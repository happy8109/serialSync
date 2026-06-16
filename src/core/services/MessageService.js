/**
 * MessageService.js
 * 负责处理聊天消息 (P1)
 * v3.1 - Body 升级为 JSON 格式，支持 sender 身份标识和 msgId 去重
 */

const EventEmitter = require('events');
const config = require('config');
const os = require('os');

class MessageService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.maxLength = config.has('message.maxLength') ? config.get('message.maxLength') : 4096;

        // 节点身份信息（由 AppController 注入）
        this.identity = {
            nodeName: os.hostname(),
            network: ''
        };

        // 消息去重（保留最近 500 条 msgId）
        this.seenMsgIds = new Set();
        this.msgIdQueue = [];
        this.MAX_SEEN_IDS = 500;
    }

    /**
     * 由 ServiceManager 注入
     */
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    /**
     * 设置节点身份信息
     * @param {Object} identity - { nodeName, network }
     */
    setIdentity(identity) {
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network) this.identity.network = identity.network;
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
            try {
                const raw = frame.body.toString('utf8');
                const msgData = JSON.parse(raw);

                // 去重检查
                if (msgData.msgId) {
                    if (this.seenMsgIds.has(msgData.msgId)) {
                        return;
                    }
                    this.seenMsgIds.add(msgData.msgId);
                    this.msgIdQueue.push(msgData.msgId);
                    if (this.msgIdQueue.length > this.MAX_SEEN_IDS) {
                        const old = this.msgIdQueue.shift();
                        this.seenMsgIds.delete(old);
                    }
                }

                this.emit('message', {
                    id: msgData.msgId || Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                    msgId: msgData.msgId,
                    sender: msgData.sender || null,
                    text: msgData.content || '',
                    timestamp: Date.now()
                });
            } catch (err) {
                // 解析 JSON 失败忽略或记录
            }
        }
    }

    /**
     * 发送消息
     * @param {string} text - 消息文本
     * @param {Object} senderOverride - 来自 WebUI 的发送者信息 { nickname, ip }
     */
    sendMessage(text, senderOverride = {}) {
        if (!this.scheduler) throw new Error('Scheduler not set');

        const msgId = `${this.identity.nodeName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // 标记已见，防止环路返回
        this.seenMsgIds.add(msgId);
        this.msgIdQueue.push(msgId);
        if (this.msgIdQueue.length > this.MAX_SEEN_IDS) {
            const old = this.msgIdQueue.shift();
            this.seenMsgIds.delete(old);
        }

        const payload = {
            msgId,
            sender: {
                nickname: senderOverride.nickname || '',
                nodeName: this.identity.nodeName,
                network: this.identity.network,
                ip: senderOverride.ip || ''
            },
            content: text
        };

        const body = Buffer.from(JSON.stringify(payload), 'utf8');

        if (body.length > this.maxLength) {
            throw new Error(`Message too long (max ${this.maxLength} bytes)`);
        }

        // 使用 P1 (Interactive) 优先级
        this.scheduler.enqueue(0x10, 0, body, 1);

        return payload; // 返回完整 payload 供 relay 转发使用
    }
}

module.exports = MessageService;
