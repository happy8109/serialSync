import React from 'react';
import { Pause, Play, X, File, ArrowUp, ArrowDown, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const TransferItem = ({ transfer, onPause, onResume, onCancel }) => {
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
                    <span className="text-xs text-muted-foreground font-mono">
                        {transfer.speed || '0 KB/s'}
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
                        <span className="text-green-500 flex items-center gap-1 font-bold">
                            <CheckCircle2 size={14} /> 传输完成
                        </span>
                    ) : (
                        <span>{transfer.percent}% • {transfer.size}</span>
                    )}
                    {!isDone && <span>{transfer.eta || '--:--'}</span>}
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isDone && !isError && (
                    <>
                        {isSending && (
                            isPaused ? (
                                <button onClick={() => onResume(transfer.id)} className="p-2 hover:bg-secondary rounded-full text-green-400" title="Resume">
                                    <Play size={16} />
                                </button>
                            ) : (
                                <button onClick={() => onPause(transfer.id)} className="p-2 hover:bg-secondary rounded-full text-yellow-400" title="Pause">
                                    <Pause size={16} />
                                </button>
                            )
                        )}
                        <button onClick={() => onCancel(transfer.id)} className="p-2 hover:bg-secondary rounded-full text-red-400" title="Cancel">
                            <X size={16} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default TransferItem;
