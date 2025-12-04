/**
 * MessageService.js
 * 负责处理聊天消息 (P1)
 */

const EventEmitter = require('events');
const config = require('config');

class MessageService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.maxLength = config.has('message.maxLength') ? config.get('message.maxLength') : 4096;
    }

    /**
     * 由 ServiceManager 注入
     */
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    /**
     * 声明感兴趣的包类型
     */
    getInterestedTypes() {
        return [0x10]; // MSG_TEXT
    }

    /**
     * 处理接收到的帧
     */
    handleFrame(frame) {
        if (frame.type === 0x10) {
            const text = frame.body.toString('utf8');
            // 向上层抛出业务事件
            this.emit('message', {
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                text,
                timestamp: Date.now()
            });
        }
    }

    /**
     * 发送消息
     * @param {string} text 
     */
    sendMessage(text) {
        if (!this.scheduler) throw new Error('Scheduler not set');

        const body = Buffer.from(text, 'utf8');

        if (body.length > this.maxLength) {
            throw new Error(`Message too long (max ${this.maxLength} bytes)`);
        }

        // 使用 P1 (Interactive) 优先级
        this.scheduler.enqueue(0x10, 0, body, 1);
    }
}

module.exports = MessageService;
