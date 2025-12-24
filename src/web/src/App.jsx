import React, { useState } from 'react';
import MainLayout from './layout/MainLayout';
import ChatView from './features/chat/ChatView';
import LiveTaskStream from './features/dashboard/LiveTaskStream';
import TransferList from './features/file-transfer/TransferList';
import ServiceManager from './features/api-forwarder/ServiceManager';
import WebSocketService from './services/WebSocketService';

function App() {
    const [activeTab, setActiveTab] = useState('files'); // 'files' | 'services'

    return (
        <MainLayout>
            <WebSocketService />

            <div className="flex flex-col h-full">
                {/* Main Grid */}
                <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
                    {/* Left Panel: Chat (8 cols) - 增加宽度以适应气泡设计 */}
                    <div className="col-span-8 border-r border-border bg-background flex flex-col min-w-0 overflow-hidden">
                        <ChatView />
                    </div>

                    {/* Right Panel: Tools (4 cols) */}
                    <div className="col-span-4 flex flex-col bg-muted/20 min-w-0 overflow-hidden relative">
                        {/* Header */}
                        <div className="flex border-b border-border bg-card/50 shrink-0 px-4 py-2.5 items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Services</span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-h-0 relative">
                            <ServiceManager />
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
