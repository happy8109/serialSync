import React, { useState, useEffect } from 'react';
import { Settings, X, Wifi, Save, Power, Zap, Activity } from 'lucide-react';
import useAppStore from '../../store/appStore';

const SettingsModal = ({ isOpen, onClose }) => {
    const { port: currentPort, isConnected } = useAppStore();
    const [ports, setPorts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [baudRateOptions, setBaudRateOptions] = useState([9600, 19200, 38400, 57600, 115200, 128000, 230400, 460800, 576000, 921600]);

    const [serialConfig, setSerialConfig] = useState({
        path: currentPort || '',
        baudRate: '115200',
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoReconnect: true,
        reconnectInterval: 3000,
        maxReconnectAttempts: 0
    });

    const [transferConfig, setTransferConfig] = useState({
        chunkSize: 1024,
        windowSize: 50,
        savePath: './received'
    });

    useEffect(() => {
        if (isOpen) {
            fetchPorts();
            fetchCurrentStatus();
        }
    }, [isOpen]);

    const fetchPorts = async () => {
        try {
            const res = await fetch('/api/ports');
            const data = await res.json();
            setPorts(data || []);
        } catch (err) {
            console.error('Failed to fetch ports:', err);
        }
    };

    const fetchCurrentStatus = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            // 优先使用后端返回的完整配置 (Canonical Source)
            const cfg = data.config || {};

            // 1. Serial Config
            // 混合 data.port (当前连接) 和 cfg.serial (配置值)
            // 如果连接了，优先显示连接端口；没连接，显示配置端口。
            // 但设置界面通常应该显示“配置值”。Data.port 是 status。
            // 让我们使用配置值作为默认填充，但如果未配置，可能回退到 data.port
            const serialVals = cfg.serial || data.serialConfig || {};
            setSerialConfig(prev => ({
                ...prev,
                path: serialVals.port || serialVals.path || '',
                baudRate: (serialVals.baudRate || 115200).toString(),
                dataBits: serialVals.dataBits || 8,
                stopBits: serialVals.stopBits || 1,
                parity: serialVals.parity || 'none',
                autoReconnect: serialVals.autoReconnect !== undefined ? serialVals.autoReconnect : true,
                reconnectInterval: serialVals.reconnectInterval || 3000,
                maxReconnectAttempts: serialVals.maxReconnectAttempts || 0 // 0 means infinite
            }));

            // 读取可配置的波特率选项
            if (serialVals.baudRateOptions && Array.isArray(serialVals.baudRateOptions)) {
                setBaudRateOptions(serialVals.baudRateOptions);
            }

            // 2. Transfer Config
            const transferVals = cfg.transfer || data.transferConfig || {};
            setTransferConfig(prev => ({
                ...prev,
                chunkSize: transferVals.chunkSize || 1024,
                windowSize: transferVals.windowSize || 50,
                savePath: transferVals.savePath || './received',
                conflictStrategy: transferVals.conflictStrategy || 'rename'
            }));

            // 3. System Config
            const servicesVals = cfg.services || {};
            const loggingVals = cfg.logging || {};
            const serialForSystem = cfg.serial || {}; // Heartbeat is in serial
            const serverVals = cfg.server || {};
            const webVals = cfg.web || {};

            setSystemConfig(prev => ({
                ...prev,
                serviceDiscovery: servicesVals.autoRegister !== undefined ? servicesVals.autoRegister : true,
                logLevel: loggingVals.level || 'info',
                heartbeatInterval: serialForSystem.heartbeatInterval || 5000,
                heartbeatTimeout: serialForSystem.heartbeatTimeout || 15000,
                apiPort: serverVals.port || 3000,
                webPort: webVals.port || 5173
            }));
            
            setOriginalPorts({
                apiPort: serverVals.port || 3000,
                webPort: webVals.port || 5173
            });

        } catch (err) {
            console.error('Failed to fetch status:', err);
        } finally {
            setLoading(false);
        }
    };

    const [activeTab, setActiveTab] = useState('connection'); // 'connection' | 'transfer' | 'system'

    const [systemConfig, setSystemConfig] = useState({
        heartbeatInterval: 5000,
        heartbeatTimeout: 15000,
        serviceDiscovery: true,
        logLevel: 'info',
        apiPort: 3000,
        webPort: 5173
    });
    const [originalPorts, setOriginalPorts] = useState({ apiPort: 3000, webPort: 5173 });

    // Add conflictStrategy to transferConfig state initialization if not already there, 
    // but here we just ensure it's handled in the UI. 
    // Assuming transferConfig state is already defined above, we update it via setTransferConfig in UI.

    if (!isOpen) return null;

    // ... (keep fetch logic, update fetchCurrentStatus to read system config)
    // Note: Since system config logic is not fully exposed in /api/status yet for system params, 
    // we might need to rely on defaults or what fetchCurrentStatus returns. 
    // For now we will assume fetchCurrentStatus needs to be updated or we use defaults for system props if missing.

    const handleRestoreDefaults = async () => {
        if (!confirm('确定要恢复默认设置吗？这将覆盖当前的所有配置。')) return;

        const defaults = {
            serial: {
                port: "COM3",
                baudRate: 115200,
                // ... (other serial defaults)
                dataBits: 8, stopBits: 1, parity: "none", rtscts: true, autoReconnect: true, reconnectInterval: 3000, maxReconnectAttempts: 0
            },
            transfer: {
                chunkSize: 1024,
                windowSize: 50,
                timeout: 5000,
                savePath: "./received",
                conflictStrategy: "rename"
            },
            system: {
                heartbeatInterval: 5000,
                heartbeatTimeout: 15000,
                serviceDiscovery: true,
                logLevel: "info"
            }
        };

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(defaults)
            });
            if (res.ok) {
                alert('已恢复默认设置，请重启应用生效。');
                onClose();
            }
        } catch (err) {
            alert('重置失败: ' + err.message);
        }
    };

    const handleSave = async () => {
        try {
            const configToSave = {
                serial: {
                    port: serialConfig.path,
                    baudRate: parseInt(serialConfig.baudRate),
                    dataBits: parseInt(serialConfig.dataBits),
                    stopBits: parseInt(serialConfig.stopBits),
                    parity: serialConfig.parity,
                    autoReconnect: serialConfig.autoReconnect,
                    reconnectInterval: parseInt(serialConfig.reconnectInterval),
                    maxReconnectAttempts: parseInt(serialConfig.maxReconnectAttempts),
                    // Heartbeat settings are currently tied to system or serial depending on implementation
                    // If backend supports them in serial config:
                    heartbeatInterval: parseInt(systemConfig.heartbeatInterval),
                    heartbeatTimeout: parseInt(systemConfig.heartbeatTimeout)
                },
                transfer: transferConfig, // Includes conflictStrategy
                system: {
                    serviceDiscovery: systemConfig.serviceDiscovery,
                    logLevel: systemConfig.logLevel,
                    apiPort: parseInt(systemConfig.apiPort),
                    webPort: parseInt(systemConfig.webPort)
                }
            };

            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configToSave)
            });
            if (res.ok) {
                const portsChanged = parseInt(systemConfig.apiPort) !== originalPorts.apiPort || parseInt(systemConfig.webPort) !== originalPorts.webPort;
                if (portsChanged) {
                    if (confirm('检测到您修改了系统服务端口配置（该级别设置需重启后台进程方可生效）。\n\n是否立即执行后台系统热重启？')) {
                        try {
                            await fetch('/api/system/restart', { method: 'POST' });
                        } catch(e) {}
                        alert(`安全重启指令已发送！\n后台调度器正在重新孵化网络进程，请耐心等待数秒。\n\n⚠️ 如果您修改了 Web UI 端口，请稍后手动在浏览器地址栏输入新的端口：\nhttp://${window.location.hostname}:${systemConfig.webPort}`);
                    }
                }
                onClose();
            } else {
                alert('保存配置失败');
            }
        } catch (err) {
            alert('保存失败: ' + err.message);
        }
    };

    const handleConnect = async () => {
        try {
            await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: serialConfig.path,
                    baudRate: parseInt(serialConfig.baudRate),
                    dataBits: parseInt(serialConfig.dataBits),
                    stopBits: parseInt(serialConfig.stopBits),
                    parity: serialConfig.parity,
                    autoReconnect: serialConfig.autoReconnect, // Use UI state
                    reconnectInterval: parseInt(serialConfig.reconnectInterval),
                    maxReconnectAttempts: parseInt(serialConfig.maxReconnectAttempts)
                })
            });
        } catch (err) {
            alert('连接失败: ' + err.message);
        }
    };

    const handleDisconnect = async () => {
        try {
            await fetch('/api/disconnect', { method: 'POST' });
        } catch (err) {
            alert('断开失败: ' + err.message);
        }
    };

    const handleForceRestart = async () => {
        if (confirm('警告：执行强制重启将断开所有当前正在进行的任务和网络连接。\n\n您确定要立刻重启系统的底层运行栈吗？')) {
            try {
                await fetch('/api/system/restart', { method: 'POST' });
                alert('重启指令已向调度器发送！\n后台进程正在销毁并重新孵化，请稍后刷新界面。');
                onClose();
            } catch (err) {
                alert('发送重启指令失败: ' + err.message);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card w-[600px] rounded-lg shadow-lg border border-border flex flex-col animate-in fade-in zoom-in duration-200 max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Settings size={20} />
                        系统设置
                    </h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border px-4">
                    <button
                        onClick={() => setActiveTab('connection')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'connection'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        串口连接
                    </button>
                    <button
                        onClick={() => setActiveTab('transfer')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'transfer'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        传输设置
                    </button>
                    <button
                        onClick={() => setActiveTab('system')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'system' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        系统选项
                    </button>
                </div>

                {/* Content - Fixed Height to prevent jumping */}
                <div className="p-6 h-[520px] overflow-y-auto">
                    {activeTab === 'connection' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-left-2 duration-200">
                            {/* Serial Port Config */}
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2 col-span-2">
                                        <label className="text-sm font-medium">串口端口 (Port)</label>
                                        <div className="flex gap-2">
                                            <select
                                                value={serialConfig.path}
                                                onChange={(e) => setSerialConfig({ ...serialConfig, path: e.target.value })}
                                                className="flex-1 px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                            >
                                                <option value="">未选择端口</option>
                                                {ports.map((p) => (
                                                    <option key={p.path} value={p.path}>
                                                        {p.path} {p.friendlyName ? `- ${p.friendlyName}` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={fetchPorts}
                                                className="px-3 py-2 bg-muted hover:bg-muted/80 rounded-md text-sm border border-border"
                                                title="刷新端口列表"
                                            >
                                                刷新
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">波特率 (Baud Rate)</label>
                                        <select
                                            value={serialConfig.baudRate}
                                            onChange={(e) => setSerialConfig({ ...serialConfig, baudRate: e.target.value })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                        >
                                            {baudRateOptions.map((rate) => (
                                                <option key={rate} value={rate.toString()}>{rate}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">数据位 (Data Bits)</label>
                                        <select
                                            value={serialConfig.dataBits}
                                            onChange={(e) => setSerialConfig({ ...serialConfig, dataBits: parseInt(e.target.value) })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                        >
                                            <option value="8">8 bits</option>
                                            <option value="7">7 bits</option>
                                            <option value="6">6 bits</option>
                                            <option value="5">5 bits</option>
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">校验位 (Parity)</label>
                                        <select
                                            value={serialConfig.parity}
                                            onChange={(e) => setSerialConfig({ ...serialConfig, parity: e.target.value })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                        >
                                            <option value="none">None</option>
                                            <option value="even">Even</option>
                                            <option value="odd">Odd</option>
                                            <option value="mark">Mark</option>
                                            <option value="space">Space</option>
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">停止位 (Stop Bits)</label>
                                        <select
                                            value={serialConfig.stopBits}
                                            onChange={(e) => setSerialConfig({ ...serialConfig, stopBits: parseInt(e.target.value) })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                        >
                                            <option value="1">1 bit</option>
                                            <option value="2">2 bits</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between bg-muted/30 p-3 rounded-md border border-border">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className="text-sm font-medium">
                                            {isConnected ? `已连接: ${currentPort}` : '未连接'}
                                        </span>
                                    </div>
                                    {isConnected ? (
                                        <button
                                            onClick={handleDisconnect}
                                            className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 flex items-center gap-1"
                                        >
                                            <Power size={12} /> 断开连接
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleConnect}
                                            disabled={!serialConfig.path}
                                            className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <Power size={12} /> 立即连接
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Connection Stability */}
                            <div className="space-y-3 pt-4 border-t border-border">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">连接策略</h4>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={serialConfig.autoReconnect}
                                            onChange={(e) => setSerialConfig({ ...serialConfig, autoReconnect: e.target.checked })}
                                            className="rounded border-input text-primary focus:ring-primary"
                                        />
                                        启用断线自动重连
                                    </label>
                                </div>
                                {serialConfig.autoReconnect && (
                                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <div className="space-y-1">
                                            <label className="text-xs text-muted-foreground">重试间隔 (ms)</label>
                                            <input
                                                type="number"
                                                value={serialConfig.reconnectInterval}
                                                onChange={(e) => setSerialConfig({ ...serialConfig, reconnectInterval: parseInt(e.target.value) })}
                                                className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-muted-foreground">最大尝试次数 (0=无限)</label>
                                            <input
                                                type="number"
                                                value={serialConfig.maxReconnectAttempts}
                                                onChange={(e) => setSerialConfig({ ...serialConfig, maxReconnectAttempts: parseInt(e.target.value) })}
                                                className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* New Heartbeat Config in Connection Tab */}
                            <div className="space-y-3 pt-4 border-t border-border">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">心跳检测 (Heartbeat)</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">心跳间隔 (ms)</label>
                                        <input
                                            type="number"
                                            value={systemConfig.heartbeatInterval}
                                            onChange={(e) => setSystemConfig({ ...systemConfig, heartbeatInterval: parseInt(e.target.value) })}
                                            className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">超时判定 (ms)</label>
                                        <input
                                            type="number"
                                            value={systemConfig.heartbeatTimeout}
                                            onChange={(e) => setSystemConfig({ ...systemConfig, heartbeatTimeout: parseInt(e.target.value) })}
                                            className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'transfer' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-200">
                            {/* Protocol Config */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Zap size={16} />
                                    高级传输设置
                                </h3>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">文件保存路径 (服务端路径)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={transferConfig.savePath}
                                            onChange={(e) => setTransferConfig({ ...transferConfig, savePath: e.target.value })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
                                            placeholder="./received"
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        * 支持相对路径 (相对于程序目录) 或绝对路径。例如: D:\Downloads
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center justify-between">
                                            包大小 (Chunk)
                                            <span className="text-[10px] text-muted-foreground">Bytes</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={transferConfig.chunkSize}
                                            onChange={(e) => setTransferConfig({ ...transferConfig, chunkSize: parseInt(e.target.value) })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                            placeholder="1024"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center justify-between">
                                            窗口大小 (Window)
                                            <span className="text-[10px] text-muted-foreground">Packets</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={transferConfig.windowSize}
                                            onChange={(e) => setTransferConfig({ ...transferConfig, windowSize: parseInt(e.target.value) })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                            placeholder="50"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground italic">
                                    * 提高窗口大小可显著提升高延迟线路下的吞吐量。包大小建议保持在 1KB 左右。
                                </p>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">文件冲突策略 (当文件已存在时)</label>
                                    <select
                                        value={transferConfig.conflictStrategy || 'rename'}
                                        onChange={(e) => setTransferConfig({ ...transferConfig, conflictStrategy: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    >
                                        <option value="rename">自动重命名 (例如 file_1.txt)</option>
                                        <option value="overwrite">直接覆盖 (Overwrite)</option>
                                        <option value="skip">跳过/忽略 (Skip)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-200">
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Activity size={16} />
                                    全局功能开关
                                </h3>

                                <div className="space-y-3">
                                    <label className="flex items-center justify-between p-3 rounded-md border border-input hover:bg-muted/50 transition-colors">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium">服务自动发现 (Service Discovery)</span>
                                            <span className="text-xs text-muted-foreground">开启后将定期广播本地服务列表，以便其他节点发现。</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={systemConfig.serviceDiscovery}
                                            onChange={(e) => setSystemConfig({ ...systemConfig, serviceDiscovery: e.target.checked })}
                                            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                                        />
                                    </label>
                                </div>

                                <div className="space-y-2 pt-4">
                                    <label className="text-sm font-medium">系统日志级别</label>
                                    <select
                                        value={systemConfig.logLevel}
                                        onChange={(e) => setSystemConfig({ ...systemConfig, logLevel: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    >
                                        <option value="debug">Debug (调试模式 - 最详尽)</option>
                                        <option value="info">Info (标准模式 - 推荐)</option>
                                        <option value="warn">Warn (仅警告和错误)</option>
                                        <option value="error">Error (仅错误)</option>
                                    </select>
                                    <p className="text-[10px] text-muted-foreground">
                                        * 用于控制后台输出到控制台和日志文件的详细程度。
                                    </p>
                                </div>

                                <div className="space-y-2 pt-4 border-t border-border">
                                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">服务端口 (重启进程生效)</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs text-muted-foreground">API 后端端口</label>
                                            <input
                                                type="number"
                                                value={systemConfig.apiPort}
                                                onChange={(e) => setSystemConfig({ ...systemConfig, apiPort: parseInt(e.target.value) || 3000 })}
                                                className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-muted-foreground">Web UI 端口</label>
                                            <input
                                                type="number"
                                                value={systemConfig.webPort}
                                                onChange={(e) => setSystemConfig({ ...systemConfig, webPort: parseInt(e.target.value) || 5173 })}
                                                className="w-full px-2 py-1 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 pt-6 border-t border-border mt-6">
                                    <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-2">危险操作 (Danger Zone)</h4>
                                    <div className="p-3 rounded-md border border-destructive/20 bg-destructive/5 flex items-center justify-between">
                                        <div className="text-sm">
                                            <p className="font-medium text-destructive">强制热重启系统后台流程栈</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">当修改端口或网络环境遇到卡死时，使用该功能强制重启。</p>
                                        </div>
                                        <button
                                            onClick={handleForceRestart}
                                            className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 flex items-center gap-1.5 transition-colors"
                                            title="立即下发重启信标：42"
                                        >
                                            <Power size={14} /> 强行重启
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border flex justify-between gap-2 bg-muted/50 rounded-b-lg">
                    <button
                        onClick={handleRestoreDefaults}
                        className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border rounded-md transition-colors"
                        title="恢复为默认推荐设置"
                    >
                        恢复默认
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            关闭
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
                        >
                            <Save size={16} />
                            保存配置
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
