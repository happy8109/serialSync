import React, { useState, useEffect, useMemo } from 'react';
import {
    RefreshCw, Plus, Trash2, Edit2, PlayCircle, Settings2,
    Folder, Clock, ArrowRightLeft, ArrowRight, ArrowLeft,
    Check, X, FolderOpen, Zap, Info
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';

export const SyncManager = () => {
    const { config, setConnectionStatus, discoveredShares, peerActivities } = useAppStore();
    const [tasks, setTasks] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTaskId, setEditingTaskId] = useState(null);
    const [isDiscovering, setIsDiscovering] = useState(false);

    const [formData, setFormData] = useState({
        id: '',
        name: '',
        description: '',
        shareId: '',
        frequency: '1m',
        direction: 'both',
        enabled: true,
        entries: [{ name: 'Default', localPath: '' }]
    });

    useEffect(() => {
        if (config && config.syncTasks) {
            setTasks(config.syncTasks);
        }
    }, [config]);

    const generateId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

    const localShares = useMemo(() => tasks.filter(t => t.direction !== 'remoteToLocal'), [tasks]);
    const remoteSubscriptions = useMemo(() => tasks.filter(t => t.direction === 'remoteToLocal'), [tasks]);

    const getDirectionIcon = (direction) => {
        if (direction === 'both') return <ArrowRightLeft size={10} />;
        if (direction === 'localToRemote') return <ArrowRight size={10} />;
        return <ArrowLeft size={10} />;
    };

    const handleRefreshDiscovery = async () => {
        setIsDiscovering(true);
        try {
            await fetch('/api/sync/discover', { method: 'POST' });
        } catch (e) {
            console.error(e);
        } finally {
            setTimeout(() => setIsDiscovering(false), 1000);
        }
    };

    const handleSubscribe = (share) => {
        setFormData({
            id: '',
            name: share.name,
            description: share.description,
            shareId: share.shareId,
            frequency: '1m',
            direction: 'remoteToLocal',
            enabled: true,
            entries: [{ name: 'Default', localPath: '' }]
        });
        setEditingTaskId(null);
        setIsModalOpen(true);
    };

    const handleSaveTask = async () => {
        if (!formData.name || !formData.shareId) return;

        const taskId = editingTaskId || `task_${Date.now()}`;
        const taskData = { ...formData, id: taskId };

        const newTasks = editingTaskId
            ? tasks.map(t => t.id === editingTaskId ? taskData : t)
            : [...tasks, taskData];

        try {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ syncTasks: newTasks })
            });
            setIsModalOpen(false);
            setEditingTaskId(null);
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteTask = async (id) => {
        if (!confirm('确定要删除此同步任务吗？')) return;
        const newTasks = tasks.filter(t => t.id !== id);
        try {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ syncTasks: newTasks })
            });
        } catch (e) {
            console.error(e);
        }
    };

    const toggleEnabled = async (task) => {
        const newTasks = tasks.map(t =>
            t.id === task.id ? { ...t, enabled: !t.enabled } : t
        );
        try {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ syncTasks: newTasks })
            });
        } catch (e) {
            console.error(e);
        }
    };

    const openEdit = (task) => {
        setFormData({ ...task });
        setEditingTaskId(task.id);
        setIsModalOpen(true);
    };

    const addEntry = () => {
        setFormData({
            ...formData,
            entries: [...formData.entries, { name: '', localPath: '' }]
        });
    };

    const removeEntry = (index) => {
        const newEntries = formData.entries.filter((_, i) => i !== index);
        setFormData({ ...formData, entries: newEntries });
    };

    const updateEntry = (index, field, value) => {
        const newEntries = [...formData.entries];
        newEntries[index][field] = value;
        setFormData({ ...formData, entries: newEntries });
    };

    const handleSelectFolder = async (index) => {
        try {
            const res = await fetch('/api/utils/select-folder');
            const data = await res.json();
            if (data.success && data.path) {
                updateEntry(index, 'localPath', data.path);
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="flex flex-col h-full bg-muted/10">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
                <h2 className="font-semibold flex items-center gap-2">
                    <RefreshCw size={18} className={cn("text-indigo-500", isDiscovering && "animate-spin")} />
                    多文件夹同步/共享
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={handleRefreshDiscovery}
                        className="p-1.5 hover:bg-muted rounded-md transition-all text-xs flex items-center gap-1 border border-border/50"
                        title="刷新远程共享"
                    >
                        <RefreshCw size={14} className={cn(isDiscovering && "animate-spin")} />
                        刷新列表
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
                {/* Local Tasks Section */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Folder size={16} className="text-indigo-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">本地共享 (My Shares)</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full mr-2">{localShares.length}</span>

                        <button
                            onClick={() => {
                                setFormData({
                                    id: '',
                                    name: '',
                                    description: '',
                                    shareId: generateId(),
                                    frequency: '1m',
                                    direction: 'localToRemote',
                                    enabled: true,
                                    entries: [{ name: 'Default', localPath: '' }]
                                });
                                setEditingTaskId(null);
                                setIsModalOpen(true);
                            }}
                            className="ml-auto p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                            title="添加本地分享"
                        >
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {localShares.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                暂无本地共享任务，点击 '+' 创建分享。
                            </div>
                        )}
                        {localShares.map(task => {
                            const isPeerActive = peerActivities && peerActivities[task.shareId];
                            return (
                                <div key={task.id} className={cn(
                                    "bg-card border rounded-lg p-3 transition-colors group",
                                    task.enabled ? "border-border/50 hover:border-indigo-500/30" : "border-border/50 opacity-70"
                                )}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium flex items-center gap-2 truncate">
                                                {task.name}
                                                <div className="flex items-center gap-1">
                                                    {task.enabled ? (
                                                        <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" title="本地正在运行"></span>
                                                    ) : (
                                                        <span className="w-2 h-2 rounded-full bg-muted-foreground/30" title="自选暂停"></span>
                                                    )}
                                                    {isPeerActive && (
                                                        <span className="text-[9px] bg-indigo-500/10 text-indigo-500 px-1 rounded border border-indigo-500/20 animate-pulse">远端已订阅</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                                <span className="font-mono bg-muted/50 px-1 rounded">{task.shareId}</span>
                                                <span className="flex items-center gap-1">
                                                    {getDirectionIcon(task.direction)}
                                                    {task.direction === 'both' ? '发布+订阅' : '仅发布'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => toggleEnabled(task)}
                                                className={cn(
                                                    "w-7 h-3.5 rounded-full flex items-center transition-colors p-0.5 relative",
                                                    task.enabled ? "bg-green-500" : "bg-muted"
                                                )}
                                                title={task.enabled ? "暂停" : "启用"}
                                            >
                                                <div className={cn(
                                                    "w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out",
                                                    task.enabled ? "translate-x-3.5" : "translate-x-0"
                                                )} />
                                            </button>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => openEdit(task)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                                                    <Edit2 size={12} />
                                                </button>
                                                <button onClick={() => handleDeleteTask(task.id)} className="p-1 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-500">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    {task.description && (
                                        <div className="mt-1 text-xs text-muted-foreground/80 line-clamp-1">
                                            {task.description}
                                        </div>
                                    )}
                                    <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
                                        {task.entries.slice(0, 3).map((entry, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                                <Folder size={10} className="shrink-0 text-indigo-400" />
                                                <span className="font-semibold text-foreground/70">{entry.name}:</span>
                                                <span className="truncate opacity-70" title={entry.localPath}>{entry.localPath}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Remote Shares Section */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/10">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Zap size={16} className="text-orange-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">远程发现 (Remote)</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full">{discoveredShares ? discoveredShares.length : 0}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {(!discoveredShares || discoveredShares.length === 0) && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                未发现远端分享，请尝试刷新。
                            </div>
                        )}
                        {discoveredShares && discoveredShares.map(share => {
                            const subTask = remoteSubscriptions.find(t => t.shareId === share.shareId);
                            const isSubscribed = !!subTask;

                            return (
                                <div key={share.shareId} className={cn(
                                    "bg-card border rounded-lg p-3 transition-colors flex flex-col gap-2",
                                    isSubscribed ? "border-indigo-500/20 bg-indigo-500/[0.02]" : "border-border/50 hover:border-orange-500/30"
                                )}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium flex items-center gap-2 text-foreground">
                                                {share.name}
                                                {isSubscribed ?
                                                    <span className="text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-sm">已订阅</span> :
                                                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" title="在线"></span>
                                                }
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">ID: {share.shareId}</div>
                                        </div>

                                        <div className="flex gap-1">
                                            {isSubscribed ? (
                                                <>
                                                    <button onClick={() => openEdit(subTask)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-all border border-border/50" title="修改订阅配置">
                                                        <Settings2 size={14} />
                                                    </button>
                                                    <button onClick={() => handleDeleteTask(subTask.id)} className="p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 transition-all border border-border/50" title="取消订阅">
                                                        <X size={14} />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => handleSubscribe(share)}
                                                    className="px-3 py-1 bg-primary text-primary-foreground text-xs rounded-md hover:bg-primary/90 transition-colors flex items-center gap-1 font-medium shadow-sm"
                                                >
                                                    <Plus size={14} /> 订阅
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {isSubscribed && subTask.entries && subTask.entries.length > 0 && (
                                        <div className="mt-1 p-2 bg-background/50 border border-border/30 rounded-md text-[10px] space-y-1">
                                            <div className="flex items-center justify-between text-muted-foreground mb-1">
                                                <span className="flex items-center gap-1"><Clock size={10} /> {subTask.frequency}</span>
                                                <span>{subTask.enabled ? '同步中' : '已暂停'}</span>
                                            </div>
                                            {subTask.entries.map((e, idx) => (
                                                <div key={idx} className="flex gap-1 truncate opacity-80">
                                                    <span className="font-semibold">{e.name}:</span>
                                                    <span className="truncate">{e.localPath}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {share.description && !isSubscribed && (
                                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 italic opacity-70">
                                            {share.description}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-card border border-border shadow-2xl rounded-xl w-full max-w-md flex flex-col max-h-[90%] overflow-hidden">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2 font-semibold text-lg">
                                <Settings2 size={18} className="text-indigo-500" />
                                <h3>{editingTaskId ? '配置同步/共享' : '创建同步/共享'}</h3>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>

                        <div className="p-5 space-y-5 overflow-y-auto flex-1 scrollbar-thin">
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">任务名称</label>
                                        <input
                                            className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="例如: 文档同步"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">共享 ID</label>
                                        <div className="flex items-stretch gap-1.5 ">
                                            <input
                                                className="flex-1 min-w-0 bg-background border border-input rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                                value={formData.shareId}
                                                onChange={e => setFormData({ ...formData, shareId: e.target.value })}
                                                placeholder="SHARE_ID"
                                            />
                                            <button
                                                onClick={() => setFormData({ ...formData, shareId: generateId() })}
                                                className="shrink-0 px-3 hover:bg-muted border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                title="重新生成 ID"
                                            >
                                                <Zap size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">任务描述</label>
                                    <textarea
                                        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-16 resize-none"
                                        value={formData.description || ''}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="简要描述此同步任务..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">扫描频率</label>
                                        <select
                                            className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            value={formData.frequency}
                                            onChange={e => setFormData({ ...formData, frequency: e.target.value })}
                                        >
                                            <option value="30s">30 秒</option>
                                            <option value="1m">1 分钟</option>
                                            <option value="5m">5 分钟</option>
                                            <option value="1h">1 小时</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">角色模式</label>
                                        <select
                                            className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            value={formData.direction}
                                            onChange={e => setFormData({ ...formData, direction: e.target.value })}
                                        >
                                            {formData.direction !== 'remoteToLocal' ? (
                                                <>
                                                    <option value="both">双向 (发布+订阅)</option>
                                                    <option value="localToRemote">发布方 (分享)</option>
                                                </>
                                            ) : (
                                                <>
                                                    <option value="remoteToLocal">订阅方 (拉取)</option>
                                                    <option value="both">双向 (同步)</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">包含的文件夹列表</label>
                                    <button onClick={addEntry} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium">
                                        <Plus size={12} /> 添加目录
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {formData.entries.map((entry, idx) => (
                                        <div key={idx} className="p-3 bg-muted/20 border border-border/50 rounded-lg space-y-3 relative group/entry">
                                            {formData.entries.length > 1 && (
                                                <button onClick={() => removeEntry(idx)} className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover/entry:opacity-100 transition-opacity z-10"><X size={14} /></button>
                                            )}

                                            <div className="grid grid-cols-1 gap-2">
                                                <div className="space-y-1">
                                                    <span className="text-[10px] text-muted-foreground font-medium">目录别名 (ID)</span>
                                                    <input
                                                        className="w-full bg-background border border-input rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                                        value={entry.name}
                                                        onChange={e => updateEntry(idx, 'name', e.target.value)}
                                                        placeholder="docs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="text-[10px] text-muted-foreground font-medium">本地路径</span>
                                                    <div className="flex items-stretch gap-1.5">
                                                        <input
                                                            className="flex-1 min-w-0 bg-background border border-input rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                                            value={entry.localPath}
                                                            onChange={e => updateEntry(idx, 'localPath', e.target.value)}
                                                            placeholder="C:\Path\To\Folder"
                                                        />
                                                        <button
                                                            onClick={() => handleSelectFolder(idx)}
                                                            className="px-2 bg-muted border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                            title="浏览..."
                                                        >
                                                            <FolderOpen size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-muted/20 border-t border-border flex gap-3 justify-end">
                            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">取消</button>
                            <button onClick={handleSaveTask} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2">
                                <Check size={16} /> 保存配置
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SyncManager;
