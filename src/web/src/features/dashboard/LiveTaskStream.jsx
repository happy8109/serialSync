import React, { useEffect, useRef } from 'react';
import useAppStore from '../../store/appStore';
import { cn } from '../../lib/utils';

const LogColumn = ({ title, logs, color, className }) => {
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className={cn("flex flex-col h-full min-w-0", className)}>
            <div className={cn("px-2 py-1.5 bg-card/50 border-b border-border text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 sticky top-0")}>
                <div className={cn("w-1.5 h-1.5 rounded-full", color)}></div>
                {title}
            </div>
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent space-y-1"
            >
                {logs.length === 0 && (
                    <div className="text-muted-foreground/20 text-[10px] text-center mt-4 italic">
                        No events
                    </div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="font-mono text-[10px] py-1 px-1.5 rounded hover:bg-white/5 border border-transparent hover:border-border/30 transition-colors">
                        <div className="text-muted-foreground text-[9px] mb-0.5 opacity-70">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                        <div className={cn("break-words leading-tight", log.level === 'error' ? 'text-red-400' : 'text-foreground/80')}>
                            {log.message}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const LiveTaskStream = () => {
    const { logs } = useAppStore();

    // Filter logs for each category
    const systemLogs = logs.filter(l => !l.tag || l.tag === 'SYSTEM' || l.tag === 'INFO');
    const apiLogs = logs.filter(l => l.tag === 'API');
    const fileLogs = logs.filter(l => l.tag === 'FILE'); // Standard File Transfer
    const syncLogs = logs.filter(l => l.tag === 'SYNC'); // Sync Manager

    return (
        <div className="h-full bg-muted/10 border-b border-border flex flex-col">
            {/* 使用与 App.jsx 完全一致的栅格布局以保证对齐 */}
            <div className="flex-1 grid grid-cols-12 h-full">

                {/* 左半部分 (对应 Chat 区) */}
                <div className="col-span-6 border-r border-border min-w-0 grid grid-cols-2">
                    <LogColumn title="System" logs={systemLogs} color="bg-gray-400" className="border-r border-border/50" />
                    <LogColumn title="File Transfer" logs={fileLogs} color="bg-yellow-500" />
                </div>

                {/* 右半部分 (对应 Tools 区) */}
                <div className="col-span-6 min-w-0 flex">
                    <LogColumn
                        title="API Gateway"
                        logs={apiLogs}
                        color="bg-blue-500"
                        className="border-r border-border/50 flex-none w-[calc(50%+1px)]"
                    />
                    <LogColumn
                        title="File Sync"
                        logs={syncLogs}
                        color="bg-indigo-500"
                        className="flex-1"
                    />
                </div>

            </div>
        </div>
    );
};

export default LiveTaskStream;
