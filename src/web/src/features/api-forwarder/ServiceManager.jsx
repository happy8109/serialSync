import React, { useState, useEffect } from 'react';
import { Globe, RefreshCw, Server, Play, Activity, Database, ArrowRight, Plus, Copy, Check, Trash2, Edit2 } from 'lucide-react';
import { cn } from '../../lib/utils';

import useAppStore from '../../store/appStore';

export default function ServiceManager() {
    const { addLog } = useAppStore();
    const [localServices, setLocalServices] = useState([]);
    const [remoteServices, setRemoteServices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);

    // Add/Edit Service Modal State
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingServiceId, setEditingServiceId] = useState(null); // If set, we are editing
    const [newService, setNewService] = useState({
        id: '',
        name: '',
        description: '',
        endpoint: 'http://localhost:8080/api/example',
        method: 'GET',
        enabled: true
    });

    // Call Result Modal State
    const [callResult, setCallResult] = useState(null);
    const [callingServiceId, setCallingServiceId] = useState(null);

    // Copy Feedback State
    const [copiedId, setCopiedId] = useState(null);

    useEffect(() => {
        fetchLocalServices();
        fetchRemoteServices(); // Load cached
        handleQueryRemote(); // Auto-trigger discovery

        // 自动轮询刷新状态
        const timer = setInterval(() => {
            fetchLocalServices();
            fetchRemoteServices();
        }, 5000);

        return () => clearInterval(timer);
    }, []);

    const fetchLocalServices = async () => {
        try {
            const res = await fetch('/api/services/local');
            const data = await res.json();
            if (data.success) setLocalServices(data.data);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchRemoteServices = async () => {
        try {
            const res = await fetch('/api/services/remote');
            const data = await res.json();
            if (data.success) setRemoteServices(data.data);
        } catch (e) {
            console.error(e);
        }
    };

    const handleQueryRemote = async () => {
        setQuerying(true);
        addLog({ timestamp: Date.now(), level: 'info', tag: 'API', message: 'Scanning for remote services...' });
        try {
            await fetch('/api/services/remote/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            // 轮询几次获取结果
            let attempts = 0;
            const interval = setInterval(async () => {
                await fetchRemoteServices();
                attempts++;
                if (attempts >= 5) {
                    clearInterval(interval);
                    setQuerying(false);
                }
            }, 1000);
        } catch (e) {
            console.error(e);
            setQuerying(false);
            addLog({ timestamp: Date.now(), level: 'error', tag: 'API', message: 'Failed to scan remote services' });
        }
    };

    const handleSaveService = async () => {
        if (!newService.id || !newService.endpoint) return;

        try {
            // Check if renaming: If editing and ID changed, delete the old one first
            if (editingServiceId && editingServiceId !== newService.id) {
                await fetch(`/api/services/local/${editingServiceId}`, {
                    method: 'DELETE'
                });
            }

            await fetch('/api/services/local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newService)
            });

            addLog({ timestamp: Date.now(), level: 'info', tag: 'API', message: `Registered local service: ${newService.id}` });

            setIsAddModalOpen(false);
            setEditingServiceId(null);
            fetchLocalServices();
            // Reset form
            setNewService({
                id: '',
                name: '',
                description: '',
                endpoint: 'http://localhost:8080/api/example',
                method: 'GET',
                enabled: true
            });
        } catch (e) {
            console.error(e);
            addLog({ timestamp: Date.now(), level: 'error', tag: 'API', message: `Failed to save service: ${e.message}` });
        }
    };

    const handleEditService = (service) => {
        setNewService({
            id: service.id,
            name: service.name || '',
            description: service.description || '',
            endpoint: service.endpoint || '',
            method: service.method || 'GET',
            enabled: service.enabled !== false
        });
        setEditingServiceId(service.id);
        setIsAddModalOpen(true);
    };

    const handleDeleteService = async (serviceId) => {
        if (!confirm('确定要删除这个服务配置吗?')) return;
        try {
            await fetch(`/api/services/local/${serviceId}`, {
                method: 'DELETE'
            });
            addLog({ timestamp: Date.now(), level: 'warn', tag: 'API', message: `Deleted local service: ${serviceId}` });
            fetchLocalServices();
        } catch (e) {
            console.error(e);
        }
    };

    const handleCallService = async (serviceId) => {
        setCallingServiceId(serviceId);
        setCallResult(null);
        addLog({ timestamp: Date.now(), level: 'info', tag: 'API', message: `Calling remote service: ${serviceId}...` });
        try {
            const res = await fetch(`/api/services/remote/${serviceId}/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) // Default empty params
            });
            const data = await res.json();
            setCallResult(data);
            addLog({ timestamp: Date.now(), level: 'info', tag: 'API', message: `Call success: ${serviceId}` });
        } catch (e) {
            setCallResult({ error: e.message });
            addLog({ timestamp: Date.now(), level: 'error', tag: 'API', message: `Call failed: ${serviceId} - ${e.message}` });
        } finally {
            setCallingServiceId(null);
        }
    };

    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const getProxyUrl = (serviceId) => {
        return `${window.location.protocol}//${window.location.hostname}:${window.location.port}/api/proxy/${serviceId}`;
    };

    return (
        <div className="flex flex-col h-full bg-muted/10">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
                <h2 className="font-semibold flex items-center gap-2">
                    <Globe size={18} className="text-blue-500" />
                    API 透明代理
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={handleQueryRemote}
                        disabled={querying}
                        className={cn(
                            "p-1.5 hover:bg-muted rounded-md transition-all text-xs flex items-center gap-1 border border-border/50",
                            querying && "animate-pulse text-blue-500"
                        )}
                        title="发现远程服务"
                    >
                        <RefreshCw size={14} className={cn(querying && "animate-spin")} />
                        {querying ? '正在发现...' : '服务发现'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">

                {/* Local Services Section */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Server size={16} className="text-green-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">本地服务 (Local)</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full mr-2">{localServices.length}</span>

                        <button
                            onClick={() => {
                                setNewService({
                                    id: '',
                                    name: '',
                                    description: '',
                                    endpoint: 'http://localhost:8080/api/example',
                                    method: 'GET',
                                    enabled: true
                                });
                                setEditingServiceId(null);
                                setIsAddModalOpen(true);
                            }}
                            className="ml-auto p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                            title="添加本地服务"
                        >
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {localServices.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                暂无本地服务配置，点击 '+' 添加。
                            </div>
                        )}
                        {localServices.map(service => (
                            <div key={service.id} className="bg-card border border-border/50 rounded-lg p-3 hover:border-blue-500/30 transition-colors group">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="font-medium flex items-center gap-2">
                                            {service.name || service.id}
                                            {service.enabled ? (
                                                service.status === 'offline' ?
                                                    <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" title="服务异常 (Offline)"></span> :
                                                    service.status === 'online' ?
                                                        <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" title="服务正常 (Online)"></span> :
                                                        <span className="w-2 h-2 rounded-full bg-yellow-500" title="检测中..."></span>
                                            ) : (
                                                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 border border-muted-foreground" title="已禁用"></span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{service.id}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                                            {service.method}
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleEditService(service)}
                                                className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                                                title="编辑"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteService(service.id)}
                                                className="p-1 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-500"
                                                title="删除"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground truncate" title={service.endpoint}>
                                    目标地址: {service.endpoint}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Remote Services Section */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/10">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Database size={16} className="text-orange-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">远程服务 (Remote)</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full">{remoteServices.length}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {remoteServices.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                点击上方 "服务发现" 获取远程设备服务列表。
                            </div>
                        )}
                        {remoteServices.map(service => {
                            const proxyUrl = getProxyUrl(service.id);
                            return (
                                <div key={service.id} className="bg-card border border-border/50 rounded-lg p-3 hover:border-orange-500/30 transition-colors flex flex-col gap-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-medium flex items-center gap-2 text-foreground">
                                                {service.enabled ? (
                                                    service.status === 'offline' ?
                                                        <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" title="远程服务异常"></span> :
                                                        service.status === 'online' ?
                                                            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" title="远程服务正常"></span> :
                                                            <span className="w-2 h-2 rounded-full bg-yellow-500" title="状态未知"></span>
                                                ) : (
                                                    <span className="w-2 h-2 rounded-full bg-muted-foreground/50 border border-muted-foreground" title="远程服务已禁用"></span>
                                                )}
                                                {service.name || service.id}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">{service.description || '暂无描述'}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleCallService(service.id)}
                                                disabled={callingServiceId === service.id}
                                                className="p-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors disabled:opacity-50"
                                                title="快速测试调用"
                                            >
                                                {callingServiceId === service.id ?
                                                    <Activity size={16} className="animate-spin" /> :
                                                    <Play size={16} fill="currentColor" />
                                                }
                                            </button>
                                        </div>
                                    </div>

                                    {/* Proxy URL Section - Gateway Mode */}
                                    <div className="bg-muted/30 rounded p-2 flex items-center justify-between gap-2 border border-border/30">
                                        <div className="text-[10px] font-mono text-muted-foreground truncate select-all">
                                            <span className="text-orange-500/70 font-semibold mr-1">代理地址:</span>
                                            {proxyUrl}
                                        </div>
                                        <button
                                            onClick={() => copyToClipboard(proxyUrl, service.id)}
                                            className="text-muted-foreground hover:text-foreground shrink-0"
                                            title="复制代理 URL"
                                        >
                                            {copiedId === service.id ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                        </button>
                                    </div>

                                    {callingServiceId === service.id && (
                                        <div className="text-xs text-blue-500 animate-pulse mt-0 flex items-center gap-1">
                                            <Activity size={12} /> 正在调用远程服务...
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Add Service Modal */}
            {isAddModalOpen && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-in fade-in duration-200">
                    <div className="bg-card border border-border shadow-xl rounded-xl w-full max-w-sm flex flex-col">
                        <div className="p-4 border-b border-border">
                            <h3 className="font-semibold text-lg">{editingServiceId ? '编辑本地服务' : '添加本地服务'}</h3>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">服务 ID (唯一标识)</label>
                                <input
                                    className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    value={newService.id}
                                    onChange={e => setNewService({ ...newService, id: e.target.value })}
                                    placeholder="例如: system_stats"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">显示名称</label>
                                <input
                                    className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    value={newService.name}
                                    onChange={e => setNewService({ ...newService, name: e.target.value })}
                                    placeholder="例如: 系统状态监控"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">本地 API 地址 (Endpoint)</label>
                                <input
                                    className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    value={newService.endpoint}
                                    onChange={e => setNewService({ ...newService, endpoint: e.target.value })}
                                    placeholder="http://localhost:3000/api..."
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">请求方法</label>
                                    <select
                                        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                        value={newService.method}
                                        onChange={e => setNewService({ ...newService, method: e.target.value })}
                                    >
                                        <option value="GET">GET</option>
                                        <option value="POST">POST</option>
                                        <option value="PUT">PUT</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">功能描述</label>
                                <textarea
                                    className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-16 resize-none"
                                    value={newService.description}
                                    onChange={e => setNewService({ ...newService, description: e.target.value })}
                                    placeholder="简要描述该服务的功能..."
                                />
                            </div>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2 bg-muted/20">
                            <button
                                onClick={() => setIsAddModalOpen(false)}
                                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSaveService}
                                disabled={!newService.id || !newService.endpoint}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                {editingServiceId ? '保存修改' : '注册服务'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Result Modal */}
            {callResult && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6 z-50">
                    <div className="bg-card border border-border shadow-xl rounded-xl w-full max-w-md max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Activity size={18} className="text-green-500" />
                                调用结果 (Result)
                            </h3>
                            <button onClick={() => setCallResult(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>
                        <div className="p-4 overflow-auto font-mono text-xs whitespace-pre-wrap">
                            {JSON.stringify(callResult, null, 2)}
                        </div>
                        <div className="p-3 border-t border-border bg-muted/20 text-center">
                            <button
                                onClick={() => setCallResult(null)}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
