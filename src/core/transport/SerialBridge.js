/**
 * SerialBridge.js
 * 链路层核心：负责串口连接、流处理、COBS帧同步与流控
 */

const { SerialPort } = require('serialport');
const EventEmitter = require('events');
const PacketCodec = require('./PacketCodec');
const { logger } = require('../../utils/logger');
const bridgeLogger = logger.create('Bridge');

const config = require('config');

class SerialBridge extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.SerialPortClass = options.SerialPortClass || SerialPort;
        this.port = null;
        this.isConnected = false;
        this.isCongested = false;
        this.buffer = Buffer.alloc(0);

        // 配置
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.shouldAutoReconnect = false; // 用户主动断开时不重连
        this.lastPath = null; // 记住上次连接的路径

        // 统计信息
        this.stats = {
            rxBytes: 0,
            txBytes: 0,
            rxFrames: 0,
            txFrames: 0,
            crcErrors: 0,
            resyncs: 0
        };
    }

    /**
     * 列出所有可用串口
     */
    static async listPorts() {
        return await SerialPort.list();
    }

    /**
     * 连接串口
     * @param {string} path 串口号
     * @param {Object} optionsOverride 覆盖默认配置
     */
    async connect(path, optionsOverride = {}) {
        // 如果正在重连中，先取消
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.isConnected) await this.disconnect();

        this.lastPath = path;
        this.shouldAutoReconnect = true; // 标记为意图保持连接

        // 合并配置: 默认配置 -> 配置文件 -> 运行时参数
        const serialConfig = config.get('serial');
        const finalConfig = { ...serialConfig, ...optionsOverride };

        return new Promise((resolve, reject) => {
            this.port = new this.SerialPortClass({
                path,
                baudRate: finalConfig.baudRate,
                dataBits: finalConfig.dataBits,
                stopBits: finalConfig.stopBits,
                parity: finalConfig.parity,
                autoOpen: false,
                rtscts: finalConfig.rtscts
            });

            this.port.open((err) => {
                if (err) {
                    this._handleConnectionError(err);
                    return reject(err);
                }

                this.isConnected = true;
                this.reconnectAttempts = 0; // 重置重连次数
                this._setupListeners();
                this.emit('open');
                resolve();
            });
        });
    }

    /**
     * 断开连接 (主动)
     */
    async disconnect() {
        this.shouldAutoReconnect = false; // 主动断开，不重连
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        if (!this.port || !this.isConnected) return;

        return new Promise((resolve) => {
            this.port.close(() => {
                this._cleanup();
                resolve();
            });
        });
    }

    _handleConnectionError(err) {
        this.emit('error', err);
        this._tryReconnect();
    }

    _tryReconnect() {
        if (!this.shouldAutoReconnect) return;

        const serialConfig = config.get('serial');
        if (!serialConfig.autoReconnect) return;

        if (serialConfig.maxReconnectAttempts > 0 && this.reconnectAttempts >= serialConfig.maxReconnectAttempts) {
            bridgeLogger.error('Max reconnect attempts reached.');
            this.emit('reconnect_failed');
            return;
        }

        this.reconnectAttempts++;
        const delay = serialConfig.reconnectInterval || 3000;

        bridgeLogger.info(`Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts})...`);
        this.emit('reconnecting', { attempt: this.reconnectAttempts });

        this.reconnectTimer = setTimeout(() => {
            this.connect(this.lastPath).catch(() => {
                // connect 内部会调用 _handleConnectionError，形成循环重试
            });
        }, delay);
    }

    /**
     * 发送数据帧
     * @param {number} type 
     * @param {number} seq 
     * @param {Buffer} body 
     * @returns {boolean} true=缓冲区未满, false=缓冲区满(需暂停)
     */
    sendFrame(type, seq, body) {
        if (!this.isConnected) throw new Error('SerialPort not connected');

        // 1. 封装帧 (含 CRC + COBS + 0x00)
        const packet = PacketCodec.encode(type, seq, body);

        // 2. 写入串口
        const notCongested = this.port.write(packet);

        // 3. 更新统计
        this.stats.txBytes += packet.length;
        this.stats.txFrames++;

        // 4. 处理背压
        if (!notCongested) {
            this.isCongested = true;
            this.emit('pause'); // 通知调度器暂停
        }

        return notCongested;
    }

    /**
     * 内部：设置监听器
     */
    _setupListeners() {
        // 数据接收
        this.port.on('data', (chunk) => {
            this.stats.rxBytes += chunk.length;
            this._handleData(chunk);
        });

        // 错误处理
        this.port.on('error', (err) => {
            this.emit('error', err);
        });

        // 连接关闭
        this.port.on('close', () => {
            this._cleanup();
            this.emit('close');
            if (this.shouldAutoReconnect) {
                this._tryReconnect();
            }
        });

        // 流控：缓冲区排空
        this.port.on('drain', () => {
            if (this.isCongested) {
                this.isCongested = false;
                this.emit('resume'); // 通知调度器恢复
            }
        });
    }

    /**
     * 内部：处理接收流 (COBS Frame Splitting)
     */
    _handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        let offset = 0;
        while (offset < this.buffer.length) {
            // 寻找帧定界符 0x00
            const delimiterIndex = this.buffer.indexOf(0x00, offset);

            if (delimiterIndex === -1) {
                // 没找到 0x00，说明帧不完整，等待更多数据
                break;
            }

            // 提取完整的一帧 (COBS Encoded Data)
            const frameBuffer = this.buffer.slice(offset, delimiterIndex);
            offset = delimiterIndex + 1; // 跳过 0x00

            if (frameBuffer.length === 0) continue; // 忽略连续的 0x00

            try {
                // 解码并校验
                const frame = PacketCodec.decode(frameBuffer);
                this.stats.rxFrames++;
                this.emit('frame', frame);
            } catch (err) {
                // 校验失败或解码失败
                this.stats.crcErrors++;
                // logger.warn('Frame Error:', err.message);
                // COBS 的特性是：一旦出错，直接丢弃，下一个 0x00 会自动同步
                // 所以这里不需要做额外的 Resync 操作，只需要记录错误
            }
        }

        // 清理已处理的数据
        if (offset > 0) {
            this.buffer = this.buffer.slice(offset);
        }
    }

    _cleanup() {
        this.isConnected = false;
        this.isCongested = false;
        this.port = null;
        this.buffer = Buffer.alloc(0);
    }
}

module.exports = SerialBridge;
