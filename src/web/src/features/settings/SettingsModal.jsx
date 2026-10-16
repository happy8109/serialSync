import React, { useState, useEffect } from 'react';
import { Settings, X, Wifi, Save, Power, Zap, Activity, Network, Shield, Plus, Trash2, Radio } from 'lucide-react';
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
                heartbeatInterval: serialForSystem.heartbeatInterval || 10000,
                heartbeatTimeout: serialForSystem.heartbeatTimeout || 30000,
                apiPort: serverVals.port || 3000,
                webPort: webVals.port || 5173
            }));

            // 4. Identity Config
            const identityVals = cfg.identity || {};
            setIdentityConfig({
                network: identityVals.network || '',
                nodeName: identityVals.nodeName || '',
                nodeId: identityVals.nodeId || ''
            });

            // 5. Relay Config
            const relayVals = cfg.relay || {};
            const peers = Array.isArray(relayVals.peers) ? relayVals.peers : (relayVals.peerUrl ? [relayVals.peerUrl] : []);
            setRelayConfig({
                peers: peers
            });

            // 6. Tunnel Config
            const tunnelVals = cfg.tunnel || {};
            setTunnelConfig({
                enabled: tunnelVals.enabled !== undefined ? tunnelVals.enabled : true,
                allowRemoteTunnel: tunnelVals.allowRemoteTunnel !== undefined ? tunnelVals.allowRemoteTunnel : true,
                targetWhitelist: Array.isArray(tunnelVals.targetWhitelist) ? tunnelVals.targetWhitelist : ['127.0.0.1:22', '127.0.0.1:23', '127.0.0.1:3389'],
                clientTunnels: Array.isArray(tunnelVals.clientTunnels) ? tunnelVals.clientTunnels : []
            });
            
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

    const [activeTab, setActiveTab] = useState('connection'); // 'connection' | 'network' | 'tunnel' | 'transfer' | 'system'

    const [identityConfig, setIdentityConfig] = useState({
        network: '',
        nodeName: '',
        nodeId: ''
    });

    const [relayConfig, setRelayConfig] = useState({
        peers: []
    });
    const [newPeerUrl, setNewPeerUrl] = useState('');

    const [tunnelConfig, setTunnelConfig] = useState({
        enabled: true,
        allowRemoteTunnel: true,
        targetWhitelist: ['127.0.0.1:22', '127.0.0.1:23', '127.0.0.1:3389'],
        clientTunnels: []
    });
    const [newWhitelistItem, setNewWhitelistItem] = useState('');
    const [showAddTunnelForm, setShowAddTunnelForm] = useState(false);
    const [newClientTunnel, setNewClientTunnel] = useState({
        id: '',
        localPort: '',
        localHost: '127.0.0.1',
        targetNode: '',
        targetHost: '127.0.0.1',
        targetPort: '',
        description: ''
    });

    const [systemConfig, setSystemConfig] = useState({
        heartbeatInterval: 10000,
        heartbeatTimeout: 30000,
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
                heartbeatInterval: 10000,
                heartbeatTimeout: 30000,
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
                },
                identity: {
                    network: identityConfig.network.trim(),
                    nodeName: identityConfig.nodeName.trim(),
                    nodeId: identityConfig.nodeId
                },
                relay: {
                    peers: relayConfig.peers.filter(Boolean)
                },
                tunnel: {
                    enabled: tunnelConfig.enabled,
                    allowRemoteTunnel: tunnelConfig.allowRemoteTunnel,
                    targetWhitelist: tunnelConfig.targetWhitelist.filter(Boolean),
                    clientTunnels: tunnelConfig.clientTunnels
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
            <div className="bg-card w-[680px] rounded-lg shadow-lg border border-border flex flex-col animate-in fade-in zoom-in duration-200 max-h-[90vh]">
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
                <div className="flex border-b border-border px-4 overflow-x-auto gap-1">
                    <button
                        onClick={() => setActiveTab('connection')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === 'connection'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        串口连接
                    </button>
                    <button
                        onClick={() => setActiveTab('network')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${activeTab === 'network'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Network size={14} />
                        网络与中继
                    </button>
                    <button
                        onClick={() => setActiveTab('tunnel')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${activeTab === 'tunnel'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Radio size={14} />
                        TCP 隧道
                    </button>
                    <button
                        onClick={() => setActiveTab('transfer')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === 'transfer'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        传输设置
                    </button>
                    <button
                        onClick={() => setActiveTab('system')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === 'system' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
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

                    {activeTab === 'network' && (
                        <div className="space-y-6 animate-in fade-in duration-200">
                            {/* Identity Config */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Network size={16} />
                                    节点身份标识 (Node Identity)
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    定义本节点在多网级联拓扑中的身份，用于网络层三层路由寻址、服务发现与跨网调用。
                                </p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-medium">底层真 ID (不可变)</label>
                                            <span className="text-[10px] text-muted-foreground">8位字母+数字</span>
                                        </div>
                                        <input
                                            type="text"
                                            value={identityConfig.nodeId || '--'}
                                            readOnly
                                            disabled
                                            className="w-full px-3 py-2 rounded-md border border-input bg-muted/60 text-muted-foreground font-mono text-sm cursor-not-allowed select-all"
                                            title="底层不可变物理真 ID (8-char Alphanumeric)"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">所属网络 (Network)</label>
                                        <input
                                            type="text"
                                            value={identityConfig.network}
                                            onChange={(e) => setIdentityConfig({ ...identityConfig, network: e.target.value })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                            placeholder="例如: A网 或 A-Network"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">节点名称 (Node Name)</label>
                                        <input
                                            type="text"
                                            value={identityConfig.nodeName}
                                            onChange={(e) => setIdentityConfig({ ...identityConfig, nodeName: e.target.value })}
                                            className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                            placeholder="例如: A1 或 Node-A"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* LAN Relay Bus */}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Radio size={16} />
                                    局域网级联中继总线 (LAN WebSocket Relay Bus)
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    当同一局域网内有多台串口中继网关时，通过 WebSocket 局域网总线相互桥接打通网络。
                                </p>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        已配置的局域网对端列表 (Peers)
                                    </label>
                                    {relayConfig.peers.length === 0 ? (
                                        <div className="p-3 rounded-md bg-muted/20 border border-border text-center text-xs text-muted-foreground">
                                            暂无局域网对端（单网关模式，仅依靠物理串口工作）
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {relayConfig.peers.map((peerUrl, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border text-sm font-mono">
                                                    <span className="truncate">{peerUrl}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRelayConfig({
                                                                peers: relayConfig.peers.filter((_, i) => i !== idx)
                                                            });
                                                        }}
                                                        className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                                                        title="删除此对端"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newPeerUrl}
                                        onChange={(e) => setNewPeerUrl(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (newPeerUrl.trim()) {
                                                    setRelayConfig({
                                                        peers: [...relayConfig.peers, newPeerUrl.trim()]
                                                    });
                                                    setNewPeerUrl('');
                                                }
                                            }
                                        }}
                                        className="flex-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                        placeholder="ws://192.168.x.x:3003/relay"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (newPeerUrl.trim()) {
                                                setRelayConfig({
                                                    peers: [...relayConfig.peers, newPeerUrl.trim()]
                                                });
                                                setNewPeerUrl('');
                                            }
                                        }}
                                        disabled={!newPeerUrl.trim()}
                                        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        <Plus size={14} /> 添加对端
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tunnel' && (
                        <div className="space-y-6 animate-in fade-in duration-200">
                            {/* Global / Target Settings */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Shield size={16} />
                                    跨网 TCP 隧道安全与受控端设置
                                </h3>
                                <div className="space-y-3">
                                    <label className="flex items-center justify-between p-3 rounded-md border border-input hover:bg-muted/50 transition-colors">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium">启用 TCP 端口转发隧道服务</span>
                                            <span className="text-xs text-muted-foreground">支持跨网穿透 SSH、RDP 远程桌面、MySQL 等任意底层 TCP 协议。</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={tunnelConfig.enabled}
                                            onChange={(e) => setTunnelConfig({ ...tunnelConfig, enabled: e.target.checked })}
                                            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                                        />
                                    </label>

                                    <label className="flex items-center justify-between p-3 rounded-md border border-input hover:bg-muted/50 transition-colors">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium">允许远端网络访问本机/内网真实服务</span>
                                            <span className="text-xs text-muted-foreground">作为受控端时开启。必须配合下方白名单进行细粒度安全防护。</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={tunnelConfig.allowRemoteTunnel}
                                            onChange={(e) => setTunnelConfig({ ...tunnelConfig, allowRemoteTunnel: e.target.checked })}
                                            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                                        />
                                    </label>
                                </div>

                                {/* Target Whitelist */}
                                <div className="space-y-2 pt-2">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        受控端目标服务安全白名单 (Target Whitelist)
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {tunnelConfig.targetWhitelist.map((rule, idx) => (
                                            <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted text-xs font-mono border border-border">
                                                {rule}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setTunnelConfig({
                                                            ...tunnelConfig,
                                                            targetWhitelist: tunnelConfig.targetWhitelist.filter((_, i) => i !== idx)
                                                        });
                                                    }}
                                                    className="text-muted-foreground hover:text-destructive"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 pt-1">
                                        <input
                                            type="text"
                                            value={newWhitelistItem}
                                            onChange={(e) => setNewWhitelistItem(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    if (newWhitelistItem.trim()) {
                                                        setTunnelConfig({
                                                            ...tunnelConfig,
                                                            targetWhitelist: [...tunnelConfig.targetWhitelist, newWhitelistItem.trim()]
                                                        });
                                                        setNewWhitelistItem('');
                                                    }
                                                }
                                            }}
                                            className="flex-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="例如: 127.0.0.1:22 或 127.0.0.1:3389"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (newWhitelistItem.trim()) {
                                                    setTunnelConfig({
                                                        ...tunnelConfig,
                                                        targetWhitelist: [...tunnelConfig.targetWhitelist, newWhitelistItem.trim()]
                                                    });
                                                    setNewWhitelistItem('');
                                                }
                                            }}
                                            disabled={!newWhitelistItem.trim()}
                                            className="px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-md text-xs font-medium border border-border disabled:opacity-50"
                                        >
                                            添加白名单规则
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Client Port Forwarding Rules */}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                            <Radio size={16} />
                                            控制端本地端口转发规则 (Port Forwarding)
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            在本机开启本地 TCP 监听端口，将流量透明转发至跨网的目标节点服务。
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddTunnelForm(!showAddTunnelForm)}
                                        className="px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded border border-primary/20 flex items-center gap-1"
                                    >
                                        <Plus size={12} />
                                        {showAddTunnelForm ? '收起表单' : '新建转发'}
                                    </button>
                                </div>

                                {/* List */}
                                {tunnelConfig.clientTunnels.length === 0 ? (
                                    <div className="p-3 rounded-md bg-muted/20 border border-border text-center text-xs text-muted-foreground">
                                        暂无本地转发规则（如需使用 Xshell/PuTTY 登录跨网机器，请新建转发规则）
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {tunnelConfig.clientTunnels.map((tun, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono font-bold text-primary">:{tun.localPort}</span>
                                                    <span className="text-muted-foreground">➔</span>
                                                    <span className="font-medium bg-muted px-1.5 py-0.5 rounded">{tun.targetNode}</span>
                                                    <span className="font-mono text-muted-foreground">({tun.targetHost || '127.0.0.1'}:{tun.targetPort})</span>
                                                    {tun.description && (
                                                        <span className="text-muted-foreground/70 text-[11px] truncate max-w-[120px]">
                                                            ({tun.description})
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setTunnelConfig({
                                                            ...tunnelConfig,
                                                            clientTunnels: tunnelConfig.clientTunnels.filter((_, i) => i !== idx)
                                                        });
                                                    }}
                                                    className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                                                    title="删除此规则"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Form */}
                                {showAddTunnelForm && (
                                    <div className="p-3 rounded-md border border-primary/30 bg-primary/5 space-y-3 animate-in fade-in duration-200">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">本机监听端口</label>
                                                <input
                                                    type="number"
                                                    value={newClientTunnel.localPort}
                                                    onChange={(e) => setNewClientTunnel({ ...newClientTunnel, localPort: e.target.value })}
                                                    className="w-full px-2 py-1 rounded border border-input bg-background text-xs font-mono"
                                                    placeholder="如 2222"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">目标网络/节点</label>
                                                <input
                                                    type="text"
                                                    value={newClientTunnel.targetNode}
                                                    onChange={(e) => setNewClientTunnel({ ...newClientTunnel, targetNode: e.target.value })}
                                                    className="w-full px-2 py-1 rounded border border-input bg-background text-xs"
                                                    placeholder="如 C网/C1"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">目标真实端口</label>
                                                <input
                                                    type="number"
                                                    value={newClientTunnel.targetPort}
                                                    onChange={(e) => setNewClientTunnel({ ...newClientTunnel, targetPort: e.target.value })}
                                                    className="w-full px-2 py-1 rounded border border-input bg-background text-xs font-mono"
                                                    placeholder="如 22"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">目标主机 (默认 127.0.0.1)</label>
                                                <input
                                                    type="text"
                                                    value={newClientTunnel.targetHost}
                                                    onChange={(e) => setNewClientTunnel({ ...newClientTunnel, targetHost: e.target.value })}
                                                    className="w-full px-2 py-1 rounded border border-input bg-background text-xs font-mono"
                                                    placeholder="127.0.0.1"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">规则备注说明</label>
                                                <input
                                                    type="text"
                                                    value={newClientTunnel.description}
                                                    onChange={(e) => setNewClientTunnel({ ...newClientTunnel, description: e.target.value })}
                                                    className="w-full px-2 py-1 rounded border border-input bg-background text-xs"
                                                    placeholder="如 跨网SSH连接C1"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowAddTunnelForm(false)}
                                                className="px-3 py-1 rounded text-xs text-muted-foreground hover:bg-muted"
                                            >
                                                取消
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!newClientTunnel.localPort || !newClientTunnel.targetNode || !newClientTunnel.targetPort) {
                                                        alert('请填写本地端口、目标节点及目标端口！');
                                                        return;
                                                    }
                                                    const tunnelToAdd = {
                                                        id: `tunnel_${newClientTunnel.localPort}`,
                                                        localPort: parseInt(newClientTunnel.localPort),
                                                        localHost: newClientTunnel.localHost || '127.0.0.1',
                                                        targetNode: newClientTunnel.targetNode.trim(),
                                                        targetHost: newClientTunnel.targetHost.trim() || '127.0.0.1',
                                                        targetPort: parseInt(newClientTunnel.targetPort),
                                                        description: newClientTunnel.description.trim()
                                                    };
                                                    setTunnelConfig({
                                                        ...tunnelConfig,
                                                        clientTunnels: [...tunnelConfig.clientTunnels, tunnelToAdd]
                                                    });
                                                    setNewClientTunnel({
                                                        id: '',
                                                        localPort: '',
                                                        localHost: '127.0.0.1',
                                                        targetNode: '',
                                                        targetHost: '127.0.0.1',
                                                        targetPort: '',
                                                        description: ''
                                                    });
                                                    setShowAddTunnelForm(false);
                                                }}
                                                className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
                                            >
                                                确认添加
                                            </button>
                                        </div>
                                    </div>
                                )}
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
