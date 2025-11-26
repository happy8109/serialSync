/**
 * PacketScheduler.js
 * 调度层：实现多级优先级队列与抢占式调度
 */

const EventEmitter = require('events');

// 优先级常量
const PRIORITY = {
    P0: 0, // System (Highest)
    P1: 1, // Interactive
    P2: 2, // Active Transfer
    P3: 3  // Background (Lowest)
};

class PacketScheduler extends EventEmitter {
    /**
     * @param {SerialBridge} bridge 
     */
    constructor(bridge) {
        super();
        this.bridge = bridge;

        // 四级队列
        this.queues = {
            0: [],
            1: [],
            2: [],
            3: []
        };

        this.isPaused = false; // 是否被流控暂停
        this.isSending = false; // 是否正在发送（防止重入）

        // 监听 Bridge 的流控事件
        this.bridge.on('pause', () => {
            this.isPaused = true;
        });

        this.bridge.on('resume', () => {
            this.isPaused = false;
            this._schedule(); // 恢复发送
        });
    }

    /**
     * 入队发送
     * @param {number} type 
     * @param {number} seq 
     * @param {Buffer} body 
     * @param {number} priority (0-3)
     */
    enqueue(type, seq, body, priority = PRIORITY.P2) {
        if (priority < 0 || priority > 3) priority = PRIORITY.P2;

        const task = { type, seq, body };
        this.queues[priority].push(task);

        // 尝试触发调度
        this._schedule();
    }

    /**
     * 核心调度循环
     */
    _schedule() {
        // 如果暂停中或正在发送中，则跳过
        // 注意：SerialPort.write 是同步调用的（虽然底层是异步），
        // 但我们需要等待 drain 事件才能继续发大量数据。
        // 这里我们简化逻辑：只要 bridge 没叫停，我们就一直发。
        if (this.isPaused) return;

        // 简单的防重入，虽然在单线程JS中通常不需要，但为了逻辑清晰
        if (this.isSending) return;
        this.isSending = true;

        try {
            // 循环发送，直到队列空或被暂停
            while (!this.isPaused) {
                const task = this._getNextTask();
                if (!task) break; // 所有队列都空了

                // 发送给 Bridge
                // sendFrame 返回 false 表示缓冲区满，需要暂停
                const notCongested = this.bridge.sendFrame(task.type, task.seq, task.body);

                if (!notCongested) {
                    // Bridge 已经触发了 pause 事件，循环会在下一次 check isPaused 时终止
                    // 但这里我们也可以显式 break
                    break;
                }
            }
        } finally {
            this.isSending = false;
        }
    }

    /**
     * 获取下一个最高优先级的任务
     */
    _getNextTask() {
        for (let p = 0; p <= 3; p++) {
            if (this.queues[p].length > 0) {
                return this.queues[p].shift();
            }
        }
        return null;
    }

    /**
     * 获取队列状态（用于调试/UI）
     */
    getStatus() {
        return {
            p0: this.queues[0].length,
            p1: this.queues[1].length,
            p2: this.queues[2].length,
            p3: this.queues[3].length,
            paused: this.isPaused
        };
    }
}

PacketScheduler.PRIORITY = PRIORITY;

module.exports = PacketScheduler;
