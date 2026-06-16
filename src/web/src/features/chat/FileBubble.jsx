import React, { useMemo, useState } from 'react';
import { FileText, File, FileArchive, FileImage, FileCode, CheckCircle2, XCircle, AlertCircle, Loader2, Download, Pause, Play, Square } from 'lucide-react';
import useAppStore from '../../store/appStore';
import { cn } from '../../lib/utils';

const FileBubble = ({ transferId, isLocal }) => {
    const { transfers, updateTransfer, addMessage } = useAppStore();
    const transfer = useMemo(() => transfers.find(t => t.id === transferId), [transfers, transferId]);
    const [actionLoading, setActionLoading] = useState(false);

    if (!transfer) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground italic py-1">
                <AlertCircle size={14} />
                <span>任务信息已丢失</span>
            </div>
        );
    }

    const { name, size, progress, speed, status, error, fullPath, sender } = transfer;

    // 根据后缀名选择图标
    const getFileIcon = (fileName) => {
        const ext = fileName?.split('.').pop().toLowerCase() || '';
        if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return <FileImage size={24} />;
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive size={24} />;
        if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'go', 'c', 'cpp'].includes(ext)) return <FileCode size={24} />;
        if (['txt', 'md', 'log', 'pdf', 'doc', 'docx'].includes(ext)) return <FileText size={24} />;
        return <File size={24} />;
    };

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        if (typeof bytes === 'string' && bytes.includes(' ')) return bytes; // Already formatted
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatSpeed = (bytesPerSec) => {
        return `${formatSize(bytesPerSec || 0)}/s`;
    };

    const handleDownload = () => {
        if (!fullPath) return;
        // 通过创建隐藏链接触发浏览器原生下载
        const a = document.createElement('a');
        a.href = `/api/download?path=${encodeURIComponent(fullPath)}`;
        a.download = name || 'file';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleAction = async (action) => {
        setActionLoading(true);
        try {
            await fetch(`/api/transfer/${transferId}/${action}`, { method: 'POST' });
        } catch (e) {
            console.error(`Failed to ${action} transfer`, e);
        } finally {
            setActionLoading(false);
        }
    };

    const isActive = status === 'sending' || status === 'receiving' || status === 'paused' || status === 'pulling';

    return (
        <div className="flex flex-col gap-3 min-w-[240px]">
            {/* Header info */}
            <div className="flex items-center gap-3">
                <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isLocal ? "bg-primary-foreground/10" : "bg-muted"
                )}>
                    {getFileIcon(name)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate" title={name}>{name || '未知文件'}</div>
                    <div className={cn(
                        "text-[10px] opacity-70",
                        isLocal ? "text-primary-foreground" : "text-muted-foreground"
                    )}>
                        {formatSize(size)} {sender && ` • 来自 ${sender.nickname || sender.nodeName}`}
                    </div>
                </div>
            </div>

            {/* Progress Area */}
            {isActive && (
                <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] items-center">
                        <span className="flex items-center gap-1 font-medium">
                            {status === 'paused' ? (
                                <span className="flex items-center gap-1 text-yellow-500">
                                    <Pause size={10} /> 已暂停
                                </span>
                            ) : status === 'pulling' ? (
                                <span className="flex items-center gap-1 text-blue-500 font-bold">
                                    <Loader2 size={10} className="animate-spin" /> 正在发起中继拉取...
                                </span>
                            ) : (
                                <span className="flex items-center gap-1">
                                    <Loader2 size={10} className="animate-spin" />
                                    {status === 'sending' ? '正在发送...' : '正在接收...'}
                                </span>
                            )}
                        </span>
                        {status !== 'pulling' && <span className="font-mono">{progress || 0}%</span>}
                    </div>
                    {status !== 'pulling' && (
                        <>
                            <div className={cn(
                                "h-1.5 w-full rounded-full overflow-hidden",
                                isLocal ? "bg-primary-foreground/20" : "bg-muted"
                            )}>
                                <div
                                    className={cn(
                                        "h-full transition-all duration-300",
                                        isLocal ? "bg-white/40" : "bg-blue-600",
                                        status === 'paused' && "opacity-50 grayscale"
                                    )}
                                    style={{ width: `${progress || 0}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center text-[10px] opacity-70 font-mono">
                                <div className="flex items-center gap-1">
                                    <span className="opacity-50">Speed:</span>
                                    <span>{formatSpeed(speed)}</span>
                                </div>

                                {/* Control Buttons */}
                                <div className="flex items-center gap-2">
                                    {status === 'paused' ? (
                                        <button
                                            disabled={actionLoading}
                                            onClick={() => handleAction('resume')}
                                            className="p-1 hover:bg-black/10 rounded transition-colors"
                                            title="恢复"
                                        >
                                            <Play size={12} fill="currentColor" />
                                        </button>
                                    ) : (
                                        <button
                                            disabled={actionLoading}
                                            onClick={() => handleAction('pause')}
                                            className="p-1 hover:bg-black/10 rounded transition-colors"
                                            title="暂停"
                                        >
                                            <Pause size={12} fill="currentColor" />
                                        </button>
                                    )}
                                    <button
                                        disabled={actionLoading}
                                        onClick={() => handleAction('cancel')}
                                        className="p-1 hover:bg-black/10 rounded transition-colors"
                                        title="取消"
                                    >
                                        <Square size={10} fill="currentColor" />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Status Footer */}
            <div className="flex items-center justify-between mt-0.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium">
                    {status === 'completed' && (
                        <>
                            <CheckCircle2 size={12} className={isLocal ? "text-primary-foreground" : "text-green-500"} />
                            <span>传输完成</span>
                        </>
                    )}
                    {status === 'failed' && (
                        <>
                            <XCircle size={12} className="text-red-500" />
                            <span className="text-red-500 truncate max-w-[150px]">
                                {error || '传输失败'}
                            </span>
                        </>
                    )}
                    {status === 'relay_available' && (
                        <>
                            <AlertCircle size={12} className="text-blue-500 animate-pulse" />
                            <span className="text-blue-500">跨网文件</span>
                        </>
                    )}
                </div>

                {/* Actions */}
                {status === 'completed' && !isLocal && fullPath && (
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                        className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors shadow-sm",
                            isLocal
                                ? "bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground"
                                : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
                        )}
                    >
                        <Download size={10} />
                        下载文件
                    </button>
                )}

                {status === 'relay_available' && (
                    <button
                        disabled={actionLoading}
                        onClick={async (e) => {
                            e.stopPropagation();
                            setActionLoading(true);
                            try {
                                updateTransfer(transferId, { status: 'pulling' });
                                const response = await fetch('/api/relay/pull', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ fileId: transferId, fileName: name })
                                });
                                const result = await response.json();
                                if (!result.success || (!result.pulling && !result.available)) {
                                    updateTransfer(transferId, { status: 'failed', error: result.error || '中继拉取发起失败' });
                                }
                            } catch (err) {
                                console.error('Failed to trigger relay pull:', err);
                                updateTransfer(transferId, { status: 'failed', error: '中继拉取发起失败' });
                            } finally {
                                setActionLoading(false);
                            }
                        }}
                        className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 text-white"
                        )}
                    >
                        <Download size={10} />
                        拉取文件
                    </button>
                )}
            </div>
        </div>
    );
};

export default FileBubble;
