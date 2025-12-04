import { create } from 'zustand';

const useAppStore = create((set) => ({
    // Connection Status
    isConnected: false,
    port: null,
    setConnectionStatus: (status) => set((state) => ({
        isConnected: status.connected !== undefined ? status.connected : state.isConnected,
        port: status.port !== undefined ? status.port : state.port
    })),

    // Active Tab
    activeTab: 'chat',
    setActiveTab: (tab) => set({ activeTab: tab }),

    // Data Streams
    logs: [],
    addLog: (log) => set((state) => ({ logs: [...state.logs.slice(-99), log] })),

    // Chat History
    messages: [],
    addMessage: (msg) => set((state) => {
        if (state.messages.some(m => m.id === msg.id)) return state;
        return { messages: [...state.messages, msg] };
    }),

    // File Transfers
    transfers: [],
    updateTransfer: (id, data) => set((state) => {
        const index = state.transfers.findIndex(t => t.id === id);
        if (index === -1) {
            return { transfers: [...state.transfers, { id, status: 'sending', ...data }] };
        }
        const newTransfers = [...state.transfers];
        newTransfers[index] = { ...newTransfers[index], ...data };
        return { transfers: newTransfers };
    }),
}));

export default useAppStore;
