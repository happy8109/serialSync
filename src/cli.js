#!/usr/bin/env node

const { SerialPort } = require('serialport');
const readline = require('readline');
const path = require('path');

// 设置配置文件路径
process.env.NODE_CONFIG_DIR = path.join(__dirname, '..', 'config');

const config = require('config');

// 简化logger，避免配置文件依赖
const simpleLogger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`)
};

class SerialCLI {
    constructor() {
        this.serialManager = null;
        this.isConnected = false;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async start() {
        console.log('SerialSync CLI v1.0.0 - 串口通信命令行工具');
        console.log('输入 "help" 查看可用命令');
        this.showPrompt();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.rl.on('line', (input) => {
            this.handleCommand(input.trim());
        });
    }

    async handleCommand(input) {
        const parts = input.split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        try {
            switch (command) {
                case 'list':
                    await this.listPorts();
                    break;
                case 'connect':
                    await this.connect(args[0]);
                    break;
                case 'disconnect':
                    await this.disconnect();
                    break;
                case 'send':
                    await this.sendData(args.join(' '));
                    break;
                case 'status':
                    this.showStatus();
                    break;
                case 'config':
                    this.showConfig();
                    break;
                case 'help':
                    this.showHelp();
                    break;
                case 'quit':
                    await this.quit();
                    break;
                default:
                    if (command) console.log(`未知命令: ${command}`);
                    break;
            }
        } catch (error) {
            console.error(`错误: ${error.message}`);
        }
        this.showPrompt();
    }

    async listPorts() {
        console.log('扫描可用串口...');
        try {
            const ports = await SerialPort.list();
            if (ports.length === 0) {
                console.log('未发现可用串口');
                return;
            }
            console.log(`发现 ${ports.length} 个串口:`);
            ports.forEach(port => {
                console.log(`  ${port.path} - ${port.manufacturer || '未知设备'}`);
            });
        } catch (error) {
            console.error(`扫描失败: ${error.message}`);
        }
    }

    async connect(portPath) {
        if (!portPath) {
            console.log('请指定串口路径，例如: connect COM3');
            return;
        }

        console.log(`连接串口: ${portPath}`);
        try {
            this.serialManager = new SerialPort({
                path: portPath,
                baudRate: config.get('serial.baudRate'),
                dataBits: config.get('serial.dataBits'),
                stopBits: config.get('serial.stopBits'),
                parity: config.get('serial.parity')
            });

            await new Promise((resolve, reject) => {
                this.serialManager.on('open', () => {
                    this.isConnected = true;
                    console.log(`连接成功: ${portPath}`);
                    
                    this.serialManager.on('data', (data) => {
                        console.log(`接收: ${data.toString()}`);
                    });

                    resolve();
                });

                this.serialManager.on('error', reject);
            });
        } catch (error) {
            console.error(`连接失败: ${error.message}`);
            this.serialManager = null;
        }
    }

    async disconnect() {
        if (!this.isConnected) {
            console.log('当前未连接');
            return;
        }

        this.serialManager.close();
        this.isConnected = false;
        this.serialManager = null;
        console.log('已断开连接');
    }

    async sendData(data) {
        if (!this.isConnected) {
            console.log('请先连接串口');
            return;
        }

        if (!data) {
            console.log('请输入要发送的数据');
            return;
        }

        this.serialManager.write(data);
        console.log(`发送: ${data}`);
    }

    showStatus() {
        console.log(`连接状态: ${this.isConnected ? '已连接' : '未连接'}`);
        if (this.isConnected) {
            console.log(`串口: ${this.serialManager.path}`);
        }
    }

    showConfig() {
        console.log('当前配置:');
        console.log(`  默认串口: ${config.get('serial.port')}`);
        console.log(`  波特率: ${config.get('serial.baudRate')}`);
        console.log(`  数据位: ${config.get('serial.dataBits')}`);
        console.log(`  停止位: ${config.get('serial.stopBits')}`);
        console.log(`  校验位: ${config.get('serial.parity')}`);
    }

    showHelp() {
        console.log(`
可用命令:
  list                    - 列出可用串口
  connect <port>          - 连接串口
  disconnect              - 断开连接
  send <data>             - 发送数据
  status                  - 显示状态
  config                  - 显示配置
  help                    - 显示帮助
  quit                    - 退出程序
        `);
    }

    async quit() {
        if (this.isConnected) {
            await this.disconnect();
        }
        this.rl.close();
        process.exit(0);
    }

    showPrompt() {
        const status = this.isConnected ? '✅' : '❌';
        process.stdout.write(`\n${status} serial-sync> `);
    }
}

async function main() {
    const cli = new SerialCLI();
    await cli.start();
}

process.on('SIGINT', () => {
    console.log('\n正在退出...');
    process.exit(0);
});

main(); 