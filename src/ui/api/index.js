const express = require('express');
const { getStatus, connectSerial, disconnectSerial, sendData, listPorts, updateConfig } = require('../services/serialService');

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

// 获取可用串口列表
router.get('/ports', async (req, res) => {
  try {
    const ports = await listPorts();
    res.json({ success: true, data: ports });
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

module.exports = router;
