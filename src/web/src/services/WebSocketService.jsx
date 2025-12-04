import { useEffect } from 'react';
import useAppStore from '../store/appStore';

const WebSocketService = () => {
    const { setConnectionStatus, addLog, addMessage, updateTransfer } = useAppStore();

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        let ws;
        let reconnectTimer;

        const connect = () => {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('WebSocket connected');
                addLog({ timestamp: Date.now(), level: 'info', tag: 'SYSTEM', message: 'WebSocket connected' });
            };

            ws.onmessage = (event) => {
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
                                speed: 'Calculating...',
                                direction: data.type === 'send' ? 'send' : 'receive'
                            });
                            break;
                        case 'complete':
                            updateTransfer(data.fileId, {
                                percent: 100,
                                status: 'done'
                            });
                            addLog({ timestamp: Date.now(), level: 'info', tag: 'FILE', message: `Transfer complete: ${data.file}` });
                            break;
                        case 'error':
                            addLog({ timestamp: Date.now(), level: 'error', tag: 'SYSTEM', message: data.message });
                            break;
                        default:
                            console.log('Unknown message type:', type);
                    }
                } catch (e) {
                    console.error('Failed to parse WebSocket message:', e);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected, reconnecting...');
                setConnectionStatus({ isConnected: false, port: null });
                addLog({ timestamp: Date.now(), level: 'warn', tag: 'SYSTEM', message: 'WebSocket disconnected' });
                reconnectTimer = setTimeout(connect, 3000);
            };

            ws.onerror = (err) => {
                console.error('WebSocket error:', err);
            };
        };

        connect();

        return () => {
            if (ws) ws.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [setConnectionStatus, addLog, addMessage, updateTransfer]);

    return null; // This component doesn't render anything
};

export default WebSocketService;
