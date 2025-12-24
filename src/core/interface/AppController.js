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
const HttpProxyService = require('../services/HttpProxyService');
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
        this.httpProxyService = new HttpProxyService();

        // 注册服务
        this.serviceManager.register(this.messageService);
        this.serviceManager.register(this.systemService);
        this.serviceManager.register(this.fileTransferService);
        this.serviceManager.register(this.httpProxyService);

        // 绑定事件
        this._setupListeners();
    }

    _setupListeners() {
        // 初始化服务配置
        const config = require('config');
        // Cache runtime config for status reporting
        this.runtimeConfig = JSON.parse(JSON.stringify(config));

        this.httpProxyService.loadServicesFromConfig(config);

        if (config.has('transfer')) {
            this.fileTransferService.setConfig(config.get('transfer'));
        }

        // 监听 Bridge 状态
        this.bridge.on('open', () => this.emit('status', this.getStatus()));
        this.bridge.on('close', () => this.emit('status', this.getStatus()));
        this.bridge.on('error', (err) => this.emit('error', err));
        this.bridge.on('status-message', (msg) => this.emit('system_message', `[串口] ${msg}`));

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

        this.fileTransferService.on('error', (err) => {
            this.emit('error', err);
        });

        this.fileTransferService.on('cancelled', (data) => {
            appLogger.info(`Transfer cancelled: ${data.fileId}`);
            this.emit('cancelled', data);
        });
    }

    /**
     * 连接串口
     */
    async connect(port, options = {}) {
        try {
            await this.bridge.connect(port, options);
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
     * 保存并应用系统配置
     */
    setSystemConfig(config) {
        // 1. 应用运行时传输配置
        if (config.transfer) {
            this.fileTransferService.setConfig(config.transfer);
        }

        // 2. 运行时热更新: 串口配置 (重连策略等)
        if (config.serial) {
            this.bridge.setConfig(config.serial);
        }

        // 3. 运行时热更新: 系统选项
        if (config.system) {
            // Service Discovery
            if (config.system.serviceDiscovery !== undefined) {
                this.httpProxyService.setAutoDiscovery(config.system.serviceDiscovery);
            }
            // Log Level
            if (config.system.logLevel !== undefined) {
                try {
                    const { logger } = require('../../utils/logger');
                    logger.level = config.system.logLevel;
                    // Also update underlying transports
                    logger.transports.forEach(t => t.level = config.system.logLevel);
                    appLogger.info(`Log level changed to ${config.system.logLevel}`);
                } catch (e) {
                    // ignore
                }
            }
        }

        // 4. 持久化到 config/default.json
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(process.cwd(), 'config', 'default.json');
            // ... (keep reading and saving logic)
            // 读取现有配置，保留未修改的项
            let currentConfig = {};
            if (fs.existsSync(configPath)) {
                currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }

            // 合并更新
            if (config.serial) {
                currentConfig.serial = { ...currentConfig.serial, ...config.serial };
            }
            if (config.transfer) {
                currentConfig.transfer = { ...currentConfig.transfer, ...config.transfer };
            }
            if (config.system) {
                // Map UI system config to actual file config structure
                if (config.system.serviceDiscovery !== undefined) {
                    if (!currentConfig.services) currentConfig.services = {};
                    currentConfig.services.autoRegister = config.system.serviceDiscovery;
                }
                if (config.system.logLevel !== undefined) {
                    if (!currentConfig.logging) currentConfig.logging = {};
                    currentConfig.logging.level = config.system.logLevel;
                }

                // Save Heartbeat to file (under system or serial? let's save to serial as per file buffer inspection earlier)
                // Actually inspection showed 'serial.heartbeatInterval'. 
                // Let's ensure we save heartbeat params deeply to serial section if they are passed in system config from UI
                if (config.system.heartbeatInterval !== undefined || config.system.heartbeatTimeout !== undefined) {
                    if (!currentConfig.serial) currentConfig.serial = {};
                    if (config.system.heartbeatInterval !== undefined) currentConfig.serial.heartbeatInterval = config.system.heartbeatInterval;
                    if (config.system.heartbeatTimeout !== undefined) currentConfig.serial.heartbeatTimeout = config.system.heartbeatTimeout;
                }
            }

            // 写入文件
            fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
            appLogger.info('System config saved to default.json');
            return true;
        } catch (err) {
            appLogger.error('Failed to save config:', err);
            throw err;
        }
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

    pauseFileTransfer(fileId) {
        return this.fileTransferService.pause(fileId);
    }

    resumeFileTransfer(fileId) {
        return this.fileTransferService.resume(fileId);
    }

    cancelFileTransfer(fileId) {
        return this.fileTransferService.cancel(fileId);
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
    /**
     * 打开文件或目录
     */
    openPath(targetPath) {
        const fs = require('fs');
        if (!fs.existsSync(targetPath)) {
            appLogger.error(`Path does not exist: ${targetPath}`);
            return { success: false, error: '文件或目录不存在' };
        }

        const { exec } = require('child_process');
        let command;
        if (process.platform === 'win32') {
            command = `start "" "${targetPath}"`;
        } else if (process.platform === 'darwin') {
            command = `open "${targetPath}"`;
        } else {
            command = `xdg-open "${targetPath}"`;
        }

        return new Promise((resolve) => {
            exec(command, (err) => {
                if (err) {
                    // Windows 'start' can sometimes return errors even if it works, 
                    // but usually 0 is success. 
                    appLogger.error(`Failed to open path: ${targetPath}`, err);
                    resolve({ success: false, error: '无法打开文件，请检查系统关联程序' });
                } else {
                    resolve({ success: true });
                }
            });
        });
    }

    /**
     * 在文件夹中显示并选中文件
     */
    showInFolder(targetPath) {
        const fs = require('fs');
        if (!fs.existsSync(targetPath)) {
            appLogger.error(`Path does not exist: ${targetPath}`);
            return { success: false, error: '文件不存在' };
        }

        const { exec } = require('child_process');
        const path = require('path');
        let command;

        if (process.platform === 'win32') {
            // Windows: 使用 explorer /select
            command = `explorer.exe /select,"${targetPath}"`;
        } else if (process.platform === 'darwin') {
            // macOS: 使用 open -R
            command = `open -R "${targetPath}"`;
        } else {
            // Linux: 通常只是打开父目录
            command = `xdg-open "${path.dirname(targetPath)}"`;
        }

        return new Promise((resolve) => {
            exec(command, (err) => {
                // explorer.exe /select often returns exit code 1 even on success
                if (err && (process.platform !== 'win32' || err.code !== 1)) {
                    appLogger.error(`Failed to show in folder: ${targetPath}`, err);
                    resolve({ success: false, error: '打开文件夹失败' });
                } else {
                    resolve({ success: true });
                }
            });
        });
    }

    getStatus() {
        // 直接从磁盘读取最新配置，确保 UI 显示的任何时候都是文件里的真实值
        // 这是最稳健的方式，绕过所有内存缓存
        let fileConfig = {};
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(process.cwd(), 'config', 'default.json');
            if (fs.existsSync(configPath)) {
                fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            appLogger.error('Failed to read config file for status', e);
        }

        return {
            // Runtime Status
            connected: this.bridge.isConnected,
            congested: this.bridge.isCongested,
            activePort: this.bridge.port ? this.bridge.port.path : null,
            port: this.bridge.port ? this.bridge.port.path : null, // Restore for frontend compatibility
            activeBaudRate: this.bridge.baudRate,

            // Full Configuration (Source of Truth for settings UI)
            // 直接下发文件内容
            config: fileConfig,

            // Legacy / Component specific status (kept for runtime stats visibility)
            bridgeStats: this.bridge.stats,
            queueStats: this.scheduler.getStatus()
        };
    }

    // ================= API Proxy Methods =================

    async pullService(serviceId, params) {
        return await this.httpProxyService.pullService(serviceId, params);
    }

    async queryRemoteServices(filter) {
        return await this.httpProxyService.queryRemoteServices(filter);
    }

    registerService(serviceId, config) {
        this.httpProxyService.registerService(serviceId, config);
    }

    unregisterService(serviceId) {
        this.httpProxyService.unregisterService(serviceId);
    }

    getLocalServices() {
        return this.httpProxyService.getLocalServicesMeta();
    }

    getRemoteServices() {
        return this.httpProxyService.getRemoteServices();
    }
}

module.exports = AppController;
