/**
 * SerialBridge.js
 * 链路层核心：负责串口连接、流处理、COBS帧同步与流控
 * v3.2 - 持续性心跳握手 (取代盲等 linkReadyDelay)
 *   - 快探测: linkReady=false 时每 2s 发 PING
 *   - 慢保活: linkReady=true 后每 30s 发 PING
 *   - 断线检测: 连续 3 次 PING 无 PONG → linkReady=false
 */

const { SerialPort } = require('serialport');
const EventEmitter = require('events');
const PacketCodec = require('./PacketCodec');
const ReliableLink = require('./ReliableLink');
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

        // 链路就绪标志（通过心跳探测确认对端在线）
        this.linkReady = false;
        this.heartbeatTimer = null;
        this.heartbeatMissCount = 0;  // 连续未收到 PONG 的次数
        this.heartbeatWaitingPong = false; // 是否正在等待 PONG
        this.PROBE_INTERVAL = 2000;   // 快探测间隔 (linkReady=false)
        this.KEEPALIVE_INTERVAL = 10000; // 慢保活间隔 (linkReady=true)
        this.MAX_MISS = 3;            // 连续丢失 N 次 PONG 判定断连

        // 统计信息
        this.stats = {
            rxBytes: 0,
            txBytes: 0,
            rxFrames: 0,
            txFrames: 0,
            crcErrors: 0,
            resyncs: 0
        };

        // ARQ 配置
        this.enableARQ = options.enableARQ !== false; // 默认启用
        this.reliableLink = null; // 延迟初始化

        // 初始化 ARQ 层
        if (this.enableARQ) {
            this.reliableLink = new ReliableLink(this, options.arqConfig);
            // 转发可靠层的帧事件到上层
            this.reliableLink.on('frame', (frame) => this.emit('frame', frame));
            this.reliableLink.on('transmit_failed', (info) => this.emit('transmit_failed', info));
        }
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
        const finalOverride = typeof optionsOverride === 'number' ? { baudRate: optionsOverride } : optionsOverride;
        const finalConfig = { ...serialConfig, ...finalOverride };

        return new Promise((resolve, reject) => {
            // Set intent config immediately so getStatus returns correct info during connection attempts
            this.baudRate = finalConfig.baudRate;
            this.currentConfig = finalConfig;

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

                // 显式拉高 DTR 和 RTS 信号 (物理串口通常需要，尤其是 USB 转串口适配器)
                this.port.set({ dtr: true, rts: true }, (setErr) => {
                    if (setErr) bridgeLogger.debug(`[串口] 设置 DTR/RTS 失败: ${setErr.message}`);
                    else bridgeLogger.info(`[串口] 信号已就绪 (DTR=1, RTS=1)`);
                });

                this.isConnected = true;
                this.reconnectAttempts = 0;
                this._setupListeners();

                // 启动心跳探测（取代盲等计时器）
                this.linkReady = false;
                this.heartbeatMissCount = 0;
                this.heartbeatWaitingPong = false;
                bridgeLogger.info(`[串口] 开始心跳探测，等待对端响应...`);
                this._startHeartbeat(this.PROBE_INTERVAL);

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

    async setConfig(newConfig) {
        if (!this.currentConfig) this.currentConfig = {};

        // 兼容性修正：UI/Config 使用 'port'，但 SerialPort 使用 'path'
        if (newConfig.port && !newConfig.path) {
            newConfig.path = newConfig.port;
        }

        const oldConfig = { ...this.currentConfig };
        Object.assign(this.currentConfig, newConfig);

        // 检测物理参数是否变化
        const needsRestart = this.isConnected && (
            oldConfig.path !== this.currentConfig.path ||
            oldConfig.baudRate !== this.currentConfig.baudRate ||
            oldConfig.dataBits !== this.currentConfig.dataBits ||
            oldConfig.stopBits !== this.currentConfig.stopBits ||
            oldConfig.parity !== this.currentConfig.parity
        );

        if (needsRestart) {
            bridgeLogger.info('[串口] 检测到物理参数变更，正在重启连接...');
            this.emit('status-message', '检测到物理参数变更，正在重启连接...');
            try {
                // 1. 临时保存自动重连意图 (disconnect会将其设为false)
                const wasAutoReconnect = this.currentConfig.autoReconnect;

                // 2. 强制关闭当前连接
                // 我们不调用 disconnect() 因为它带有业务含义(用户停止)，我们直接操作底层
                // 或者调用 disconnect() 然后手动恢复标志
                await this.disconnect();

                // 3. 恢复重连标志 (disconnect副作用修正)
                this.shouldAutoReconnect = wasAutoReconnect;

                // 4. 使用新配置立即连接
                // 给一点点缓冲时间，让端口释放
                setTimeout(() => {
                    const targetPath = this.currentConfig.path || this.currentConfig.port;
                    this.connect(targetPath, this.currentConfig)
                        .catch(err => {
                            bridgeLogger.error(`[串口] 热更新重连失败: ${err.message}`);
                            // 触发重连循环
                            this._handleConnectionError(err);
                        });
                }, 500);

            } catch (err) {
                bridgeLogger.error('[串口] 热更新过程出错', err);
            }
        } else {
            // 参数无实质变化，或者当前未连接
            bridgeLogger.info('[串口] 配置已更新（无需重启）');
            this.emit('status-message', '配置已更新（无需重启）');

            // 强联动逻辑：
            // 如果当前是断开状态，但新配置要求"自动重连"，则立即尝试连接。
            // 这覆盖了之前可能的手动 disconnect 状态。
            const targetPath = this.currentConfig.path || this.currentConfig.port;
            if (!this.isConnected && this.currentConfig.autoReconnect && targetPath) {
                bridgeLogger.info('[串口] 配置保存触发自动连接...');
                this.emit('status-message', '配置保存触发自动连接...');
                this.shouldAutoReconnect = true;
                this._tryReconnect();
            }
        }
    }

    _tryReconnect() {
        if (!this.shouldAutoReconnect) return;

        // Use runtime config priority
        const serialConfig = this.currentConfig || config.get('serial');
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

        // 链路就绪检查: 连接初期延迟发送，等待对端就绪
        if (!this.linkReady) {
            bridgeLogger.info(`[串口] 链路未就绪，丢弃帧 type=0x${type.toString(16)}`);
            return true; // 返回 true 避免触发背压
        }

        // 如果启用了 ARQ，委托给 ReliableLink
        if (this.enableARQ && this.reliableLink) {
            this.reliableLink.send(type, seq, body);
            return true; // ARQ 模式下始终返回 true，背压由底层处理
        }

        // 直接发送模式 (ARQ 禁用)
        const packet = PacketCodec.encode(type, seq, body);
        const notCongested = this.port.write(packet);

        this.stats.txBytes += packet.length;
        this.stats.txFrames++;

        if (!notCongested) {
            this.isCongested = true;
            this.emit('pause');
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
            // Ignore common Windows errors during disconnect/close
            if (err.message && (err.message.includes('Operation aborted') || err.message.includes('Access is denied'))) {
                // bridgeLogger might not be available here as 'this'. Just use logging if possible or silent.
                // bridgeLogger is imported in file scope.
                bridgeLogger.debug(`Ignored serial error (expected during reset): ${err.message}`);
                return;
            }
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
        if (chunk.length > 0) {
            bridgeLogger.debug(`[串口] 接收原始数据: ${chunk.length} 字节`);
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);

        let offset = 0;
        while (offset < this.buffer.length) {
            const delimiterIndex = this.buffer.indexOf(0x00, offset);

            if (delimiterIndex === -1) {
                break;
            }

            const frameBuffer = this.buffer.slice(offset, delimiterIndex);
            offset = delimiterIndex + 1;

            if (frameBuffer.length === 0) continue;

            try {
                const frame = PacketCodec.decode(frameBuffer);
                this.stats.rxFrames++;
                bridgeLogger.debug(`[串口] 解码成功: type=0x${frame.type.toString(16)}, fSeq=${frame.fSeq}, fAck=${frame.fAck}, bodyLen=${frame.body.length}`);

                // 收到合法帧 → 链路就绪 + 重置心跳失败计数
                // (任何合法帧都证明对端在线，避免繁忙时误判断连)
                this.heartbeatMissCount = 0;
                if (!this.linkReady) {
                    this.linkReady = true;
                    bridgeLogger.info(`[串口] 收到对端帧，链路已就绪`);
                    // 切换到慢保活
                    this._startHeartbeat(this.KEEPALIVE_INTERVAL);
                    this.emit('linkReady');
                }

                // 心跳 PING/PONG 在 bridge 层拦截，不进入 ARQ
                // （raw PING 的 fSeq=0 会被 ARQ 当作重复帧丢弃）
                if (frame.type === 0x00 && frame.fSeq === 0) {
                    // 收到心跳 PING → 直接回复 raw PONG
                    this._sendRawPong();
                    continue; // 不传递给 ARQ 或上层
                }
                if (frame.type === 0x01 && frame.fSeq === 0) {
                    // 收到心跳 PONG → 标记探测周期完成
                    this.heartbeatWaitingPong = false;
                    continue; // 不传递给 ARQ 或上层
                }

                // 根据 ARQ 模式处理帧
                if (this.enableARQ && this.reliableLink) {
                    this.reliableLink._onFrame(frame);
                } else {
                    // 直接模式: 直接向上层发送帧
                    this.emit('frame', frame);
                }
            } catch (err) {
                this.stats.crcErrors++;
                bridgeLogger.warn(`[串口] 帧解码失败: ${err.message}`);
            }
        }

        if (offset > 0) {
            this.buffer = this.buffer.slice(offset);
        }
    }

    _cleanup() {
        this.isConnected = false;
        this.isCongested = false;
        this.linkReady = false;
        this.port = null;
        this.buffer = Buffer.alloc(0);

        // 停止心跳
        this._stopHeartbeat();

        // 重置 ARQ 状态
        if (this.reliableLink) {
            this.reliableLink.reset();
        }
    }

    // ========== 心跳探测 ==========

    /**
     * 启动/重启心跳定时器
     * @param {number} interval - 探测间隔 (ms)
     */
    _startHeartbeat(interval) {
        this._stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.isConnected || !this.port) return;

            // 检查上一轮 PONG 是否收到
            if (this.heartbeatWaitingPong) {
                this.heartbeatMissCount++;
                if (this.linkReady && this.heartbeatMissCount >= this.MAX_MISS) {
                    bridgeLogger.warn(`[串口] 心跳超时: 连续 ${this.MAX_MISS} 次未收到 PONG，链路标记为未就绪`);
                    this.linkReady = false;
                    this.emit('linkLost');
                    // 切回快探测
                    this._startHeartbeat(this.PROBE_INTERVAL);
                    return;
                }
            }

            // 发送 PING（绕过 linkReady 检查，直接写串口）
            this._sendRawPing();
            this.heartbeatWaitingPong = true;
        }, interval);
    }

    _stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.heartbeatMissCount = 0;
        this.heartbeatWaitingPong = false;
    }

    /**
     * 绕过 linkReady 检查，直接发送 PING 帧
     */
    _sendRawPing() {
        if (!this.port || !this.isConnected) return;
        try {
            const packet = PacketCodec.encode(0x00, 0, Buffer.alloc(0)); // type=0x00 = PING
            this.port.write(packet);
            bridgeLogger.debug(`[串口] 发送心跳 PING`);
        } catch (err) {
            bridgeLogger.debug(`[串口] 心跳 PING 发送失败: ${err.message}`);
        }
    }

    /**
     * 绕过 linkReady 检查，直接发送 PONG 帧
     */
    _sendRawPong() {
        if (!this.port || !this.isConnected) return;
        try {
            const packet = PacketCodec.encode(0x01, 0, Buffer.alloc(0)); // type=0x01 = PONG
            this.port.write(packet);
            bridgeLogger.debug(`[串口] 回复心跳 PONG`);
        } catch (err) {
            bridgeLogger.debug(`[串口] 心跳 PONG 发送失败: ${err.message}`);
        }
    }
}

module.exports = SerialBridge;
