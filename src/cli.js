#!/usr/bin/env node

const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, '..', 'config');
const readline = require('readline');
const { SerialPort } = require('serialport');
const SerialManager = require('./core/serial/SerialManager');
const config = require('config');
const { ReadlineParser } = require('@serialport/parser-readline');

class SerialCLI {
    constructor() {
        this.manager = new SerialManager();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.manager.on('data', (data) => {
            console.log(`接收: ${data.toString('utf8')}`);
        });
        this.manager.on('connected', () => {
            console.log('✅ 串口连接成功');
        });
        this.manager.on('disconnected', () => {
            console.log('🔌 串口已断开');
        });
        this.manager.on('error', (err) => {
            console.error('串口错误:', err.message || err);
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
                case 'sendlarge':
                    await this.sendLargeData(args.join(' '));
                    break;
                case 'rawsend':
                    await this.rawSendData(args.join(' '));
                    break;
                case 'status':
                    this.showStatus();
                    break;
                case 'help':
                    this.showHelp();
                    break;
                case 'quit':
                    await this.quit();
                    break;
                case 'sendfile':
                    await this.sendFile(args[0]);
                    break;
                case 'receivefile':
                    await this.receiveFile(args[0]);
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

    async connect(port) {
        try {
            await this.manager.connect(port);
            // 监听原始串口数据（调试用，已注释，避免影响协议解包）
            // if (this.manager.port) {
            //     this.manager.port.on('data', (buf) => {
            //         console.log(`[原始接收] ${buf.toString()}`);
            //     });
            //     const parser = this.manager.port.pipe(new ReadlineParser({ delimiter: '\n' }));
            //     parser.on('data', (line) => {
            //         console.log(`[分包接收] ${line}`);
            //     });
            // }
        } catch (e) {
            console.error('连接失败:', e.message);
        }
    }

    async disconnect() {
        this.manager.disconnect();
    }

    async sendData(data) {
        if (!data) {
            console.log('请输入要发送的数据');
            return;
        }
        try {
            await this.manager.sendData(data);
            console.log('发送成功');
        } catch (e) {
            console.error('发送失败:', e.message);
        }
    }

    async rawSendData(data) {
        if (!this.manager.isConnected || !this.manager.port) {
            console.log('请先连接串口');
            return;
        }
        if (!data) {
            console.log('请输入要发送的数据');
            return;
        }
        this.manager.port.write(data, (err) => {
            if (err) {
                console.error('原始数据发送失败:', err.message);
            } else {
                console.log('原始数据发送成功');
            }
        });
    }

    async sendLargeData(data) {
        if (!data) {
            console.log('请输入要发送的大数据内容');
            return;
        }
        try {
            await this.manager.sendLargeData(data);
            console.log('分块协议数据发送成功');
        } catch (e) {
            console.error('分块协议数据发送失败:', e.message);
        }
    }

    /**
     * 发送文件（分块协议）
     */
    async sendFile(filepath) {
        const fs = require('fs');
        if (!filepath) {
            console.log('请输入要发送的文件路径');
            return;
        }
        if (!this.manager.isConnected) {
            console.log('请先连接串口');
            return;
        }
        try {
            const data = fs.readFileSync(filepath);
            let lastProgress = -1;
            // 监听进度
            const onProgress = (info) => {
                if (info.type === 'send' && info.total) {
                    const percent = Math.floor((info.seq + 1) / info.total * 100);
                    if (percent !== lastProgress) {
                        process.stdout.write(`\r发送进度: ${percent}%`);
                        lastProgress = percent;
                    }
                }
            };
            this.manager.on('progress', onProgress);
            await this.manager.sendLargeData(data);
            this.manager.removeListener('progress', onProgress);
            console.log('\n文件发送完成');
        } catch (e) {
            console.error('文件发送失败:', e.message);
        }
    }

    /**
     * 接收文件并保存
     */
    async receiveFile(savepath) {
        const fs = require('fs');
        if (!savepath) {
            console.log('请输入要保存的文件路径');
            return;
        }
        if (!this.manager.isConnected) {
            console.log('请先连接串口');
            return;
        }
        // 只监听一次 file 事件
        const onFile = (buf) => {
            fs.writeFileSync(savepath, buf);
            console.log(`文件已保存到: ${savepath}`);
            this.manager.removeListener('file', onFile);
        };
        this.manager.on('file', onFile);
        // 监听进度
        const onProgress = (info) => {
            if (info.type === 'receive' && info.total) {
                const percent = Math.floor((info.seq + 1) / info.total * 100);
                process.stdout.write(`\r接收进度: ${percent}%`);
            }
        };
        this.manager.on('progress', onProgress);
        console.log('等待接收文件...');
    }

    showStatus() {
        const status = this.manager.getConnectionStatus();
        console.log('连接状态:', status.isConnected ? '已连接' : '未连接');
        console.log('串口:', status.port);
        console.log('重连次数:', status.reconnectAttempts, '/', status.maxReconnectAttempts);
    }

    showHelp() {
        console.log(`\n可用命令:\n  list                      - 列出可用串口\n  connect [port]            - 连接串口（可指定端口）\n  disconnect                - 断开连接\n  send <data>               - 发送数据（走协议）\n  sendlarge <data>          - 分块协议发送大数据（协议分块/ACK/重传）\n  sendfile <filepath>       - 发送文件（分块协议/大文件/进度）\n  receivefile <savepath>    - 接收文件并保存（分块协议/进度）\n  rawsend <data>            - 发送原始数据（无协议/无压缩）\n  status                    - 显示状态\n  help                      - 显示帮助\n  quit                      - 退出程序\n        `);
    }

    async quit() {
        this.manager.disconnect();
        this.rl.close();
        process.exit(0);
    }

    showPrompt() {
        const status = this.manager.isConnected ? '✅' : '❌';
        process.stdout.write(`\n${status} serial-sync> `);
    }
}

async function main() {
    const cli = new SerialCLI();
    // 解析命令行参数
    const portArg = process.argv[2];
    await cli.start();
    // 自动连接串口
    try {
        const portToConnect = portArg || config.get('serial.port');
        if (portToConnect) {
            await cli.connect(portToConnect);
        } else {
            console.log('未检测到串口端口参数，也未在配置文件中找到默认端口。');
        }
    } catch (e) {
        console.error('自动连接串口失败:', e.message);
    }
}

process.on('SIGINT', () => {
    console.log('\n正在退出...');
    process.exit(0);
});

main(); 