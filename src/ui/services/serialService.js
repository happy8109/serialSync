const { logger } = require('../../utils/logger');
const SerialManager = require('../../core/serial/SerialManager');

const serialManager = new SerialManager();

// 事件监听
serialManager.on('connected', () => {
  logger.info('串口连接事件触发');
});
serialManager.on('disconnected', () => {
  logger.info('串口断开事件触发');
});
serialManager.on('data', (data) => {
  logger.info('接收到串口数据:', data);
});
serialManager.on('error', (error) => {
  logger.error('串口错误事件:', error);
});

// 获取连接状态
function getStatus() {
  return serialManager.getConnectionStatus();
}

// 连接串口
async function connectSerial() {
  await serialManager.connect();
}

// 断开连接
async function disconnectSerial() {
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

module.exports = {
  getStatus,
  connectSerial,
  disconnectSerial,
  sendData,
  listPorts,
  updateConfig
}; 