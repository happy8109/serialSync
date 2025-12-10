import { useEffect } from 'react';
import useAppStore from '../store/appStore';

const WebSocketService = () => {
    const { setConnectionStatus, addLog, addMessage, updateTransfer } = useAppStore();

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        let ws;
        let reconnectTimer;
        let isUnmounted = false;

        const connect = () => {
            if (isUnmounted) return;

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                if (isUnmounted) {
                    ws.close();
                    return;
                }
                console.log('WebSocket connected');
                addLog({ timestamp: Date.now(), level: 'info', tag: 'SYSTEM', message: 'WebSocket connected' });
            };

            ws.onmessage = (event) => {
                if (isUnmounted) return;
                try {
                    const { type, data } = JSON.parse(event.data);

                    switch (type) {
                        case 'status':
                            setConnectionStatus(data);
                            break;
                        case 'chat':
                            addMessage({
                                id: data.id || Date.now(),
                                from: data.from || 'remote', // Use 'from' if available
                                text: data.text,
                                timestamp: data.timestamp || new Date().toISOString()
                            });
                            break;
                        case 'progress':
                            updateTransfer(data.fileId, {
                                id: data.fileId,
                                name: data.file,
                                size: data.total ? (data.total / 1024).toFixed(1) + ' KB' : 'Unknown',
                                percent: data.percent,
                                direction: data.type === 'send' ? 'send' : 'receive'
                            });
                            break;
                        case 'complete':
                            updateTransfer(data.fileId, {
                                percent: 100,
                                status: 'done',
                                fullPath: data.fullPath
                            });
                            addLog({ timestamp: Date.now(), level: 'info', tag: 'FILE', message: `Transfer complete: ${data.file}` });
                            break;
                        case 'error':
                            addLog({ timestamp: Date.now(), level: 'error', tag: 'SYSTEM', message: data.message });
                            break;
                        case 'cancelled':
                            // Remove the cancelled transfer from the list
                            import('../store/appStore').then(module => {
                                const { removeTransfer } = useAppStore.getState();
                                removeTransfer(data.fileId);
                            });
                            addLog({ timestamp: Date.now(), level: 'warn', tag: 'FILE', message: `Transfer cancelled: ${data.fileId}` });
                            break;
                        default:
                            console.log('Unknown message type:', type);
                    }
                } catch (e) {
                    console.error('Failed to parse WebSocket message:', e);
                }
            };

            ws.onclose = () => {
                if (isUnmounted) return;

                console.log('WebSocket disconnected, reconnecting...');
                setConnectionStatus({ connected: false, port: null });
                addLog({ timestamp: Date.now(), level: 'warn', tag: 'SYSTEM', message: 'WebSocket disconnected' });
                reconnectTimer = setTimeout(connect, 3000);
            };

            ws.onerror = (err) => {
                if (isUnmounted) return;
                console.error('WebSocket error:', err);
            };
        };

        connect();

        return () => {
            isUnmounted = true;
            if (ws) {
                ws.onclose = null; // Prevent onclose from triggering
                ws.close();
            }
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [setConnectionStatus, addLog, addMessage, updateTransfer]);

    return null; // This component doesn't render anything
};

export default WebSocketService;
