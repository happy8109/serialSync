import React, { useRef, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import useAppStore from '../../store/appStore';
import { cn } from '../../lib/utils';

const ChatView = () => {
    const { messages, addMessage } = useAppStore();
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;

        try {
            await fetch('/api/send/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: input })
            });

            addMessage({
                id: Date.now(),
                from: 'local',
                text: input,
                timestamp: new Date().toISOString()
            });

            setInput('');
            // Reset height
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e) => {
        const target = e.target;
        target.style.height = 'auto';
        target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
        setInput(target.value);
    };

    return (
        <div className="flex flex-col h-full bg-background min-h-0">
            {/* Message List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">
                {messages.length === 0 && (
                    <div className="text-muted-foreground text-center mt-20 opacity-50">
                        No messages yet. Start typing...
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className="flex gap-2 group">
                        <span className="text-muted-foreground shrink-0 select-none">
                            [{new Date(msg.timestamp).toLocaleTimeString([], { hour12: false })}]
                        </span>
                        <span className={cn(
                            "font-bold shrink-0",
                            msg.from === 'local' ? "text-green-400" : "text-blue-400"
                        )}>
                            &lt;{msg.from === 'local' ? 'Local' : 'Remote'}&gt;:
                        </span>
                        <span className="whitespace-pre-wrap break-all text-foreground/90">
                            {msg.text}
                        </span>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border bg-card/50">
                <div className="relative flex items-end gap-2">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message... (Shift+Enter for new line)"
                        className="flex-1 bg-input text-foreground rounded-md p-3 min-h-[44px] max-h-[150px] resize-none focus:outline-none focus:ring-1 focus:ring-ring font-mono text-sm"
                        rows={1}
                    />
                    <button
                        onClick={handleSend}
                        className="h-[44px] w-[44px] flex items-center justify-center bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shrink-0"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatView;
