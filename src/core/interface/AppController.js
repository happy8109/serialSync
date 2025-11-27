/**
 * AppController.js
 * 接口层：统一管理核心组件，为 CLI/Web 提供 API
 */

const EventEmitter = require('events');
const SerialBridge = require('../transport/SerialBridge');
const PacketScheduler = require('../transport/PacketScheduler');
const ServiceManager = require('../services/ServiceManager');
const MessageService = require('../services/MessageService');
const SystemService = require('../services/SystemService');
const FileTransferService = require('../services/FileTransferService');
const { logger } = require('../../utils/logger');
const appLogger = logger.create('App');

class AppController extends EventEmitter {
    constructor(options = {}) {
        super();

        // 初始化核心组件
        this.bridge = new SerialBridge(options.bridgeOptions);
        this.scheduler = new PacketScheduler(this.bridge);

        // 初始化服务层
        this.serviceManager = new ServiceManager(this.scheduler);
        this.messageService = new MessageService();
        this.systemService = new SystemService();
        this.fileTransferService = new FileTransferService();

        // 注册服务
        this.serviceManager.register(this.messageService);
        this.serviceManager.register(this.systemService);
        this.serviceManager.register(this.fileTransferService);

        // 绑定事件
        this._setupListeners();
    }

    _setupListeners() {
        // 监听 Bridge 状态
        this.bridge.on('open', () => this.emit('status', { connected: true }));
        this.bridge.on('close', () => this.emit('status', { connected: false }));
        this.bridge.on('error', (err) => this.emit('error', err));

        // 监听收到数据帧 -> 分发给服务
        this.bridge.on('frame', (frame) => {
            this.serviceManager.handleFrame(frame);
            // 依然抛出 frame 事件供 CLI 调试显示
            this.emit('frame', frame);
        });

        // 监听业务事件
        this.messageService.on('message', (msg) => {
            this.emit('chat', msg);
        });

        this.systemService.on('pong', (data) => {
            this.emit('pong', data);
        });

        // 监听文件传输事件
        this.fileTransferService.on('progress', (data) => {
            this.emit('progress', data);
        });

        this.fileTransferService.on('complete', (data) => {
            this.emit('complete', data);
        });
    }

    /**
     * 连接串口
     */
    async connect(port, baudRate = 115200) {
        try {
            await this.bridge.connect(port, { baudRate });
            return true;
        } catch (err) {
            throw err;
        }
    }

    /**
     * 断开连接
     */
    async disconnect() {
        await this.bridge.disconnect();
    }

    /**
     * 列出可用串口
     */
    async listPorts() {
        return await this.bridge.constructor.listPorts();
    }

    /**
     * 设置文件传输参数
     */
    setFileTransferConfig(config) {
        this.fileTransferService.setConfig(config);
    }

    /**
     * 发送聊天消息 (P1)
     */
    sendChat(text) {
        this.messageService.sendMessage(text);
    }

    /**
     * 发送 Ping (P0)
     */
    sendPing() {
        this.systemService.sendPing();
    }

    /**
     * 发送文件 (P2)
     */
    async sendFile(filePath) {
        return await this.fileTransferService.sendFile(filePath);
    }

    /**
     * 模拟发送大文件 (P2) - 仅用于测试调度器
     * 生成 N 个 1KB 的包
     */
    simulateFileTransfer(count = 100) {
        const chunkSize = 1024;
        const dummyData = Buffer.alloc(chunkSize).fill('F');

        console.log(`[Controller] Start queuing ${count} chunks...`);
        for (let i = 0; i < count; i++) {
            // Type 0x22 = FILE_CHUNK, P2
            this.scheduler.enqueue(0x22, i, dummyData, 2);
        }
    }

    /**
     * 获取系统状态
     */
    getStatus() {
        return {
            connected: this.bridge.isConnected,
            port: this.bridge.port ? this.bridge.port.path : null,
            bridgeStats: this.bridge.stats,
            queueStats: this.scheduler.getStatus()
        };
    }
}

module.exports = AppController;
