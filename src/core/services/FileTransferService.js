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

        // 接收会话: { fileId: { fileName, fileSize, totalChunks, receivedBitmap, savePath, fd, lastAckTime } }
        this.recvSessions = new Map();

        this.chunkSize = 1024; // 1KB
        this.windowSize = 50;  // 窗口大小 - 增大以提高吞吐量
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
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

        // 创建发送会话
        this.sendSessions.set(fileId, {
            fileId,
            filePath,
            fileSize: stats.size,
            totalChunks,
            windowStart: 0,
            inflight: new Set(), // 已发送但未确认的 seq
            startTime: Date.now(),
            fd: null // 将在 accept 后打开
        });

        // 发送 FILE_OFFER
        const offer = {
            id: fileId,
            name: fileName,
            size: stats.size,
            chunks: totalChunks
        };

        this._sendJson(TYPE.FILE_OFFER, offer);
        bridgeLogger.info(`Sending file: ${fileName} (${(stats.size / 1024).toFixed(1)} KB)`);

        return fileId;
    }

    // --- 内部处理逻辑 ---

    _handleOffer(frame) {
        const offer = JSON.parse(frame.body.toString());
        bridgeLogger.info(`Receiving file: ${offer.name} (${(offer.size / 1024).toFixed(1)} KB)`);

        // 自动接受
        const saveDir = path.join(process.cwd(), 'received');
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
        const savePath = path.join(saveDir, offer.name);

        const fd = fs.openSync(savePath, 'w');

        this.recvSessions.set(offer.id, {
            id: offer.id,
            name: offer.name,
            size: offer.size,
            totalChunks: offer.chunks,
            receivedChunks: 0,
            savePath,
            fd,
            receivedBitmap: new Set(),
            lastAckTime: 0
        });

        // 回复 FILE_ACCEPT
        this._sendJson(TYPE.FILE_ACCEPT, {
            id: offer.id,
            accepted: true
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

        // 打开文件描述符
        session.fd = fs.openSync(session.filePath, 'r');

        // 开始发送窗口内的数据
        this._sendWindow(session);
    }

    _sendWindow(session) {
        const limit = Math.min(session.totalChunks, session.windowStart + this.windowSize);

        for (let seq = session.windowStart; seq < limit; seq++) {
            if (!session.inflight.has(seq)) {
                this._sendChunk(session, seq);
                session.inflight.add(seq);
            }
        }

        // 显示发送进度条
        const percent = Math.round(session.windowStart / session.totalChunks * 100);
        const barLength = 30;
        const filledLength = Math.floor(barLength * percent / 100);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

        process.stdout.write(`\r[File] Sending: ${path.basename(session.filePath)} [${bar}] ${percent}%`);
    }

    _sendChunk(session, seq) {
        const buffer = Buffer.alloc(this.chunkSize);
        const position = seq * this.chunkSize;
        const bytesRead = fs.readSync(session.fd, buffer, 0, this.chunkSize, position);
        const chunkData = buffer.slice(0, bytesRead);

        // Body = [FileID(36)] [Data]
        const idBuf = Buffer.from(session.fileId);
        const payload = Buffer.concat([idBuf, chunkData]);

        this.scheduler.enqueue(TYPE.FILE_CHUNK, seq, payload, 2); // P2
    }

    _handleChunk(frame) {
        if (frame.body.length <= 36) return;

        const fileId = frame.body.slice(0, 36).toString();
        const data = frame.body.slice(36);

        const session = this.recvSessions.get(fileId);
        if (!session) return;

        // 写入文件 (如果重复收到则覆盖，幂等)
        const position = frame.seq * this.chunkSize;
        fs.writeSync(session.fd, data, 0, data.length, position);

        if (!session.receivedBitmap.has(frame.seq)) {
            session.receivedBitmap.add(frame.seq);
            session.receivedChunks++;
        }

        // 策略：每收到 20 个包发送一次 ACK (匹配更大的窗口)
        if (session.receivedChunks % 20 === 0 || session.receivedChunks === session.totalChunks) {
            this._sendAck(session);
        }

        // 打印进度条
        const percent = Math.round(session.receivedChunks / session.totalChunks * 100);
        const barLength = 30;
        const filledLength = Math.floor(barLength * percent / 100);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

        // 使用 \r 实现同行更新
        process.stdout.write(`\r[File] Receiving: ${session.name} [${bar}] ${percent}%`);

        // 完成时换行
        if (session.receivedChunks === session.totalChunks) {
            process.stdout.write('\n');
        }

        // 检查是否完成
        if (session.receivedChunks === session.totalChunks) {
            // 发送最后一个 ACK
            this._sendAck(session);
            // 等待 FIN
        }
    }

    _sendAck(session) {
        // 计算连续收到的最大序号
        let maxContinuous = 0;
        while (session.receivedBitmap.has(maxContinuous)) {
            maxContinuous++;
        }
        // maxContinuous 现在是第一个未收到的序号

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

        // 更新窗口: 接收方期望 nextSeq，说明 nextSeq 之前都收到了
        if (ack.nextSeq > session.windowStart) {
            // 清理 inflight 中已经确认的
            for (let i = session.windowStart; i < ack.nextSeq; i++) {
                session.inflight.delete(i);
            }
            session.windowStart = ack.nextSeq;
        }

        // 检查是否完成
        if (session.windowStart >= session.totalChunks) {
            process.stdout.write('\n'); // 完成进度条后换行
            bridgeLogger.info(`File transfer complete: ${session.filePath}`);
            this._sendJson(TYPE.FILE_FIN, { id: session.fileId });
            fs.closeSync(session.fd);
            this.sendSessions.delete(session.fileId);
            return;
        }

        // 继续发送窗口内的新数据
        this._sendWindow(session);
    }

    _handleFin(frame) {
        const req = JSON.parse(frame.body.toString());
        const session = this.recvSessions.get(req.id);
        if (!session) return;

        console.log(`[File] Transfer complete: ${session.name}`);
        fs.closeSync(session.fd);
        this.recvSessions.delete(req.id);
    }

    _sendJson(type, data) {
        const body = Buffer.from(JSON.stringify(data));
        this.scheduler.enqueue(type, 0, body, 1); // P1 (Control)
    }
}

module.exports = FileTransferService;
