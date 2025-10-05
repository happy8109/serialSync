const express = require('express');
const { getStatus, connectSerial, disconnectSerial, sendData, listPorts, updateConfig, getSerialConfig } = require('../services/serialService');
const multer = require('multer');
const upload = multer();

const router = express.Router();

// 获取连接状态
router.get('/status', async (req, res) => {
  try {
    const status = await getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取串口连接状态（专门用于调试）
router.get('/serial-status', async (req, res) => {
  try {
    const serialService = require('../services/serialService');
    const isConnected = serialService.serialManager.isConnected;
    const currentPort = serialService.serialManager._currentPort;
    
    res.json({ 
      success: true, 
      data: { 
        connected: isConnected,
        port: currentPort,
        timestamp: new Date().toISOString()
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 连接串口
router.post('/connect', async (req, res) => {
  try {
    const port = req.body.port;
    await connectSerial(port);
    res.json({ success: true, message: '串口连接成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 断开连接
router.post('/disconnect', async (req, res) => {
  try {
    await disconnectSerial();
    res.json({ success: true, message: '串口已断开' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 发送数据
router.post('/send', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, error: '数据不能为空' });
    }
    await sendData(data);
    res.json({ success: true, message: '数据发送成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 文件发送接口
router.post('/sendfile', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未上传文件' });
    }
    const fileBuf = req.file.buffer;
    // 修正中文文件名乱码
    let fileName = req.file.originalname;
    if (/[^\x00-\x7F]/.test(fileName) || /[\x80-\xff]/.test(fileName)) {
      fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }
    // 发送文件，推送进度
    let lastPercent = -1;
    let lastSpeed = 0, lastLost = 0, lastRetry = 0;
    const meta = { name: fileName };
    // 监听进度
    const onProgress = (info) => {
      if (info.type === 'send' && info.total) {
        if (info.percent !== lastPercent) {
          lastPercent = info.percent;
          lastSpeed = info.speed;
          lastLost = info.lostBlocks;
          lastRetry = info.totalRetries;
          // 推送到WebSocket
          const { broadcast } = require('../ws/index');
          broadcast({
            type: 'file-progress',
            direction: 'send',
            percent: info.percent,
            speed: info.speed,
            lostBlocks: info.lostBlocks,
            totalRetries: info.totalRetries,
            fileName,
            meta
          });
        }
      }
    };
    const serialService = require('../services/serialService');
    serialService.serialManager.on('progress', onProgress);
    await serialService.serialManager.sendFile(fileBuf, meta);
    serialService.serialManager.removeListener('progress', onProgress);
    // 发送完成
    res.json({ success: true, speed: lastSpeed, lostBlocks: lastLost, totalRetries: lastRetry });
    // 推送完成事件
    const { broadcast } = require('../ws/index');
    broadcast({
      type: 'file-progress',
      direction: 'send',
      percent: 100,
      speed: lastSpeed,
      lostBlocks: lastLost,
      totalRetries: lastRetry,
      fileName,
      meta,
      status: 'done'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
    // 推送错误事件
    const { broadcast } = require('../ws/index');
    broadcast({
      type: 'file-progress',
      direction: 'send',
      percent: 0,
      speed: 0,
      lostBlocks: 0,
      totalRetries: 0,
      fileName: req.file ? req.file.originalname : '',
      status: 'error',
      error: error.message
    });
  }
});

// 获取可用串口列表
router.get('/ports', async (req, res) => {
  try {
    const ports = await listPorts();
    res.json({ success: true, data: ports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取串口参数
router.get('/config', async (req, res) => {
  try {
    const config = await getSerialConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新配置
router.put('/config', async (req, res) => {
  try {
    const { serial, sync } = req.body;
    await updateConfig({ serial, sync });
    res.json({ success: true, message: '配置更新成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 拉式数据传输API ====================

// 获取本地服务列表
router.get('/services', async (req, res) => {
  try {
    const serialService = require('../services/serialService');
    const services = serialService.serialManager.getLocalServices();
    res.json({ success: true, data: services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 注册本地服务
router.post('/services/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const metadata = req.body;
    
    const serialService = require('../services/serialService');
    serialService.serialManager.registerLocalService(serviceId, metadata);
    
    res.json({ success: true, message: '服务注册成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 拉取对端数据
router.get('/pull/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const params = req.query;
    
    const serialService = require('../services/serialService');
    
    // 检查串口连接状态
    if (!serialService.serialManager.isConnected) {
      return res.status(500).json({ 
        success: false, 
        error: '串口未连接，请先连接串口' 
      });
    }
    
    console.log(`[API] 收到拉取请求: serviceId=${serviceId}, params=`, params);
    console.log(`[API] 串口连接状态: ${serialService.serialManager.isConnected}`);
    
    const result = await serialService.serialManager.pullData(serviceId, params);
    
    // 尝试解析JSON响应
    try {
      const jsonResult = JSON.parse(result);
      res.json({ success: true, data: jsonResult });
    } catch (e) {
      // 如果不是JSON，直接返回文本
      res.set('Content-Type', 'text/plain');
      res.send(result);
    }
  } catch (error) {
    console.error(`[API] 拉取请求失败:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST方式拉取对端数据（支持复杂参数）
router.post('/pull/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const params = req.body;
    
    const serialService = require('../services/serialService');
    const result = await serialService.serialManager.pullData(serviceId, params);
    
    // 尝试解析JSON响应
    try {
      const jsonResult = JSON.parse(result);
      res.json({ success: true, data: jsonResult });
    } catch (e) {
      // 如果不是JSON，直接返回文本
      res.set('Content-Type', 'text/plain');
      res.send(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
