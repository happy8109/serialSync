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
        this.windowSize = options.windowSize || 10;
        this.savePath = options.savePath || path.join(process.cwd(), 'received');
        this.conflictStrategy = options.conflictStrategy || 'rename';
        this.timeout = options.timeout || 10000; // 默认 10 秒

        // Watchdog: 2秒检查一次超时重传
        setInterval(() => this._watchdog(), 2000);
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    setConfig(config) {
        if (!config) return;
        if (config.chunkSize) this.chunkSize = config.chunkSize;
        if (config.windowSize) this.windowSize = config.windowSize;
        if (config.savePath) this.savePath = config.savePath;
        if (config.conflictStrategy) this.conflictStrategy = config.conflictStrategy;
        if (config.timeout) this.timeout = config.timeout;
        bridgeLogger.info(`Config updated: chunkSize=${this.chunkSize}, windowSize=${this.windowSize}, strategy=${this.conflictStrategy}, timeout=${this.timeout}`);
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

    pause(fileId) {
        if (this.sendSessions.has(fileId)) {
            const s = this.sendSessions.get(fileId);
            s.status = 'paused';
            bridgeLogger.info(`Transfer paused (send): ${fileId}`);
            this.emit('progress', {
                fileId, type: 'send', file: path.basename(s.filePath),
                current: s.windowStart, total: s.totalChunks, size: s.fileSize,
                percent: Math.round(s.windowStart / s.totalChunks * 100),
                status: 'paused', isHidden: s.meta?.isHidden, speed: s.speed || 0
            });
        } else if (this.recvSessions.has(fileId)) {
            const s = this.recvSessions.get(fileId);
            s.status = 'paused';
            bridgeLogger.info(`Transfer paused (recv): ${fileId}`);
            this.emit('progress', {
                fileId, type: 'receive', file: s.name,
                current: s.receivedChunks, total: s.chunks, size: s.size,
                percent: Math.round(s.receivedChunks / s.chunks * 100),
                status: 'paused', isHidden: s.isHidden, speed: s.speed || 0
            });
        }
    }

    resume(fileId) {
        if (this.sendSessions.has(fileId)) {
            const s = this.sendSessions.get(fileId);
            if (s.status === 'paused') {
                s.status = 'sending';
                s.lastProgressTime = Date.now();
                bridgeLogger.info(`Transfer resumed (send): ${fileId}`);
                // 立即通知前端状态更新
                this.emit('progress', {
                    fileId, type: 'send', file: path.basename(s.filePath),
                    current: s.windowStart, total: s.totalChunks, size: s.fileSize,
                    percent: Math.round(s.windowStart / s.totalChunks * 100),
                    status: 'sending', isHidden: s.meta?.isHidden, speed: s.speed || 0
                });
                this._sendWindow(s); // 重新激活发送循环
            }
        } else if (this.recvSessions.has(fileId)) {
            const s = this.recvSessions.get(fileId);
            if (s.status === 'paused') {
                s.status = 'receiving';
                s.lastProgressTime = Date.now();
                bridgeLogger.info(`Transfer resumed (recv): ${fileId}`);
                // 立即通知前端状态更新
                this.emit('progress', {
                    fileId, type: 'receive', file: s.name,
                    current: s.receivedChunks, total: s.chunks, size: s.size,
                    percent: Math.round(s.receivedChunks / s.chunks * 100),
                    status: 'receiving', isHidden: s.isHidden, speed: s.speed || 0
                });
                this._sendAck(s); // 发送 ACK 唤醒发送端
            }
        }
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
        let fileName = offer.name;
        let finalPath = path.join(saveDir, fileName);

        // 解耦：在 Offer 阶段不再检查目标文件是否存在，也不执行重命名/跳过逻辑
        // 一律先接收到临时文件，等传输完成后在 _handleFin 中统一处理冲突落地
        bridgeLogger.info(`接收 Offer: ${fileName} -> ${finalPath} (Conflict check deferred)`);
        const partPath = finalPath + '.part';
        const metaPath = finalPath + '.meta';

        // 确保目录存在
        if (!fs.existsSync(path.dirname(finalPath))) {
            fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        }

        // 重复 Offer 检测
        for (const [id, s] of this.recvSessions.entries()) {
            if (s.savePath === finalPath) {
                // 如果 ID 相同，说明是同一个任务的重传（如握手阶段重试），回复 ACK 即可
                if (s.id === offer.id) {
                    bridgeLogger.info(`[重复Offer] ID相同，重发 ACK: ${id}`);
                    this._sendAck(s);
                    return;
                }
                // 如果 ID 不同，说明是新发起的任务（哪怕文件内容一样），直接覆盖旧任务
                // 这样能防止旧任务僵死导致新任务无法启动
                bridgeLogger.warn(`[冲突] 发现旧Session占用路径，强制清理: ${id} -> ${offer.id}`);
                this.cancel(id);
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
            startTime: Date.now(), lastSpeedTime: Date.now(), lastChunks: receivedChunks, speed: 0,
            lastProgressTime: Date.now(), ackTimer: null
        });

        let nextSeq = 0;
        while (receivedBitmap.has(nextSeq)) nextSeq++;
        bridgeLogger.info(`[Offer处理完毕] 准备发送 ACCEPT: ${offer.id}, NextSeq=${nextSeq}`);
        this._sendJson(TYPE.FILE_ACCEPT, { id: offer.id, nextSeq }, 1);
    }

    _handleAccept(frame) {
        const data = JSON.parse(frame.body.toString());
        const s = this.sendSessions.get(data.id);
        if (!s) return;
        s.status = 'sending';
        s.windowStart = data.nextSeq;
        s.lastProgressTime = Date.now();
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
        s.lastProgressTime = Date.now();

        if (s.receivedChunks % 20 === 0 || s.receivedChunks === s.totalChunks) {
            fs.writeFileSync(s.metaPath, JSON.stringify({ hash: s.hash, bitmap: Array.from(s.receivedBitmap) }));
        }

        this.emit('progress', {
            fileId: id, type: 'receive', file: s.name, current: s.receivedChunks, total: s.chunks,
            size: s.size, // 传输总字节数
            percent: Math.round(s.receivedChunks / s.chunks * 100), status: s.status, isHidden: s.isHidden,
            speed: this._updateSpeed(s, s.receivedChunks)
        });

        if (s.receivedChunks === s.chunks || s.receivedBitmap.size % this.windowSize === 0) {
            this._sendAck(s);
        } else {
            // 延迟 ACK：如果当前包不足以触发窗口确认，500ms 后强制确认
            if (s.ackTimer) clearTimeout(s.ackTimer);
            s.ackTimer = setTimeout(() => {
                if (this.recvSessions.has(id)) this._sendAck(s);
            }, 500);
        }
    }

    _sendAck(s) {
        if (s.ackTimer) { clearTimeout(s.ackTimer); s.ackTimer = null; }
        let nextSeq = 0;
        while (s.receivedBitmap.has(nextSeq)) nextSeq++;
        this._sendJson(TYPE.FILE_ACK, { id: s.id, nextSeq }, 1);
    }

    _handleAck(frame) {
        const ack = JSON.parse(frame.body.toString());
        const s = this.sendSessions.get(ack.id);
        if (!s) return;

        // 【关键修复】如果状态还是 offering 但收到了 ACK，说明对方已经接受了（ACCEPT包可能丢了）
        // 或者是重发 Offer 后对方回复了 ACK。直接提升状态为 sending。
        if (s.status === 'offering') {
            s.status = 'sending';
            s.windowStart = ack.nextSeq;
            s.lastProgressTime = Date.now();
            if (s.fd) try { fs.closeSync(s.fd); } catch (e) { }
            s.fd = fs.openSync(s.filePath, 'r');
            bridgeLogger.info(`[隐式握手] 收到 ACK，自动从 offering用于 sending: ${s.id}`);
        }

        if (ack.nextSeq > s.windowStart) {
            for (let i = s.windowStart; i < ack.nextSeq; i++) s.inflight.delete(i);
            s.windowStart = ack.nextSeq;
            s.lastProgressTime = Date.now();
        }

        // 发送端进度反馈
        this.emit('progress', {
            fileId: ack.id,
            type: 'send',
            file: path.basename(s.filePath),
            current: s.windowStart,
            total: s.totalChunks,
            size: s.fileSize, // 传输总字节数
            percent: Math.round(s.windowStart / s.totalChunks * 100),
            status: s.status,
            isHidden: s.meta?.isHidden,
            speed: this._updateSpeed(s, s.windowStart)
        });

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

            // 冲突处理延迟到这里执行
            // 重新计算最终路径（因为可能中途文件被创建了）
            let finalSavePath = s.savePath;
            const isSyncTask = !!s.meta?.shareId;
            const strategy = isSyncTask ? 'overwrite' : this.conflictStrategy;
            bridgeLogger.info(`[Finalize] File=${s.name}, Path=${finalSavePath}, Exists=${fs.existsSync(finalSavePath)}, Strategy=${strategy}`);

            if (fs.existsSync(finalSavePath)) {
                if (strategy === 'skip') {
                    // 既然已经传完了，Skip 实际上意味着“丢弃接收到的临时文件”
                    bridgeLogger.info(`[Conflict] Consummation skipped (file exists): ${path.basename(finalSavePath)}`);
                    // 清理临时文件
                    try { if (fs.existsSync(s.partPath)) fs.unlinkSync(s.partPath); } catch (e) { }
                    try { if (fs.existsSync(s.metaPath)) fs.unlinkSync(s.metaPath); } catch (e) { }
                    // 虽然丢弃了，但对发送端来说是成功的（因为传输没错），回复 FIN_ACK
                    this.emit('complete', { fileId: s.id, type: 'receive', file: s.name, fullPath: null, status: 'skipped' });
                    this._sendJson(TYPE.FILE_FIN_ACK, { id: s.id }, 1);
                    this.recvSessions.delete(data.id);
                    return;
                }
                if (strategy === 'rename') {
                    const dir = path.dirname(finalSavePath);
                    const ext = path.extname(s.name);
                    const base = path.basename(s.name, ext);
                    let counter = 1;
                    while (fs.existsSync(finalSavePath)) {
                        finalSavePath = path.join(dir, `${base} (${counter})${ext}`);
                        counter++;
                    }
                    bridgeLogger.info(`[Conflict] Final renaming to: ${finalSavePath}`);
                }
                // overwrite 模式直接往下走，覆盖即可
            }

            if (fs.existsSync(finalSavePath)) fs.unlinkSync(finalSavePath); // 确保 renameSync 不会报错（Windows下 rename 不能覆盖）
            fs.renameSync(s.partPath, finalSavePath);
            if (fs.existsSync(s.metaPath)) fs.unlinkSync(s.metaPath);

            // 更新 session 中的 savePath 以便后续事件使用正确的最终路径
            s.savePath = finalSavePath;

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

    _watchdog() {
        const now = Date.now();
        for (const s of this.sendSessions.values()) {
            if (s.status === 'sending' && (now - s.lastProgressTime > this.timeout)) {
                bridgeLogger.warn(`[传输超时重传] ${this.timeout}ms未收到响应，重发当前窗口: ${s.id.substring(0, 8)}`);
                s.lastProgressTime = now;
                s.inflight.clear();
                this._sendWindow(s);
            } else if (s.status === 'offering' && (now - s.startTime > this.timeout)) {
                bridgeLogger.warn(`[握手超时] ${Math.round(this.timeout / 1000)}秒未收到 ACCEPT，重发 Offer: ${s.id.substring(0, 8)}`);
                s.startTime = now;
                this._sendJson(TYPE.FILE_OFFER, {
                    id: s.id, name: path.basename(s.filePath), size: s.fileSize,
                    chunks: s.totalChunks, hash: s.meta?.hash, priority: s.priority, meta: s.meta
                }, 1);
            }
        }
    }

    _updateSpeed(s, currentChunks) {
        const now = Date.now();
        const duration = (now - s.lastSpeedTime) / 1000;
        if (duration >= 1.0) {
            const delta = currentChunks - s.lastChunks;
            s.speed = Math.round((delta * this.chunkSize) / duration);
            s.lastChunks = currentChunks;
            s.lastSpeedTime = now;
        }
        return s.speed || 0;
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
