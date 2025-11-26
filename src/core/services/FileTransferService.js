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

        // 计算文件 Hash (MD5) - 用于断点续传校验
        // 对于超大文件，这里可能会耗时，实际生产中可以只计算头尾+大小，或者流式计算
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
            fd: null // 将在 accept 后打开
        });

        // 发送 FILE_OFFER
        const offer = {
            id: fileId,
            name: fileName,
            size: stats.size,
            chunks: totalChunks,
            hash: fileHash // 新增 Hash 字段
        };

        this._sendJson(TYPE.FILE_OFFER, offer);
        bridgeLogger.info(`Sending file: ${fileName} (${(stats.size / 1024).toFixed(1)} KB) Hash: ${fileHash.substring(0, 6)}...`);

        return fileId;
    }

    // --- 内部处理逻辑 ---

    _handleOffer(frame) {
        const offer = JSON.parse(frame.body.toString());
        bridgeLogger.info(`Receiving file: ${offer.name} (${(offer.size / 1024).toFixed(1)} KB)`);

        const saveDir = path.join(process.cwd(), 'received');
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);

        // 使用 .part 后缀
        const savePath = path.join(saveDir, offer.name + '.part');
        const metaPath = path.join(saveDir, offer.name + '.meta');

        let receivedBitmap = new Set();
        let receivedChunks = 0;
        let isResume = false;

        // 检查是否存在断点信息
        if (fs.existsSync(metaPath) && fs.existsSync(savePath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                if (meta.hash === offer.hash && meta.size === offer.size) {
                    // Hash 匹配，恢复进度
                    // meta.bitmap 是数组，转回 Set
                    receivedBitmap = new Set(meta.bitmap);
                    receivedChunks = receivedBitmap.size;
                    isResume = true;
                    bridgeLogger.info(`Resuming transfer for ${offer.name}, progress: ${(receivedChunks / offer.chunks * 100).toFixed(1)}%`);
                }
            } catch (e) {
                bridgeLogger.warn('Failed to read meta file, starting fresh');
            }
        }

        // 打开文件 (r+ 模式支持读写，如果不存在则 w 创建)
        let fd;
        if (isResume) {
            fd = fs.openSync(savePath, 'r+');
        } else {
            fd = fs.openSync(savePath, 'w');
        }

        this.recvSessions.set(offer.id, {
            id: offer.id,
            name: offer.name,
            size: offer.size,
            totalChunks: offer.chunks,
            receivedChunks,
            savePath,
            metaPath, // 保存 meta 路径
            hash: offer.hash, // 保存 hash
            fd,
            receivedBitmap,
            lastAckTime: 0,
            lastPercent: -1 // 用于进度条节流
        });

        // 计算 nextSeq (第一个未收到的块)
        let nextSeq = 0;
        while (receivedBitmap.has(nextSeq)) {
            nextSeq++;
        }

        // 回复 FILE_ACCEPT，带上 nextSeq
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

        // 打开文件描述符
        session.fd = fs.openSync(session.filePath, 'r');

        // 处理断点续传
        if (resp.nextSeq && resp.nextSeq > 0) {
            session.windowStart = resp.nextSeq;
            bridgeLogger.info(`Resuming from chunk ${resp.nextSeq}`);
            // 进度条也需要相应调整，这里暂不处理进度条的初始显示，_sendWindow 会处理
        }

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

            // 持久化进度到 .meta 文件
            try {
                const meta = {
                    hash: session.hash,
                    size: session.size,
                    bitmap: Array.from(session.receivedBitmap) // Set 转 Array
                };
                fs.writeFileSync(session.metaPath, JSON.stringify(meta));
            } catch (e) {
                // 忽略写入错误，避免影响传输
            }
        }

        // 打印进度条 (节流：仅在百分比变化或每 50 包更新一次，防止刷屏)
        const percent = Math.round(session.receivedChunks / session.totalChunks * 100);
        if (percent !== session.lastPercent || session.receivedChunks % 50 === 0) {
            session.lastPercent = percent;
            const barLength = 30;
            const filledLength = Math.floor(barLength * percent / 100);
            const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
            process.stdout.write(`\r[File] Receiving: ${session.name} [${bar}] ${percent}%`);
        }

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

        // 重命名 .part -> 原文件名
        const finalPath = session.savePath.replace('.part', '');
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); // 如果目标存在则覆盖
        fs.renameSync(session.savePath, finalPath);

        // 删除 .meta 文件
        if (fs.existsSync(session.metaPath)) {
            fs.unlinkSync(session.metaPath);
        }

        this.recvSessions.delete(req.id);
    }

    _sendJson(type, data) {
        const body = Buffer.from(JSON.stringify(data));
        this.scheduler.enqueue(type, 0, body, 1); // P1 (Control)
    }
}

module.exports = FileTransferService;
