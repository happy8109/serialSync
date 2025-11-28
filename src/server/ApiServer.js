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
    constructor(port = 3000) {
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
        this.app.use(express.json());
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
                this.controller.setFileTransferConfig(config);
                res.json({ success: true, config });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
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

        // 捕获错误，防止进程崩溃
        this.controller.on('error', (err) => {
            this.logger.error(`Controller Error: ${err.message}`);
            this._broadcast('error', { message: err.message });
        });
    }

    start() {
        this.server.listen(this.port, () => {
            this.logger.info(`API Server running on http://localhost:${this.port}`);
        });
    }
}

module.exports = ApiServer;
