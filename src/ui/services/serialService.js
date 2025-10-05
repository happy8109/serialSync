const { logger } = require('../../utils/logger');
const SerialManager = require('../../core/serial/SerialManager');
const { broadcast } = require('../ws/index');
const config = require('config');

// 全局serialManager实例，支持串口覆盖
let serialManager = null;
let serialPortOverride = null;

// 初始化serialManager
function initSerialManager(portOverride = null) {
  if (serialManager) {
    // 如果已经存在实例且串口覆盖参数相同，直接返回
    if (serialPortOverride === portOverride) {
      return serialManager;
    }
    // 否则需要重新创建实例
    logger.info(`重新初始化SerialManager，串口覆盖: ${portOverride}`);
  }
  
  serialPortOverride = portOverride;
  serialManager = new SerialManager();
  setupEventListeners();
  return serialManager;
}

// 设置事件监听器
function setupEventListeners() {
  if (!serialManager) return;

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
}

// 获取连接状态
function getStatus() {
  if (!serialManager) {
    return { connected: false, port: null };
  }
  return serialManager.getConnectionStatus();
}

// 连接串口
async function connectSerial(port) {
  logger.info(`[serialService] connectSerial 被调用, port=${port}`);
  // 确保serialManager已初始化
  if (!serialManager) {
    initSerialManager();
  }
  // 使用串口覆盖参数或用户指定的端口
  const actualPort = port || serialPortOverride;
  await serialManager.connect(actualPort);
}

// 断开连接
async function disconnectSerial() {
  logger.info('[serialService] disconnectSerial 被调用');
  if (serialManager) {
    serialManager.disconnect();
  }
}

// 发送数据
async function sendData(data) {
  if (!serialManager) {
    throw new Error('SerialManager未初始化');
  }
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

// 更新配置（实现写入 config/default.json 并重新应用配置）
async function updateConfig({ serial, sync }) {
  logger.info('配置更新请求', { serial, sync });
  const configPath = require('path').join(process.cwd(), 'config', 'default.json');
  const fs = require('fs');
  let configObj = {};
  try {
    configObj = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    logger.error('读取配置文件失败', e);
    throw new Error('读取配置文件失败');
  }
  if (serial) {
    configObj.serial = { ...configObj.serial, ...serial };
  }
  if (sync) {
    configObj.sync = { ...configObj.sync, ...sync };
  }
  try {
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf-8');
    logger.info('配置文件已更新');

    // 如果当前已连接，则需要断开重连以应用新配置
    if (serialManager) {
      const wasConnected = serialManager.isConnected;
      const currentPort = serialManager._currentPort;
      
      if (wasConnected) {
        logger.info('断开当前连接以应用新配置');
        await serialManager.disconnect();
        
        // 等待一小段时间确保端口完全释放
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 使用新配置重新连接
        logger.info('使用新配置重新连接');
        try {
          await serialManager.connect(currentPort);
          logger.info('使用新配置重新连接成功');
        } catch (err) {
          logger.error('使用新配置重新连接失败:', err);
          throw new Error('使用新配置重新连接失败: ' + err.message);
        }
      } else {
        // 即使没有连接，也要确保配置已更新
        logger.info('配置已更新，下次连接时将使用新配置');
      }
    } else {
      logger.info('配置已更新，SerialManager未初始化');
    }
  } catch (e) {
    logger.error('配置更新失败', e);
    throw new Error('配置更新失败: ' + e.message);
  }
}

// 获取串口参数
function getSerialConfig() {
  // 重新读取配置文件，而不是使用缓存的配置
  const fs = require('fs');
  const configPath = require('path').join(process.cwd(), 'config', 'default.json');
  try {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // 返回完整的配置信息，包括serial和sync
    const result = {
      ...configData.serial,
      ...configData.sync
    };
    
    // 如果有串口覆盖参数，使用覆盖的串口
    if (serialPortOverride) {
      result.port = serialPortOverride;
    }
    
    return result;
  } catch (e) {
    logger.error('读取配置文件失败，使用缓存配置', e);
    // 如果读取失败，回退到 config 模块
    const result = {
      ...config.get('serial'),
      ...config.get('sync')
    };
    
    // 如果有串口覆盖参数，使用覆盖的串口
    if (serialPortOverride) {
      result.port = serialPortOverride;
    }
    
    return result;
  }
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

// 延迟初始化，等待命令行参数

module.exports = {
  getStatus,
  connectSerial,
  disconnectSerial,
  sendData,
  listPorts,
  updateConfig,
  closeAll,
  getSerialConfig,
  initSerialManager, // 导出初始化函数
  get serialManager() { return serialManager; } // 导出实例的getter
}; 