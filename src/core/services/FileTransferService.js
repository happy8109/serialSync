/**
 * FileTransferService.js - 核心传输引擎
 * 职责：负责大文件的切片、可靠重传、滑动窗口控制。
 * 不负责：不负责决定文件存哪，不负责策略，只负责执行。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { logger } = require('../../utils/logger');
const bridgeLogger = logger.create('FileService');

const TYPE = {
    FILE_OFFER: 0x20,
    FILE_ACCEPT: 0x21,
    FILE_CHUNK: 0x22,
    FILE_ACK: 0x23,
    FILE_FIN: 0x24,
    FILE_FIN_ACK: 0x25
};

class FileTransferService extends EventEmitter {
    constructor(options = {}) {
        super();
        this.scheduler = null;
        this.sendSessions = new Map(); // fileId -> session
        this.recvSessions = new Map(); // fileId -> session

        this.chunkSize = options.chunkSize || 1024;
        this.windowSize = options.windowSize || 50;
        this.savePath = options.savePath || path.join(process.cwd(), 'received');
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    setConfig(config) {
        if (!config) return;
        if (config.chunkSize) this.chunkSize = config.chunkSize;
        if (config.windowSize) this.windowSize = config.windowSize;
        if (config.savePath) this.savePath = config.savePath;
        bridgeLogger.info(`Config updated: chunkSize=${this.chunkSize}, windowSize=${this.windowSize}`);
    }

    getInterestedTypes() { return Object.values(TYPE); }

    handleFrame(frame) {
        switch (frame.type) {
            case TYPE.FILE_OFFER: this._handleOffer(frame); break;
            case TYPE.FILE_ACCEPT: this._handleAccept(frame); break;
            case TYPE.FILE_CHUNK: this._handleChunk(frame); break;
            case TYPE.FILE_ACK: this._handleAck(frame); break;
            case TYPE.FILE_FIN: this._handleFin(frame); break;
            case TYPE.FILE_FIN_ACK: this._handleFinAck(frame); break;
        }
    }

    /**
     * 发起一个文件传输任务
     */
    async sendFile(filePath, priority = 2, meta = {}) {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const stats = fs.statSync(filePath);
        const fileId = crypto.randomUUID();
        const totalChunks = Math.ceil(stats.size / this.chunkSize);

        const fileHash = await new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            stream.on('data', d => hash.update(d));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', e => reject(e));
        });

        this.sendSessions.set(fileId, {
            id: fileId, filePath, fileSize: stats.size, totalChunks, priority,
            windowStart: 0, inflight: new Set(), status: 'offering', fd: null,
            meta, startTime: Date.now(), lastChunks: 0, lastSpeedTime: Date.now(), speed: 0
        });

        this._sendJson(TYPE.FILE_OFFER, {
            id: fileId, name: path.basename(filePath), size: stats.size,
            chunks: totalChunks, hash: fileHash, priority, meta
        }, 1);

        bridgeLogger.info(`Offer sent: ${path.basename(filePath)} (${fileId.substring(0, 8)})`);
        return fileId;
    }

    cancel(fileId) {
        if (this.sendSessions.has(fileId)) {
            const s = this.sendSessions.get(fileId);
            if (s.fd) try { fs.closeSync(s.fd); } catch (e) { }
            this.sendSessions.delete(fileId);
            this._sendJson(TYPE.FILE_FIN, { id: fileId, error: 'cancelled' }, 1);
        } else if (this.recvSessions.has(fileId)) {
            const s = this.recvSessions.get(fileId);
            if (s.fd) try { fs.closeSync(s.fd); } catch (e) { }
            try {
                if (fs.existsSync(s.partPath)) fs.unlinkSync(s.partPath);
                if (fs.existsSync(s.metaPath)) fs.unlinkSync(s.metaPath);
            } catch (e) { }
            this.recvSessions.delete(fileId);
            this._sendJson(TYPE.FILE_FIN, { id: fileId, error: 'cancelled' }, 1);
        }
        this.emit('cancelled', { fileId });
    }

    _handleOffer(frame) {
        const offer = JSON.parse(frame.body.toString());
        const offerEvent = { ...offer, handled: false, customSaveDir: null };
        this.emit('offer', offerEvent);

        // 如果是背景同步但无人接手，直接拒绝，不产生任何临时文件
        if (offer.meta?.shareId && !offerEvent.handled) {
            this._sendJson(TYPE.FILE_FIN, { id: offer.id, error: 'rejected' }, 1);
            return;
        }

        const saveDir = offerEvent.customSaveDir || this.savePath;
        const finalPath = path.join(saveDir, offer.name);
        const partPath = finalPath + '.part';
        const metaPath = finalPath + '.meta';

        // 确保目录存在
        if (!fs.existsSync(path.dirname(finalPath))) {
            fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        }

        // 重复 Offer 检测 (鲁棒性：可能上次 FIN 丢了)
        for (const [id, s] of this.recvSessions.entries()) {
            if (s.savePath === finalPath) {
                if (s.hash === offer.hash) {
                    this._sendAck(s); // 重新抖动发端
                    return;
                }
                this.cancel(id); // 覆盖旧的非同质任务
                break;
            }
        }

        let receivedBitmap = new Set();
        let receivedChunks = 0;
        let isResume = false;
        if (fs.existsSync(metaPath) && fs.existsSync(partPath)) {
            try {
                const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                if (m.hash === offer.hash) {
                    receivedBitmap = new Set(m.bitmap);
                    receivedChunks = receivedBitmap.size;
                    isResume = true;
                }
            } catch (e) { }
        }

        const fd = fs.openSync(partPath, isResume ? 'r+' : 'w');
        this.recvSessions.set(offer.id, {
            ...offer, savePath: finalPath, partPath, metaPath, fd, receivedBitmap, receivedChunks,
            isHidden: !!offerEvent.handled || !!offer.meta?.isHidden,
            startTime: Date.now(), lastSpeedTime: Date.now(), lastChunks: receivedChunks, speed: 0
        });

        let nextSeq = 0;
        while (receivedBitmap.has(nextSeq)) nextSeq++;
        this._sendJson(TYPE.FILE_ACCEPT, { id: offer.id, nextSeq }, 1);
    }

    _handleAccept(frame) {
        const data = JSON.parse(frame.body.toString());
        const s = this.sendSessions.get(data.id);
        if (!s) return;
        s.status = 'sending';
        s.windowStart = data.nextSeq;
        if (s.fd) try { fs.closeSync(s.fd); } catch (e) { }
        s.fd = fs.openSync(s.filePath, 'r');
        this._sendWindow(s);
    }

    _sendWindow(s) {
        if (s.status !== 'sending') return;
        for (let i = 0; i < this.windowSize; i++) {
            const seq = s.windowStart + i;
            if (seq >= s.totalChunks) break;
            if (s.inflight.has(seq)) continue;

            const buf = Buffer.alloc(this.chunkSize);
            const n = fs.readSync(s.fd, buf, 0, this.chunkSize, seq * this.chunkSize);
            const chunk = n < this.chunkSize ? buf.slice(0, n) : buf;

            const idBuf = Buffer.from(s.id.replace(/-/g, ''), 'hex');
            const seqBuf = Buffer.alloc(4);
            seqBuf.writeUInt32BE(seq);

            this.scheduler.enqueue(TYPE.FILE_CHUNK, 0, Buffer.concat([idBuf, seqBuf, chunk]), s.priority);
            s.inflight.add(seq);
        }
    }

    _handleChunk(frame) {
        if (frame.body.length < 20) return;
        const id = [
            frame.body.slice(0, 4).toString('hex'), frame.body.slice(4, 6).toString('hex'),
            frame.body.slice(6, 8).toString('hex'), frame.body.slice(8, 10).toString('hex'),
            frame.body.slice(10, 16).toString('hex')
        ].join('-');
        const seq = frame.body.readUInt32BE(16);
        const data = frame.body.slice(20);

        const s = this.recvSessions.get(id);
        if (!s || s.receivedBitmap.has(seq)) return;

        fs.writeSync(s.fd, data, 0, data.length, seq * this.chunkSize);
        s.receivedBitmap.add(seq);
        s.receivedChunks++;

        if (s.receivedChunks % 20 === 0 || s.receivedChunks === s.totalChunks) {
            fs.writeFileSync(s.metaPath, JSON.stringify({ hash: s.hash, bitmap: Array.from(s.receivedBitmap) }));
        }

        this.emit('progress', {
            fileId: id, type: 'receive', file: s.name, current: s.receivedChunks, total: s.chunks,
            percent: Math.round(s.receivedChunks / s.chunks * 100), status: 'receiving', isHidden: s.isHidden
        });

        if (s.receivedChunks === s.chunks) this._sendAck(s);
    }

    _sendAck(s) {
        let max = 0;
        while (s.receivedBitmap.has(max)) max++;
        this._sendJson(TYPE.FILE_ACK, { id: s.id, nextSeq: max }, 1);
    }

    _handleAck(frame) {
        const ack = JSON.parse(frame.body.toString());
        const s = this.sendSessions.get(ack.id);
        if (!s) return;
        if (ack.nextSeq > s.windowStart) {
            for (let i = s.windowStart; i < ack.nextSeq; i++) s.inflight.delete(i);
            s.windowStart = ack.nextSeq;
        }
        if (s.windowStart >= s.totalChunks) {
            this._sendJson(TYPE.FILE_FIN, { id: s.id }, 1);
            s.status = 'completing';
            return;
        }
        this._sendWindow(s);
    }

    async _handleFin(frame) {
        const data = JSON.parse(frame.body.toString());
        if (data.error) { this.cancel(data.id); return; }
        const s = this.recvSessions.get(data.id);
        if (!s) return;

        fs.closeSync(s.fd);
        try {
            const actual = await this._calcHash(s.partPath);
            if (actual !== s.hash) throw new Error("Hash Mismatch");

            if (fs.existsSync(s.savePath)) fs.unlinkSync(s.savePath);
            fs.renameSync(s.partPath, s.savePath);
            if (fs.existsSync(s.metaPath)) fs.unlinkSync(s.metaPath);

            this.emit('complete', { fileId: s.id, type: 'receive', file: s.name, fullPath: s.savePath, isHidden: s.isHidden });
            if (s.isHidden) this.emit('system_log', `[背景同步] 成功落地: ${s.name} -> ${s.savePath}`);

            // 关键：回复 FIN_ACK
            this._sendJson(TYPE.FILE_FIN_ACK, { id: s.id }, 1);
        } catch (e) {
            bridgeLogger.error(`Finalize failed: ${s.name} - ${e.message}`);
            this.cancel(s.id);
        }
        this.recvSessions.delete(data.id);
    }

    _handleFinAck(frame) {
        const data = JSON.parse(frame.body.toString());
        const s = this.sendSessions.get(data.id);
        if (s) {
            this.emit('complete', { fileId: s.id, type: 'send', file: path.basename(s.filePath), isHidden: s.meta?.isHidden });
            if (s.fd) try { fs.closeSync(s.fd); } catch (e) { }
            this.sendSessions.delete(data.id);
            bridgeLogger.info(`Transfer finished & verified: ${data.id}`);
        }
    }

    _calcHash(p) {
        return new Promise((resolve, reject) => {
            const h = crypto.createHash('md5');
            const stream = fs.createReadStream(p);
            stream.on('data', d => h.update(d));
            stream.on('end', () => resolve(h.digest('hex')));
            stream.on('error', e => reject(e));
        });
    }

    _sendJson(type, data, priority = 2) {
        if (this.scheduler) this.scheduler.enqueue(type, 0, Buffer.from(JSON.stringify(data)), priority);
    }

    getActiveTransferCount(meta = {}) {
        let count = 0;
        const scan = (map) => {
            for (const s of map.values()) {
                let match = true;
                for (const [k, v] of Object.entries(meta)) {
                    if (String(s.meta?.[k]).toLowerCase() !== String(v).toLowerCase()) { match = false; break; }
                }
                if (match) count++;
            }
        };
        scan(this.sendSessions); scan(this.recvSessions);
        return count;
    }
}

module.exports = FileTransferService;
