#!/usr/bin/env node

const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, '..', 'config');
const readline = require('readline');
const SerialPort = require('serialport');
const SerialManager = require('./core/serial/SerialManager');
const config = require('config');
const { ReadlineParser } = require('@serialport/parser-readline');
const inquirer = require('inquirer');

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
        this.manager.on('disconnected', () => {
            if (!this._disconnectedPrinted) {
                const status = this.manager.getConnectionStatus();
                console.log(`🔌 串口已断开: ${status.port}`);
                this._disconnectedPrinted = true;
            }
        });
        this.manager.on('connected', () => {
            this._disconnectedPrinted = false;
            const status = this.manager.getConnectionStatus();
            console.log(`✅ 串口连接成功: ${status.port}`);
        });
        this.manager.on('error', (err) => {
            console.error('串口错误:', err.message || err);
        });
        // 自动保存文件（扩展协议）
        this.manager.on('file', (buf, meta, savePath) => {
            if (savePath) {
                const fs = require('fs');
                try {
                    fs.writeFileSync(savePath, buf);
                    console.log(`\n[自动保存] 文件已保存到: ${savePath}`);
                } catch (e) {
                    console.error(`[自动保存] 文件保存失败: ${e.message}`);
                }
                this.showPrompt(); // 修复：自动保存后恢复主提示符
            }
        });
        
        // 监听接收进度（自动接收文件时）
        let lastReceivePercent = -1;
        this.manager.on('progress', (info) => {
            if (info.type === 'receive' && info.total) {
                if (info.percent !== lastReceivePercent) {
                    process.stdout.write(`\r接收进度: ${info.percent}% (${info.seq + 1}/${info.total}) 速率: ${this.formatSpeed(info.speed)}`);
                    lastReceivePercent = info.percent;
                }
            }
        });
    }

    /**
     * 格式化速率显示
     * @param {number} bytesPerSecond - 字节/秒
     * @returns {string} 格式化后的速率字符串
     */
    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond >= 1024 * 1024) {
            return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)}MB/s`;
        } else if (bytesPerSecond >= 1024) {
            return `${(bytesPerSecond / 1024).toFixed(2)}KB/s`;
        } else {
            return `${bytesPerSecond}B/s`;
        }
    }

    formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
        
        // 监听文件请求事件，处理需确认的文件传输
        this.manager.on('fileRequest', (meta, accept, reject, options) => {
            this.handleFileRequest(meta, accept, reject, options);
        });
    }

    async handleCommand(input) {
        // 如果正在等待文件确认，则处理确认逻辑
        if (this._waitingForFileConfirm) {
            this._handleFileConfirmInput(input);
            return;
        }
        
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
                case 'sendfile':
                    await this.sendFile(args[0]);
                    break;
                case 'sendfile-confirm':
                    await this.sendFileConfirm(args[0]);
                    break;
                case 'receivefile':
                    await this.receiveFile(args[0]);
                    break;
                case 'autospeed':
                    await this.autoSpeedTest(args[0]);
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
                default:
                    if (command) console.log(`未知命令: ${command}`);
                    break;
            }
        } catch (error) {
            console.error(`错误: ${error.message}`);
        }
        this.showPrompt();
    }

    /**
     * 处理文件请求事件（需确认的文件传输）
     */
    async handleFileRequest(meta, accept, reject, options) {
        const { requireConfirm } = options || {};
        
        if (!requireConfirm) {
            // 不需要确认，自动同意（兼容旧协议）
            const path = require('path');
            const config = require('config');
            const saveDir = config.get('sync.saveDir', path.join(process.cwd(), 'received_files'));
            const fs = require('fs');
            if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
            const savePath = path.join(saveDir, meta.name || ('recv_' + Date.now()));
            accept(savePath);
            return;
        }
        
        // 需要确认，显示提示并等待用户输入
        console.log(`\n📁 收到文件传输请求:`);
        console.log(`   文件名: ${meta.name}`);
        console.log(`   大小: ${meta.size ? this.formatSize(meta.size) : '未知'}`);
        console.log(`\n是否同意接收此文件? (y/n): `);
        
        // 使用全局标志控制输入处理
        return new Promise((resolve) => {
            // 设置等待标志
            this._waitingForFileConfirm = true;
            this._fileConfirmData = { meta, accept, reject, resolve };
        });
    }

    /**
     * 处理文件确认输入
     */
    _handleFileConfirmInput(input) {
        const { meta, accept, reject, resolve } = this._fileConfirmData;
        const answer = input.trim().toLowerCase();
        
        if (answer === 'y' || answer === 'yes' || answer === '是') {
            // 用户同意，使用默认路径
            const path = require('path');
            const config = require('config');
            const saveDir = config.get('sync.saveDir', path.join(process.cwd(), 'received_files'));
            const fs = require('fs');
            if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
            const savePath = path.join(saveDir, meta.name || ('recv_' + Date.now()));
            accept(savePath);
            console.log(`\n✅ 已同意接收文件，将保存到: ${savePath}`);
            
        } else if (answer === 'n' || answer === 'no' || answer === '否') {
            // 用户拒绝
            reject('用户拒绝接收');
            console.log(`\n❌ 已拒绝接收文件`);
            
        } else {
            // 无效输入，重新询问
            console.log(`\n无效输入，请输入 y/n: `);
            return; // 继续等待输入
        }
        
        // 清理状态
        this._waitingForFileConfirm = false;
        this._fileConfirmData = null;
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
        await this.manager.disconnect();
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
     * 发送文件（分块协议，支持大文件、进度、异常处理）
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
            const stat = fs.statSync(filepath);
            const totalSize = stat.size;
            let lastPercent = -1;
            // 监听进度
            const onProgress = (info) => {
                if (info.type === 'send' && info.total) {
                    if (info.percent !== lastPercent) {
                        process.stdout.write(`\r发送进度: ${info.percent}% (${info.seq + 1}/${info.total}) 速率: ${this.formatSpeed(info.speed)} 丢块: ${info.lostBlocks} 总重试: ${info.totalRetries}`);
                        lastPercent = info.percent;
                    }
                }
            };
            this.manager.on('progress', onProgress);
            await this.manager.sendFile(filepath);
            this.manager.removeListener('progress', onProgress);
            // 只输出完成提示，不再输出任何统计或总结行
            console.log(`\n文件发送完成，总字节数: ${totalSize}`);
        } catch (e) {
            console.error('文件发送失败:', e.message);
        }
    }

    /**
     * 发送文件（需接收方确认模式）
     */
    async sendFileConfirm(filepath) {
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
            const stat = fs.statSync(filepath);
            const totalSize = stat.size;
            let lastPercent = -1;
            // 监听进度
            const onProgress = (info) => {
                if (info.type === 'send' && info.total) {
                    if (info.percent !== lastPercent) {
                        process.stdout.write(`\r发送进度: ${info.percent}% (${info.seq + 1}/${info.total}) 速率: ${this.formatSpeed(info.speed)} 丢块: ${info.lostBlocks} 总重试: ${info.totalRetries}`);
                        lastPercent = info.percent;
                    }
                }
            };
            this.manager.on('progress', onProgress);
            // 使用需确认模式发送文件
            await this.manager.sendFile(filepath, {}, { requireConfirm: true });
            this.manager.removeListener('progress', onProgress);
            console.log(`\n文件发送完成，总字节数: ${totalSize}`);
        } catch (e) {
            console.error('文件发送失败:', e.message);
        }
    }

    /**
     * 接收文件并保存（分块协议，支持进度、校验）
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
            console.log(`\n文件已保存到: ${savepath}，总字节数: ${buf.length}`);
            this.manager.removeListener('file', onFile);
        };
        this.manager.on('file', onFile);
        // 监听进度
        let lastPercent = -1;
        const onProgress = (info) => {
            if (info.type === 'receive' && info.total) {
                if (info.percent !== lastPercent) {
                    process.stdout.write(`\r接收进度: ${info.percent}% (${info.seq + 1}/${info.total}) 速率: ${this.formatSpeed(info.speed)}`);
                    lastPercent = info.percent;
                }
            }
        };
        this.manager.on('progress', onProgress);
        console.log('等待接收文件...');
    }

    showStatus() {
        const status = this.manager.getConnectionStatus();
        console.log('连接状态:', status.isConnected ? '已连接' : '未连接');
        console.log('串口:', status.port);
        if (status.lastActive) {
            const date = new Date(status.lastActive);
            console.log('最后活跃:', date.toLocaleString());
        }
        if (status.currentTask) {
            console.log('当前任务:', status.currentTask);
        }
        if (status.speed) {
            console.log('当前速率:', this.formatSpeed(status.speed));
        }
    }

    showHelp() {
        console.log(`\n可用命令:\n  list                      - 列出可用串口\n  connect [port]            - 连接串口（可指定端口）\n  disconnect                - 断开连接\n  send <data>               - 发送数据（走协议）\n  sendlarge <data>          - 分块协议发送大数据（协议分块/ACK/重传）\n  sendfile <filepath>       - 发送文件（分块协议/大文件/进度，自动同意）\n  sendfile-confirm <filepath> - 发送文件（需接收方确认）\n  receivefile <savepath>    - 接收文件并保存（分块协议/进度）\n  autospeed <filepath>      - 自动测速多种chunkSize，输出对比表\n  status                    - 显示状态\n  help                      - 显示帮助\n  quit                      - 退出程序\n        `);
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

    /**
     * 自动测速命令：循环多种chunkSize，发送同一文件，统计速率/丢块/重试
     * 用法：autospeed <filepath>
     */
    async autoSpeedTest(filepath) {
        const fs = require('fs');
        if (!filepath) {
            console.log('请输入要测速的文件路径');
            return;
        }
        if (!this.manager.isConnected) {
            console.log('请先连接串口');
            return;
        }
        const sizes = [128, 256, 512, 1024, 2048, 4096];
        const stat = fs.statSync(filepath);
        const totalSize = stat.size;
        const origChunkSize = this.manager.chunkSize;
        const path = require('path');
        for (const chunkSize of sizes) {
            this.manager.chunkSize = chunkSize;
            let lastPercent = -1;
            let lastProgress = null;
            let hadProgress = false;
            const onProgress = (info) => {
                if (info.type === 'send' && info.total) {
                    if (info.percent !== lastPercent) {
                        process.stdout.write(`\r[${chunkSize}] 进度: ${info.percent}% (${info.seq + 1}/${info.total}) 速率: ${this.formatSpeed(info.speed)} 丢块: ${info.lostBlocks} 总重试: ${info.totalRetries}`);
                        lastPercent = info.percent;
                        hadProgress = true;
                    }
                    lastProgress = info;
                }
            };
            this.manager.on('progress', onProgress);
            let error = null;
            const meta = { name: path.basename(filepath) };
            try {
                await this.manager.sendFile(filepath, meta);
            } catch (e) {
                error = e.message;
            }
            this.manager.removeListener('progress', onProgress);
            if (hadProgress) process.stdout.write('\n');
            if (error) {
                let friendly = error;
                if (/out of range/.test(error) && chunkSize === 128) {
                    friendly = '分块数过多，128字节分块不被支持';
                } else if (/块0发送失败/.test(error)) {
                    friendly = '分块过大，链路/协议不支持';
                }
                console.log(`[${chunkSize}] 发送失败: ${friendly}`);
            }
        }
        this.manager.chunkSize = origChunkSize;
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