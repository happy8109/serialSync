import React from 'react';
import useAppStore from '../../store/appStore';
import TransferItem from './TransferItem';
import Dropzone from './Dropzone';

const TransferList = () => {
    const { transfers, updateTransfer, removeTransfer } = useAppStore();

    const handleFileSelect = async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/send/file', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (data.success) {
                // Transfer started successfully, backend will send progress updates via WebSocket
                // We can add a temporary placeholder here if needed, but WebSocket should be fast enough
                console.log('File upload started:', data.fileId);
            } else {
                console.error('File upload failed:', data.error);
                alert('文件发送失败: ' + data.error);
            }
        } catch (err) {
            console.error('File upload error:', err);
            alert('文件发送出错: ' + err.message);
        }
    };

    const handlePause = async (id) => {
        try {
            await fetch(`/api/transfer/${id}/pause`, { method: 'POST' });
            updateTransfer(id, { status: 'paused' });
        } catch (err) {
            console.error('Failed to pause:', err);
        }
    };

    const handleResume = async (id) => {
        try {
            await fetch(`/api/transfer/${id}/resume`, { method: 'POST' });
            updateTransfer(id, { status: 'sending' });
        } catch (err) {
            console.error('Failed to resume:', err);
        }
    };

    const handleCancel = async (id) => {
        try {
            await fetch(`/api/transfer/${id}/cancel`, { method: 'POST' });
            // updateTransfer(id, { status: 'error' }); // No longer needed as we remove it
            removeTransfer(id);
        } catch (err) {
            console.error('Failed to cancel:', err);
        }
    };

    const handleOpen = async (path) => {
        try {
            await fetch('/api/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
        } catch (err) {
            console.error('Failed to open file:', err);
        }
    };

    return (
        <div className="flex flex-col h-full p-6 gap-6 overflow-hidden">
            <div className="flex-none">
                <h2 className="text-xl font-bold mb-4">文件传输</h2>
                <Dropzone onFileSelect={handleFileSelect} />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">传输列表</h3>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                    {transfers.length === 0 && (
                        <div className="text-center text-muted-foreground py-10 border border-dashed border-border rounded-md">
                            暂无活动传输
                        </div>
                    )}
                    {transfers.map(t => (
                        <TransferItem
                            key={t.id}
                            transfer={t}
                            onPause={handlePause}
                            onResume={handleResume}
                            onCancel={handleCancel}
                            onOpen={handleOpen}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TransferList;
