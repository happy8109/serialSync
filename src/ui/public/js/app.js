// SerialSync 前端应用
class SerialSyncApp {
    constructor() {
        this.apiBase = '/api';
        this.isConnected = false;
        this.connectionStatus = null;
        this.ports = [];
        this.logEntries = [];
        this.maxLogEntries = 100;
        this.ws = null; // WebSocket连接
        
        this.init();
    }

    /**
     * 初始化应用
     */
    async init() {
        this.bindEvents();
        await this.loadPorts();
        await this.loadConfig(); // 新增，确保参数同步
        await this.updateStatus();
        this.startStatusPolling();
        this.initWebSocket(); // 初始化WebSocket连接
        this.addLogEntry('应用已启动', 'info');
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 连接按钮
        document.getElementById('connectBtn').addEventListener('click', () => {
            this.connect();
        });

        // 断开按钮
        document.getElementById('disconnectBtn').addEventListener('click', () => {
            this.disconnect();
        });

        // 刷新串口按钮
        document.getElementById('refreshPortsBtn').addEventListener('click', () => {
            this.loadPorts();
        });

        // 串口选择变化
        document.getElementById('portSelect').addEventListener('change', () => {
            this.updateConfig();
        });

        // 配置变化
        ['baudRate', 'dataBits', 'stopBits', 'parity'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                this.updateConfig();
            });
        });

        // 聊天窗口相关逻辑
        const chatMessages = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendChatBtn = document.getElementById('sendChatBtn');
        const fileSendBtn = document.getElementById('fileSendBtn');

        // 发送消息
        sendChatBtn.addEventListener('click', async () => {
            const text = chatInput.value.trim();
            if (!text) return;
            this.appendChatMessage(text, 'sent');
            chatInput.value = '';
            chatInput.focus();
            // 发送到后端
            try {
                await this.apiCall('POST', '/send', { data: text });
            } catch (err) {
                this.appendChatMessage('发送失败: ' + err.message, 'system');
            }
        });

        // 回车发送
        chatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                sendChatBtn.click();
                e.preventDefault();
            }
        });

        // 预留文件发送
        fileSendBtn.addEventListener('click', () => {
            alert('文件发送功能开发中...');
        });


    }

    /**
     * 加载可用串口列表
     */
    async loadPorts() {
        try {
            this.showLoading(true);
            console.log('[SerialSync] 请求串口列表...');
            const response = await this.apiCall('GET', '/ports');
            console.log('[SerialSync] 串口列表接口返回:', response);
            
            if (response.success) {
                this.ports = response.data;
                this.updatePortSelect();
                this.addLogEntry(`发现 ${this.ports.length} 个串口`, 'info');
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            this.addLogEntry(`加载串口列表失败: ${error.message}`, 'error');
            this.showNotification('加载串口列表失败', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 更新串口选择下拉框
     */
    updatePortSelect() {
        const select = document.getElementById('portSelect');
        const currentValue = select.value;
        
        // 清空现有选项
        select.innerHTML = '<option value="">选择串口...</option>';
        
        // 添加串口选项
        console.log('[SerialSync] 渲染串口下拉框:', this.ports);
        this.ports.forEach(port => {
            const option = document.createElement('option');
            option.value = port.path;
            option.textContent = `${port.path} - ${port.manufacturer || '未知设备'}`;
            select.appendChild(option);
        });
        
        // 恢复之前的选择
        if (currentValue) {
            select.value = currentValue;
        }
    }

    /**
     * 连接串口
     */
    async connect() {
        try {
            this.showLoading(true);
            const port = document.getElementById('portSelect').value;
            if (!port) {
                this.showNotification('请选择串口', 'warn');
                return;
            }
            const response = await this.apiCall('POST', '/connect', { port });
            
            if (response.success) {
                this.isConnected = true;
                this.updateConnectionUI();
                this.addLogEntry('串口连接成功', 'success');
                this.showNotification('串口连接成功', 'success');
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            this.addLogEntry(`连接失败: ${error.message}`, 'error');
            this.showNotification(`连接失败: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 断开连接
     */
    async disconnect() {
        try {
            this.showLoading(true);
            const response = await this.apiCall('POST', '/disconnect');
            
            if (response.success) {
                this.isConnected = false;
                this.updateConnectionUI();
                this.addLogEntry('串口已断开', 'info');
                this.showNotification('串口已断开', 'info');
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            this.addLogEntry(`断开连接失败: ${error.message}`, 'error');
            this.showNotification(`断开连接失败: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 发送数据
     */
    async sendData() {
        const data = document.getElementById('sendData').value.trim();
        
        if (!data) {
            this.showNotification('请输入要发送的数据', 'warn');
            return;
        }

        if (!this.isConnected) {
            this.showNotification('请先连接串口', 'warn');
            return;
        }

        try {
            this.showLoading(true);
            const response = await this.apiCall('POST', '/send', { data });
            
            if (response.success) {
                this.addLogEntry(`数据发送成功: ${data.length} 字节`, 'success');
                this.showNotification('数据发送成功', 'success');
                document.getElementById('sendData').value = '';
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            this.addLogEntry(`发送数据失败: ${error.message}`, 'error');
            this.showNotification(`发送数据失败: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 更新连接状态UI
     */
    updateConnectionUI() {
        const statusElement = document.getElementById('connectionStatus');
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');
        const sendChatBtn = document.getElementById('sendChatBtn'); // 聊天发送按钮

        if (this.isConnected) {
            statusElement.innerHTML = '<i class="fas fa-circle status-connected"></i> 已连接';
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.disabled = false;
            if (sendChatBtn) sendChatBtn.disabled = false;
        } else {
            statusElement.innerHTML = '<i class="fas fa-circle status-disconnected"></i> 未连接';
            if (connectBtn) connectBtn.disabled = false;
            if (disconnectBtn) disconnectBtn.disabled = true;
            if (sendChatBtn) sendChatBtn.disabled = true;
        }
    }

    /**
     * 更新状态信息
     */
    async updateStatus() {
        try {
            const response = await this.apiCall('GET', '/status');
            
            if (response.success) {
                this.connectionStatus = response.data;
                this.isConnected = response.data.isConnected;
                
                // 更新UI
                document.getElementById('portInfo').textContent = response.data.port || '-';
                document.getElementById('speedInfo').textContent =
                    (response.data.speed ? response.data.speed + ' B/s' : '-');
                document.getElementById('taskInfo').textContent =
                    response.data.currentTask || '-';
                this.updateConnectionUI();
            }
        } catch (error) {
            console.error('更新状态失败:', error);
        }
    }

    /**
     * 开始状态轮询
     */
    startStatusPolling() {
        setInterval(() => {
            this.updateStatus();
        }, 2000);
    }

    /**
     * 初始化WebSocket连接
     */
    initWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('[SerialSync] WebSocket连接已建立');
                this.addLogEntry('WebSocket连接已建立', 'info');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('[SerialSync] WebSocket消息解析失败:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('[SerialSync] WebSocket连接已关闭');
                this.addLogEntry('WebSocket连接已关闭', 'warn');
                // 尝试重连
                setTimeout(() => {
                    this.initWebSocket();
                }, 3000);
            };
            
            this.ws.onerror = (error) => {
                console.error('[SerialSync] WebSocket错误:', error);
                this.addLogEntry('WebSocket连接错误', 'error');
            };
        } catch (error) {
            console.error('[SerialSync] WebSocket初始化失败:', error);
            this.addLogEntry('WebSocket初始化失败', 'error');
        }
    }

    /**
     * 处理WebSocket消息
     */
    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'message':
                if (message.direction === 'received') {
                    this.appendChatMessage(message.data, 'received');
                    this.addLogEntry(`收到消息: ${message.data}`, 'info');
                }
                break;
            case 'connection':
                if (message.status === 'connected') {
                    this.isConnected = true;
                    this.updateConnectionUI();
                    this.addLogEntry(`串口已连接: ${message.port}`, 'success');
                } else if (message.status === 'disconnected') {
                    this.isConnected = false;
                    this.updateConnectionUI();
                    this.addLogEntry('串口已断开', 'warn');
                }
                break;
            case 'error':
                this.addLogEntry(`串口错误: ${message.message}`, 'error');
                break;
            default:
                console.log('[SerialSync] 未知WebSocket消息类型:', message.type);
        }
    }

    /**
     * 添加聊天消息到界面
     */
    appendChatMessage(text, type) {
        const chatMessages = document.getElementById('chatMessages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message ' + (type || 'sent');
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.textContent = text;
        msgDiv.appendChild(bubble);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * 更新配置
     */
    async updateConfig() {
        const config = {
            serial: {
                port: document.getElementById('portSelect').value,
                baudRate: parseInt(document.getElementById('baudRate').value),
                dataBits: parseInt(document.getElementById('dataBits').value),
                stopBits: parseInt(document.getElementById('stopBits').value),
                parity: document.getElementById('parity').value
            }
        };

        try {
            const response = await this.apiCall('PUT', '/config', config);
            
            if (response.success) {
                this.addLogEntry('配置已更新', 'info');
                await this.updateStatus(); // 新增，参数变更后刷新状态
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            this.addLogEntry(`更新配置失败: ${error.message}`, 'error');
        }
    }

    /**
     * 加载后端串口参数并填充到表单
     */
    async loadConfig() {
        try {
            const response = await this.apiCall('GET', '/config');
            if (response.success && response.data) {
                const cfg = response.data;
                if (cfg.port) document.getElementById('portSelect').value = cfg.port;
                if (cfg.baudRate) document.getElementById('baudRate').value = cfg.baudRate;
                if (cfg.dataBits) document.getElementById('dataBits').value = cfg.dataBits;
                if (cfg.stopBits) document.getElementById('stopBits').value = cfg.stopBits;
                if (cfg.parity) document.getElementById('parity').value = cfg.parity;
            }
        } catch (e) {
            this.addLogEntry('加载串口参数失败: ' + e.message, 'error');
        }
    }

    /**
     * 保存接收到的数据
     */
    saveReceivedData() {
        const data = document.getElementById('receiveData').value;
        
        if (!data) {
            this.showNotification('没有数据可保存', 'warn');
            return;
        }

        const blob = new Blob([data], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `serial_data_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.addLogEntry('数据已保存到文件', 'success');
        this.showNotification('数据已保存', 'success');
    }

    /**
     * 添加日志条目
     */
    addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = {
            timestamp,
            message,
            type
        };

        this.logEntries.push(entry);
        
        // 限制日志条目数量
        if (this.logEntries.length > this.maxLogEntries) {
            this.logEntries.shift();
        }

        this.updateLogDisplay();
    }

    /**
     * 更新日志显示
     */
    updateLogDisplay() {
        const logContent = document.getElementById('logContent');
        logContent.innerHTML = this.logEntries
            .map(entry => `<div class="log-entry ${entry.type}">[${entry.timestamp}] ${entry.message}</div>`)
            .join('');
        
        // 滚动到底部
        logContent.scrollTop = logContent.scrollHeight;
    }

    /**
     * 清空日志
     */
    clearLog() {
        this.logEntries = [];
        this.updateLogDisplay();
        this.addLogEntry('日志已清空', 'info');
    }

    /**
     * 导出日志
     */
    exportLog() {
        const logText = this.logEntries
            .map(entry => `[${entry.timestamp}] ${entry.message}`)
            .join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `serial_sync_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.addLogEntry('日志已导出', 'success');
        this.showNotification('日志已导出', 'success');
    }

    /**
     * 通用 API 调用方法
     */
    async apiCall(method, path, data) {
        const url = this.apiBase + path;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (data && method !== 'GET') {
            options.body = JSON.stringify(data);
        }
        const resp = await fetch(url, options);
        return await resp.json();
    }

    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
    }

    /**
     * 显示通知
     */
    showNotification(message, type = 'info', duration = 3000) {
        const area = document.getElementById('notificationArea');
        if (!area) return;
        const div = document.createElement('div');
        div.className = `notification ${type}`;
        div.textContent = message;
        area.appendChild(div);
        setTimeout(() => {
            area.removeChild(div);
        }, duration);
    }
}

// 启动应用，确保在 DOMContentLoaded 后实例化
window.addEventListener('DOMContentLoaded', () => {
    console.log('[SerialSync] DOMContentLoaded, initializing app...');
    window.serialSyncApp = new SerialSyncApp();
});