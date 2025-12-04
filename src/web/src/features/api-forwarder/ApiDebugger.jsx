import React, { useState } from 'react';
import { Play, Clock, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const ApiDebugger = () => {
    const [serviceId, setServiceId] = useState('system.info');
    const [params, setParams] = useState('{\n  "verbose": true\n}');
    const [response, setResponse] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleSend = async () => {
        setLoading(true);
        const startTime = Date.now();

        // Mock API call
        setTimeout(() => {
            const rtt = Date.now() - startTime;
            const resData = {
                success: true,
                data: {
                    version: "2.1.0",
                    uptime: 3600,
                    cpu: "15%"
                },
                meta: { timestamp: Date.now() }
            };

            setResponse({ data: resData, rtt });
            setHistory(prev => [{
                id: Date.now(),
                serviceId,
                timestamp: new Date(),
                status: 200,
                rtt
            }, ...prev]);
            setLoading(false);
        }, 500);
    };

    return (
        <div className="flex h-full">
            {/* Main Area */}
            <div className="flex-1 flex flex-col p-4 gap-4 min-w-0">
                <div className="flex gap-2">
                    <div className="flex-1">
                        <label className="text-xs text-muted-foreground font-bold mb-1 block">服务 ID (SERVICE ID)</label>
                        <input
                            type="text"
                            value={serviceId}
                            onChange={(e) => setServiceId(e.target.value)}
                            className="w-full bg-input border border-border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="例如 system.info"
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

                <div className="flex-1 flex gap-4 min-h-0">
                    {/* Request Params */}
                    <div className="flex-1 flex flex-col min-w-0">
                        <label className="text-xs text-muted-foreground font-bold mb-1 block">请求参数 (JSON)</label>
                        <textarea
                            value={params}
                            onChange={(e) => setParams(e.target.value)}
                            className="flex-1 bg-input border border-border rounded-md p-3 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                            spellCheck={false}
                        />
                    </div>

                    {/* Response */}
                    <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs text-muted-foreground font-bold block">响应结果</label>
                            {response && (
                                <span className="text-xs font-mono text-green-400">
                                    RTT: {response.rtt}ms
                                </span>
                            )}
                        </div>
                        <div className="flex-1 bg-black/30 border border-border rounded-md p-3 font-mono text-sm overflow-auto">
                            {response ? (
                                <pre className="text-green-300">
                                    {JSON.stringify(response.data, null, 2)}
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
            <div className="w-64 border-l border-border bg-card/30 flex flex-col">
                <div className="p-3 border-b border-border flex justify-between items-center">
                    <span className="text-xs font-bold text-muted-foreground">历史记录</span>
                    <button onClick={() => setHistory([])} className="text-muted-foreground hover:text-destructive">
                        <Trash2 size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {history.map(item => (
                        <div
                            key={item.id}
                            onClick={() => setServiceId(item.serviceId)}
                            className="p-3 border-b border-border/50 hover:bg-white/5 cursor-pointer group"
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-mono text-sm font-medium truncate w-32" title={item.serviceId}>
                                    {item.serviceId}
                                </span>
                                <span className={cn("text-xs", item.status === 200 ? "text-green-400" : "text-red-400")}>
                                    {item.status}
                                </span>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{item.timestamp.toLocaleTimeString()}</span>
                                <span>{item.rtt}ms</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ApiDebugger;
