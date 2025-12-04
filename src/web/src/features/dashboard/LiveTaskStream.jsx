import React, { useEffect, useRef } from 'react';
import useAppStore from '../../store/appStore';
import { cn } from '../../lib/utils';

const LogItem = ({ log }) => {
    let colorClass = "text-foreground";
    if (log.level === 'error') colorClass = "text-red-400";
    else if (log.level === 'warn') colorClass = "text-yellow-400";
    else if (log.tag === 'API') colorClass = "text-blue-400";
    else if (log.tag === 'FILE') colorClass = "text-yellow-300";
    else if (log.tag === 'SYSTEM') colorClass = "text-green-400";

    return (
        <div className="font-mono text-xs py-0.5 border-b border-border/10 last:border-0 flex gap-2 hover:bg-white/5 px-2">
            <span className="text-muted-foreground shrink-0 w-[70px]">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            {log.tag && (
                <span className={cn("font-bold shrink-0 w-[60px]", colorClass)}>
                    [{log.tag}]
                </span>
            )}
            <span className={cn("break-all", log.level === 'error' ? 'text-red-400' : 'text-foreground/80')}>
                {log.message}
            </span>
        </div>
    );
};

const LiveTaskStream = () => {
    const { logs } = useAppStore();
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="h-full bg-muted/30 border-b border-border flex flex-col">
            <div className="px-3 py-1 bg-card border-b border-border flex justify-between items-center">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">实时任务流</span>
                <div className="flex gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" title="P0 系统"></span>
                    <span className="w-2 h-2 rounded-full bg-blue-500" title="P1 API/聊天"></span>
                    <span className="w-2 h-2 rounded-full bg-yellow-500" title="P2 文件"></span>
                </div>
            </div>
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
            >
                {logs.length === 0 && (
                    <div className="text-muted-foreground/30 text-xs text-center mt-8">
                        系统空闲，等待事件...
                    </div>
                )}
                {logs.map((log, i) => (
                    <LogItem key={i} log={log} />
                ))}
            </div>
        </div>
    );
};

export default LiveTaskStream;
