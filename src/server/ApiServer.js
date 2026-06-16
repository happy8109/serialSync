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
        this.wss = new WebSocket.Server({ noServer: true });
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
            const { text, sender } = req.body;
            if (!text) return res.status(400).json({ error: 'Text is required' });
            this.controller.sendChat(text, sender || {});
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

            const nickname = req.body.nickname || req.query.nickname || '';

            try {
                const fileId = await this.controller.sendFile(filePath, nickname);
                res.json({ success: true, fileId });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 6.5. 触发跨网中继文件拉取
        router.post('/relay/pull', async (req, res) => {
            const { fileId, fileName } = req.body;
            if (!fileId || !fileName) {
                return res.status(400).json({ error: 'fileId and fileName are required' });
            }
            try {
                const result = await this.controller.relayService.requestFilePull(fileId, fileName);
                res.json({ success: true, ...result });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 6.6. 局域网中继下载特定文件
        router.get('/relay/file/:fileId', (req, res) => {
            const { fileId } = req.params;
            const fileInfo = this.controller.relayService.fileIndex.get(fileId);
            
            if (!fileInfo || !fileInfo.local || !fileInfo.fullPath) {
                return res.status(404).json({ error: '文件未就绪或未找到' });
            }

            if (!fs.existsSync(fileInfo.fullPath)) {
                return res.status(404).json({ error: '物理文件不存在' });
            }

            res.download(fileInfo.fullPath, fileInfo.fileName, (err) => {
                if (err && !res.headersSent) {
                    this.logger.error(`中继文件下载失败: ${fileInfo.fullPath}`, err);
                    res.status(500).json({ error: '下载失败' });
                }
            });
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
            const { path: targetPath } = req.body;
            if (!targetPath) return res.status(400).json({ error: 'Path is required' });
            const result = await this.controller.showInFolder(targetPath);
            res.json(result);
        });

        // 9.5 文件下载（供远程浏览器端下载已接收的文件）
        router.get('/download', (req, res) => {
            const filePath = req.query.path;
            if (!filePath) return res.status(400).json({ error: 'Path is required' });

            // 安全校验：仅允许下载 savePath（received/）目录内的文件，防止路径穿越
            const savePath = this.controller.fileTransferService.savePath;
            const resolvedSavePath = path.resolve(savePath);
            const resolvedFilePath = path.resolve(filePath);

            if (!resolvedFilePath.startsWith(resolvedSavePath + path.sep) && resolvedFilePath !== resolvedSavePath) {
                this.logger.warn(`Download rejected (path traversal attempt): ${filePath}`);
                return res.status(403).json({ error: '禁止访问该路径' });
            }

            if (!fs.existsSync(resolvedFilePath)) {
                return res.status(404).json({ error: '文件不存在或已被移动' });
            }

            const stat = fs.statSync(resolvedFilePath);
            if (!stat.isFile()) {
                return res.status(400).json({ error: '目标不是文件' });
            }

            res.download(resolvedFilePath, path.basename(resolvedFilePath), (err) => {
                if (err && !res.headersSent) {
                    this.logger.error(`Download failed: ${resolvedFilePath}`, err);
                    res.status(500).json({ error: '文件下载失败' });
                }
            });
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

        // 透明返回结果的辅助函数
        const _transparentResponse = (res, result) => {
            try {
                const json = JSON.parse(result);
                res.json(json);
            } catch (e) {
                res.send(result);
            }
        };

        // 15a. 精确模式路由 (无子路径)
        router.all('/proxy/:serviceId', async (req, res) => {
            const { serviceId } = req.params;

            // 拦截内网发出的健康探测请求
            if (req.headers['x-health-probe']) {
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
                const result = await this.controller.pullService(serviceId, params);
                _transparentResponse(res, result);
            } catch (err) {
                res.status(502).send({ error: err.message });
            }
        });

        // 15b. 网关模式路由 (带子路径): /api/proxy/ollama/api/tags → path="/api/tags"
        router.all('/proxy/:serviceId/*', async (req, res) => {
            const { serviceId } = req.params;
            const subPath = '/' + req.params[0];

            // 健康探测拦截
            if (req.headers['x-health-probe']) {
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

            // 注入网关元数据
            params.__gateway = {
                path: subPath,
                method: req.method
            };

            try {
                const result = await this.controller.pullService(serviceId, params);
                _transparentResponse(res, result);
            } catch (err) {
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

        // 监听 HTTP Server Upgrade 事件以分流 /relay WebSocket 连接
        this.server.on('upgrade', (request, socket, head) => {
            const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;

            if (pathname === '/relay') {
                const relayWsServer = new WebSocket.Server({ noServer: true });
                relayWsServer.handleUpgrade(request, socket, head, (ws) => {
                    this.controller.relayService.handlePeerConnection(ws);
                });
            } else {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            }
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

        this.controller.on('file_notify', (data) => {
            this._broadcast('file_notify', data);
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
