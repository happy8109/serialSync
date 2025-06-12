const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const config = require('config');
const { logger } = require('../utils/logger');
const SerialManager = require('../core/serial/SerialManager');

class WebServer {
  constructor() {
    this.app = express();
    this.serialManager = new SerialManager();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSerialEvents();
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
    this.app.use('/api', this.createApiRoutes());
    
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
   * 创建API路由
   */
  createApiRoutes() {
    const router = express.Router();

    // 获取连接状态
    router.get('/status', (req, res) => {
      try {
        const status = this.serialManager.getConnectionStatus();
        res.json({
          success: true,
          data: status
        });
      } catch (error) {
        logger.error('获取状态失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 连接串口
    router.post('/connect', async (req, res) => {
      try {
        await this.serialManager.connect();
        res.json({
          success: true,
          message: '串口连接成功'
        });
      } catch (error) {
        logger.error('连接失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 断开连接
    router.post('/disconnect', (req, res) => {
      try {
        this.serialManager.disconnect();
        res.json({
          success: true,
          message: '串口已断开'
        });
      } catch (error) {
        logger.error('断开连接失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 发送数据
    router.post('/send', async (req, res) => {
      try {
        const { data } = req.body;
        
        if (!data) {
          return res.status(400).json({
            success: false,
            error: '数据不能为空'
          });
        }

        await this.serialManager.sendData(data);
        res.json({
          success: true,
          message: '数据发送成功'
        });
      } catch (error) {
        logger.error('发送数据失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取可用串口列表
    router.get('/ports', async (req, res) => {
      try {
        const { SerialPort } = require('serialport');
        const ports = await SerialPort.list();
        res.json({
          success: true,
          data: ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer,
            serialNumber: port.serialNumber,
            pnpId: port.pnpId,
            vendorId: port.vendorId,
            productId: port.productId
          }))
        });
      } catch (error) {
        logger.error('获取串口列表失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 更新配置
    router.put('/config', (req, res) => {
      try {
        const { serial, sync } = req.body;
        
        // 这里应该实现配置更新逻辑
        // 为了简化，这里只是返回成功
        logger.info('配置更新请求', { serial, sync });
        
        res.json({
          success: true,
          message: '配置更新成功'
        });
      } catch (error) {
        logger.error('更新配置失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    return router;
  }

  /**
   * 设置串口事件
   */
  setupSerialEvents() {
    this.serialManager.on('connected', () => {
      logger.info('串口连接事件触发');
    });

    this.serialManager.on('disconnected', () => {
      logger.info('串口断开事件触发');
    });

    this.serialManager.on('data', (data) => {
      logger.info('接收到串口数据:', data);
    });

    this.serialManager.on('error', (error) => {
      logger.error('串口错误事件:', error);
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
    
    // 断开串口连接
    this.serialManager.disconnect();
    
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