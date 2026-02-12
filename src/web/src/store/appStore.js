import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useAppStore = create(
    persist(
        (set) => ({
            // Connection Status (Not persisted)
            isConnected: null, // Start as null to distinguish from 'explicitly false'
            linkReady: false, // 对端是否在线 (心跳确认)
            port: null,
            baudRate: null,
            stats: { rxBytes: 0, txBytes: 0, crcErrors: 0 },
            peerActivities: {},
            setConnectionStatus: (status) => set((state) => ({
                isConnected: status.connected !== undefined ? status.connected : state.isConnected,
                linkReady: status.linkReady !== undefined ? status.linkReady : state.linkReady,
                port: status.port !== undefined ? status.port : state.port,
                baudRate: status.baudRate !== undefined ? status.baudRate : state.baudRate,
                stats: status.bridgeStats !== undefined ? status.bridgeStats : state.stats,
                config: status.config !== undefined ? status.config : state.config,
                discoveredShares: status.discoveredShares || state.discoveredShares,
                peerActivities: status.peerActivities || state.peerActivities
            })),

            // Active Tab
            activeTab: 'chat',
            setActiveTab: (tab) => set({ activeTab: tab }),

            // Data Streams (Not persisted)
            logs: [],
            addLog: (log) => set((state) => ({ logs: [...state.logs.slice(-99), log] })),

            // Chat History (Persisted)
            messages: [],
            addMessage: (msg) => set((state) => {
                if (state.messages.some(m => m.id === msg.id)) return state;
                return { messages: [...state.messages, msg] };
            }),
            clearMessages: () => set({ messages: [] }),

            // File Transfers (Persisted metadata)
            transfers: [],
            updateTransfer: (id, data) => set((state) => {
                const index = state.transfers.findIndex(t => t.id === id);
                if (index === -1) {
                    return { transfers: [{ id, status: 'sending', ...data }, ...state.transfers] };
                }
                const newTransfers = [...state.transfers];
                newTransfers[index] = { ...newTransfers[index], ...data };
                return { transfers: newTransfers };
            }),
            removeTransfer: (id) => set((state) => ({
                transfers: state.transfers.filter(t => t.id !== id)
            })),
            clearTransfers: () => set({ transfers: [] }),

            // Sync Discovery
            discoveredShares: [],
            setDiscoveredShares: (shares) => set({ discoveredShares: shares }),
        }),
        {
            name: 'serial-sync-storage', // localStorage key
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                messages: state.messages,
                transfers: state.transfers.map(t => ({
                    ...t,
                    // 不持久化实时变化的进度和速度数据，只保留元数据
                    progress: t.status === 'completed' ? 100 : 0,
                    speed: 0,
                    fullPath: t.fullPath,
                    status: t.status === 'completed' ? 'completed' : 'failed'
                }))
            }),
        }
    )
);

export default useAppStore;
