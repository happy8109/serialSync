import React, { useState } from 'react';
import { X, Play, Trash2 } from 'lucide-react';

const ApiDebuggerModal = ({ isOpen, onClose }) => {
    const [serviceId, setServiceId] = useState('system.info');
    const [params, setParams] = useState('{\n  "verbose": true\n}');
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);

    if (!isOpen) return null;

    const handleSend = async () => {
        setLoading(true);
        setResponse(null);
        const startTime = Date.now();

        try {
            let parsedParams = {};
            try {
                parsedParams = JSON.parse(params);
            } catch (e) {
                alert('Invalid JSON params');
                setLoading(false);
                return;
            }

            // In a real app, this would call the backend API
            // For now, we'll mock it or use the real endpoint if available
            // const res = await fetch(...)

            // Mock response for UI testing
            await new Promise(r => setTimeout(r, 500));
            const mockRes = { status: 'ok', data: { version: '2.0.0', uptime: 12345 } };

            const rtt = Date.now() - startTime;
            setResponse({ data: mockRes, rtt });
            setHistory(prev => [{ id: Date.now(), serviceId, status: 'success', rtt }, ...prev]);

        } catch (err) {
            console.error(err);
            setResponse({ error: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card w-[800px] h-[600px] rounded-lg shadow-xl border border-border flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        API 调试器
                    </h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex min-h-0">
                    {/* Main Area */}
                    <div className="flex-1 flex flex-col p-4 gap-4 min-w-0 border-r border-border">
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="text-xs text-muted-foreground font-bold mb-1 block">服务 ID (SERVICE ID)</label>
                                <input
                                    type="text"
                                    value={serviceId}
                                    onChange={(e) => setServiceId(e.target.value)}
                                    className="w-full bg-input border border-border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleSend}
                                    disabled={loading}
                                    className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {loading ? <span className="animate-spin">⏳</span> : <Play size={16} />}
                                    发送
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col gap-4 min-h-0">
                            {/* Request Params */}
                            <div className="flex-1 flex flex-col min-w-0 h-1/2">
                                <label className="text-xs text-muted-foreground font-bold mb-1 block">请求参数 (JSON)</label>
                                <textarea
                                    value={params}
                                    onChange={(e) => setParams(e.target.value)}
                                    className="flex-1 bg-input border border-border rounded-md p-3 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                                    spellCheck={false}
                                />
                            </div>

                            {/* Response */}
                            <div className="flex-1 flex flex-col min-w-0 h-1/2">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs text-muted-foreground font-bold block">响应结果</label>
                                    {response && (
                                        <span className="text-xs font-mono text-green-600">
                                            RTT: {response.rtt}ms
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 bg-muted/50 border border-border rounded-md p-3 font-mono text-sm overflow-auto">
                                    {response ? (
                                        <pre className="text-foreground">
                                            {JSON.stringify(response.data || response.error, null, 2)}
                                        </pre>
                                    ) : (
                                        <div className="text-muted-foreground/50 italic">
                                            等待响应...
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* History Sidebar */}
                    <div className="w-64 flex flex-col bg-muted/10">
                        <div className="p-3 border-b border-border flex justify-between items-center">
                            <span className="text-xs font-bold text-muted-foreground">历史记录</span>
                            <button onClick={() => setHistory([])} className="text-muted-foreground hover:text-destructive">
                                <Trash2 size={14} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {history.map(item => (
                                <div key={item.id} className="p-2 bg-card border border-border rounded text-xs cursor-pointer hover:border-primary">
                                    <div className="font-bold truncate">{item.serviceId}</div>
                                    <div className="flex justify-between text-muted-foreground mt-1">
                                        <span>{item.status}</span>
                                        <span>{item.rtt}ms</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ApiDebuggerModal;
