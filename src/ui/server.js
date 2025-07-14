const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const config = require('config');
const { logger } = require('../utils/logger');
const apiRouter = require('./api/index.js');
const serialService = require('./services/serialService');

class WebServer {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
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

    // 优雅关闭
    process.on('SIGTERM', () => {
      this.gracefulShutdown();
    });

    process.on('SIGINT', () => {
      this.gracefulShutdown();
    });
  }

  /**
   * 优雅关闭
   */
  async gracefulShutdown() {
    logger.info('正在关闭服务器...');
    // 关闭串口资源
    try {
      await serialService.closeAll();
      logger.info('串口资源已关闭');
    } catch (e) {
      logger.warn('关闭串口资源时发生异常', e);
    }
    // 关闭HTTP服务器
    if (this.server) {
      this.server.close(() => {
        logger.info('服务器已关闭');
        process.exit(0);
      });
    }
  }
}

module.exports = WebServer; 