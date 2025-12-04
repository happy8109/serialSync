/**
 * server/index.js
 * API Server 入口
 */

const ApiServer = require('./ApiServer');
const config = require('config');

// 优先使用环境变量，其次配置文件，最后默认 3000
// 支持命令行参数: node src/server/index.js [SerialPort] [HttpPort]
const args = process.argv.slice(2);
const serialPortArg = args[0];
const httpPortArg = args[1];

const port = httpPortArg || process.env.API_PORT || process.env.PORT || (config.has('server.port') ? config.get('server.port') : 3000);

const server = new ApiServer(port);

server.start();

// 自动连接逻辑
const autoConnect = async () => {
    let targetPort = serialPortArg;
    let baudRate = 115200;

    // 如果命令行没指定，尝试从配置读取
    if (!targetPort && config.has('serial.port')) {
        targetPort = config.get('serial.port');
        if (config.has('serial.baudRate')) {
            baudRate = config.get('serial.baudRate');
        }
    }

    if (targetPort) {
        console.log(`[AutoConnect] Connecting to ${targetPort} at ${baudRate}...`);
        try {
            await server.controller.connect(targetPort, baudRate);
            console.log(`[AutoConnect] Successfully connected to ${targetPort}`);
        } catch (err) {
            console.error(`[AutoConnect] Failed to connect: ${err.message}`);
        }
    } else {
        console.log('[AutoConnect] No serial port specified, waiting for API connection...');
    }
};

// 延迟一点执行，确保服务器已启动
setTimeout(autoConnect, 1000);

// 优雅退出
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    if (server.controller) {
        await server.controller.disconnect();
    }
    process.exit(0);
});
