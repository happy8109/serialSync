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
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const serverScript = path.join(projectRoot, 'src', 'server', 'index.js');
const webDir = path.join(projectRoot, 'src', 'web');
const pkgVersion = require('../package.json').version;

let serverProcess = null;
let webProcess = null;
let isRestarting = false;

// 跨平台杀掉进程树（解决 Windows/Linux 遗留孤儿进程霸占端口的问题）
function killProcessTree(proc) {
    if (!proc || !proc.pid) return;
    const pid = proc.pid;
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } else {
            // Linux/macOS: 先尝试用进程组信号杀整棵树 (kill -SIGTERM -- -PGID)
            // spawn with shell:true 会创建进程组，PGID 通常等于父 PID
            try {
                process.kill(-pid, 'SIGTERM');
            } catch (e1) {
                // 如果 PGID 方式失败，则遍历 /proc 手动查找并杀掉所有子进程
                try {
                    const { execSync } = require('child_process');
                    const children = execSync(`pgrep -P ${pid}`, { encoding: 'utf8' }).trim().split('\n');
                    children.filter(Boolean).forEach(childPid => {
                        try { process.kill(parseInt(childPid), 'SIGTERM'); } catch (e) {}
                    });
                } catch (e2) { /* pgrep may fail if no children, that's fine */ }
                try { proc.kill('SIGTERM'); } catch (e) {}
            }
            // 兜底：500ms 后对残留进程补发 SIGKILL
            setTimeout(() => {
                try { process.kill(-pid, 'SIGKILL'); } catch (e) {}
                try { proc.kill('SIGKILL'); } catch (e) {}
            }, 500);
        }
    } catch (e) {
        try { proc.kill('SIGKILL'); } catch (err) {}
    }
}

function readConfig() {
    const args = process.argv.slice(2);
    let fileConfig = {};
    try {
        const configPath = path.join(projectRoot, 'config', 'default.json');
        const examplePath = path.join(projectRoot, 'config', 'default.json.example');

        // 首次运行：从模板自动生成配置文件
        if (!fs.existsSync(configPath) && fs.existsSync(examplePath)) {
            fs.copyFileSync(examplePath, configPath);
            console.log('[Launcher] 首次运行：已从 default.json.example 生成配置文件 default.json');
        }

        if (fs.existsSync(configPath)) {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) {
        console.error('[Launcher] Failed to read config/default.json', e);
    }
    
    const serialPort = args[0] || (fileConfig.serial && fileConfig.serial.port) || 'COM3';
    const apiPort = args[1] || (fileConfig.server && fileConfig.server.port) || 3000;
    const webPort = args[2] || (fileConfig.web && fileConfig.web.port) || 5173;
    
    return { serialPort, apiPort, webPort };
}

function startServices() {
    isRestarting = false;
    const { serialPort, apiPort, webPort } = readConfig();

    console.log('\n==================================================');
    console.log(`SerialSync Launcher v${pkgVersion}`);
    console.log(`Serial Port : ${serialPort}`);
    console.log(`API Port    : ${apiPort}`);
    console.log(`Web Port    : ${webPort}`);
    console.log('==================================================\n');

    console.log('[Launcher] Starting API Server...');
    serverProcess = spawn('node', ['--no-deprecation', serverScript, serialPort, apiPort], {
        cwd: projectRoot,
        stdio: 'pipe',
        env: { ...process.env, PORT: String(apiPort) }
    });

    serverProcess.stdout.on('data', (data) => process.stdout.write(`[Backend] ${data}`));
    serverProcess.stderr.on('data', (data) => process.stderr.write(`[Backend] ${data}`));

    serverProcess.on('exit', (code) => {
        if (code === 42) {
            console.log('\n[Launcher] 收到重启信号(42)，正在准备重新孵化进城...');
            isRestarting = true;
            if (webProcess) {
                killProcessTree(webProcess);
                webProcess = null;
            }
            // 等待端口释放后重新启动
            setTimeout(startServices, 1500);
        } else if (!isRestarting) {
            console.log(`\n[Launcher] Backend exited with code ${code}`);
            process.exit(code || 0);
        }
    });

    serverProcess.on('error', (err) => {
        console.error(`[Launcher] Failed to start Backend: ${err.message}`);
    });

    console.log('[Launcher] Starting Web UI...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const isWindows = process.platform === 'win32';
    webProcess = spawn(npmCmd, ['run', 'dev'], {
        cwd: webDir,
        stdio: 'pipe',
        env: {
            ...process.env,
            PORT: String(webPort),
            API_PORT: String(apiPort),
            NODE_OPTIONS: '--no-deprecation'
        },
        shell: true,
        detached: !isWindows // Linux/macOS: 创建独立进程组，以便 kill(-PGID) 能命中整棵树
    });

    webProcess.stdout.on('data', (data) => {
        process.stdout.write(`[Frontend] ${data}`);
    });

    webProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('vite') && msg.includes('not found')) {
            console.error('\n[Launcher] [ERROR] Frontend dependencies missing! Please run: npm install in src/web\n');
        }
        if (msg.includes('DeprecationWarning') || msg.includes('ws proxy socket error') || msg.includes('ECONNABORTED')) {
            return;
        }
        process.stderr.write(`[Frontend] ${data}`);
    });

    webProcess.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error(`[Launcher] [ERROR] Could not find "${npmCmd}". Is Node.js installed?`);
        } else {
            console.error(`[Launcher] [ERROR] Failed to start Frontend: ${err.message}`);
        }
    });
}

const cleanup = () => {
    if (isRestarting) return;
    console.log('\n[Launcher] Shutting down services...');
    if (serverProcess) killProcessTree(serverProcess);
    if (webProcess) killProcessTree(webProcess);
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
    if (!isRestarting) {
        if (serverProcess) killProcessTree(serverProcess);
        if (webProcess) killProcessTree(webProcess);
    }
});

// 启动初始服务
startServices();
