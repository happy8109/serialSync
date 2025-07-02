const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const config = require('config');
const { logger, auditLogger } = require('../../utils/logger');
const zlib = require('zlib');

class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.get('serial.maxReconnectAttempts');
    this.reconnectInterval = config.get('serial.reconnectInterval');
    this.autoReconnect = config.get('serial.autoReconnect');
    this.reconnectTimer = null;
    this.dataBuffer = Buffer.alloc(0);
    this.chunkSize = config.get('sync.chunkSize');
    this.timeout = config.get('sync.timeout');
    this.retryAttempts = config.get('sync.retryAttempts');
    this.compression = config.get('sync.compression');
  }

  /**
   * 连接串口
   */
  async connect(portOverride) {
    try {
      const serialConfig = { ...config.get('serial') };
      if (portOverride) {
        serialConfig.port = portOverride;
      }
      this.port = new SerialPort({
        path: serialConfig.port,
        baudRate: serialConfig.baudRate,
        dataBits: serialConfig.dataBits,
        stopBits: serialConfig.stopBits,
        parity: serialConfig.parity,
        timeout: serialConfig.timeout
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      // 设置事件监听器
      this.setupEventListeners();

      logger.info(`串口连接已建立: ${serialConfig.port}`);
      auditLogger.info('串口连接成功', { port: serialConfig.port });

      return new Promise((resolve, reject) => {
        this.port.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        });

        this.port.on('error', (error) => {
          logger.error('串口连接错误:', error);
          this.isConnected = false;
          this.emit('error', error);
          reject(error);
        });
      });
    } catch (error) {
      logger.error('串口连接失败:', error);
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 数据接收
    this.parser.on('data', (data) => {
      this.handleDataReceived(data);
    });

    // 连接关闭
    this.port.on('close', () => {
      this.isConnected = false;
      logger.warn('串口连接已关闭');
      this.emit('disconnected');
      
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    // 错误处理
    this.port.on('error', (error) => {
      logger.error('串口错误:', error);
      this.emit('error', error);
    });
  }

  /**
   * 处理接收到的数据
   */
  handleDataReceived(data) {
    try {
      // 数据校验
      if (!this.validateData(data)) {
        logger.warn('接收到无效数据，请求重传');
        this.requestRetransmission();
        return;
      }

      // 数据解压缩
      let processedData = data;
      if (this.compression) {
        try {
          processedData = zlib.inflateSync(Buffer.from(data, 'base64')).toString();
        } catch (error) {
          logger.warn('数据解压缩失败:', error);
        }
      }

      logger.info(`接收到数据: ${processedData.length} 字节`);
      this.emit('data', processedData);
      
      // 发送确认
      this.sendAcknowledgment();
    } catch (error) {
      logger.error('数据处理错误:', error);
    }
  }

  /**
   * 发送数据
   */
  async sendData(data, retryCount = 0) {
    if (!this.isConnected) {
      throw new Error('串口未连接');
    }

    try {
      let processedData = data;
      
      // 数据压缩
      if (this.compression && typeof data === 'string') {
        processedData = zlib.deflateSync(data).toString('base64');
      }

      // 添加校验和
      const checksum = this.calculateChecksum(processedData);
      const dataWithChecksum = `${processedData}|${checksum}`;

      // 分块发送
      const chunks = this.chunkData(dataWithChecksum, this.chunkSize);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkWithIndex = `${i}|${chunks.length}|${chunk}`;
        
        await this.sendChunk(chunkWithIndex);
        
        // 等待确认
        const acknowledged = await this.waitForAcknowledgment(i, this.timeout);
        if (!acknowledged) {
          if (retryCount < this.retryAttempts) {
            logger.warn(`块 ${i} 发送失败，重试 ${retryCount + 1}/${this.retryAttempts}`);
            return this.sendData(data, retryCount + 1);
          } else {
            throw new Error(`块 ${i} 发送失败，已达到最大重试次数`);
          }
        }
      }

      logger.info(`数据发送成功: ${data.length} 字节`);
      auditLogger.info('数据发送成功', { 
        size: data.length, 
        chunks: chunks.length 
      });
      
    } catch (error) {
      logger.error('数据发送失败:', error);
      throw error;
    }
  }

  /**
   * 发送数据块
   */
  sendChunk(chunk) {
    return new Promise((resolve, reject) => {
      this.port.write(chunk + '\r\n', (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 等待确认
   */
  waitForAcknowledgment(chunkIndex, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);

      const onAck = (data) => {
        if (data === `ACK:${chunkIndex}`) {
          clearTimeout(timer);
          this.parser.removeListener('data', onAck);
          resolve(true);
        }
      };

      this.parser.on('data', onAck);
    });
  }

  /**
   * 发送确认
   */
  sendAcknowledgment(chunkIndex) {
    if (this.isConnected) {
      this.port.write(`ACK:${chunkIndex}\r\n`);
    }
  }

  /**
   * 请求重传
   */
  requestRetransmission() {
    if (this.isConnected) {
      this.port.write('RETRY\r\n');
    }
  }

  /**
   * 分块数据
   */
  chunkData(data, chunkSize) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * 计算校验和
   */
  calculateChecksum(data) {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum += data.charCodeAt(i);
    }
    return checksum.toString(16);
  }

  /**
   * 验证数据
   */
  validateData(data) {
    const parts = data.split('|');
    if (parts.length !== 2) return false;
    
    const [dataPart, checksum] = parts;
    const calculatedChecksum = this.calculateChecksum(dataPart);
    return checksum === calculatedChecksum;
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    logger.info(`安排重连 ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('重连失败:', error);
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      }
    }, this.reconnectInterval);
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.port && this.isConnected) {
      this.port.close((error) => {
        if (error) {
          logger.error('断开连接错误:', error);
        } else {
          logger.info('串口连接已断开');
          this.isConnected = false;
          this.emit('disconnected');
        }
      });
    }
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      port: config.get('serial.port'),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts
    };
  }
}

module.exports = SerialManager; 