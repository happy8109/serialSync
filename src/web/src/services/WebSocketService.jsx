import { useEffect } from 'react';
import useAppStore from '../store/appStore';

const WebSocketService = () => {
    const { setConnectionStatus, addLog, addMessage, updateTransfer, setDiscoveredShares } = useAppStore();

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
                        case 'status': {
                            const oldConnected = useAppStore.getState().isConnected;
                            const newConnected = data.connected;
                            setConnectionStatus(data);

                            if (oldConnected !== null && oldConnected !== newConnected) {
                                addLog({
                                    timestamp: Date.now(),
                                    level: 'info',
                                    tag: 'SYSTEM',
                                    message: newConnected ? `串口已连接: ${data.port}` : '串口已断开'
                                });
                            }
                            break;
                        }
                        case 'chat':
                            addMessage({
                                id: data.id || `msg_${Date.now()}`,
                                from: data.from || 'remote',
                                type: 'text',
                                text: data.text,
                                timestamp: data.timestamp || new Date().toISOString()
                            });
                            break;
                        case 'log':
                            addLog(data);
                            break;
                        case 'progress': {
                            // Sync tasks are marked as 'isHidden'
                            if (data.isHidden) {
                                // Only update transfer store for sync tasks (optional, maybe we don't even want them in the transfer list?)
                                // For now, let's keep them in the store but flagged, so components can filter them out.
                                updateTransfer(data.fileId, {
                                    id: data.fileId,
                                    name: data.file,
                                    size: data.size,
                                    progress: data.percent,
                                    speed: data.speed || 0,
                                    status: data.status || (data.type === 'send' ? 'sending' : 'receiving'),
                                    direction: data.type === 'send' ? 'send' : 'receive',
                                    isHidden: true // Propagate hidden flag
                                });
                                break; // Skip chat message creation
                            }

                            const isNew = !useAppStore.getState().transfers.some(t => t.id === data.fileId);
                            const direction = data.type === 'send' ? 'send' : 'receive';

                            updateTransfer(data.fileId, {
                                id: data.fileId,
                                name: data.file,
                                size: data.size, // Use byte size instead of chunk count
                                progress: data.percent,
                                speed: data.speed || 0,
                                status: data.status || (direction === 'send' ? 'sending' : 'receiving'),
                                direction
                            });

                            // 如果是新任务且是接收到的，自动添加到聊天记录
                            if (isNew) {
                                // Log the start of the transfer
                                addLog({
                                    timestamp: Date.now(),
                                    level: 'info',
                                    tag: 'FILE',
                                    message: `Started ${direction}: ${data.file} (${(data.size / 1024).toFixed(1)} KB)`
                                });

                                if (direction === 'receive') {
                                    addMessage({
                                        id: `msg_${data.fileId}`,
                                        from: 'remote',
                                        type: 'file',
                                        content: data.file,
                                        transferId: data.fileId,
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            }
                            break;
                        }
                        case 'complete':
                            updateTransfer(data.fileId, {
                                progress: 100,
                                speed: 0,
                                status: 'completed',
                                fullPath: data.fullPath
                            });
                            addLog({ timestamp: Date.now(), level: 'info', tag: 'FILE', message: `Transfer complete: ${data.file}` });
                            break;
                        case 'error':
                            if (data.fileId) {
                                updateTransfer(data.fileId, {
                                    status: 'failed',
                                    error: data.message
                                });
                            }
                            addLog({ timestamp: Date.now(), level: 'error', tag: 'SYSTEM', message: data.message });
                            break;
                        case 'cancelled':
                            updateTransfer(data.fileId, {
                                status: 'failed',
                                error: '已取消'
                            });
                            addLog({ timestamp: Date.now(), level: 'warn', tag: 'FILE', message: `Transfer cancelled: ${data.fileId}` });
                            break;
                        case 'sync_discovery':
                            setDiscoveredShares(data);
                            addLog({
                                timestamp: Date.now(),
                                level: 'info',
                                tag: 'SYNC',
                                message: `Discovered ${Object.keys(data).length} remote shares`
                            });
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
