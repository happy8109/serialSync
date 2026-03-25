import React, { useState } from 'react';
import { Settings, Activity, Zap, Cpu, Cable } from 'lucide-react';
import useAppStore from '../store/appStore';
import { cn } from '../lib/utils';
import SettingsModal from '../features/settings/SettingsModal';

const MainLayout = ({ children }) => {
    const { isConnected, linkReady, port, baudRate, stats } = useAppStore();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // 三态指示器: 绿(linkReady) / 橙(串口连接但对端离线) / 红(串口断开)
    const indicatorClass = isConnected
        ? (linkReady
            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
            : "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]")
        : "bg-red-500";
    const statusLabel = isConnected
        ? (linkReady ? port : `${port} (等待对端)`)
        : 'DISCONNECTED';
    const baudLabel = isConnected
        ? (baudRate ? `${baudRate} bps` : '-- bps')
        : 'Disconnected';

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
            {/* Header */}
            <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-sm">
                        <Cable size={20} />
                    </div>
                    <h1 className="font-bold text-lg tracking-tight">SerialSync <span className="text-xs font-normal text-muted-foreground ml-1">v{__APP_VERSION__}</span></h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                        {isConnected && (
                            <>
                                <div className="flex items-center gap-3 px-2 py-1 bg-muted/30 rounded border border-border/30">
                                    <span className="flex items-center gap-1">
                                        <span className="text-green-500">RX:</span> {(stats.rxBytes / 1024).toFixed(1)} KB
                                    </span>
                                    <span className="w-px h-3 bg-border/50"></span>
                                    <span className="flex items-center gap-1">
                                        <span className="text-blue-500">TX:</span> {(stats.txBytes / 1024).toFixed(1)} KB
                                    </span>
                                    {stats.crcErrors > 0 && (
                                        <>
                                            <span className="w-px h-3 bg-border/50"></span>
                                            <span className="text-red-500">ERR: {stats.crcErrors}</span>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border/50">
                            <div
                                className={cn(
                                    "w-2.5 h-2.5 rounded-full transition-colors",
                                    indicatorClass
                                )}
                            />
                            <span className="font-medium">
                                {statusLabel}
                            </span>
                            <span className="w-px h-3 bg-border/50 mx-1"></span>
                            <span className="text-muted-foreground/70">
                                {baudLabel}
                            </span>
                        </div>
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
