import React from 'react';
import { MessageSquare, FolderInput, Zap, Settings, Activity } from 'lucide-react';
import useAppStore from '../store/appStore';
import { cn } from '../lib/utils';

const NavItem = ({ icon: Icon, label, id, active, onClick }) => (
    <button
        onClick={() => onClick(id)}
        className={cn(
            "w-12 h-12 flex items-center justify-center rounded-lg mb-2 transition-colors",
            active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
        title={label}
    >
        <Icon size={24} />
    </button>
);

const Sidebar = () => {
    const { activeTab, setActiveTab, isConnected, linkReady, port } = useAppStore();

    const navItems = [
        { id: 'chat', icon: MessageSquare, label: '聊天' },
        { id: 'files', icon: FolderInput, label: '文件传输' },
        { id: 'api', icon: Zap, label: 'API 调试' },
        { id: 'settings', icon: Settings, label: '设置' },
    ];

    // 三态: 绿(linkReady) / 橙(串口连接但对端离线) / 红(串口断开)
    const indicatorClass = isConnected
        ? (linkReady
            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
            : "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]")
        : "bg-red-500";
    const tooltip = isConnected
        ? (linkReady ? `Connected: ${port}` : `Waiting: ${port}`)
        : "Disconnected";

    return (
        <div className="w-16 bg-card border-r border-border flex flex-col items-center py-4 h-screen">
            <div className="flex-1 flex flex-col items-center">
                {navItems.map((item) => (
                    <NavItem
                        key={item.id}
                        {...item}
                        active={activeTab === item.id}
                        onClick={setActiveTab}
                    />
                ))}
            </div>

            <div className="mt-auto flex flex-col items-center gap-2">
                <div
                    className={cn(
                        "w-3 h-3 rounded-full",
                        indicatorClass
                    )}
                    title={tooltip}
                />
                <span className="text-[10px] text-muted-foreground font-mono">
                    {port || 'OFF'}
                </span>
            </div>
        </div>
    );
};

export default Sidebar;
