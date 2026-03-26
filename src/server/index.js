/**
 * server/index.js
 * API Server 入口
 * 
 * 生产模式下充当轻量看门狗：将服务器作为子进程运行，
 * 收到退出信号后等待端口释放再重新孵化，解决 EADDRINUSE 问题。
 */

// --production 标志：自动设置 NODE_ENV
if (process.argv.includes('--production')) {
    process.env.NODE_ENV = 'production';
}

const isProduction = process.env.NODE_ENV === 'production';
const isChild = process.env._SERIALSYNC_WORKER === '1';

// ==================== 生产模式看门狗 ====================
if (isProduction && !isChild) {
    const { fork } = require('child_process');
    const path = require('path');

    let isShuttingDown = false;

    function spawnWorker() {
        const childEnv = { ...process.env, _SERIALSYNC_WORKER: '1' };
        const child = fork(path.join(__dirname, 'index.js'), process.argv.slice(2), {
            env: childEnv,
            stdio: 'inherit'
        });

        child.on('exit', (code) => {
            if (isShuttingDown) return;
            if (code === 0) {
                // 退出码 0 = 请求重启，等待端口释放后重新孵化
                console.log('[Supervisor] 收到重启信号，等待端口释放...');
                setTimeout(spawnWorker, 1500);
            } else {
                console.log(`[Supervisor] 工作进程异常退出 (code=${code})，2 秒后重启...`);
                setTimeout(spawnWorker, 2000);
            }
        });

        return child;
    }

    const worker = spawnWorker();

    const cleanup = () => {
        isShuttingDown = true;
        if (worker && !worker.killed) {
            worker.kill('SIGINT');
        }
        setTimeout(() => process.exit(0), 1000);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

} else {
    // ==================== 实际服务器逻辑 ====================
    const ApiServer = require('./ApiServer');
    const config = require('config');

    const args = process.argv.slice(2).filter(a => a !== '--production');
    const serialPortArg = args[0];
    const httpPortArg = args[1];

    const port = httpPortArg || process.env.API_PORT || process.env.PORT || (config.has('server.port') ? config.get('server.port') : 3003);

    const server = new ApiServer(port);
    server.start();

    // 自动连接逻辑
    const autoConnect = async () => {
        let targetPort = serialPortArg;
        let baudRate = 115200;

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

    setTimeout(autoConnect, 1000);

    // 优雅退出
    process.on('SIGINT', async () => {
        console.log('Stopping server...');
        if (server.controller) {
            await server.controller.disconnect();
        }
        process.exit(0);
    });
}
