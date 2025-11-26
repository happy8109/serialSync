const AppController = require('../src/core/interface/AppController');
const EventEmitter = require('events');

// --- 1. 模拟串口类 ---
class LoopbackPort extends EventEmitter {
    constructor(options) {
        super();
        this.path = options.path;
        this.otherPort = null;
        this.isOpen = false;

        // 模拟异步打开
        setTimeout(() => {
            this.isOpen = true;
            this.emit('open');
            if (options.openCallback) options.openCallback(null);
        }, 10);
    }

    open(cb) {
        // SerialBridge 会调用这个，但我们在构造函数里已经模拟了
        if (cb) cb(null);
    }

    write(data) {
        if (!this.isOpen) return false;

        // 模拟传输延迟
        setTimeout(() => {
            if (this.otherPort && this.otherPort.isOpen) {
                this.otherPort.emit('data', data);
            }
        }, 10);

        // 模拟 drain
        setImmediate(() => {
            this.emit('drain');
        });
        return true;
    }

    close(cb) {
        this.isOpen = false;
        this.emit('close');
        if (cb) cb();
    }
}

// 简单的工厂模式，用于让 SerialBridge 实例化
const ports = new Map();

class MockSerialPort extends LoopbackPort {
    constructor(options) {
        super(options);
        ports.set(options.path, this);

        // 尝试自动配对
        if (options.path === 'COM_A' && ports.has('COM_B')) {
            this.link(ports.get('COM_B'));
        } else if (options.path === 'COM_B' && ports.has('COM_A')) {
            this.link(ports.get('COM_A'));
        }
    }

    link(other) {
        this.otherPort = other;
        other.otherPort = this;
        console.log(`[Mock] Linked ${this.path} <-> ${other.path}`);
    }
}

// --- 2. 测试脚本 ---

async function runTest() {
    console.log('=== SerialSync v2.0 Integration Test (Simulated) ===\n');

    // 创建两个控制器
    const appA = new AppController({ bridgeOptions: { SerialPortClass: MockSerialPort } });
    const appB = new AppController({ bridgeOptions: { SerialPortClass: MockSerialPort } });

    // 监听日志
    setupLogging('A', appA);
    setupLogging('B', appB);

    // 启动连接
    console.log('1. Connecting...');
    await appA.connect('COM_A');
    await appB.connect('COM_B');

    // 等待连接建立
    await new Promise(r => setTimeout(r, 100));

    // 测试 1: 聊天
    console.log('\n2. Testing Chat...');
    appA.sendChat('Hello from A!');
    await new Promise(r => setTimeout(r, 100));
    appB.sendChat('Hi A, this is B!');
    await new Promise(r => setTimeout(r, 100));

    // 测试 2: Ping
    console.log('\n3. Testing Ping...');
    appA.sendPing();
    await new Promise(r => setTimeout(r, 200));

    // 测试 3: 文件传输 (模拟)
    console.log('\n4. Testing File Transfer (Simulated)...');
    // 注意：这里使用的是 simulateFileTransfer，它只发包，不走完整的握手流程
    // 如果要测试完整流程，需要真实文件。这里先用模拟发包测试调度器。
    appA.simulateFileTransfer(10); // 发送 10 个包

    await new Promise(r => setTimeout(r, 1000));

    console.log('\n=== Test Finished ===');
    process.exit(0);
}

function setupLogging(name, app) {
    app.on('status', s => console.log(`[${name}] Status: ${s.connected ? 'Connected' : 'Disconnected'}`));
    app.on('chat', msg => console.log(`[${name}] Recv Chat: ${msg.text}`));
    app.on('pong', data => console.log(`[${name}] Recv Pong: ${data.rtt}ms`));
    // app.on('frame', f => console.log(`[${name}] Frame: ${f.type.toString(16)}`));
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
