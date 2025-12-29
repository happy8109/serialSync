import React from 'react';
import { cn } from '../../lib/utils';

const ChatMessage = ({ message, children }) => {
    const isLocal = message.from === 'local';
    const isSystem = message.from === 'system';

    if (isSystem) {
        return (
            <div className="flex justify-center my-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full font-mono">
                    {message.text || message.content}
                </span>
            </div>
        );
    }

    return (
        <div className={cn(
            "flex flex-col mb-4",
            isLocal ? "items-end" : "items-start"
        )}>
            <div className={cn(
                "flex items-center gap-2 mb-1 px-1",
                isLocal ? "flex-row-reverse" : "flex-row"
            )}>
                <span className="text-xs font-bold text-muted-foreground/70">
                    {isLocal ? 'Me' : 'Remote'}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>

            <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm transition-all",
                isLocal
                    ? "bg-blue-500 text-white rounded-tr-none hover:bg-blue-400 shadow-blue-600/10"
                    : "bg-card border border-border text-foreground rounded-tl-none hover:bg-card/80"
            )}>
                {children}
            </div>
        </div>
    );
};

export default ChatMessage;
