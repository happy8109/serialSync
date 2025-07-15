const { logger } = require('../../utils/logger');
const SerialManager = require('../../core/serial/SerialManager');
const { broadcast } = require('../ws/index');
const config = require('config');

const serialManager = new SerialManager();

const path = require('path');
const fs = require('fs');

// 监听文件请求事件，实现自动接收
serialManager.on('fileRequest', (meta, accept, reject, options) => {
  const requireConfirm = options && options.requireConfirm;
  if (!requireConfirm && config.get('sync.autoAccept')) {
    // 自动保存到配置目录
    const saveDir = config.get('sync.saveDir') || path.join(process.cwd(), 'received_files');
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const savePath = path.join(saveDir, meta.name || ('recv_' + Date.now()));
    logger.info(`[WS] 自动同意接收文件: ${meta.name}, 保存到: ${savePath}`);
    accept(savePath);
  } else {
    // 如需确认，可扩展为推送到前端，由前端决定是否 accept/reject
    logger.info(`[WS] 收到需确认的文件请求: ${meta.name}`);
  }
});

// 事件监听
serialManager.on('connected', () => {
  logger.info('串口连接事件触发');
  // 推送连接状态到前端
  broadcast({
    type: 'connection',
    status: 'connected',
    port: serialManager.getConnectionStatus().port
  });
});

serialManager.on('disconnected', () => {
  logger.info('串口断开事件触发');
  // 推送断开状态到前端
  broadcast({
    type: 'connection',
    status: 'disconnected'
  });
});

serialManager.on('data', (data) => {
  logger.info('接收到串口数据:', data);
  // 推送接收到的消息到前端
  broadcast({
    type: 'message',
    direction: 'received',
    data: data.toString('utf8'),
    timestamp: new Date().toISOString()
  });
});

serialManager.on('error', (error) => {
  logger.error('串口错误事件:', error);
  // 推送错误信息到前端
  broadcast({
    type: 'error',
    message: error.message || error.toString()
  });
});

// 新增：监听文件接收进度和完成事件
serialManager.on('progress', (info) => {
  if (info.type === 'receive') {
    broadcast({
      type: 'file-progress',
      direction: 'receive',
      percent: info.percent,
      speed: info.speed,
      lostBlocks: info.lostBlocks,
      totalRetries: info.totalRetries,
      fileName: info.fileName,
      meta: info.meta,
      status: info.status
    });
  }
});

serialManager.on('file-received', (info) => {
  logger.info('[WS] 文件接收完成:', info);
  broadcast({
    type: 'file-received',
    fileName: info.fileName,
    savePath: info.savePath,
    meta: info.meta
  });
});

serialManager.on('file', (buf, meta, savePath) => {
  try {
    if (!savePath) {
      const saveDir = config.get('sync.saveDir') || path.join(process.cwd(), 'received_files');
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      savePath = path.join(saveDir, meta && meta.name ? meta.name : ('recv_' + Date.now()));
    }
    fs.writeFileSync(savePath, buf);
    logger.info(`[WS] 文件已保存到: ${savePath}`);
    // 主动触发 file-received 事件
    serialManager.emit('file-received', {
      fileName: meta && meta.name,
      savePath,
      meta
    });
    // 新增：推送接收完成的 file-progress，便于前端自动隐藏进度条
    broadcast({
      type: 'file-progress',
      direction: 'receive',
      percent: 100,
      speed: 0,
      fileName: meta && meta.name,
      meta,
      status: 'done'
    });
  } catch (e) {
    logger.error(`[WS] 文件保存失败: ${e.message}`);
  }
});

// 获取连接状态
function getStatus() {
  return serialManager.getConnectionStatus();
}

// 连接串口
async function connectSerial(port) {
  logger.info(`[serialService] connectSerial 被调用, port=${port}`);
  await serialManager.connect(port);
}

// 断开连接
async function disconnectSerial() {
  logger.info('[serialService] disconnectSerial 被调用');
  serialManager.disconnect();
}

// 发送数据
async function sendData(data) {
  await serialManager.sendData(data);
}

// 获取可用串口列表
async function listPorts() {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  return ports.map(port => ({
    path: port.path,
    manufacturer: port.manufacturer,
    serialNumber: port.serialNumber,
    pnpId: port.pnpId,
    vendorId: port.vendorId,
    productId: port.productId
  }));
}

// 更新配置（示例，实际可扩展）
async function updateConfig({ serial, sync }) {
  logger.info('配置更新请求', { serial, sync });
  // TODO: 实现实际配置更新逻辑
}

// 获取串口参数
function getSerialConfig() {
  // 只返回 serial 配置部分
  return config.get('serial');
}

// 关闭所有串口资源
async function closeAll() {
  if (serialManager && typeof serialManager.disconnect === 'function') {
    try {
      await serialManager.disconnect();
    } catch (e) {
      logger.warn('关闭串口资源时发生异常', e);
    }
  }
}

module.exports = {
  getStatus,
  connectSerial,
  disconnectSerial,
  sendData,
  listPorts,
  updateConfig,
  closeAll,
  getSerialConfig,
  serialManager // 导出实例
}; 