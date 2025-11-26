#!/usr/bin/env node

/**
 * SerialSync - 串口通信程序
 * 主入口文件
 */

const config = require('config');
const SERIALSYNC_VERSION = 'v1.2.0';

// 首先创建日志目录
const fs = require('fs');
const path = require('path');
const logDir = path.dirname(config.get('logging.file'));
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 然后导入logger
const { logger } = require('./utils/logger');
const WebServer = require('./ui/server');

// 优雅关闭处理
process.on('uncaughtException', (error) => {
    if (logger) {
        logger.error('未捕获的异常:', error);
    } else {
        console.error('未捕获的异常:', error);
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    if (logger) {
        logger.error('未处理的Promise拒绝:', reason);
    } else {
        console.error('未处理的Promise拒绝:', reason);
    }
    process.exit(1);
});

/**
 * 启动应用
 */
async function startApp(overridePort, overrideSerialPort) {
    try {
        logger.info('正在启动 SerialSync 应用...');
        
        // 显示启动信息
        console.log(`\n            -= SerialSync ${SERIALSYNC_VERSION} 串口通信同步程序 =-\n        `);

        // 验证配置
        validateConfig(overridePort, overrideSerialPort);
        
        // 启动Web服务器
        const server = new WebServer(overrideSerialPort);
        // 覆盖端口
        if (overridePort) {
            const originalStart = server.start.bind(server);
            server.start = function() {
                const host = config.get('server.host');
                this.server = this.app.listen(overridePort, host, () => {
                    logger.info(`Web服务器已启动: http://${host}:${overridePort}`);
                    // 初始化WebSocket服务
                    try {
                        const { initWebSocket } = require('./ui/ws/index');
                        initWebSocket(this.server);
                        logger.info('WebSocket服务已初始化');
                    } catch (error) {
                        logger.error('WebSocket服务初始化失败:', error);
                    }
                });
                process.on('SIGTERM', () => { this.gracefulShutdown(); });
                process.on('SIGINT', () => { this.gracefulShutdown(); });
            };
        }
        server.start();
        
        // 自动连接串口（核心功能）
        logger.info('正在自动连接串口...');
        const { autoConnectSerial } = require('./ui/services/serialService');
        const connectSuccess = await autoConnectSerial();
        if (connectSuccess) {
            logger.info('串口桥核心功能已就绪');
        } else {
            logger.warn('串口连接失败，但程序继续运行（可通过Web界面手动连接）');
        }
        
        logger.info('SerialSync 应用启动成功');
        
        // 显示访问信息
        const port = overridePort || config.get('server.port');
        const host = config.get('server.host');
        const serialPort = overrideSerialPort || config.get('serial.port');
        const serialStatus = connectSuccess ? '✅ 已连接' : '❌ 未连接';
        console.log(`\n🌐 Web界面: http://${host}:${port}\n📊 串口配置: ${serialPort} @ ${config.get('serial.baudRate')}bps (${serialStatus})\n📝 日志文件: ${config.get('logging.file')}\n🔧 按 Ctrl+C 退出程序\n        `);
        
    } catch (error) {
        logger.error('应用启动失败:', error);
        console.error('❌ 应用启动失败:', error.message);
        process.exit(1);
    }
}

/**
 * 验证配置
 */
function validateConfig(overridePort, overrideSerialPort) {
    try {
        // 验证串口配置
        const serialConfig = config.get('serial');
        const serialPort = overrideSerialPort || serialConfig.port;
        if (!serialPort) {
            throw new Error('串口配置错误: 未指定串口');
        }
        
        // 验证日志配置
        const loggingConfig = config.get('logging');
        if (!loggingConfig.file) {
            throw new Error('日志配置错误: 未指定日志文件路径');
        }
        
        // 验证服务器配置
        const serverConfig = config.get('server');
        const port = overridePort || serverConfig.port;
        if (!port || port < 1 || port > 65535) {
            throw new Error('服务器配置错误: 端口号无效');
        }
        
        logger.info('配置验证通过');
        
    } catch (error) {
        logger.error('配置验证失败:', error);
        throw error;
    }
}

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
SerialSync - 串口通信程序

用法:
  node src/index.js [选项]

选项:
  --help, -h          显示帮助信息
  --version, -v       显示版本信息
  --port <port>       指定Web服务器端口
  --serial <port>     指定串口端口
  --config <path>     指定配置文件路径

示例:
  node src/index.js
  node src/index.js --port 3001 --serial COM4
  node src/index.js --port 3002 --serial COM5
  node src/index.js --config ./config/custom.json

配置文件:
  默认配置文件: config/default.json
  环境配置文件: config/{NODE_ENV}.json

环境变量:
  NODE_ENV        运行环境 (development|production)
  SERIAL_PORT     串口端口
  SERIAL_BAUDRATE 波特率
  SERVER_PORT     Web服务器端口

更多信息请访问: https://github.com/your-repo/serial-sync
    `);
}

/**
 * 显示版本信息
 */
function showVersion() {
    const packageJson = require('../package.json');
    console.log(`SerialSync ${SERIALSYNC_VERSION}`);
    console.log(`Node.js ${process.version}`);
    console.log(`Platform ${process.platform} ${process.arch}`);
}

// 命令行参数处理
const args = process.argv.slice(2);

let overridePort = null;
let overrideSerialPort = null;

if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
}

// 解析 --port 参数
const portIndex = args.findIndex(arg => arg === '--port');
if (portIndex !== -1 && args[portIndex + 1]) {
    overridePort = parseInt(args[portIndex + 1], 10);
    if (isNaN(overridePort) || overridePort < 1 || overridePort > 65535) {
        console.error('❌ 端口号无效，请输入 1~65535 之间的数字');
        process.exit(1);
    }
}

// 解析 --serial 参数
const serialIndex = args.findIndex(arg => arg === '--serial');
if (serialIndex !== -1 && args[serialIndex + 1]) {
    overrideSerialPort = args[serialIndex + 1];
    if (!overrideSerialPort || typeof overrideSerialPort !== 'string') {
        console.error('❌ 串口参数无效，请输入有效的串口名称（如 COM4）');
        process.exit(1);
    }
}

// 启动应用
startApp(overridePort, overrideSerialPort); 