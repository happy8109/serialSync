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
                    {/* Left Panel: Chat (8 cols) */}
                    <div className="col-span-8 border-r border-border bg-background flex flex-col min-w-0 overflow-hidden">
                        <ChatView />
                    </div>

                    {/* Right Panel: Tools (4 cols) */}
                    <div className="col-span-4 flex flex-col bg-muted/20 min-w-0 overflow-hidden relative">
                        {/* Tab Switcher Header */}
                        <div className="flex border-b border-border bg-card/50 shrink-0 px-2 py-1 items-center gap-1">
                            <button
                                onClick={() => setToolTab('services')}
                                className={cn(
                                    "flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all rounded-md",
                                    toolTab === 'services'
                                        ? "bg-primary/10 text-primary shadow-sm"
                                        : "text-muted-foreground hover:bg-muted"
                                )}
                            >
                                API Services
                            </button>
                            <button
                                onClick={() => setToolTab('sync')}
                                className={cn(
                                    "flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all rounded-md",
                                    toolTab === 'sync'
                                        ? "bg-indigo-500/10 text-indigo-500 shadow-sm"
                                        : "text-muted-foreground hover:bg-muted"
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
