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
const PKG_TYPE = { DATA: 0x01, ACK: 0x02, RETRY: 0x03, FILE_REQ: 0x10, FILE_ACCEPT: 0x11, FILE_REJECT: 0x12 };

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
    this.dataBuffer = Buffer.alloc(0);
    this.chunkSize = config.get('sync.chunkSize');
    this.timeout = config.get('sync.timeout');
    this.retryAttempts = config.get('sync.retryAttempts');
    this.compression = config.get('sync.compression');
    this.confirmTimeout = config.get('sync.confirmTimeout', 30000);
    this._fileSessions = {}; // { reqId: { meta, savePath, chunks: {}, total, startTime } }
    this._userPort = null; // 记住用户指定端口
    this._currentPort = null; // 记录当前实际连接端口
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
        this._userPort = portOverride; // 记住用户指定端口
      } else if (this._userPort) {
        serialConfig.port = this._userPort; // 自动重连时优先用用户端口
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
          // 优先判断 FILE_REQ/ACCEPT/REJECT 包
          if (this._recvBuffer.length >= 4 && 
              (this._recvBuffer[1] === PKG_TYPE.FILE_REQ || 
               this._recvBuffer[1] === PKG_TYPE.FILE_ACCEPT || 
               this._recvBuffer[1] === PKG_TYPE.FILE_REJECT)) {
            const type = this._recvBuffer[1];
            const reqId = this._recvBuffer[2];
            const metaLen = this._recvBuffer[3];
            const expectedLen = 4 + metaLen + 1;
            if (this._recvBuffer.length < expectedLen) {
              break;
            }
            const onePacket = this._recvBuffer.slice(0, expectedLen);
            this._recvBuffer = this._recvBuffer.slice(expectedLen);
            this.handleDataReceived(onePacket);
            continue;
          }
          // 再判断分块包（TYPE=0x01/0x02/0x03，且长度>=9，带REQ_ID）
          if (
            this._recvBuffer.length >= 9 &&
            (this._recvBuffer[1] === 0x01 || this._recvBuffer[1] === 0x02 || this._recvBuffer[1] === 0x03)
          ) {
            const len = this._recvBuffer.readUInt16BE(7);
            const expectedLen = 9 + len + 1;
            if (this._recvBuffer.length < expectedLen) {
              break;
            }
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
          this._currentPort = serialConfig.port;
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
      // logger.warn('串口连接已关闭'); // 删除终端 warn 输出
      this.emit('disconnected');
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
   * 新协议：发送文件（先FILE_REQ，后分块，带REQ_ID）
   * @param {Buffer|string} fileData - 文件数据或路径
   * @param {Object} meta - 文件元数据（如 name, size, type 等）
   * @param {Object} options - 传输选项
   * @param {boolean} options.requireConfirm - 是否需要接收方确认（默认false，即自动同意）
   * @returns {Promise<void>}
   */
  async sendFile(fileData, meta = {}, options = {}) {
    // 发送前清理会话和监听，防止残留影响
    this._fileSessions = {};
    this.removeAllListeners('_fileAccept');
    this.removeAllListeners('_fileReject');
    this.removeAllListeners('_ack');
    const fs = require('fs');
    const path = require('path');
    let buf;
    if (typeof fileData === 'string') {
      // 传入的是文件路径
      buf = fs.readFileSync(fileData);
      if (!meta.name) meta.name = path.basename(fileData);
      if (!meta.size) meta.size = buf.length;
    } else {
      buf = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);
      if (!meta.size) meta.size = buf.length;
    }
    if (!meta.name) meta.name = 'unnamed_' + Date.now();
    if (!meta.type && meta.name.includes('.')) meta.type = meta.name.split('.').pop();
    // 1. 发送 FILE_REQ（包含文件名和确认要求）
    const reqId = Math.floor(Math.random() * 200) + 1; // 简单生成，实际可更健壮
    const fileName = meta.name || 'unnamed_' + Date.now();
    
    // 构建元数据：文件名 + 文件大小 + 确认要求标志
    const requireConfirm = options.requireConfirm || false;
    const metaData = {
      name: fileName,
      size: meta.size || buf.length,
      requireConfirm: requireConfirm
    };
    const metaStr = JSON.stringify(metaData);
    const metaBuf = Buffer.from(metaStr, 'utf8');
    
    const reqHeader = Buffer.from([0xAA, PKG_TYPE.FILE_REQ, reqId, metaBuf.length]);
    const reqSum = [PKG_TYPE.FILE_REQ, reqId, metaBuf.length, ...metaBuf].reduce((a, b) => (a + b) & 0xFF, 0);
    const reqPacket = Buffer.concat([reqHeader, metaBuf, Buffer.from([reqSum])]);
    await this._writePacket(reqPacket);
    // 2. 等待 FILE_ACCEPT/REJECT
    const accept = await new Promise((resolve, reject) => {
      // 对于需要确认的文件传输，使用配置的确认超时时间
      const confirmTimeout = requireConfirm ? this.confirmTimeout : (this.timeout * 20);
      const timer = setTimeout(() => {
        this.removeListener('_fileAccept', onAccept);
        this.removeListener('_fileReject', onReject);
        reject(new Error('等待对端确认超时'));
      }, confirmTimeout);
      const onAccept = (recvReqId) => {
        if (recvReqId === reqId) {
          clearTimeout(timer);
          this.removeListener('_fileAccept', onAccept);
          this.removeListener('_fileReject', onReject);
          resolve(true);
        }
      };
      const onReject = (recvReqId, reason) => {
        if (recvReqId === reqId) {
          clearTimeout(timer);
          this.removeListener('_fileAccept', onAccept);
          this.removeListener('_fileReject', onReject);
          reject(new Error('对端拒绝接收: ' + (reason || '无理由')));
        }
      };
      this.on('_fileAccept', onAccept);
      this.on('_fileReject', onReject);
    });
    if (!accept) throw new Error('对端未同意接收');
    // 3. 分块发送（所有包带 REQ_ID）
    let sendBuf = buf;
    if (this.compression) {
      sendBuf = zlib.deflateSync(sendBuf);
    }
    const chunkSize = this.chunkSize || 256;
    const total = Math.ceil(sendBuf.length / chunkSize);
    let startTime = Date.now();
    let sentBytes = 0;
    let totalRetries = 0;
    let lostBlocks = 0;
    for (let seq = 0; seq < total; seq++) {
      const chunk = sendBuf.slice(seq * chunkSize, (seq + 1) * chunkSize);
      let retries = 0;
      while (retries < this.retryAttempts) {
        await this._writePacket(this._packChunkWithReqId(PKG_TYPE.DATA, reqId, seq, total, chunk));
        const ack = await this._waitForAckNew(reqId, seq, this.timeout);
        if (ack) break;
        retries++;
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`块${seq}未收到ACK，重试${retries}`, { onlyFile: true });
        }
      }
      if (retries === this.retryAttempts) throw new Error(`块${seq}发送失败`);
      sentBytes += chunk.length;
      totalRetries += retries;
      if (retries > 0) lostBlocks++;
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;
      const speed = elapsed > 0 ? Math.round(sentBytes / elapsed) : 0;
      const percent = Math.round(((seq + 1) / total) * 100);
      this.emit('progress', {
        type: 'send',
        reqId,
        seq,
        total,
        percent,
        speed,
        retries,
        totalRetries,
        lostBlocks,
        meta
      });
    }
    logger.info('所有数据块发送完成');
  }

  /**
   * 统一协议数据接收入口，自动区分短包/分块包
   */
  handleDataReceived(data) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // 只保留新协议：优先判断 FILE_REQ/ACCEPT/REJECT
    if (buf.length >= 4 && buf[0] === 0xAA) {
      const type = buf[1];
      if (type === PKG_TYPE.FILE_REQ) {
        // [0xAA][0x10][REQ_ID][LEN][META][CHECKSUM]
        const reqId = buf[2];
        const metaLen = buf[3];
        if (buf.length === 4 + metaLen + 1) {
          const metaStr = buf.slice(4, 4 + metaLen).toString();
          let meta;
          let requireConfirm = false;
          
          try {
            // 尝试解析为JSON格式（新协议）
            const metaData = JSON.parse(metaStr);
            meta = { 
              name: metaData.name,
              size: metaData.size
            };
            requireConfirm = metaData.requireConfirm || false;
          } catch (e) {
            // 兼容旧协议：直接是文件名字符串
            meta = { name: metaStr };
            requireConfirm = false;
          }
          
          const checksum = buf[4 + metaLen];
          const sum = [type, reqId, metaLen, ...Buffer.from(metaStr)].reduce((a, b) => (a + b) & 0xFF, 0);
          if (checksum === sum) {
            // 触发 fileRequest 事件，带 accept/reject 回调和确认要求
            const self = this;
            const acceptCallback = function(savePath) {
              // 发送 FILE_ACCEPT
              const acceptHeader = Buffer.from([0xAA, PKG_TYPE.FILE_ACCEPT, reqId, 0]);
              const acceptSum = [PKG_TYPE.FILE_ACCEPT, reqId, 0].reduce((a, b) => (a + b) & 0xFF, 0);
              const acceptBuf = Buffer.concat([acceptHeader, Buffer.from([acceptSum])]);
              self.port.write(acceptBuf, (err) => {
                if (err) {
                  logger.error('FILE_ACCEPT 包写入串口失败:', err);
                }
              });
              // 记录会话，准备接收分块
              self._fileSessions[reqId] = {
                meta,
                savePath: savePath || meta.name,
                chunks: {},
                total: null,
                startTime: Date.now()
              };
            };
            const rejectCallback = function(reason) {
              // 发送 FILE_REJECT
              const reasonBuf = Buffer.from(reason || '', 'utf8');
              const rejectHeader = Buffer.from([0xAA, PKG_TYPE.FILE_REJECT, reqId, reasonBuf.length]);
              const sum2 = [PKG_TYPE.FILE_REJECT, reqId, reasonBuf.length, ...reasonBuf].reduce((a, b) => (a + b) & 0xFF, 0);
              const rejectBuf = Buffer.concat([rejectHeader, reasonBuf, Buffer.from([sum2])]);
              self.port.write(rejectBuf);
            };
            
            // 传递确认要求信息给上层应用
            this.emit('fileRequest', meta, acceptCallback, rejectCallback, { requireConfirm });
            // 自动同意逻辑：只有在不需要确认时才自动同意
            if (!requireConfirm) {
            const autoAccept = (config.has && config.has('sync.autoAccept')) ? config.get('sync.autoAccept') : true;
            if (autoAccept) {
              // 默认保存到配置目录+文件名
              const path = require('path');
              const saveDir = (config.has && config.has('sync.saveDir')) ? config.get('sync.saveDir') : path.join(process.cwd(), 'recv');
              const fs = require('fs');
              if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
              const savePath = path.join(saveDir, meta.name || ('recv_' + Date.now()));
              // 直接调用 accept 回调
              acceptCallback(savePath);
            }
            }
            // 如果需要确认，则等待上层应用（CLI/UI）处理
            return;
          }
        }
      } else if (type === PKG_TYPE.FILE_ACCEPT) {
        const reqId = buf[2];
        this.emit('_fileAccept', reqId);
        return;
      } else if (type === PKG_TYPE.FILE_REJECT) {
        const reqId = buf[2];
        const len = buf[3];
        const reason = buf.slice(4, 4 + len).toString();
        this.emit('_fileReject', reqId, reason);
        return;
      }
    }
    // 只保留新协议分块包（带REQ_ID）
    if (buf.length >= 9 && buf[0] === 0xAA && (buf[1] === PKG_TYPE.DATA || buf[1] === PKG_TYPE.ACK || buf[1] === PKG_TYPE.RETRY)) {
      const type = buf[1];
      const reqId = buf[2];
          // 只声明一次 seq
    const seq = buf.readUInt16BE(3);
    const total = buf.readUInt16BE(5);
    const len = buf.readUInt16BE(7);
      if (buf.length !== 9 + len + 1) return;
      const data = buf.slice(9, 9 + len);
      const checksum = buf[9 + len];
      const sum = [type, reqId, ...buf.slice(3, 9), ...data].reduce((a, b) => (a + b) & 0xFF, 0);
      if (checksum !== sum) return;
      // 只处理 DATA 包
      if (type === PKG_TYPE.DATA) {
        // 查找会话
        const session = this._fileSessions[reqId];
        if (!session) {
          return; // 未确认的文件请求
        }
        if (!session.total) session.total = total;
        session.chunks[seq] = data;
        // 发送 ACK
        const ackPacket = this._packChunkWithReqId(PKG_TYPE.ACK, reqId, seq, 0, Buffer.alloc(0));
        this.port.write(ackPacket);
        // 进度事件
        const received = Object.keys(session.chunks).length;
        const percent = Math.round((received / session.total) * 100);
        const now = Date.now();
        const elapsed = (now - session.startTime) / 1000;
        const bytes = Object.values(session.chunks).reduce((a, b) => a + b.length, 0);
        const speed = elapsed > 0 ? Math.round(bytes / elapsed) : 0;
        this.emit('progress', {
          type: 'receive',
          reqId,
          seq,
          total: session.total,
          percent,
          speed,
          meta: session.meta
        });
        // 全部收到
        if (received === session.total) {
          const bufs = [];
          for (let i = 0; i < session.total; i++) bufs.push(session.chunks[i]);
          let all = Buffer.concat(bufs);
          if (this.compression) {
            try { all = zlib.inflateSync(all); } catch (e) { logger.warn('解压失败', e); }
          }
          this.emit('file', all, session.meta, session.savePath);
          delete this._fileSessions[reqId];
        }
      } else if (type === PKG_TYPE.ACK) {
        this.emit('_ack', reqId, seq);
      }
      return;
    }
    // 恢复短包协议解析
    if (buf.length >= 4 && buf[0] === 0xAA) {
      const len = buf[1];
      if (buf.length === len + 3) {
        const dataPart = buf.slice(2, 2 + len);
        const checksum = buf[2 + len];
        const valid = this.calcChecksum(dataPart) === checksum;
        if (valid) {
          let processed = dataPart;
    if (this.compression) {
            try { processed = zlib.inflateSync(dataPart); } catch (e) { logger.warn('数据解压缩失败:', e); }
    }
    logger.info(`接收到短包数据: ${processed.length} 字节`);
    this.emit('data', processed);
          this.sendAcknowledgment && this.sendAcknowledgment();
        }
      }
    }
    // 其余包型全部忽略
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
   * 断开串口连接
   * @param {boolean} isManual - 是否为手动断开，手动断开时临时关闭自动重连
   * @returns {Promise<void>} 断开成功resolve，失败reject
   */
  disconnect(isManual = false) {
    return new Promise((resolve, reject) => {
    if (this.port && this.isConnected) {
      this.port.close((error) => {
        if (error) {
          logger.error('断开连接错误:', error);
            reject(error);
        } else {
          logger.info('串口连接已断开');
          this.isConnected = false;
          this.emit('disconnected');
          // 不再自动重连，由上层业务决定
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
      port: this._currentPort,
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

  // 新协议分块包组包
  _packChunkWithReqId(type, reqId, seq, total, data) {
    const len = data.length;
    const header = Buffer.alloc(9);
    header[0] = 0xAA;
    header[1] = type;
    header[2] = reqId;
    header.writeUInt16BE(seq, 3);
    header.writeUInt16BE(total, 5);
    header.writeUInt16BE(len, 7);
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sum = [type, reqId, ...header.slice(3, 9), ...body].reduce((a, b) => (a + b) & 0xFF, 0);
    return Buffer.concat([header, body, Buffer.from([sum])]);
  }

  // 新协议ACK等待
  _waitForAckNew(reqId, seq, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener('_ack', onAck);
        resolve(false);
      }, timeout);
      const onAck = (recvReqId, ackSeq) => {
        if (recvReqId === reqId && ackSeq === seq) {
          clearTimeout(timer);
          this.removeListener('_ack', onAck);
          resolve(true);
        }
      };
      this.on('_ack', onAck);
    });
  }
}

module.exports = SerialManager; 