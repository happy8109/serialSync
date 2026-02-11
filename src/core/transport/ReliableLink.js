/**
 * ReliableLink.js
 * ARQ 可靠传输层 - 实现链路层确认与重传
 * 
 * 职责:
 * - 发送端: 分配 FSeq，维护发送窗口，超时重传
 * - 接收端: 解析 FSeq/FAck，捎带确认，去重
 * 
 * v3.1.1 - 修复发送洪泛导致的传输卡死
 *   - 增加发送队列与帧间节流，避免瞬间塞满串口缓冲区
 *   - 重传间隔化，防止雪崩式重传
 *   - 窗口满时排队等待，而非直接丢弃
 */

const EventEmitter = require('events');
const PacketCodec = require('./PacketCodec');
const { logger } = require('../../utils/logger');
const linkLogger = logger.create('ReliableLink');

// 默认配置 (基于 115200 波特率计算)
// 1 帧 ≈ 2200 字节 → 物理传输 ≈ 191ms
// 窗口 4 帧 → 全部发完 ≈ 800ms
// ACK 来回 ≈ 300ms，超时设 5s 留足余量
const DEFAULT_CONFIG = {
    WINDOW_SIZE: 4,        // 发送窗口大小 (小窗口避免洪泛)
    ACK_TIMEOUT: 5000,     // ACK 超时时间 (ms)，留足物理传输+往返时间
    MAX_RETRIES: 5,        // 最大重试次数
    ACK_DELAY: 50,         // 延迟 ACK 时间 (ms)，用于捎带确认
    SEQ_MODULO: 65536,     // 序号模 (FSeq 为 2 字节)
    FRAME_INTERVAL: 200    // 帧间延时 (ms)，匹配物理传输速率
};

class ReliableLink extends EventEmitter {
    /**
     * @param {SerialBridge} bridge 底层串口桥接
     * @param {Object} options 配置选项
     */
    constructor(bridge, options = {}) {
        super();
        this.bridge = bridge;
        this.config = { ...DEFAULT_CONFIG, ...options };

        // 发送端状态
        this.sendSeq = 0;           // 下一个要发送的 FSeq
        this.sendBase = 0;          // 滑动窗口基址（最早未确认的 FSeq）
        this.sendWindow = new Map(); // FSeq -> { packet, type, seq, body, retries, timer }

        // 发送队列 & 节流
        this.txQueue = [];          // 待发送帧队列 [{ type, seq, body, fSeq, retries }]
        this.txDraining = false;    // 是否正在逐帧发送
        this.txDrainTimer = null;   // 逐帧发送定时器

        // 待发送缓冲（窗口满时暂存）
        this.pendingQueue = [];     // [{ type, seq, body }]

        // 接收端状态
        this.expectSeq = 0;         // 期望收到的下一个 FSeq
        this.recvAck = 0;           // 待发送的 ACK (捎带确认用)
        this.ackTimer = null;       // 延迟 ACK 定时器

        // 统计
        this.stats = {
            txFrames: 0,
            rxFrames: 0,
            retransmits: 0,
            acksSent: 0
        };
    }

    /**
     * 发送数据帧（上层调用）
     * @param {number} type 帧类型
     * @param {number} seq 应用层序号
     * @param {Buffer} body 帧体
     */
    send(type, seq, body) {
        // 检查窗口是否已满
        if (this.sendWindow.size >= this.config.WINDOW_SIZE) {
            linkLogger.warn(`发送窗口已满 (size=${this.sendWindow.size})，加入等待队列`);
            this.pendingQueue.push({ type, seq, body });
            return false;
        }

        const fSeq = this.sendSeq;
        this.sendSeq = (this.sendSeq + 1) % this.config.SEQ_MODULO;

        // 加入发送队列，节流发送
        this._enqueue(type, seq, body, fSeq, 0);
        return true;
    }

    /**
     * 将帧加入发送队列
     */
    _enqueue(type, seq, body, fSeq, retries) {
        this.txQueue.push({ type, seq, body, fSeq, retries });
        this._startDrain();
    }

    /**
     * 启动逐帧发送（节流）
     */
    _startDrain() {
        if (this.txDraining) return;
        this.txDraining = true;
        this._drainNext();
    }

    /**
     * 发送队列中的下一帧
     */
    _drainNext() {
        if (this.txQueue.length === 0) {
            this.txDraining = false;
            this.txDrainTimer = null;
            return;
        }

        const item = this.txQueue.shift();
        this._transmit(item.type, item.seq, item.body, item.fSeq, item.retries);

        // 如果队列还有帧，延后发送下一帧
        if (this.txQueue.length > 0) {
            this.txDrainTimer = setTimeout(() => {
                this._drainNext();
            }, this.config.FRAME_INTERVAL);
        } else {
            this.txDraining = false;
            this.txDrainTimer = null;
        }
    }

    /**
     * 内部：实际发送帧
     */
    _transmit(type, seq, body, fSeq, retries) {
        // 使用当前的 recvAck 作为捎带确认
        const fAck = this.recvAck;

        // 编码帧
        const packet = PacketCodec.encode(type, seq, body, fSeq, fAck);

        // 设置重传定时器
        const timer = setTimeout(() => {
            this._onTimeout(fSeq);
        }, this.config.ACK_TIMEOUT);

        // 存入发送窗口
        this.sendWindow.set(fSeq, {
            packet,
            type,
            seq,
            body,
            fSeq,
            fAck,
            retries,
            timer
        });

        // 写入串口
        this.bridge.port.write(packet);
        this.stats.txFrames++;

        linkLogger.debug(`TX: fSeq=${fSeq}, fAck=${fAck}, type=${type}, seq=${seq}, retries=${retries}`);
    }

    /**
     * 处理收到的帧（由 SerialBridge 调用）
     * @param {Object} frame 解码后的帧 { type, seq, body, fSeq, fAck }
     */
    _onFrame(frame) {
        const { type, seq, body, fSeq, fAck } = frame;

        linkLogger.debug(`RX: fSeq=${fSeq}, fAck=${fAck}, type=${type}, seq=${seq}`);

        // 1. 处理对方的 ACK (释放已确认的帧)
        this._processAck(fAck);

        // 2. 纯 ACK 帧 (type=0xFF) 只需处理 fAck，不作为数据帧处理
        //    否则会触发 _scheduleAck → 对方收到后又 _scheduleAck → 无限循环
        if (type === 0xFF) return;

        // 3. 处理数据帧
        this._handleDataFrame(frame);
    }

    /**
     * 处理对方的 ACK - 释放已确认的帧
     */
    _processAck(fAck) {
        // fAck 表示对方期望收到的下一帧，即 fAck-1 及之前的帧都已收到
        // 累积确认：释放所有 FSeq < fAck 的帧
        let released = 0;
        for (const [storedFSeq, entry] of this.sendWindow) {
            // 考虑序号回绕
            if (this._seqLt(storedFSeq, fAck)) {
                clearTimeout(entry.timer);
                this.sendWindow.delete(storedFSeq);
                released++;
                linkLogger.debug(`ACK 确认 fSeq=${storedFSeq}`);
            }
        }

        // 如果释放了窗口空间，尝试发送等待队列中的帧
        if (released > 0) {
            this._flushPending();
        }
    }

    /**
     * 将等待队列中的帧移入发送窗口
     */
    _flushPending() {
        while (this.pendingQueue.length > 0 && this.sendWindow.size < this.config.WINDOW_SIZE) {
            const pending = this.pendingQueue.shift();
            const fSeq = this.sendSeq;
            this.sendSeq = (this.sendSeq + 1) % this.config.SEQ_MODULO;
            this._enqueue(pending.type, pending.seq, pending.body, fSeq, 0);
        }
    }

    /**
     * 处理数据帧 - 去重、排序、向上层转发
     */
    _handleDataFrame(frame) {
        const { fSeq } = frame;

        // 检查是否为期望的帧
        if (fSeq === this.expectSeq) {
            // 正确顺序，接受并递增期望序号
            this.expectSeq = (this.expectSeq + 1) % this.config.SEQ_MODULO;
            this._acceptFrame(frame);
        } else if (this._seqLt(fSeq, this.expectSeq)) {
            // 重复帧，忽略但仍发送 ACK
            linkLogger.debug(`重复帧 fSeq=${fSeq}, expect=${this.expectSeq}, 已忽略`);
        } else {
            // 乱序帧，在窗口范围内则接受
            const distance = (fSeq - this.expectSeq + this.config.SEQ_MODULO) % this.config.SEQ_MODULO;
            if (distance <= this.config.WINDOW_SIZE) {
                linkLogger.debug(`乱序帧 fSeq=${fSeq}, expect=${this.expectSeq}, 在窗口内接受`);
                // 更新期望序号到收到的帧之后
                this.expectSeq = (fSeq + 1) % this.config.SEQ_MODULO;
                this._acceptFrame(frame);
            } else {
                // 超出窗口范围：可能是对端重启或严重丢包
                // 同步到对方的序号，避免永久卡死
                linkLogger.warn(`乱序帧 fSeq=${fSeq} 超出窗口范围 (expect=${this.expectSeq}), 进行序号同步`);
                this.expectSeq = (fSeq + 1) % this.config.SEQ_MODULO;
                this._acceptFrame(frame);
            }
        }

        // 调度 ACK 发送
        this._scheduleAck();
    }

    /**
     * 接受帧并向上层转发
     */
    _acceptFrame(frame) {
        this.stats.rxFrames++;
        this.recvAck = this.expectSeq; // 更新捎带确认号
        this.emit('frame', frame);
    }

    /**
     * 调度延迟 ACK
     */
    _scheduleAck() {
        // 如果已有定时器，不重复调度
        if (this.ackTimer) return;

        this.ackTimer = setTimeout(() => {
            this._sendAck();
        }, this.config.ACK_DELAY);
    }

    /**
     * 发送纯 ACK 帧（Type=0xFF 表示纯 ACK）
     */
    _sendAck() {
        this.ackTimer = null;

        // 使用特殊类型 0xFF 表示纯 ACK 帧
        const packet = PacketCodec.encode(0xFF, 0, Buffer.alloc(0), 0, this.recvAck);
        this.bridge.port.write(packet);
        this.stats.acksSent++;

        linkLogger.debug(`发送 ACK: fAck=${this.recvAck}`);
    }

    /**
     * 重传超时处理
     */
    _onTimeout(fSeq) {
        const entry = this.sendWindow.get(fSeq);
        if (!entry) return; // 已被 ACK 确认

        if (entry.retries >= this.config.MAX_RETRIES) {
            linkLogger.error(`帧 fSeq=${fSeq} 达到最大重试次数，传输失败`);
            this.sendWindow.delete(fSeq);
            this.emit('transmit_failed', { fSeq, type: entry.type, seq: entry.seq });
            return;
        }

        // 重传：通过发送队列节流，避免同时重传所有帧导致洪泛
        linkLogger.warn(`重传 fSeq=${fSeq}, 第 ${entry.retries + 1} 次`);
        this.stats.retransmits++;

        // 先从窗口中移除旧条目（_transmit 会重新加入）
        clearTimeout(entry.timer);
        this.sendWindow.delete(fSeq);

        // 加入发送队列，间隔发送
        this._enqueue(entry.type, entry.seq, entry.body, fSeq, entry.retries + 1);
    }

    /**
     * 序号比较（考虑回绕）
     * @returns {boolean} a < b
     */
    _seqLt(a, b) {
        const half = this.config.SEQ_MODULO / 2;
        return ((b - a + this.config.SEQ_MODULO) % this.config.SEQ_MODULO) < half && a !== b;
    }

    /**
     * 重置状态（断开重连时调用）
     */
    reset() {
        // 清除所有定时器
        for (const entry of this.sendWindow.values()) {
            clearTimeout(entry.timer);
        }
        if (this.ackTimer) {
            clearTimeout(this.ackTimer);
            this.ackTimer = null;
        }
        if (this.txDrainTimer) {
            clearTimeout(this.txDrainTimer);
            this.txDrainTimer = null;
        }

        // 重置状态
        this.sendSeq = 0;
        this.sendBase = 0;
        this.sendWindow.clear();
        this.txQueue = [];
        this.txDraining = false;
        this.pendingQueue = [];
        this.expectSeq = 0;
        this.recvAck = 0;

        linkLogger.info('ReliableLink 状态已重置');
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this.stats,
            windowSize: this.sendWindow.size,
            txQueueSize: this.txQueue.length,
            pendingQueueSize: this.pendingQueue.length,
            sendSeq: this.sendSeq,
            expectSeq: this.expectSeq
        };
    }
}

module.exports = ReliableLink;
