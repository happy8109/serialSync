/**
 * cli.js
 * 基于 v2.0 架构的新版 CLI 工具 (REPL 模式)
 * 用法: node src/cli.js [PORT]
 * 如果不指定 PORT，将使用配置文件中的默认端口
 */

const readline = require('readline');
const AppController = require('./core/interface/AppController');
const config = require('config');
const { logger } = require('./utils/logger');
let cliLogger = logger;

const controller = new AppController();

// 获取命令行参数中的串口号，如果没有则使用配置文件
const args = process.argv.slice(2);
const port = args[0] || config.get('serial.port');

if (!port) {
    console.error('Usage: node src/cli.js <PORT>');
    console.error('Or configure default port in config/default.json');
    process.exit(1);
}

// 更新 Logger，带上 Port 信息
cliLogger = logger.child({ port });

console.log(`Using port: ${port} ${args[0] ? '(from argument)' : '(from config)'}`);

// 监听系统事件
controller.on('status', (status) => {
    const msg = `[System] ${status.connected ? 'Connected' : 'Disconnected'}`;
    console.log(msg);
    cliLogger.info(msg);
});

controller.on('error', (err) => {
    const msg = `[Error] ${err.message}`;
    console.error(msg);
    cliLogger.error(msg);
});

controller.on('chat', (msg) => {
    const logMsg = `[Chat] ${msg.text}`;
    console.log(logMsg);
    cliLogger.info(logMsg);
});

controller.on('pong', (data) => {
    const logMsg = `[System] Pong received (RTT: ${data.rtt}ms)`;
    console.log(logMsg);
    cliLogger.info(logMsg);
});

controller.on('frame', (frame) => {
    // 过滤掉 CHAT (0x10)、PING/PONG (0x00/0x01) 和所有文件传输相关的包 (0x20-0x24)
    // 以保持终端清爽,文件传输进度由 FileService 的日志显示
    if (frame.type === 0x10 || frame.type === 0x00 || frame.type === 0x01) return;
    if (frame.type >= 0x20 && frame.type <= 0x24) return; // FILE_OFFER, ACCEPT, CHUNK, ACK, FIN

    let typeStr = `0x${frame.type.toString(16)}`;
    let content = `[${frame.body.length} bytes]`;
    console.log(`[Recv] ${typeStr} Seq=${frame.seq} ${content}`);
});

// 启动连接
console.log(`Connecting to ${port}...`);
controller.connect(port).catch(err => {
    console.error('Connect failed:', err.message);
    cliLogger.error(`Connect failed: ${err.message}`);
    process.exit(1);
});

// 设置 REPL
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

rl.prompt();

rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }

    const [cmd, ...args] = input.split(' ');

    try {
        switch (cmd.toLowerCase()) {
            case 'chat':
                const rawText = args.join(' ');
                // 支持 \n 转义换行
                const text = rawText.replace(/\\n/g, '\n');
                if (!text) console.log('Usage: chat <message>');
                else controller.sendChat(text);
                break;

            case 'ping':
                controller.sendPing();
                console.log('Ping sent');
                break;

            case 'file':
                const arg = args[0];
                if (!arg) {
                    console.log('Usage: file <filepath> OR file <count> (for simulation)');
                    break;
                }

                // Check if it's a number (simulation)
                if (/^\d+$/.test(arg)) {
                    const count = parseInt(arg);
                    controller.simulateFileTransfer(count);
                } else {
                    // Real file transfer
                    controller.sendFile(arg).then(fileId => {
                        console.log(`[File] Transfer started. ID: ${fileId}`);
                    }).catch(err => {
                        console.error(`[File] Error: ${err.message}`);
                    });
                }
                break;

            case 'status':
                console.table(controller.getStatus());
                break;

            case 'help':
                console.log('Commands: chat <msg>, ping, file <chunks>, status, exit');
                break;

            case 'exit':
            case 'quit':
                process.exit(0);
                break;

            default:
                console.log('Unknown command. Type "help" for list.');
        }
    } catch (err) {
        console.error('Command error:', err.message);
    }

    rl.prompt();
});

rl.on('close', () => {
    process.exit(0);
});
