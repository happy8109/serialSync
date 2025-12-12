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
                    {/* Left Panel: Chat (7 cols) */}
                    <div className="col-span-7 border-r border-border bg-background flex flex-col min-w-0 overflow-hidden">
                        <ChatView />
                    </div>

                    {/* Right Panel: Tools (5 cols) */}
                    <div className="col-span-5 flex flex-col bg-muted/30 min-w-0 overflow-hidden relative">
                        {/* Tabs Header */}
                        <div className="flex border-b border-border bg-card/50 shrink-0">
                            <button
                                onClick={() => setActiveTab('files')}
                                className={`flex-1 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'files'
                                    ? 'border-primary text-primary bg-primary/5'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                            >
                                File Transfer
                            </button>
                            <button
                                onClick={() => setActiveTab('services')}
                                className={`flex-1 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'services'
                                    ? 'border-primary text-primary bg-primary/5'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                            >
                                API Services
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 min-h-0 relative">
                            {activeTab === 'files' ? (
                                <TransferList />
                            ) : (
                                <ServiceManager />
                            )}
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
