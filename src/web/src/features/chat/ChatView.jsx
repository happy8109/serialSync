import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Paperclip, Trash2 } from 'lucide-react';
import useAppStore from '../../store/appStore';
import { cn } from '../../lib/utils';
import ChatMessage from './ChatMessage';
import FileBubble from './FileBubble';

const ChatView = () => {
    const { messages, addMessage, clearMessages, updateTransfer } = useAppStore();
    const [input, setInput] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = (behavior = "smooth") => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initial scroll to bottom (immediate)
    useEffect(() => {
        setTimeout(() => scrollToBottom("auto"), 100);
    }, []);

    const handleSend = async () => {
        if (!input.trim()) return;

        const text = input;
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        try {
            await fetch('/api/send/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            addMessage({
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                from: 'local',
                type: 'text',
                text: text,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    const handleFileSelect = async (files) => {
        if (!files || files.length === 0) return;

        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/api/send/file', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (result.success) {
                    const transferId = result.fileId || result.id;

                    // 初始化传输状态，防止气泡显示“信息丢失”
                    updateTransfer(transferId, {
                        id: transferId,
                        name: file.name,
                        size: file.size,
                        progress: 0,
                        status: 'sending'
                    });

                    addMessage({
                        id: `msg_file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        from: 'local',
                        type: 'file',
                        content: file.name,
                        transferId: transferId,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (err) {
                console.error('Failed to send file:', err);
            }
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
        const newHeight = Math.min(target.scrollHeight, 150);
        target.style.height = `${newHeight}px`;
        target.style.overflowY = target.scrollHeight > 150 ? 'auto' : 'hidden';
        setInput(target.value);
    };

    // Drag and Drop handlers
    const onDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const onDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        handleFileSelect(files);
    }, []);

    return (
        <div
            className="flex flex-col h-full bg-background min-h-0 relative"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-card/30 flex justify-between items-center shrink-0">
                <div className="text-sm font-bold flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    串口对话
                </div>
                <button
                    onClick={() => { if (confirm('确定清空聊天记录？')) clearMessages(); }}
                    className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all"
                    title="清空记录"
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-x-2 inset-y-2 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center backdrop-blur-[2px] pointer-events-none">
                    <div className="bg-primary text-primary-foreground px-6 py-3 rounded-full shadow-lg font-medium animate-bounce flex items-center gap-2">
                        <Paperclip size={20} />
                        松开鼠标发送文件
                    </div>
                </div>
            )}

            {/* Message List */}
            <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin scrollbar-thumb-border">
                {messages.length === 0 && (
                    <div className="text-muted-foreground text-center mt-20 opacity-30 select-none">
                        <div className="mb-2">暂时没有消息</div>
                        <div className="text-[10px] uppercase tracking-widest">Connect to start chatting</div>
                    </div>
                )}

                {messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg}>
                        {msg.type === 'file' ? (
                            <FileBubble
                                transferId={msg.transferId}
                                isLocal={msg.from === 'local'}
                            />
                        ) : (
                            <div className="whitespace-pre-wrap break-all leading-relaxed">
                                {msg.text || msg.content}
                            </div>
                        )}
                    </ChatMessage>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border bg-card/30">
                <div className="flex items-end gap-2 max-w-5xl">
                    <div className="flex-1 relative group">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            placeholder="输入消息... (Shift+Enter 换行)"
                            maxLength={10000}
                            className="w-full bg-input text-foreground rounded-xl p-3 min-h-[44px] max-h-[150px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-border shadow-inner text-sm leading-relaxed block overflow-hidden hover:overflow-y-auto focus:overflow-y-auto transition-all"
                            rows={1}
                        />
                        {input.length > 1000 && (
                            <div className="absolute right-3 bottom-2 text-[10px] text-muted-foreground bg-background/80 px-1 rounded pointer-events-none">
                                {input.length} / 10000
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className={cn(
                            "h-[44px] w-[44px] flex items-center justify-center rounded-xl transition-all shrink-0",
                            input.trim()
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:scale-105 active:scale-95"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        <Send size={18} />
                    </button>

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="h-[44px] w-[44px] flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground rounded-xl transition-all shrink-0"
                        title="选择文件"
                    >
                        <Paperclip size={20} />
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => handleFileSelect(Array.from(e.target.files))}
                        className="hidden"
                        multiple
                    />
                </div>
            </div>
        </div>
    );
};

export default ChatView;
