const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const config = require('config');
const { logger, auditLogger } = require('../../utils/logger');
const zlib = require('zlib');

/**
 * 扩展协议包结构：[0xAA][TYPE][SEQ][TOTAL][LEN][DATA][CHECKSUM]
 * - 0xAA: 包头 (1字节)
 * - TYPE: 包类型 (1字节，0x01=DATA, 0x02=ACK, 0x03=RETRY)
 * - SEQ: 当前块序号 (1字节)
 * - TOTAL: 总块数 (1字节)
 * - LEN: 数据长度 (1字节)
 * - DATA: 数据体 (LEN字节)
 * - CHECKSUM: 校验和 (1字节，TYPE~DATA所有字节累加和 & 0xFF)
 */

// 包类型常量
const PKG_TYPE = { DATA: 0x01, ACK: 0x02, RETRY: 0x03 };

/**
 * 串口协议说明：
 * 1. 短包协议（消息/聊天）：[0xAA][LEN][DATA][CHECKSUM]
 * 2. 分块包协议（文件/大数据）：[0xAA][TYPE][SEQ][TOTAL][LEN][DATA][CHECKSUM]
 * - TYPE: 0x01=DATA, 0x02=ACK, 0x03=RETRY
 *
 * 统一入口自动识别包类型，事件分发清晰：
 * - 'data'：短消息/聊天
 * - 'file'：大文件/分块重组完成
 * - 'progress'：文件分块接收/发送进度
 * - 'error'：异常
 */

/**
 * SerialManager 串口通信管理器
 *
 * 主要API：
 * - async connect(portOverride): 连接串口
 * - disconnect(): 断开串口
 * - getConnectionStatus(): 获取连接状态
 * - async sendData(data): 发送短消息
 * - async sendLargeData(buffer): 发送大文件
 * - on('data', fn): 收到短消息事件
 * - on('file', fn): 收到完整文件事件
 * - on('progress', fn): 文件分块进度
 * - on('error', fn): 错误事件
 * - on('connected'/'disconnected', fn): 连接状态变化
 *
 * 事件说明：
 * @event data        收到短消息（Buffer）
 * @event file        收到完整文件（Buffer）
 * @event progress    文件分块进度 {type, seq, total}
 * @event error       错误事件（Error）
 * @event connected   串口已连接
 * @event disconnected串口已断开
 */
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
   * @param {string} [portOverride] - 可选，覆盖默认串口端口
   * @returns {Promise<void>} 连接成功时resolve，否则reject
   * @throws {Error} 连接失败时抛出
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

      // 移除 ReadlineParser，改为原始 buffer 拼包
      this._recvBuffer = Buffer.alloc(0);
      this.port.on('data', (chunk) => {
        // 拼包逻辑：按协议包头和长度收集
        this._recvBuffer = Buffer.concat([this._recvBuffer, chunk]);
        while (this._recvBuffer.length > 0) {
          if (this._recvBuffer[0] !== 0xAA) {
            this._recvBuffer = this._recvBuffer.slice(1);
            continue;
          }
          // 优先判断分块包（TYPE=0x01/0x02/0x03，且长度>=8）
          if (
            this._recvBuffer.length >= 8 &&
            (this._recvBuffer[1] === 0x01 || this._recvBuffer[1] === 0x02 || this._recvBuffer[1] === 0x03)
          ) {
            const len = this._recvBuffer.readUInt16BE(6);
            const expectedLen = 8 + len + 1;
            if (this._recvBuffer.length < expectedLen) break;
            const onePacket = this._recvBuffer.slice(0, expectedLen);
            this._recvBuffer = this._recvBuffer.slice(expectedLen);
            this.handleDataReceived(onePacket);
            continue;
          }
          // 再判断短包（LEN不能太大，防止误判）
          if (this._recvBuffer.length >= 2) {
            const len = this._recvBuffer[1];
            if (len > 200) { // 防止误判
              this._recvBuffer = this._recvBuffer.slice(1);
              continue;
            }
            const expectedLen = 3 + len;
            if (this._recvBuffer.length < expectedLen) break;
            const onePacket = this._recvBuffer.slice(0, expectedLen);
            this._recvBuffer = this._recvBuffer.slice(expectedLen);
            this.handleDataReceived(onePacket);
            continue;
          }
          break;
        }
      });

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
    this.port.on('close', () => {
      this.isConnected = false;
      logger.warn('串口连接已关闭');
      this.emit('disconnected');
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });
    this.port.on('error', (error) => {
      logger.error('串口错误:', error);
      this.emit('error', error);
    });
  }

  /**
   * 发送短消息/字符串
   * @param {string|Buffer} data - 要发送的数据
   * @returns {Promise<void>} 发送成功resolve，失败reject
   * @throws {Error} 串口未连接或发送异常
   */
  async sendData(data) {
    if (!this.isConnected) {
      return Promise.reject(new Error('串口未连接'));
    }
    try {
      let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (this.compression) {
        buf = zlib.deflateSync(buf);
      }
      const packet = this.packData(buf);
      return new Promise((resolve, reject) => {
        this.port.write(packet, (err) => {
          if (err) {
            logger.error('数据发送失败:', err);
            this.emit('error', err);
            reject(err);
          } else {
            logger.info(`数据发送成功: ${buf.length} 字节`);
            auditLogger.info('数据发送成功', { size: buf.length });
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error('数据发送异常:', error);
      return Promise.reject(error);
    }
  }

  /**
   * 统一协议数据接收入口，自动区分短包/分块包
   */
  handleDataReceived(data) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // 判断包类型
    if (buf.length >= 7 && buf[0] === 0xAA) {
      // 可能是分块包
      const chunk = this.unpackChunk(buf);
      if (chunk) {
        if (chunk.type === PKG_TYPE.DATA) {
          this.handleChunk(chunk);
          this.sendAck(chunk.seq);
        } else if (chunk.type === PKG_TYPE.ACK) {
          this.emit('ack', chunk.seq);
        } else if (chunk.type === PKG_TYPE.RETRY) {
          // 可扩展：重传逻辑
        }
        // 分块包（无论类型）都直接 return
        return;
      }
    }
    // 新增：ACK/RETRY 包长度为5，且第二字节为0x02/0x03，直接 return
    if (
      buf.length === 5 &&
      buf[0] === 0xAA &&
      (buf[1] === PKG_TYPE.ACK || buf[1] === PKG_TYPE.RETRY)
    ) {
      if (buf[1] === PKG_TYPE.ACK) {
        this.emit('ack', buf[2]);
      }
      // 这是 ACK 或 RETRY 包，直接 return
      return;
    }
    // 否则尝试短包协议
    const { data: unpacked, valid } = this.unpackData(buf);
    if (!valid) {
      this.loggerWarnOrRequestRetrans(buf);
      return;
    }
    let processed = unpacked;
    if (this.compression) {
      try {
        processed = zlib.inflateSync(unpacked);
      } catch (e) {
        logger.warn('数据解压缩失败:', e);
      }
    }
    logger.info(`接收到短包数据: ${processed.length} 字节`);
    this.emit('data', processed);
    this.sendAcknowledgment();
  }

  /**
   * 分块数据重组，emit 'file' 事件
   */
  handleChunk(chunk) {
    if (!this._recvChunks) this._recvChunks = {};
    if (!this._recvTotal) this._recvTotal = chunk.total;
    this._recvChunks[chunk.seq] = chunk.data;
    // 进度细化
    const received = Object.keys(this._recvChunks).length;
    const percent = Math.round((received / this._recvTotal) * 100);
    const now = Date.now();
    if (!this._recvStartTime) this._recvStartTime = now;
    const elapsed = (now - this._recvStartTime) / 1000;
    const bytes = Object.values(this._recvChunks).reduce((a, b) => a + b.length, 0);
    const speed = elapsed > 0 ? Math.round(bytes / elapsed) : 0;
    const eta = speed > 0 ? Math.round((bytes * (this._recvTotal - received)) / speed) : 0;
    this.emit('progress', {
      type: 'receive',
      seq: chunk.seq,
      total: this._recvTotal,
      percent,
      speed,
      eta
    });
    // 全部收到
    if (received === this._recvTotal) {
      const bufs = [];
      for (let i = 0; i < this._recvTotal; i++) bufs.push(this._recvChunks[i]);
      let all = Buffer.concat(bufs);
      if (this.compression) {
        try { all = zlib.inflateSync(all); } catch (e) { logger.warn('解压失败', e); }
      }
      this.emit('file', all);
      this._recvChunks = null;
      this._recvTotal = null;
      this._recvStartTime = null;
    }
  }

  /**
   * 辅助：无效包时日志与重传
   */
  loggerWarnOrRequestRetrans(buf) {
    logger.warn('接收到无效协议包，请求重传', buf);
    this.requestRetransmission();
    this.emit('error', new Error('协议包校验失败'));
  }

  /**
   * 发送确认
   */
  sendAcknowledgment() {
    if (this.isConnected) {
      this.port.write(`ACK\r\n`);
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
   * 断开串口连接
   * @returns {Promise<void>} 断开成功resolve，失败reject
   */
  disconnect() {
    return new Promise((resolve, reject) => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.port && this.isConnected) {
        this.port.close((error) => {
          if (error) {
            logger.error('断开连接错误:', error);
            reject(error);
          } else {
            logger.info('串口连接已断开');
            this.isConnected = false;
            this.emit('disconnected');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取当前连接状态
   * @returns {{isConnected: boolean, port: string, reconnectAttempts: number, maxReconnectAttempts: number, lastActive?: number, currentTask?: string, speed?: number}}
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      port: config.get('serial.port'),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      // 可选扩展
      lastActive: this._lastActive || Date.now(),
      currentTask: this._currentTask || '',
      speed: this._currentSpeed || 0
    };
  }

  /**
   * 打包数据为协议包
   * @param {Buffer} data
   * @returns {Buffer}
   */
  packData(data) {
    if (!Buffer.isBuffer(data)) data = Buffer.from(data);
    const len = data.length;
    const checksum = this.calcChecksum(data);
    return Buffer.concat([
      Buffer.from([0xAA, len]),
      data,
      Buffer.from([checksum])
    ]);
  }

  /**
   * 解包协议包，返回{data, valid}
   * @param {Buffer} buf
   * @returns {{data: Buffer, valid: boolean}}
   */
  unpackData(buf) {
    if (buf.length < 4) return { data: null, valid: false };
    if (buf[0] !== 0xAA) return { data: null, valid: false };
    const len = buf[1];
    if (buf.length !== len + 3) return { data: null, valid: false };
    const data = buf.slice(2, 2 + len);
    const checksum = buf[2 + len];
    const valid = this.calcChecksum(data) === checksum;
    return { data, valid };
  }

  /**
   * 计算校验和
   * @param {Buffer} data
   * @returns {number}
   */
  calcChecksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data[i]) & 0xFF;
    }
    return sum;
  }

  /**
   * 发送大文件/二进制数据（分块协议，带ACK/重传）
   * @param {Buffer} data - 要发送的完整文件数据
   * @returns {Promise<void>} 全部发送成功resolve，失败reject
   * @throws {Error} 发送失败（如重试用尽）
   * @emits progress {type: 'send', seq, total, percent, speed, retries, totalRetries, lostBlocks}
   */
  async sendLargeData(data) {
    if (!this.isConnected) return Promise.reject(new Error('串口未连接'));
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (this.compression) {
      buf = zlib.deflateSync(buf);
    }
    const chunkSize = this.chunkSize || 256;
    const total = Math.ceil(buf.length / chunkSize);
    let startTime = Date.now();
    let sentBytes = 0;
    let totalRetries = 0;
    let lostBlocks = 0;
    for (let seq = 0; seq < total; seq++) {
      const chunk = buf.slice(seq * chunkSize, (seq + 1) * chunkSize);
      let retries = 0;
      while (retries < this.retryAttempts) {
        await this._writePacket(this.packChunk(PKG_TYPE.DATA, seq, total, chunk));
        const ack = await this._waitForAck(seq, this.timeout);
        if (ack) break;
        retries++;
        // 只写入日志文件，不在控制台输出
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`块${seq}未收到ACK，重试${retries}`, { onlyFile: true });
        }
      }
      if (retries === this.retryAttempts) return Promise.reject(new Error(`块${seq}发送失败`));
      sentBytes += chunk.length;
      totalRetries += retries;
      if (retries > 0) lostBlocks++;
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;
      const speed = elapsed > 0 ? Math.round(sentBytes / elapsed) : 0;
      const percent = Math.round(((seq + 1) / total) * 100);
      this.emit('progress', {
        type: 'send',
        seq,
        total,
        percent,
        speed, // B/s
        retries, // 当前块重试
        totalRetries, // 累计重试
        lostBlocks // 累计丢块
      });
    }
    // 发送完成后，确保info日志单独成行，避免与进度行混合
    //console.log('');
    logger.info('所有数据块发送完成');
    return Promise.resolve();
  }

  /**
   * 发送协议包
   */
  _writePacket(packet) {
    return new Promise((resolve, reject) => {
      this.port.write(packet, (err) => {
        if (err) reject(err);
        else this.port.drain((err2) => {
          if (err2) reject(err2);
          else resolve();
        });
      });
    });
  }

  /**
   * 等待ACK
   */
  _waitForAck(seq, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener('ack', onAck);
        resolve(false);
      }, timeout);
      const onAck = (ackSeq) => {
        if (ackSeq === seq) {
          clearTimeout(timer);
          this.removeListener('ack', onAck);
          resolve(true);
        }
      };
      this.on('ack', onAck);
    });
  }

  /**
   * 组包（分块协议包）
   */
  packChunk(type, seq, total, data) {
    const len = data.length;
    // header应为8字节
    const header = Buffer.alloc(8);
    header[0] = 0xAA;
    header[1] = type;
    header.writeUInt16BE(seq, 2);    // seq: 2字节
    header.writeUInt16BE(total, 4);  // total: 2字节
    header.writeUInt16BE(len, 6);    // len: 2字节
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sum = [...header.slice(1, 8), ...body].reduce((a, b) => (a + b) & 0xFF, 0);
    const packet = Buffer.concat([header, body, Buffer.from([sum])]);
    return packet;
  }

  /**
   * 解包（分块协议包）
   */
  unpackChunk(buf) {
    if (buf.length < 9) return null;
    if (buf[0] !== 0xAA) return null;
    const type = buf[1];
    const seq = buf.readUInt16BE(2);
    const total = buf.readUInt16BE(4);
    const len = buf.readUInt16BE(6);
    if (buf.length !== 8 + len + 1) return null;
    const data = buf.slice(8, 8 + len);
    const checksum = buf[8 + len];
    const sum = [...buf.slice(1, 8), ...data].reduce((a, b) => (a + b) & 0xFF, 0);
    if (checksum !== sum) return null;
    return { type, seq, total, data };
  }

  /**
   * 发送ACK
   */
  sendAck(seq) {
    const ack = this.packChunk(PKG_TYPE.ACK, seq, 0, Buffer.alloc(0));
    this.port.write(ack);
  }
}

module.exports = SerialManager; 