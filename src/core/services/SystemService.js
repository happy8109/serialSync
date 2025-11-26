/**
 * SystemService.js
 * 负责心跳 (PING/PONG) 和系统级消息 (P0)
 */

const EventEmitter = require('events');

class SystemService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.lastPingTime = 0;
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    getInterestedTypes() {
        return [0x00, 0x01]; // PING, PONG
    }

    handleFrame(frame) {
        if (frame.type === 0x00) { // Received PING
            // Auto Reply PONG
            this.sendPong();
        } else if (frame.type === 0x01) { // Received PONG
            const now = Date.now();
            const rtt = this.lastPingTime ? (now - this.lastPingTime) : 0;
            this.emit('pong', { rtt });
        }
    }

    sendPing() {
        if (!this.scheduler) return;
        this.lastPingTime = Date.now();
        this.scheduler.enqueue(0x00, 0, Buffer.alloc(0), 0); // P0
    }

    sendPong() {
        if (!this.scheduler) return;
        this.scheduler.enqueue(0x01, 0, Buffer.alloc(0), 0); // P0
    }
}

module.exports = SystemService;
