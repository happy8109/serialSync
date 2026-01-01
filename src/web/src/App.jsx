import React, { useState } from 'react';
import MainLayout from './layout/MainLayout';
import ChatView from './features/chat/ChatView';
import LiveTaskStream from './features/dashboard/LiveTaskStream';
import TransferList from './features/file-transfer/TransferList';
import ServiceManager from './features/api-forwarder/ServiceManager';
import SyncManager from './features/file-sync/SyncManager';
import WebSocketService from './services/WebSocketService';
import { cn } from './lib/utils';

function App() {
    const [toolTab, setToolTab] = useState('services'); // 'services' | 'sync'

    return (
        <MainLayout>
            <WebSocketService />

            <div className="flex flex-col h-full">
                {/* Main Grid */}
                <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
                    {/* Left Panel: Chat (6 cols) */}
                    <div className="col-span-6 border-r border-border bg-background flex flex-col min-w-0 overflow-hidden">
                        <ChatView />
                    </div>

                    {/* Right Panel: Tools (6 cols) */}
                    <div className="col-span-6 flex flex-col bg-muted/20 min-w-0 overflow-hidden relative">
                        {/* Tab Switcher Header */}
                        <div className="flex border-b border-border bg-card/50 shrink-0 h-10 items-center">
                            <button
                                onClick={() => setToolTab('services')}
                                className={cn(
                                    "flex-1 h-full text-[10px] font-bold uppercase tracking-wider transition-all border-r border-border/50",
                                    toolTab === 'services'
                                        ? "bg-muted/50 text-primary shadow-[inset_0_-2px_0_0_rgba(59,130,246,1)]"
                                        : "text-muted-foreground hover:bg-muted/30"
                                )}
                            >
                                API Services
                            </button>
                            <button
                                onClick={() => setToolTab('sync')}
                                className={cn(
                                    "flex-1 h-full text-[10px] font-bold uppercase tracking-wider transition-all",
                                    toolTab === 'sync'
                                        ? "bg-indigo-500/10 text-indigo-500 shadow-[inset_0_-2px_0_0_rgba(99,102,241,1)]"
                                        : "text-muted-foreground hover:bg-muted/30"
                                )}
                            >
                                File Sync
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-h-0 relative">
                            {toolTab === 'services' ? <ServiceManager /> : <SyncManager />}
                        </div>
                    </div>
                </div>

                {/* Bottom: Live Task Stream */}
                <div className="h-[150px] shrink-0 border-t border-border bg-card z-10">
                    <LiveTaskStream />
                </div>
            </div>
        </MainLayout>
    );
}

export default App;
