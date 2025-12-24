/**
 * FileTransferService.js
 * 负责文件传输 (P2/P3)
 * 实现协议：FILE_OFFER -> FILE_ACCEPT -> FILE_CHUNK... -> FILE_ACK -> FILE_FIN
 * 改进：增加基于窗口的流控和重传机制
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../../utils/logger');

const bridgeLogger = logger.create('FileService');

// 包类型定义
const TYPE = {
    FILE_OFFER: 0x20,
    FILE_ACCEPT: 0x21,
    FILE_CHUNK: 0x22,
    FILE_ACK: 0x23,
    FILE_FIN: 0x24
};

class FileTransferService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;

        // 发送会话: { fileId: { filePath, fileSize, totalChunks, windowStart, inflight, status, fd } }
        this.sendSessions = new Map();

        // 接收会话: { fileName, fileSize, totalChunks, receivedBitmap, savePath, fd, lastAckTime } }
        this.recvSessions = new Map();

        this.chunkSize = 1024; // 1KB
        this.windowSize = 50;  // 窗口大小
        this.savePath = path.join(process.cwd(), 'received'); // Default
        this.conflictStrategy = 'rename'; // 'rename' | 'overwrite' | 'skip'
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    /**
     * 动态更新配置
     * @param {Object} config { chunkSize, windowSize, savePath, conflictStrategy }
     */
    setConfig(config) {
        if (config.chunkSize) {
            this.chunkSize = config.chunkSize;
            bridgeLogger.info(`Config updated: chunkSize = ${this.chunkSize}`);
        }
        if (config.windowSize) {
            this.windowSize = config.windowSize;
            bridgeLogger.info(`Config updated: windowSize = ${this.windowSize}`);
        }
        if (config.savePath) {
            // resolve relative paths
            this.savePath = path.isAbsolute(config.savePath)
                ? config.savePath
                : path.join(process.cwd(), config.savePath);
            bridgeLogger.info(`Config updated: savePath = ${this.savePath}`);
        }
        if (config.conflictStrategy) {
            this.conflictStrategy = config.conflictStrategy;
            bridgeLogger.info(`Config updated: conflictStrategy = ${this.conflictStrategy}`);
        }
    }

    getInterestedTypes() {
        return Object.values(TYPE);
    }

    handleFrame(frame) {
        switch (frame.type) {
            case TYPE.FILE_OFFER:
                this._handleOffer(frame);
                break;
            case TYPE.FILE_ACCEPT:
                this._handleAccept(frame);
                break;
            case TYPE.FILE_CHUNK:
                this._handleChunk(frame);
                break;
            case TYPE.FILE_ACK:
                this._handleAck(frame);
                break;
            case TYPE.FILE_FIN:
                this._handleFin(frame);
                break;
        }
    }

    /**
     * 发送文件
     * @param {string} filePath 
     */
    async sendFile(filePath) {
        if (!fs.existsSync(filePath)) throw new Error('File not found');

        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const fileId = crypto.randomUUID();
        const totalChunks = Math.ceil(stats.size / this.chunkSize);

        // 计算文件 Hash (MD5) - 用于断点续传校验
        const fileBuffer = fs.readFileSync(filePath);
        const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

        // 创建发送会话
        this.sendSessions.set(fileId, {
            fileId,
            filePath,
            fileSize: stats.size,
            totalChunks,
            windowStart: 0,
            inflight: new Set(), // 已发送但未确认的 seq
            startTime: Date.now(),
            fd: null, // 将在 accept 后打开
            lastChunks: 0,
            lastSpeedTime: Date.now(),
            speed: 0
        });

        // 发送 FILE_OFFER
        const offer = {
            id: fileId,
            name: fileName,
            size: stats.size,
            chunks: totalChunks,
            hash: fileHash
        };

        this._sendJson(TYPE.FILE_OFFER, offer);
        bridgeLogger.info(`Sending file: ${fileName} (${(stats.size / 1024).toFixed(1)} KB) Hash: ${fileHash.substring(0, 6)}...`);

        return fileId;
    }

    pause(fileId) {
        const session = this.sendSessions.get(fileId);
        if (session) {
            session.status = 'paused';
            bridgeLogger.info(`Paused transfer for ${fileId}`);
            this.emit('progress', {
                fileId: session.fileId,
                type: session.fd === null ? 'receive' : 'send', // Determine type by fd presence
                file: session.filePath ? path.basename(session.filePath) : session.name,
                percent: Math.round((session.windowStart || session.receivedChunks || 0) / (session.totalChunks || 1) * 100),
                status: 'paused'
            });
            return true;
        }
        return false;
    }

    resume(fileId) {
        const session = this.sendSessions.get(fileId);
        if (session && session.status === 'paused') {
            session.status = 'sending';
            bridgeLogger.info(`Resumed transfer for ${fileId}`);
            this.emit('progress', {
                fileId: session.fileId,
                type: 'send',
                file: path.basename(session.filePath),
                percent: Math.round(session.windowStart / session.totalChunks * 100),
                status: 'sending'
            });
            this._sendWindow(session);
            return true;
        }
        return false;
    }

    cancel(fileId) {
        let success = false;
        // Check sending sessions
        if (this.sendSessions.has(fileId)) {
            const session = this.sendSessions.get(fileId);
            if (session.fd) {
                try { fs.closeSync(session.fd); } catch (e) { }
            }
            this.sendSessions.delete(fileId);
            // Send FIN
            this._sendJson(TYPE.FILE_FIN, { id: fileId, error: 'cancelled' });
            bridgeLogger.info(`Cancelled sending ${fileId}`);
            success = true;
        }
        // Check receiving sessions
        else if (this.recvSessions.has(fileId)) {
            const session = this.recvSessions.get(fileId);
            if (session.fd) {
                try { fs.closeSync(session.fd); } catch (e) { }
            }
            // Cleanup temp files
            try {
                if (fs.existsSync(session.savePath)) fs.unlinkSync(session.savePath);
                if (fs.existsSync(session.metaPath)) fs.unlinkSync(session.metaPath);
            } catch (e) { }
            this.recvSessions.delete(fileId);

            // Send FIN
            this._sendJson(TYPE.FILE_FIN, { id: fileId, error: 'cancelled' });
            bridgeLogger.info(`Cancelled receiving ${fileId}`);
            success = true;
        }

        if (success) {
            this.emit('cancelled', { fileId });
            return true;
        }
        return false;
    }

    // --- 内部处理逻辑 ---

    _handleOffer(frame) {
        const offer = JSON.parse(frame.body.toString());
        bridgeLogger.info(`Receiving file: ${offer.name} (${(offer.size / 1024).toFixed(1)} KB)`);

        const saveDir = this.savePath;
        if (!fs.existsSync(saveDir)) {
            try {
                fs.mkdirSync(saveDir, { recursive: true });
            } catch (err) {
                bridgeLogger.error(`Failed to create save directory: ${saveDir}`, err);
                return;
            }
        }

        const savePath = path.join(saveDir, offer.name);

        // Resolve conflict
        let finalPath = savePath;
        if (fs.existsSync(savePath)) {
            if (this.conflictStrategy === 'overwrite') {
                // Do nothing, will overwrite
                bridgeLogger.info(`File exists, overwriting: ${offer.name}`);
            } else if (this.conflictStrategy === 'skip') {
                bridgeLogger.warn(`File exists, skipping: ${offer.name}`);
                // TODO: Send skip reject? For now just ignore
                return;
            } else {
                // Rename (default)
                const ext = path.extname(offer.name);
                const base = path.basename(offer.name, ext);
                let counter = 1;
                while (fs.existsSync(finalPath)) {
                    finalPath = path.join(saveDir, `${base}_${counter}${ext}`);
                    counter++;
                }
                bridgeLogger.info(`File exists, renaming to: ${path.basename(finalPath)}`);
            }
        }

        const partPath = finalPath + '.part';
        const metaPath = finalPath + '.meta';

        // Check for collision with existing sessions
        for (const [id, session] of this.recvSessions.entries()) {
            if (session.savePath === savePath) {
                bridgeLogger.warn(`Collision detected: ${offer.name} is already being received (session ${id}). Cancelling old session.`);
                this.cancel(id); // Force cancel the old session to release the file lock
                break;
            }
        }

        let receivedBitmap = new Set();
        let receivedChunks = 0;
        let isResume = false;

        // 检查是否存在断点信息
        if (fs.existsSync(metaPath) && fs.existsSync(savePath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                if (meta.hash === offer.hash && meta.size === offer.size) {
                    receivedBitmap = new Set(meta.bitmap);
                    receivedChunks = receivedBitmap.size;
                    isResume = true;
                    bridgeLogger.info(`Resuming transfer for ${offer.name}, progress: ${(receivedChunks / offer.chunks * 100).toFixed(1)}%`);
                }
            } catch (e) {
                bridgeLogger.warn('Failed to read meta file, starting fresh');
            }
        }

        let fd;
        try {
            // 始终写入 .part 文件
            if (isResume) {
                fd = fs.openSync(partPath, 'r+');
            } else {
                fd = fs.openSync(partPath, 'w');
            }
        } catch (err) {
            bridgeLogger.error(`Failed to open file for writing: ${partPath}`, err);
            return;
        }

        this.recvSessions.set(offer.id, {
            id: offer.id,
            name: offer.name,
            size: offer.size,
            totalChunks: offer.chunks,
            receivedChunks,
            savePath: finalPath, // 使用解析冲突后的最终路径
            partPath,
            metaPath,
            hash: offer.hash,
            fd,
            receivedBitmap,
            lastAckTime: 0,
            lastPercent: -1,
            lastChunks: 0,
            lastSpeedTime: Date.now(),
            speed: 0
        });

        let nextSeq = 0;
        while (receivedBitmap.has(nextSeq)) {
            nextSeq++;
        }

        this._sendJson(TYPE.FILE_ACCEPT, {
            id: offer.id,
            accepted: true,
            nextSeq: nextSeq
        });
    }

    _handleAccept(frame) {
        const resp = JSON.parse(frame.body.toString());
        if (!resp.accepted) {
            bridgeLogger.warn(`Offer rejected for ${resp.id}`);
            this.sendSessions.delete(resp.id);
            return;
        }

        const session = this.sendSessions.get(resp.id);
        if (!session) return;

        bridgeLogger.info(`Offer accepted, starting transfer...`, { fileId: resp.id });

        session.fd = fs.openSync(session.filePath, 'r');

        if (resp.nextSeq && resp.nextSeq > 0) {
            session.windowStart = resp.nextSeq;
            bridgeLogger.info(`Resuming from chunk ${resp.nextSeq}`);
        }

        this._sendWindow(session);
    }

    _sendWindow(session) {
        if (session.status === 'paused') return;
        const limit = Math.min(session.totalChunks, session.windowStart + this.windowSize);

        for (let seq = session.windowStart; seq < limit; seq++) {
            if (!session.inflight.has(seq)) {
                this._sendChunk(session, seq);
                session.inflight.add(seq);
            }
        }

        // 计算速度
        const now = Date.now();
        const timeDiff = (now - session.lastSpeedTime) / 1000;
        if (timeDiff >= 1) {
            const chunksDiff = session.windowStart - session.lastChunks;
            session.speed = Math.floor((chunksDiff * this.chunkSize) / timeDiff);
            session.lastChunks = session.windowStart;
            session.lastSpeedTime = now;
        }

        // 发送进度事件
        const percent = Math.round(session.windowStart / session.totalChunks * 100);
        this.emit('progress', {
            fileId: session.fileId,
            type: 'send',
            file: path.basename(session.filePath),
            current: session.windowStart,
            total: session.totalChunks,
            percent: percent,
            speed: session.speed,
            status: 'sending'
        });
    }

    _sendChunk(session, seq) {
        const buffer = Buffer.alloc(this.chunkSize);
        const position = seq * this.chunkSize;
        const bytesRead = fs.readSync(session.fd, buffer, 0, this.chunkSize, position);
        const chunkData = buffer.slice(0, bytesRead);

        const idBuf = Buffer.from(session.fileId);
        const payload = Buffer.concat([idBuf, chunkData]);

        this.scheduler.enqueue(TYPE.FILE_CHUNK, seq, payload, 2);
    }

    _handleChunk(frame) {
        if (frame.body.length <= 36) return;

        const fileId = frame.body.slice(0, 36).toString();
        const data = frame.body.slice(36);

        const session = this.recvSessions.get(fileId);
        if (!session) return;

        const position = frame.seq * this.chunkSize;
        fs.writeSync(session.fd, data, 0, data.length, position);

        if (!session.receivedBitmap.has(frame.seq)) {
            session.receivedBitmap.add(frame.seq);
            session.receivedChunks++;
        }

        if (session.receivedChunks % 20 === 0 || session.receivedChunks === session.totalChunks) {
            this._sendAck(session);
            try {
                const meta = {
                    hash: session.hash,
                    size: session.size,
                    bitmap: Array.from(session.receivedBitmap)
                };
                fs.writeFileSync(session.metaPath, JSON.stringify(meta));
            } catch (e) { }
        }

        // 计算并发送进度
        const now = Date.now();
        const timeDiff = (now - session.lastSpeedTime) / 1000;
        if (timeDiff >= 1) {
            const chunksDiff = session.receivedChunks - session.lastChunks;
            session.speed = Math.floor((chunksDiff * this.chunkSize) / timeDiff);
            session.lastChunks = session.receivedChunks;
            session.lastSpeedTime = now;
        }

        const percent = Math.round(session.receivedChunks / session.totalChunks * 100);
        if (percent !== session.lastPercent || now - session.lastSpeedTime < 100) { // 保证最后100%也能发出去
            session.lastPercent = percent;
            this.emit('progress', {
                fileId: session.id,
                type: 'receive',
                file: session.name,
                current: session.receivedChunks,
                total: session.totalChunks,
                percent: percent,
                speed: session.speed,
                status: 'receiving'
            });
        }

        if (session.receivedChunks === session.totalChunks) {
            // 已攒齐分片，等待 FIN 包进行重命名
            this._sendAck(session);
        }
    }

    _sendAck(session) {
        let maxContinuous = 0;
        while (session.receivedBitmap.has(maxContinuous)) {
            maxContinuous++;
        }

        const ackData = {
            id: session.id,
            nextSeq: maxContinuous
        };

        this._sendJson(TYPE.FILE_ACK, ackData);
    }

    _handleAck(frame) {
        const ack = JSON.parse(frame.body.toString());
        const session = this.sendSessions.get(ack.id);
        if (!session) return;

        if (ack.nextSeq > session.windowStart) {
            for (let i = session.windowStart; i < ack.nextSeq; i++) {
                session.inflight.delete(i);
            }
            session.windowStart = ack.nextSeq;
        }

        if (session.windowStart >= session.totalChunks) {
            bridgeLogger.info(`File transfer complete: ${session.filePath}`);
            this.emit('complete', {
                fileId: session.fileId,
                type: 'send',
                file: path.basename(session.filePath),
                fullPath: session.filePath
            });
            this._sendJson(TYPE.FILE_FIN, { id: session.fileId });
            fs.closeSync(session.fd);
            this.sendSessions.delete(session.fileId);
            return;
        }

        this._sendWindow(session);
    }

    _handleFin(frame) {
        const req = JSON.parse(frame.body.toString());
        if (req.error === 'cancelled') {
            this.cancel(req.id);
            return;
        }
        const session = this.recvSessions.get(req.id);
        if (!session) return;

        fs.closeSync(session.fd);

        const finalPath = session.savePath;
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);

        try {
            fs.renameSync(session.partPath, finalPath);

            // 只有在重命名成功（文件真正就绪）后才发送 complete 事件
            this.emit('complete', {
                fileId: session.id,
                type: 'receive',
                file: session.name,
                fullPath: finalPath
            });

            if (fs.existsSync(session.metaPath)) {
                fs.unlinkSync(session.metaPath);
            }
        } catch (err) {
            bridgeLogger.error(`Failed to finalize file: ${session.name}`, err);
        }

        this.recvSessions.delete(req.id);
    }

    _sendJson(type, data) {
        const body = Buffer.from(JSON.stringify(data));
        this.scheduler.enqueue(type, 0, body, 1);
    }
}

module.exports = FileTransferService;
