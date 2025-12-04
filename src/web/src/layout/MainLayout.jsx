import React, { useState } from 'react';
import { Settings, Activity, Zap } from 'lucide-react';
import useAppStore from '../store/appStore';
import { cn } from '../lib/utils';
import SettingsModal from '../features/settings/SettingsModal';

const MainLayout = ({ children }) => {
    const { isConnected, port } = useAppStore();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
            {/* Header */}
            <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                        S
                    </div>
                    <h1 className="font-bold text-lg tracking-tight">SerialSync <span className="text-xs font-normal text-muted-foreground ml-1">v2.0</span></h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border/50">
                        <div
                            className={cn(
                                "w-2.5 h-2.5 rounded-full transition-colors",
                                isConnected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500"
                            )}
                        />
                        <span className="text-xs font-medium text-muted-foreground font-mono">
                            {isConnected ? port : 'DISCONNECTED'}
                        </span>
                    </div>

                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                        title="设置"
                    >
                        <Settings size={20} />
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 min-h-0 relative">
                {children}
            </main>

            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </div>
    );
};

export default MainLayout;
