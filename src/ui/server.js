const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const config = require('config');
const { logger } = require('../utils/logger');
const apiRouter = require('./api/index.js');
const serialService = require('./services/serialService');
const { initWebSocket } = require('./ws/index');

class WebServer {
  constructor() {
    this.app = express();
    this.wsServer = null; // 保存WebSocket实例
    this.setupMiddleware();
    this.setupRoutes();
    this._signalHandlersRegistered = false;
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    // 启用压缩
    this.app.use(compression());
    
    // 启用CORS
    this.app.use(cors());
    
    // 解析JSON
    this.app.use(express.json({ limit: '10mb' }));
    
    // 解析URL编码
    this.app.use(express.urlencoded({ extended: true }));
    
    // 静态文件服务
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // 请求日志
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // API路由
    this.app.use('/api', apiRouter);
    
    // 主页路由
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: '页面未找到' });
    });
    
    // 错误处理中间件
    this.app.use((error, req, res, next) => {
      logger.error('服务器错误:', error);
      res.status(500).json({ error: '服务器内部错误' });
    });
  }

  /**
   * 启动服务器
   */
  start() {
    const port = config.get('server.port');
    const host = config.get('server.host');

    this.server = this.app.listen(port, host, () => {
      logger.info(`Web服务器已启动: http://${host}:${port}`);
      this.wsServer = initWebSocket(this.server);
      // 设置最大监听器数，防止内存泄漏警告
      this.server.setMaxListeners(20);
      if (this.wsServer) this.wsServer.setMaxListeners(20);
      logger.info('WebSocket服务已初始化');
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`端口 ${port} 已被占用，请更换端口或关闭占用进程。`);
        console.error(`❌ 端口 ${port} 已被占用，请更换端口或关闭占用进程。`);
        process.exit(1);
      } else {
        logger.error('服务器启动失败:', err);
        console.error('❌ 服务器启动失败:', err.message);
        process.exit(1);
      }
    });

    if (!this._signalHandlersRegistered) {
      process.on('SIGTERM', () => {
        this.gracefulShutdown();
      });
      process.on('SIGINT', () => {
        this.gracefulShutdown();
      });
      this._signalHandlersRegistered = true;
    }
  }

  /**
   * 优雅关闭
   */
  async gracefulShutdown() {
    logger.info('正在关闭服务器...');
    try {
      await serialService.closeAll();
      logger.info('串口资源已关闭');
    } catch (e) {
      logger.warn('关闭串口资源时发生异常', e);
    }

    // 立即关闭所有WebSocket连接
    if (this.wsServer) {
      this.wsServer.clients.forEach(client => {
        try { client.terminate(); } catch (e) {}
      });
      try { this.wsServer.close(); } catch (e) {}
      this.wsServer.removeAllListeners();
    }

    // 立即关闭HTTP服务器
    if (this.server) {
      try { this.server.close(); } catch (e) {}
      this.server.removeAllListeners();
    }

    // 立即退出
    process.exit(0);
  }
}

module.exports = WebServer; 