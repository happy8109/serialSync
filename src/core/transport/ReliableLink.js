/**
 * ReliableLink.js
 * ARQ 可靠传输层 - 实现链路层确认与重传
 * 
 * 职责:
 * - 发送端: 分配 FSeq，维护发送窗口，超时重传
 * - 接收端: 解析 FSeq/FAck，捎带确认，去重
 */

const EventEmitter = require('events');
const PacketCodec = require('./PacketCodec');
const { logger } = require('../../utils/logger');
const linkLogger = logger.create('ReliableLink');

// 默认配置
const DEFAULT_CONFIG = {
    WINDOW_SIZE: 16,       // 发送窗口大小
    ACK_TIMEOUT: 500,      // ACK 超时时间 (ms)
    MAX_RETRIES: 5,        // 最大重试次数
    ACK_DELAY: 50,         // 延迟 ACK 时间 (ms)，用于捎带确认
    SEQ_MODULO: 65536      // 序号模 (FSeq 为 2 字节)
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
        const fSeq = this.sendSeq;
        this.sendSeq = (this.sendSeq + 1) % this.config.SEQ_MODULO;

        // 检查窗口是否已满
        if (this.sendWindow.size >= this.config.WINDOW_SIZE) {
            linkLogger.warn(`发送窗口已满 (size=${this.sendWindow.size})，等待 ACK`);
            // TODO: 可以实现队列机制，暂时丢弃
            return false;
        }

        // 创建并发送数据包
        this._transmit(type, seq, body, fSeq, 0);
        return true;
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

        // 2. 处理数据帧
        this._handleDataFrame(frame);
    }

    /**
     * 处理对方的 ACK - 释放已确认的帧
     */
    _processAck(fAck) {
        // fAck 表示对方期望收到的下一帧，即 fAck-1 及之前的帧都已收到
        // 累积确认：释放所有 FSeq < fAck 的帧
        for (const [storedFSeq, entry] of this.sendWindow) {
            // 考虑序号回绕
            if (this._seqLt(storedFSeq, fAck)) {
                clearTimeout(entry.timer);
                this.sendWindow.delete(storedFSeq);
                linkLogger.debug(`ACK 确认 fSeq=${storedFSeq}`);
            }
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

        // 重传
        linkLogger.warn(`重传 fSeq=${fSeq}, 第 ${entry.retries + 1} 次`);
        this.stats.retransmits++;
        this._transmit(entry.type, entry.seq, entry.body, fSeq, entry.retries + 1);
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

        // 重置状态
        this.sendSeq = 0;
        this.sendBase = 0;
        this.sendWindow.clear();
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
            sendSeq: this.sendSeq,
            expectSeq: this.expectSeq
        };
    }
}

module.exports = ReliableLink;
