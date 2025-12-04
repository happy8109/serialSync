import React, { useState } from 'react';
import { Settings, X, Wifi, Save, Zap, Power, Terminal } from 'lucide-react';
import useAppStore from '../../store/appStore';
import ApiDebuggerModal from '../api-forwarder/ApiDebuggerModal';

const SettingsModal = ({ isOpen, onClose }) => {
    const { port, isConnected } = useAppStore();
    const [serialPort, setSerialPort] = useState(port || 'COM3');
    const [baudRate, setBaudRate] = useState('115200');
    const [isDebuggerOpen, setIsDebuggerOpen] = useState(false);

    if (!isOpen) return null;

    const handleSave = async () => {
        // TODO: Call API to update config
        console.log('Saving config:', { serialPort, baudRate });
        onClose();
    };

    const handleConnect = async () => {
        try {
            await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: serialPort, baudRate: parseInt(baudRate) })
            });
            // Status will be updated via WebSocket
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

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="bg-card w-[500px] rounded-lg shadow-lg border border-border flex flex-col animate-in fade-in zoom-in duration-200">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Settings size={20} />
                            设置
                        </h2>
                        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        {/* Serial Port Config */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                <Wifi size={16} />
                                串口连接
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">端口 (Port)</label>
                                    <input
                                        type="text"
                                        value={serialPort}
                                        onChange={(e) => setSerialPort(e.target.value)}
                                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="e.g. COM3"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">波特率 (Baud)</label>
                                    <select
                                        value={baudRate}
                                        onChange={(e) => setBaudRate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="9600">9600</option>
                                        <option value="115200">115200</option>
                                        <option value="921600">921600</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-muted/30 p-3 rounded-md border border-border">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                    <span className="text-sm font-medium">
                                        {isConnected ? `已连接: ${port}` : '未连接'}
                                    </span>
                                </div>
                                {isConnected ? (
                                    <button
                                        onClick={handleDisconnect}
                                        className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 flex items-center gap-1"
                                    >
                                        <Power size={12} /> 断开
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleConnect}
                                        className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                                    >
                                        <Power size={12} /> 连接
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* API Config */}
                        <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Zap size={16} />
                                    API 转发
                                </h3>
                                <button
                                    onClick={() => setIsDebuggerOpen(true)}
                                    className="text-xs flex items-center gap-1 text-blue-600 hover:underline"
                                >
                                    <Terminal size={12} /> 打开调试器
                                </button>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">注册服务 ID</label>
                                <textarea
                                    className="w-full px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary h-20 font-mono text-xs"
                                    placeholder="system.info, device.control"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-border flex justify-end gap-2 bg-muted/50 rounded-b-lg">
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

            <ApiDebuggerModal isOpen={isDebuggerOpen} onClose={() => setIsDebuggerOpen(false)} />
        </>
    );
};

export default SettingsModal;
