#!/usr/bin/env node

/**
 * SerialSync - 串口通信程序
 * 主入口文件
 */

const config = require('config');

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
async function startApp() {
    try {
        logger.info('正在启动 SerialSync 应用...');
        
        // 显示启动信息
        console.log(`
            -= SerialSync v1.0.0 串口通信同步程序 =-
        `);

        // 验证配置
        validateConfig();
        
        // 启动Web服务器
        const server = new WebServer();
        server.start();
        
        logger.info('SerialSync 应用启动成功');
        
        // 显示访问信息
        const port = config.get('server.port');
        const host = config.get('server.host');
        console.log(`
🌐 Web界面: http://${host}:${port}
📊 串口配置: ${config.get('serial.port')} @ ${config.get('serial.baudRate')}bps
📝 日志文件: ${config.get('logging.file')}
🔧 按 Ctrl+C 退出程序
        `);
        
    } catch (error) {
        logger.error('应用启动失败:', error);
        console.error('❌ 应用启动失败:', error.message);
        process.exit(1);
    }
}

/**
 * 验证配置
 */
function validateConfig() {
    try {
        // 验证串口配置
        const serialConfig = config.get('serial');
        if (!serialConfig.port) {
            throw new Error('串口配置错误: 未指定串口');
        }
        
        // 验证日志配置
        const loggingConfig = config.get('logging');
        if (!loggingConfig.file) {
            throw new Error('日志配置错误: 未指定日志文件路径');
        }
        
        // 验证服务器配置
        const serverConfig = config.get('server');
        if (!serverConfig.port || serverConfig.port < 1 || serverConfig.port > 65535) {
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
  --help, -h     显示帮助信息
  --version, -v  显示版本信息
  --config <path> 指定配置文件路径

示例:
  node src/index.js
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
    console.log(`SerialSync v${packageJson.version}`);
    console.log(`Node.js ${process.version}`);
    console.log(`Platform ${process.platform} ${process.arch}`);
}

// 命令行参数处理
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
}

// 启动应用
startApp(); 