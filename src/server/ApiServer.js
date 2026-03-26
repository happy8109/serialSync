/**
 * ApiServer.js
 * 基于 Express 和 WebSocket 的 API 服务层
 * 为 Web UI 和桌面应用提供 REST API 和实时事件流
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AppController = require('../core/interface/AppController');
const { logger } = require('../utils/logger');

class ApiServer {
    constructor(port) {
        if (!port) {
            throw new Error('ApiServer: Port is required');
        }
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.controller = new AppController();
        this.logger = logger.create('ApiServer');

        this._initMiddleware();
        this._setupRoutes();
        this._setupWebSockets();
        this._bindEvents();
    }

    _initMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '1mb' }));

        // 生产模式：托管前端构建产物 (src/web/dist)
        // 仅当 NODE_ENV=production 且 dist 目录存在时启用
        // 开发模式即使存在 dist 也不会误触发，前端始终由 Vite dev server 提供
        const distPath = path.join(__dirname, '..', 'web', 'dist');
        if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
            this.logger.info(`生产模式：托管前端静态资源 ${distPath}`);
            this.app.use(express.static(distPath));
            this._servingStatic = true;
        }
    }

    _setupRoutes() {
        const router = express.Router();

        // 配置上传
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

        const upload = multer({
            storage: multer.diskStorage({
                destination: (req, file, cb) => cb(null, uploadDir),
                filename: (req, file, cb) => {
                    // 修复中文文件名乱码: Multer 默认使用 latin1，需转回 utf8
                    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
                    cb(null, originalName);
                }
            })
        });

        // 1. 获取串口列表
        router.get('/ports', async (req, res) => {
            try {
                const ports = await this.controller.listPorts();
                res.json(ports);
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 2. 连接串口
        router.post('/connect', async (req, res) => {
            const { path, baudRate } = req.body;
            if (!path) return res.status(400).json({ error: 'Path is required' });
            try {
                await this.controller.connect(path, baudRate || 115200);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 3. 断开连接
        router.post('/disconnect', async (req, res) => {
            try {
                await this.controller.disconnect();
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 4. 获取/设置配置
        router.post('/config', (req, res) => {
            const config = req.body;
            try {
                this.controller.setSystemConfig(config);
                res.json({ success: true, config });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 4.5. 触发系统重启（智能适配运行模式）
        router.post('/system/restart', (req, res) => {
            res.json({ success: true, message: 'Restarting...' });
            
            setTimeout(() => {
                if (process.env.NODE_ENV === 'production') {
                    // 生产模式：exit(0) 触发 index.js 看门狗 或 PM2 自动重启
                    this.logger.info('生产模式重启：退出等待看门狗重新孵化...');
                    process.exit(0);
                } else {
                    // 开发模式：exit(42) 触发 launcher.js 重新孵化
                    this.logger.info('开发模式重启：退出码 42 触发 launcher 重新孵化');
                    process.exit(42);
                }
            }, 500);
        });

        // 5. 发送聊天消息
        router.post('/send/chat', (req, res) => {
            const { text } = req.body;
            if (!text) return res.status(400).json({ error: 'Text is required' });
            this.controller.sendChat(text);
            res.json({ success: true });
        });

        // 6. 发送文件 (支持 multipart 上传或本地路径)
        router.post('/send/file', upload.single('file'), async (req, res) => {
            let filePath;
            if (req.file) {
                filePath = req.file.path;
            } else if (req.body.path) {
                filePath = req.body.path;
            } else {
                return res.status(400).json({ error: 'File or path is required' });
            }

            try {
                const fileId = await this.controller.sendFile(filePath);
                res.json({ success: true, fileId });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 7. 获取状态
        router.get('/status', (req, res) => {
            res.json(this.controller.getStatus());
        });

        // 8. 传输控制
        router.post('/transfer/:fileId/pause', (req, res) => {
            const success = this.controller.pauseFileTransfer(req.params.fileId);
            res.json({ success });
        });

        router.post('/transfer/:fileId/resume', (req, res) => {
            const success = this.controller.resumeFileTransfer(req.params.fileId);
            res.json({ success });
        });

        router.post('/transfer/:fileId/cancel', (req, res) => {
            const success = this.controller.cancelFileTransfer(req.params.fileId);
            res.json({ success });
        });

        // 9. 打开文件/目录
        router.post('/open', async (req, res) => {
            const { path } = req.body;
            if (!path) return res.status(400).json({ error: 'Path is required' });
            const result = await this.controller.openPath(path);
            res.json(result);
        });

        router.post('/open-folder', async (req, res) => {
            const { path } = req.body;
            if (!path) return res.status(400).json({ error: 'Path is required' });
            const result = await this.controller.showInFolder(path);
            res.json(result);
        });

        router.get('/utils/select-folder', async (req, res) => {
            const result = await this.controller.selectFolder();
            res.json(result);
        });

        router.post('/sync/discover', (req, res) => {
            this.controller.triggerSyncDiscovery();
            res.json({ success: true, message: 'Discovery started' });
        });

        // ================= API Forwarding Routes =================

        // 10. 获取本地服务列表
        router.get('/services/local', (req, res) => {
            res.json({ success: true, data: this.controller.getLocalServices() });
        });

        // 11. 注册本地服务
        router.post('/services/local', (req, res) => {
            const { id, ...config } = req.body;
            if (!id) return res.status(400).json({ error: 'Service ID is required' });
            this.controller.registerService(id, config);
            res.json({ success: true });
        });

        // 11.5 删除本地服务
        router.delete('/services/local/:serviceId', (req, res) => {
            const { serviceId } = req.params;
            try {
                this.controller.unregisterService(serviceId);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 12. 查询对端服务 (触发串口查询，同步等待结果返回)
        router.post('/services/remote/query', async (req, res) => {
            try {
                const filter = req.body;
                const services = await this.controller.queryRemoteServices(filter);
                // 直接返回查询结果，前端无需盲目轮询
                res.json({ success: true, data: services || [] });
            } catch (err) {
                // 超时或串口未连接时返回空列表而非 500，避免前端报错
                res.json({ success: true, data: [], message: err.message });
            }
        });

        // 13. 获取缓存的对端服务列表
        router.get('/services/remote', (req, res) => {
            res.json({ success: true, data: this.controller.getRemoteServices() });
        });

        // 14. 调用远程服务 (RPC 风格, Legacy)
        router.post('/services/remote/:serviceId/call', async (req, res) => {
            try {
                const { serviceId } = req.params;
                const params = req.body;

                const result = await this.controller.pullService(serviceId, params);

                // 尝试解析JSON响应
                try {
                    const jsonResult = JSON.parse(result);
                    res.json({ success: true, data: jsonResult });
                } catch (e) {
                    res.json({ success: true, data: result });
                }
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 15. 网关模式 (Gateway Mode) - 透明转发
        // 支持 GET/POST 等所有方法，路径如: /api/proxy/daily_brief?date=2024
        router.all('/proxy/:serviceId', async (req, res) => {
            const { serviceId } = req.params;

            // 拦截内网发出的健康探测请求，避免引发高耗时的真实串口级联调用
            if (req.headers['x-health-probe']) {
                // 检查请求的服务是否在当前节点的“本地服务”或“对端映射过来的远程服务”缓存字典中存在
                // 这既保证了不产生真实的串口阻塞包，又实现了真实的“服务可用性接力验证”
                const isLocal = this.controller.getLocalServices().some(s => s.id === serviceId);
                const isRemote = this.controller.getRemoteServices().some(s => s.id === serviceId);
                
                if (isLocal || isRemote) {
                    return res.json({ status: 'ok', serviceId, available: true });
                } else {
                    return res.status(503).json({ error: 'Service Unavailable', serviceId, available: false });
                }
            }

            // 智能提取参数
            let params = {};
            if (Object.keys(req.query).length > 0) {
                params = { ...req.query };
            }
            if (req.body && Object.keys(req.body).length > 0) {
                params = { ...params, ...req.body };
            }

            try {
                // 发起远程调用
                const result = await this.controller.pullService(serviceId, params);

                // 透明返回结果
                // 1. 如果结果是 JSON 字符串，尝试解析并以 JSON 格式返回
                try {
                    const json = JSON.parse(result);
                    res.json(json);
                } catch (e) {
                    // 2. 否则直接返回原始内容 (可能是纯文本或HTML)
                    res.send(result);
                }
            } catch (err) {
                // 网关错误
                res.status(502).send({ error: err.message });
            }
        });

        this.app.use('/api', router);
    }

    _setupWebSockets() {
        this.wss.on('connection', (ws) => {
            this.logger.info('New WebSocket client connected');

            // 发送初始状态
            ws.send(JSON.stringify({
                type: 'status',
                data: this.controller.getStatus()
            }));

            ws.on('close', () => {
                this.logger.info('WebSocket client disconnected');
            });
        });
    }

    _broadcast(type, data) {
        const message = JSON.stringify({ type, data });
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    _bindEvents() {
        // 监听 Controller 事件并广播
        this.controller.on('status', (status) => {
            this._broadcast('status', status);
        });

        this.controller.on('chat', (msg) => {
            this._broadcast('chat', msg);
        });

        this.controller.on('pong', (data) => {
            this._broadcast('pong', data);
        });

        this.controller.on('progress', (data) => {
            this._broadcast('progress', data);
        });

        this.controller.on('complete', (data) => {
            this._broadcast('complete', data);
        });

        this.controller.on('status-msg', (log) => {
            this._broadcast('log', log);
        });

        // 捕获错误，防止进程崩溃
        this.controller.on('error', (err) => {
            this.logger.error(`Controller Error: ${err.message}`);
            this._broadcast('error', { message: err.message });
        });

        this.controller.on('system_message', (msg) => {
            // Broadcast as specific type
            this._broadcast('system_message', { message: msg });
        });

        this.controller.on('cancelled', (data) => {
            this._broadcast('cancelled', data);
        });

        this.controller.on('sync_discovery_update', (shares) => {
            this._broadcast('sync_discovery', shares);
        });

        // 定期广播状态 (每秒)
        setInterval(() => {
            this._broadcast('status', this.controller.getStatus());
        }, 1000);
    }

    start() {
        // 生产模式 SPA 兜底：所有未匹配的路由返回 index.html（支持前端路由）
        if (this._servingStatic) {
            const distPath = path.join(__dirname, '..', 'web', 'dist');
            this.app.get('*', (req, res) => {
                res.sendFile(path.join(distPath, 'index.html'));
            });
        }

        this.server.listen(this.port, () => {
            this.logger.info(`API Server running on http://localhost:${this.port}`);
        });
    }
}

module.exports = ApiServer;
