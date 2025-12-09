import React from 'react';
import MainLayout from './layout/MainLayout';
import ChatView from './features/chat/ChatView';
import LiveTaskStream from './features/dashboard/LiveTaskStream';
import TransferList from './features/file-transfer/TransferList';
import WebSocketService from './services/WebSocketService';

function App() {
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
                    <div className="col-span-5 flex flex-col bg-muted/30 min-w-0 overflow-hidden">
                        {/* File Transfer (Full Height) */}
                        <div className="flex-1 min-h-0">
                            <TransferList />
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
