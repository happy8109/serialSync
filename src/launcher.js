/**
 * launcher.js
 * SerialSync 统一启动器
 * 同时启动后端 API 服务和前端 Web UI，方便开发和测试。
 * 
 * 用法:
 * node src/launcher.js [SerialPort] [ApiPort] [WebPort]
 * 
 * 示例:
 * node src/launcher.js COM3 3000 5173
 * node src/launcher.js COM4 3001 5174
 */

const { spawn } = require('child_process');
const path = require('path');

// 读取配置文件 (Bypass node-config cache by reading file directly)
const args = process.argv.slice(2); // Restore args definition
let fileConfig = {};
try {
    const configPath = path.join(__dirname, '..', 'config', 'default.json');
    if (require('fs').existsSync(configPath)) {
        fileConfig = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
    }
} catch (e) {
    console.error('[Launcher] Failed to read config/default.json', e);
}

// 1. 串口配置
// 优先级: CLI 参数 > 配置文件 > 默认值
const serialPort = args[0] || (fileConfig.serial && fileConfig.serial.port) || 'COM3';

// 2. API 服务端口
const apiPort = args[1] || (fileConfig.server && fileConfig.server.port) || '3000';

// 3. Web UI 端口
const webPort = args[2] || (fileConfig.web && fileConfig.web.port) || '5173';

const projectRoot = path.resolve(__dirname, '..');
const serverScript = path.join(projectRoot, 'src', 'server', 'index.js');
const webDir = path.join(projectRoot, 'src', 'web');

console.log('==================================================');
console.log(`SerialSync Launcher`);
console.log(`Serial Port : ${serialPort}`);
console.log(`API Port    : ${apiPort}`);
console.log(`Web Port    : ${webPort}`);
console.log('==================================================\n');

const children = [];

// 1. 启动后端 API Server
console.log('[Launcher] Starting API Server...');
const serverProcess = spawn('node', ['--no-deprecation', serverScript, serialPort, apiPort], {
    cwd: projectRoot,
    stdio: 'pipe', // 使用 pipe 以便我们可以给日志加前缀
    env: { ...process.env, PORT: String(apiPort) }
});

serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[Backend] ${data}`);
});
serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[Backend] ${data}`);
});
children.push(serverProcess);

// 2. 启动前端 Web UI (Vite Dev Server)
// 注意: Windows 下 npm 是 npm.cmd
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('[Launcher] Starting Web UI...');
const webProcess = spawn(npmCmd, ['run', 'dev'], {
    cwd: webDir,
    stdio: 'pipe',
    env: {
        ...process.env,
        PORT: String(webPort),
        API_PORT: String(apiPort),
        NODE_OPTIONS: '--no-deprecation'
    },
    shell: true
});

webProcess.stdout.on('data', (data) => {
    // 过滤掉一些嘈杂的 Vite 输出，或者直接透传
    process.stdout.write(`[Frontend] ${data}`);
});
webProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    // 过滤掉已知的无害警告和错误
    if (msg.includes('DeprecationWarning') ||
        msg.includes('ws proxy socket error') ||
        msg.includes('ECONNABORTED')) {
        return;
    }
    process.stderr.write(`[Frontend] ${data}`);
});
children.push(webProcess);

// 3. 优雅退出
const cleanup = () => {
    console.log('\n[Launcher] Shutting down services...');
    children.forEach(child => {
        try {
            child.kill();
        } catch (e) {
            // ignore
        }
    });
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
