import React from 'react';
import { Pause, Play, X, File, ArrowUp, ArrowDown, CheckCircle2, FolderOpen } from 'lucide-react';
import { cn } from '../../lib/utils';

const getDirectory = (path) => {
    if (!path) return '';
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return lastSlash > -1 ? path.substring(0, lastSlash) : path;
};

const TransferItem = ({ transfer, onPause, onResume, onCancel, onOpen }) => {
    const isSending = transfer.direction === 'send';
    const isPaused = transfer.status === 'paused';
    const isError = transfer.status === 'error';
    const isDone = transfer.status === 'done';

    return (
        <div className="bg-card border border-border rounded-md p-3 flex items-center gap-4 group hover:border-primary/50 transition-colors">
            {/* Icon */}
            <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                isSending ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"
            )}>
                {isSending ? <ArrowUp size={20} /> : <ArrowDown size={20} />}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                    <span className="font-medium truncate text-sm" title={transfer.name}>
                        {transfer.name}
                    </span>
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                        className={cn(
                            "h-full transition-all duration-300",
                            isError ? "bg-red-500" : isDone ? "bg-green-500" : isPaused ? "bg-yellow-500" : "bg-primary"
                        )}
                        style={{ width: `${transfer.percent}%` }}
                    />
                </div>

                <div className="flex justify-between items-center mt-1 text-xs text-muted-foreground">
                    {isDone ? (
                        <div className="flex items-center gap-2">
                            <span className="text-green-500 flex items-center gap-1 font-bold">
                                <CheckCircle2 size={14} /> 传输完成
                            </span>

                        </div>
                    ) : (
                        <span>{transfer.percent}% • {transfer.size}</span>
                    )}

                    {/* Speed and Actions (Bottom Right) */}
                    <div className="flex items-center gap-3">
                        {!isDone && transfer.speed && (
                            <span className="font-mono">{transfer.speed}</span>
                        )}

                        {/* Actions */}
                        {!isDone && !isError && (
                            <div className="flex gap-1">
                                {isSending && (
                                    isPaused ? (
                                        <button onClick={() => onResume(transfer.id)} className="p-1 hover:bg-secondary rounded text-green-400" title="Resume">
                                            <Play size={14} />
                                        </button>
                                    ) : (
                                        <button onClick={() => onPause(transfer.id)} className="p-1 hover:bg-secondary rounded text-yellow-400" title="Pause">
                                            <Pause size={14} />
                                        </button>
                                    )
                                )}
                                <button onClick={() => onCancel(transfer.id)} className="p-1 hover:bg-secondary rounded text-red-400" title="Cancel">
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        {/* Open Buttons (Done state) */}
                        {isDone && transfer.fullPath && (
                            <div className="flex gap-1">
                                <button
                                    onClick={() => onOpen(transfer.fullPath)}
                                    className="p-1 hover:bg-secondary rounded text-blue-400"
                                    title="打开文件"
                                >
                                    <File size={14} />
                                </button>
                                <button
                                    onClick={() => onOpen(getDirectory(transfer.fullPath))}
                                    className="p-1 hover:bg-secondary rounded text-yellow-400"
                                    title="打开所在文件夹"
                                >
                                    <FolderOpen size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransferItem;
