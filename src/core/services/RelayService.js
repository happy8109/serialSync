/**
 * RelayService.js
 * 跨网中继核心服务
 * v3.1 - 管理 LAN 对端 WebSocket 连接，实现消息/文件的跨网中继
 *
 * 职责：
 * 1. WebSocket 连接管理（IP 比较主从策略、断线重连）
 * 2. 消息转发引擎（串口⇄LAN 桥接、防环路）
 * 3. 文件通知广播转发
 * 4. 文件中继协调（pendingRelayPulls 状态机）
 * 5. LAN 文件传输（HTTP 拉取）
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const RoutePacket = require('../router/RoutePacket');
const { logger } = require('../../utils/logger');
const { getSafeHostname } = require('../../utils/osUtils');
const { computeFileMd5 } = require('../../utils/fileUtils');
const relayLogger = logger.create('Relay');

// 帧类型常量
const PT = {
    MSG_TEXT: 0x10,
    FILE_NOTIFY: 0x15,
    FILE_RELAY_REQ: 0x50,
    FILE_RELAY_RESP: 0x51
};

class RelayService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.routeEngine = null; // 路由引擎引用

        // 多 Peer 配置与会话
        this.peerUrls = [];         // 配置的所有对端 URL 列表 [ws://IP:PORT/relay]
        this.peerManagers = new Map(); // url -> { url, isClient, reconnectTimer, reconnectDelay }
        this.peers = new Map();     // peerKey -> { id, ws, identity, url, isClient, linkId }

        // 重连策略默认值
        this.defaultReconnectDelay = 3000;
        this.maxReconnectDelay = 30000;

        // 节点身份
        this.identity = {
            nodeName: getSafeHostname(),
            network: '',
            nodeId: ''
        };

        // 消息去重（保留最近 500 条 msgId）
        this.seenMsgIds = new Set();
        this.msgIdQueue = [];
        this.MAX_SEEN_IDS = 500;

        // 文件中继：待处理拉取请求表 (兼容旧版单条查询) 与 Singleflight 并发合并表
        // Map<fileId, { direction: 'serial'|'relay'|'local', requestedAt: number, reqId: string }>
        this.pendingRelayPulls = new Map();
        // Map<fileId, { fileName: string, startedAt: number, subscribers: Array<{ direction, reqId, peerKey }> }>
        this.activePulls = new Map();
        this.PULL_TIMEOUT = 300000; // 拉取超时 5 分钟

        // 文件接收目录与沿途分站缓存仓库
        this.receivedDir = path.join(process.cwd(), 'received');
        this.stagingDir = path.join(this.receivedDir, '.staging');
        this.localHttpPort = 3000;

        // 文件 ID → 文件路径映射（由文件通知填充）
        this.fileIndex = new Map();

        // 文件传输引擎引用（防并发重复拉取）
        this.fileTransferService = null;
    }

    /**
     * 由 ServiceManager 注入
     */
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    /**
     * 注入文件传输引擎
     * @param {FileTransferService} fileTransferService
     */
    setFileTransferService(fileTransferService) {
        this.fileTransferService = fileTransferService;
    }

    setLocalHttpPort(port) {
        if (port) this.localHttpPort = port;
    }

    /**
     * 设置节点身份
     */
    setIdentity(identity) {
        if (!identity) return;
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network !== undefined) this.identity.network = identity.network;
        if (identity.nodeId) this.identity.nodeId = identity.nodeId;
    }

    /**
     * 向后兼容属性获取器
     */
    get peerWs() {
        for (const peer of this.peers.values()) {
            if (peer.ws && peer.ws.readyState === WebSocket.OPEN) return peer.ws;
        }
        return null;
    }

    get peerIdentity() {
        for (const peer of this.peers.values()) {
            if (peer.identity) return peer.identity;
        }
        return null;
    }

    get relayReady() {
        for (const peer of this.peers.values()) {
            if (peer.ws && peer.ws.readyState === WebSocket.OPEN) return true;
        }
        return false;
    }

    get isClient() {
        for (const mgr of this.peerManagers.values()) {
            if (mgr.isClient) return true;
        }
        return false;
    }

    get peerUrl() {
        return this.peerUrls.length > 0 ? this.peerUrls[0] : null;
    }

    set peerUrl(url) {
        if (url) {
            this.setPeers([url]);
        }
    }

    /**
     * 注入路由引擎
     * @param {RouteEngine} routeEngine
     */
    setRouteEngine(routeEngine) {
        this.routeEngine = routeEngine;
    }

    /**
     * 设置 LAN 对端地址列表 (支持多 Peer) 并启动连接
     * @param {string|string[]} urls - 单个 URL 或 URL 数组
     */
    setPeers(urls) {
        if (!urls) urls = [];
        if (typeof urls === 'string') {
            urls = urls.split(',').map(u => u.trim()).filter(Boolean);
        } else if (!Array.isArray(urls)) {
            urls = [urls];
        }

        const validUrls = urls.filter(u => typeof u === 'string' && u.startsWith('ws'));
        this.peerUrls = validUrls;

        // 停止不再需要的对端连接
        for (const [url, mgr] of this.peerManagers) {
            if (!validUrls.includes(url)) {
                if (mgr.reconnectTimer) clearTimeout(mgr.reconnectTimer);
                this.peerManagers.delete(url);
                for (const [key, peer] of this.peers) {
                    if (peer.url === url) {
                        try { peer.ws.close(); } catch (e) { }
                    }
                }
            }
        }

        // 启动新增对端的管理器
        for (const url of validUrls) {
            this._startPeerManager(url);
        }
    }

    /**
     * 设置单个 LAN 对端地址 (兼容旧 API)
     * @param {string} url - ws://IP:PORT/relay
     */
    setPeerUrl(url) {
        if (url) {
            this.setPeers([url]);
        } else {
            this.setPeers([]);
        }
    }

    /**
     * 声明感兴趣的帧类型
     */
    getInterestedTypes() {
        return [PT.FILE_NOTIFY, PT.FILE_RELAY_REQ, PT.FILE_RELAY_RESP];
    }

    /**
     * 处理从串口收到的帧
     */
    handleFrame(frame) {
        switch (frame.type) {
            case PT.FILE_NOTIFY:
                this._handleSerialFileNotify(frame);
                break;
            case PT.FILE_RELAY_REQ:
                this._handleSerialRelayReq(frame);
                break;
            case PT.FILE_RELAY_RESP:
                this._handleSerialRelayResp(frame);
                break;
        }
    }

    // =====================================================================
    // WebSocket 连接管理 (多 Peer 支持)
    // =====================================================================

    /**
     * 启动对某个 Peer URL 的状态管理
     */
    _startPeerManager(url) {
        if (this.peerManagers.has(url)) return;

        const isClient = this._determineRoleForUrl(url);
        const manager = {
            url,
            isClient,
            reconnectTimer: null,
            reconnectDelay: this.defaultReconnectDelay
        };
        this.peerManagers.set(url, manager);

        relayLogger.info(`[中继] 对端管理启动: ${url}, 角色=${isClient ? '客户端(主动连接)' : '服务端(等待连入)'}`);

        if (isClient) {
            this._connectToPeerUrl(manager);
        }
    }

    /**
     * 判定本节点对特定 URL 的角色
     * 规则：IP 值较小的一方作为客户端主动连接
     */
    _determineRoleForUrl(targetUrl) {
        try {
            const peerUrlObj = new URL(targetUrl);
            const peerHost = peerUrlObj.hostname;
            const localIPs = this._getLocalIPs();
            const peerIP = this._ipToNumber(peerHost);
            return localIPs.some(ip => this._ipToNumber(ip) < peerIP);
        } catch (err) {
            relayLogger.error(`[中继] 角色判定异常 (${targetUrl}): ${err.message}`);
            return true;
        }
    }

    /**
     * 作为客户端连接指定 LAN 对端
     */
    _connectToPeerUrl(manager) {
        if (!manager.isClient || !manager.url) return;

        // 若已有活跃连接则无需重连
        for (const peer of this.peers.values()) {
            if (peer.url === manager.url && peer.ws && peer.ws.readyState === WebSocket.OPEN) {
                return;
            }
        }

        relayLogger.info(`[中继] 正在主动连接对端: ${manager.url}`);

        try {
            const ws = new WebSocket(manager.url);

            ws.on('open', () => {
                relayLogger.info(`[中继] 已成功连入对端: ${manager.url}`);
                manager.reconnectDelay = this.defaultReconnectDelay;
                this._onPeerConnected(ws, { url: manager.url, isClient: true, manager });
            });

            ws.on('error', (err) => {
                relayLogger.debug(`[中继] 对端连接错误 (${manager.url}): ${err.message}`);
            });

            ws.on('close', () => {
                relayLogger.warn(`[中继] 与对端的连接断开 (${manager.url})`);
                this._scheduleReconnect(manager);
            });
        } catch (err) {
            relayLogger.error(`[中继] 连接异常 (${manager.url}): ${err.message}`);
            this._scheduleReconnect(manager);
        }
    }

    /**
     * 安排重连（指数退避）
     */
    _scheduleReconnect(manager) {
        if (!manager.isClient || !manager.url) return;
        if (manager.reconnectTimer) return;

        relayLogger.info(`[中继] ${manager.reconnectDelay / 1000}s 后重试连接: ${manager.url}`);
        manager.reconnectTimer = setTimeout(() => {
            manager.reconnectTimer = null;
            this._connectToPeerUrl(manager);
        }, manager.reconnectDelay);

        manager.reconnectDelay = Math.min(manager.reconnectDelay * 2, this.maxReconnectDelay);
    }

    /**
     * 处理来自 ApiServer 的对端 WebSocket 连接（服务端模式连入）
     * @param {WebSocket} ws
     */
    handlePeerConnection(ws) {
        relayLogger.info(`[中继] 外部对端已连入 (服务端模式)`);
        this._onPeerConnected(ws, { isClient: false });
    }

    /**
     * 对端连接建立后的通用初始化处理
     */
    _onPeerConnected(ws, options = {}) {
        const peerId = options.url || `peer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const peerEntry = {
            id: peerId,
            ws,
            url: options.url || null,
            isClient: !!options.isClient,
            identity: null,
            linkId: null
        };

        this.peers.set(peerId, peerEntry);

        // 监听对端消息
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this._handlePeerMessage(msg, peerEntry);
            } catch (err) {
                relayLogger.error(`[中继] 解析对端消息失败: ${err.message}`);
            }
        });

        // 监听对端断开
        ws.on('close', () => {
            this._onPeerDisconnected(peerEntry);
        });

        // 发送握手
        try {
            ws.send(JSON.stringify({
                action: 'handshake',
                data: {
                    nodeId: this.identity.nodeId,
                    nodeName: this.identity.nodeName,
                    network: this.identity.network
                }
            }));
        } catch (err) {
            relayLogger.error(`[中继] 发送握手失败: ${err.message}`);
        }

        this.emit('relay_status', this.getStatus());
    }

    /**
     * 对端连接断开后的处理
     */
    _onPeerDisconnected(peerEntry) {
        relayLogger.warn(`[中继] 对端连接注销: ${peerEntry.id} (node=${peerEntry.identity ? peerEntry.identity.nodeName : 'unknown'})`);

        // 从 RouteEngine 注销链路
        if (this.routeEngine && peerEntry.linkId) {
            this.routeEngine.unregisterLink(peerEntry.linkId);
        }

        this.peers.delete(peerEntry.id);
        this.emit('relay_status', this.getStatus());
    }

    /**
     * 向 LAN 对端广播 JSON 消息 (发送至所有活跃连接)
     */
    _sendToPeer(msg) {
        let sentCount = 0;
        const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
        for (const peer of this.peers.values()) {
            if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
                try {
                    peer.ws.send(raw);
                    sentCount++;
                } catch (err) {
                    relayLogger.error(`[中继] 发送给对端 ${peer.id} 失败: ${err.message}`);
                }
            }
        }
        return sentCount > 0;
    }

    // =====================================================================
    // 消息中继引擎
    // =====================================================================

    /**
     * 将消息转发给 LAN 对端
     * @param {'serial'|'local'} origin - 消息来源方向
     * @param {Object} data - 消息数据
     */
    forwardToRelay(origin, data) {
        if (!this.relayReady) return;

        // 不要发回给原始发送节点，如果该节点刚好是我们的中继对端
        if (this.peerIdentity && data.sender && data.sender.nodeName === this.peerIdentity.nodeName) {
            return;
        }

        // 防环路：只有 serial 和 local 来源的消息才转发给 relay
        // relay 来源的消息绝不回传（在 _handlePeerMessage 中已处理方向）
        if (origin === 'serial' || origin === 'local') {
            if (data.type === 'file_notify') {
                this._sendToPeer({ action: 'file_notify', data });
            } else {
                this._sendToPeer({ action: 'chat', data });
            }
        }
    }

    /**
     * 处理从 LAN 对端收到的消息
     */
    _handlePeerMessage(msg, peerEntry) {
        const { action, data } = msg;

        switch (action) {
            case 'handshake':
                if (peerEntry) {
                    peerEntry.identity = data;
                }
                relayLogger.info(`[中继] 对端握手: ${data.network ? '[' + data.network + '] ' : ''}${data.nodeName}${data.nodeId ? ' (' + data.nodeId + ')' : ''}`);

                // 注册该 LAN 对端为 RouteEngine 的通信链路
                if (this.routeEngine && data.nodeName) {
                    const linkId = `lan:${data.nodeName}`;
                    if (peerEntry) peerEntry.linkId = linkId;

                    this.routeEngine.registerLink(linkId, {
                        type: 'lan',
                        send: (packet, priority = 1) => {
                            if (peerEntry && peerEntry.ws && peerEntry.ws.readyState === WebSocket.OPEN) {
                                peerEntry.ws.send(JSON.stringify({
                                    action: 'route_packet',
                                    packet: packet.toJSON()
                                }));
                                return true;
                            }
                            return false;
                        },
                        isReady: () => peerEntry && peerEntry.ws && peerEntry.ws.readyState === WebSocket.OPEN
                    });
                }
                break;

            case 'route_packet':
                // 网络层统一定向/广播报文交付
                if (this.routeEngine && msg.packet) {
                    try {
                        const routePacket = RoutePacket.fromJSON(msg.packet);
                        const fromLinkId = (peerEntry && peerEntry.linkId) ? peerEntry.linkId : `lan:${peerEntry ? peerEntry.id : 'unknown'}`;
                        this.routeEngine.handleIncomingPacket(routePacket, fromLinkId);
                    } catch (err) {
                        relayLogger.error(`[中继] 解析 route_packet 失败: ${err.message}`);
                    }
                }
                break;

            case 'chat':
                this._handleRelayChat(data);
                break;

            case 'file_notify':
                this._handleRelayFileNotify(data);
                break;

            case 'file_pull_req':
                this._handleRelayPullReq(data, peerEntry);
                break;

            case 'file_pull_resp':
                this._handleRelayPullResp(data, peerEntry);
                break;

            default:
                relayLogger.debug(`[中继] 未知 action: ${action}`);
        }
    }

    /**
     * 处理从 relay 收到的聊天消息 → 注入串口 + 本地广播
     */
    _handleRelayChat(data) {
        // 去重检查
        if (data.msgId && this._isDuplicate(data.msgId)) return;

        // 1. 本地 WebUI 广播（通过事件上报给 AppController）
        this.emit('relay_chat', {
            id: data.msgId || Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            msgId: data.msgId,
            sender: data.sender,
            text: data.content || data.text || '',
            timestamp: Date.now()
        });

        // 2. 注入串口发送（转发到串口对端）
        if (this.scheduler) {
            const payload = {
                msgId: data.msgId,
                sender: data.sender,
                content: data.content || data.text || ''
            };
            const body = Buffer.from(JSON.stringify(payload), 'utf8');
            this.scheduler.enqueue(PT.MSG_TEXT, 0, body, 1);
        }
    }

    // =====================================================================
    // 文件通知中继
    // =====================================================================

    /**
     * 处理从串口收到的文件通知 → 转发给 relay 对端
     */
    _handleSerialFileNotify(frame) {
        try {
            const data = JSON.parse(frame.body.toString('utf8'));

            // 去重检查
            if (data.msgId && this._isDuplicate(data.msgId)) return;

            // 记录文件索引
            if (data.fileId) {
                this.fileIndex.set(data.fileId, { fileName: data.fileName, local: false });
            }

            // 本地 WebUI 广播
            this.emit('relay_file_notify', data);

            // 传统模式下转发给 relay 对端 (路由模式下由 RouteEngine 自动处理泛洪)
            if (!this.routeEngine) {
                this._sendToPeer({ action: 'file_notify', data });
            }
        } catch (err) {
            relayLogger.error(`[中继] 解析串口文件通知失败: ${err.message}`);
        }
    }

    /**
     * 处理从 relay 收到的文件通知 → 注入串口 + 本地广播
     */
    _handleRelayFileNotify(data) {
        // 去重检查
        if (data.msgId && this._isDuplicate(data.msgId)) return;

        // 记录文件索引
        if (data.fileId) {
            this.fileIndex.set(data.fileId, { fileName: data.fileName, local: false });
        }

        // 本地 WebUI 广播
        this.emit('relay_file_notify', data);

        // 传统模式下注入串口发送（路由模式下由 RouteEngine 自动处理泛洪）
        if (!this.routeEngine && this.scheduler) {
            const body = Buffer.from(JSON.stringify(data), 'utf8');
            this.scheduler.enqueue(PT.FILE_NOTIFY, 0, body, 1);
        }
    }

    /**
     * 主动广播文件通知（文件接收完成时由 AppController 调用）
     * @param {Object} fileInfo - { fileId, fileName, fileSize, fullPath, sender }
     */
    broadcastFileNotify(fileInfo) {
        const msgId = `notify_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // 记录文件索引（本地有文件）
        this.fileIndex.set(fileInfo.fileId, {
            fileName: fileInfo.fileName,
            fullPath: fileInfo.fullPath,
            local: true
        });

        const data = {
            msgId,
            fileId: fileInfo.fileId,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            sender: fileInfo.sender
        };

        // 标记已见（防止自己再处理）
        this._markSeen(msgId);

        const body = Buffer.from(JSON.stringify(data), 'utf8');

        // 优先使用路由引擎全网广播 (向串口与所有 LAN Peer 泛洪)
        if (this.routeEngine) {
            this.routeEngine.send({
                type: PT.FILE_NOTIFY,
                dst: '*',
                payload: body,
                priority: 1
            });
        } else {
            // 传统模式手动双发
            this._sendToPeer({ action: 'file_notify', data });
            if (this.scheduler) {
                this.scheduler.enqueue(PT.FILE_NOTIFY, 0, body, 1);
            }
        }

        // 本地 WebUI 广播（由 AppController 直接处理，此处不重复 emit）
    }

    // =====================================================================
    // 文件中继拉取
    // =====================================================================

    /**
     * WebUI 用户触发的文件拉取（由 ApiServer 调用）
     * @param {string} fileId
     * @param {string} fileName
     * @returns {Promise}
     */
    /**
     * WebUI 用户触发的文件拉取（由 ApiServer 调用）
     * @param {string} fileId
     * @param {string} fileName
     * @returns {Promise}
     */
    _ensureStagingDir() {
        if (!fs.existsSync(this.receivedDir)) {
            fs.mkdirSync(this.receivedDir, { recursive: true });
        }
        if (!fs.existsSync(this.stagingDir)) {
            fs.mkdirSync(this.stagingDir, { recursive: true });
        }
    }

    _getStagingPath(fileId) {
        return path.join(this.stagingDir, `${fileId}.blob`);
    }

    _getPartPath(fileId) {
        return path.join(this.stagingDir, `${fileId}.part`);
    }

    /**
     * Singleflight 订阅登记：
     * 若已有同 fileId 拉取任务在进行，返回 false（复用上游请求，绝不重复占用串口）；
     * 否则创建新任务并返回 true（由调用方发起唯一一次上游拉取）。
     */
    _addPullSubscriber(fileId, fileName, subscriber) {
        if (this.activePulls.has(fileId)) {
            const entry = this.activePulls.get(fileId);
            const exists = entry.subscribers.some(
                s => s.direction === subscriber.direction && s.peerKey === subscriber.peerKey
            );
            if (!exists) {
                entry.subscribers.push(subscriber);
            }
            relayLogger.info(`[Singleflight] 合并并发拉取请求: ${fileName} (${fileId}), 当前订阅数=${entry.subscribers.length}`);
            return false;
        }
        this.activePulls.set(fileId, {
            fileName,
            startedAt: Date.now(),
            subscribers: [subscriber]
        });
        return true;
    }

    _copyToReceived(srcPath, fileName) {
        if (!fs.existsSync(this.receivedDir)) {
            fs.mkdirSync(this.receivedDir, { recursive: true });
        }
        const destPath = path.join(this.receivedDir, fileName);
        if (path.resolve(srcPath) !== path.resolve(destPath)) {
            fs.copyFileSync(srcPath, destPath);
        }
        return destPath;
    }

    _promoteToStaging(fileId, srcPath) {
        this._ensureStagingDir();
        const stagingPath = this._getStagingPath(fileId);
        if (path.resolve(srcPath) !== path.resolve(stagingPath) && !fs.existsSync(stagingPath)) {
            const partPath = this._getPartPath(fileId);
            fs.copyFileSync(srcPath, partPath);
            fs.renameSync(partPath, stagingPath);
        }
        return fs.existsSync(stagingPath) ? stagingPath : srcPath;
    }

    _completeAllSubscribers(fileId, fileName, stagingPath) {
        const entry = this.activePulls.get(fileId);
        if (!entry) return;
        this.activePulls.delete(fileId);
        this.pendingRelayPulls.delete(fileId);

        let serialNotified = false;
        for (const sub of entry.subscribers) {
            if (sub.direction === 'local') {
                const finalPath = this._copyToReceived(stagingPath, sub.fileName || fileName);
                this.emit('relay_pull_complete', { fileId, fileName: sub.fileName || fileName, fullPath: finalPath });
            } else if (sub.direction === 'relay') {
                this._sendToPeer({
                    action: 'file_pull_resp',
                    data: {
                        reqId: sub.reqId,
                        fileId,
                        available: true,
                        httpPort: this.localHttpPort,
                        downloadUrl: `/api/relay/file/${fileId}`
                    }
                });
            } else if (sub.direction === 'serial' && !serialNotified) {
                serialNotified = true;
                this.emit('relay_send_file', { fileId, fileName: sub.fileName || fileName, fullPath: stagingPath });
            }
        }
    }

    _failAllSubscribers(fileId, errorMsg) {
        const entry = this.activePulls.get(fileId);
        this.activePulls.delete(fileId);
        this.pendingRelayPulls.delete(fileId);

        const partPath = this._getPartPath(fileId);
        if (fs.existsSync(partPath)) {
            try { fs.unlinkSync(partPath); } catch (e) { /* ignore */ }
        }

        if (!entry) return;
        for (const sub of entry.subscribers) {
            if (sub.direction === 'local') {
                this.emit('relay_pull_failed', { fileId, error: errorMsg });
            } else if (sub.direction === 'relay') {
                this._sendToPeer({
                    action: 'file_pull_resp',
                    data: { reqId: sub.reqId, fileId, available: false, error: errorMsg }
                });
            } else if (sub.direction === 'serial' && this.scheduler) {
                const body = Buffer.from(JSON.stringify({ reqId: sub.reqId, fileId, status: 'not_found', error: errorMsg }), 'utf8');
                this.scheduler.enqueue(PT.FILE_RELAY_RESP, 0, body, 1);
            }
        }
    }

    async requestFilePull(fileId, fileName) {
        // 1. 检查本地文件索引或分站缓存仓库
        const localFile = this._findLocalFile(fileId, fileName);
        if (localFile) {
            const finalPath = this._copyToReceived(localFile, fileName);
            return { available: true, fullPath: finalPath };
        }

        const reqId = `pull_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // 1.5 防死锁与 Singleflight 并发合并：若已有拉取/串口接收在进行，直接订阅等待
        const isFirst = this._addPullSubscriber(fileId, fileName, { direction: 'local', reqId, peerKey: 'local', fileName });
        if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
            relayLogger.info(`[中继] 文件已在串口接收中: ${fileId}，进入 Singleflight 等待`);
            this.pendingRelayPulls.set(fileId, { direction: 'local', requestedAt: Date.now(), reqId, fileName });
            return { available: false, pulling: true, reqId, status: 'receiving' };
        }
        if (!isFirst) {
            return { available: false, pulling: true, reqId, coalesced: true };
        }

        this.pendingRelayPulls.set(fileId, { direction: 'local', requestedAt: Date.now(), reqId, fileName });

        // 2. 发起唯一一次上游拉取请求
        if (this.routeEngine) {
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.routeEngine.send({
                type: PT.FILE_RELAY_REQ,
                dst: '*',
                payload: body,
                priority: 1
            });
        } else if (this.relayReady) {
            this._sendToPeer({
                action: 'file_pull_req',
                data: { reqId, fileId, fileName }
            });
        } else if (this.scheduler) {
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.scheduler.enqueue(PT.FILE_RELAY_REQ, 0, body, 1);
        } else {
            this._failAllSubscribers(fileId, '无可用中继链路');
            throw new Error('无可用中继链路');
        }

        return { available: false, pulling: true, reqId };
    }

    /**
     * 处理从串口收到的文件拉取请求
     */
    _handleSerialRelayReq(frame) {
        try {
            const data = JSON.parse(frame.body.toString('utf8'));
            const { reqId, fileId, fileName } = data;

            relayLogger.info(`[中继] 串口收到文件拉取请求: ${fileName} (${fileId})`);

            // 防重发：若本地正在通过串口发送该文件，忽略重复请求
            if (this.fileTransferService && this.fileTransferService.isSending(fileId)) {
                relayLogger.info(`[中继] 本地正在向串口发送文件 (${fileId})，忽略重复拉取请求`);
                return;
            }

            // 检查本地是否有文件（含分站缓存）
            const localFile = this._findLocalFile(fileId, fileName);
            if (localFile) {
                relayLogger.info(`[中继] 本地找到文件，直接通过串口发送: ${localFile}`);
                this.emit('relay_send_file', { fileId, fileName, fullPath: localFile });
                return;
            }

            // Singleflight 并发合并（含正在串口接收中）
            const isFirst = this._addPullSubscriber(fileId, fileName, { direction: 'serial', reqId, peerKey: 'serial', fileName });
            this.pendingRelayPulls.set(fileId, { direction: 'serial', requestedAt: Date.now(), reqId, fileName });

            if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
                relayLogger.info(`[中继] 本地正在接收该文件 (${fileId})，已合并至 Singleflight 等待`);
                return;
            }
            if (!isFirst) {
                return;
            }

            if (this.relayReady) {
                relayLogger.info(`[中继] 本地无文件，转发拉取请求到 LAN 对端`);
                this._sendToPeer({
                    action: 'file_pull_req',
                    data: { reqId, fileId, fileName }
                });
            } else {
                relayLogger.warn(`[中继] 本地无文件且无 relay 对端，拉取失败`);
                this._failAllSubscribers(fileId, '文件不存在');
            }
        } catch (err) {
            relayLogger.error(`[中继] 解析串口拉取请求失败: ${err.message}`);
        }
    }

    /**
     * 处理从串口收到的文件拉取响应
     */
    _handleSerialRelayResp(frame) {
        try {
            const data = JSON.parse(frame.body.toString('utf8'));
            relayLogger.info(`[中继] 串口收到拉取响应: ${data.status} for ${data.fileId}`);

            // 如果有待处理的 relay 方向请求，转发响应给 relay 对端
            const pending = this.pendingRelayPulls.get(data.fileId);
            if (pending && pending.direction === 'relay') {
                this._sendToPeer({ action: 'file_pull_resp', data });
                this.pendingRelayPulls.delete(data.fileId);
            }
        } catch (err) {
            relayLogger.error(`[中继] 解析串口拉取响应失败: ${err.message}`);
        }
    }

    /**
     * 处理从 relay 对端收到的文件拉取请求
     */
    _handleRelayPullReq(data, peerEntry = null) {
        const { reqId, fileId, fileName } = data;
        const peerKey = peerEntry ? peerEntry.id : 'lan';

        relayLogger.info(`[中继] LAN 收到文件拉取请求: ${fileName} (${fileId})`);

        // 检查本地是否有文件（含分站缓存）
        const localFile = this._findLocalFile(fileId, fileName);
        if (localFile) {
            relayLogger.info(`[中继] 本地找到文件，返回下载地址`);
            this._sendToPeer({
                action: 'file_pull_resp',
                data: {
                    reqId, fileId,
                    available: true,
                    httpPort: this.localHttpPort,
                    downloadUrl: `/api/relay/file/${fileId}`
                }
            });
            return;
        }

        // Singleflight 并发合并
        const isFirst = this._addPullSubscriber(fileId, fileName, { direction: 'relay', reqId, peerKey, fileName });
        this.pendingRelayPulls.set(fileId, { direction: 'relay', requestedAt: Date.now(), reqId, fileName });

        if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
            relayLogger.info(`[中继] 文件正在接收中 (${fileId})，已合并至 Singleflight 等待`);
            return;
        }
        if (!isFirst) {
            return;
        }

        if (this.routeEngine) {
            relayLogger.info(`[中继] 本地无文件，通过路由引擎广播文件拉取请求`);
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.routeEngine.send({
                type: PT.FILE_RELAY_REQ,
                dst: '*',
                payload: body,
                priority: 1
            });
        } else if (this.scheduler) {
            relayLogger.info(`[中继] 本地无文件，转发拉取请求到串口`);
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.scheduler.enqueue(PT.FILE_RELAY_REQ, 0, body, 1);
        } else {
            this._failAllSubscribers(fileId, '无串口链路可用');
        }
    }

    /**
     * 处理从 relay 对端收到的文件拉取响应
     */
    _handleRelayPullResp(data, peerEntry = null) {
        const { reqId, fileId, available, downloadUrl, httpPort, error } = data;

        relayLogger.info(`[中继] LAN 收到拉取响应: ${available ? '可用' : '不可用'} for ${fileId}`);

        const pending = this.pendingRelayPulls.get(fileId);
        const active = this.activePulls.get(fileId);
        if (!pending && !active) {
            relayLogger.debug(`[中继] 无匹配的待处理拉取请求: ${fileId}`);
            return;
        }

        const fileName = (active && active.fileName) || (pending && pending.fileName) || `${fileId}.bin`;

        if (available && downloadUrl) {
            let peerBaseUrl = null;
            if (peerEntry && peerEntry.url) {
                try {
                    const u = new URL(peerEntry.url);
                    peerBaseUrl = `http://${u.hostname}:${httpPort || u.port || 3000}`;
                } catch (e) { /* fallback */ }
            }
            if (!peerBaseUrl && this.peerUrl) {
                try {
                    const u = new URL(this.peerUrl);
                    peerBaseUrl = `http://${u.hostname}:${httpPort || u.port || 3000}`;
                } catch (e) { /* fallback */ }
            }
            this._downloadFromPeer(fileId, fileName, downloadUrl, peerBaseUrl);
        } else {
            relayLogger.warn(`[中继] 文件拉取失败: ${error || '未知错误'}`);
            this._failAllSubscribers(fileId, error || '文件不存在');
        }
    }

    /**
     * 从 LAN 对端下载文件（先写 .part 临时文件 -> MD5 校验 -> 原子转正进入分站仓库）
     */
    _downloadFromPeer(fileId, fileName, downloadUrl, peerBaseUrl) {
        if (!peerBaseUrl) {
            this._failAllSubscribers(fileId, '无法确定对端 HTTP 下载地址');
            return;
        }
        const fullUrl = `${peerBaseUrl}${downloadUrl}`;
        relayLogger.info(`[中继] 从 LAN 对端下载文件至分站缓存: ${fullUrl}`);

        this._ensureStagingDir();
        const partPath = this._getPartPath(fileId);
        const stagingPath = this._getStagingPath(fileId);
        const fileStream = fs.createWriteStream(partPath);

        http.get(fullUrl, (res) => {
            if (res.statusCode !== 200) {
                relayLogger.error(`[中继] 下载失败: HTTP ${res.statusCode}`);
                fileStream.close();
                this._failAllSubscribers(fileId, `HTTP ${res.statusCode}`);
                return;
            }

            res.pipe(fileStream);

            fileStream.on('finish', async () => {
                fileStream.close();
                try {
                    if (/^[a-f0-9]{32}$/i.test(fileId)) {
                        const actualMd5 = await computeFileMd5(partPath);
                        if (actualMd5 !== fileId.toLowerCase()) {
                            relayLogger.error(`[中继] MD5 校验失败: expected=${fileId}, actual=${actualMd5}`);
                            this._failAllSubscribers(fileId, 'MD5 校验失败，文件已损坏');
                            return;
                        }
                    }

                    fs.renameSync(partPath, stagingPath);
                    relayLogger.info(`[中继] 分站缓存原子落盘完成: ${stagingPath}`);

                    this.fileIndex.set(fileId, {
                        fileName,
                        fullPath: stagingPath,
                        md5: fileId,
                        local: true,
                        isStaging: true
                    });

                    this._completeAllSubscribers(fileId, fileName, stagingPath);
                } catch (err) {
                    relayLogger.error(`[中继] 分站缓存校验/落盘失败: ${err.message}`);
                    this._failAllSubscribers(fileId, err.message);
                }
            });
        }).on('error', (err) => {
            relayLogger.error(`[中继] LAN 下载错误: ${err.message}`);
            fileStream.close();
            this._failAllSubscribers(fileId, err.message);
        });
    }

    /**
     * 文件接收完成回调（当串口接收到文件后，原子转入分站仓库并唤醒全部 Singleflight 订阅者）
     */
    async onFileReceived(fileId, fileName, fullPath) {
        let finalPath = fullPath;
        try {
            if (/^[a-f0-9]{32}$/i.test(fileId) && fs.existsSync(fullPath)) {
                const actualMd5 = await computeFileMd5(fullPath);
                if (actualMd5 !== fileId.toLowerCase()) {
                    relayLogger.error(`[中继] 串口接收文件 MD5 校验失败: expected=${fileId}, actual=${actualMd5}`);
                    this._failAllSubscribers(fileId, 'MD5 校验失败');
                    return;
                }
            }
            finalPath = this._promoteToStaging(fileId, fullPath);
        } catch (err) {
            relayLogger.warn(`[中继] 转入分站缓存失败，使用原路径: ${err.message}`);
        }

        this.fileIndex.set(fileId, { fileName, fullPath: finalPath, md5: fileId, local: true, isStaging: true });
        this._completeAllSubscribers(fileId, fileName, finalPath);
    }

    // =====================================================================
    // 工具方法
    // =====================================================================

    /**
     * 查找本地文件
     */
    _findLocalFile(fileId, fileName) {
        // 1. 先查文件索引
        const indexed = this.fileIndex.get(fileId);
        if (indexed && indexed.local && indexed.fullPath && fs.existsSync(indexed.fullPath)) {
            return indexed.fullPath;
        }

        // 2. 查沿途分站缓存仓库 (.staging/<md5>.blob)
        if (fileId) {
            const stagingPath = this._getStagingPath(fileId);
            if (fs.existsSync(stagingPath)) {
                this.fileIndex.set(fileId, { fileName: fileName || fileId, fullPath: stagingPath, md5: fileId, local: true, isStaging: true });
                return stagingPath;
            }
        }

        // 3. 回退：在 received 目录中按文件名查找
        if (fileName) {
            const filePath = path.join(this.receivedDir, fileName);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }

        return null;
    }

    /**
     * 检查消息是否重复
     */
    _isDuplicate(msgId) {
        if (this.seenMsgIds.has(msgId)) return true;
        this._markSeen(msgId);
        return false;
    }

    /**
     * 标记消息已见
     */
    _markSeen(msgId) {
        this.seenMsgIds.add(msgId);
        this.msgIdQueue.push(msgId);
        // 淘汰旧记录
        if (this.msgIdQueue.length > this.MAX_SEEN_IDS) {
            const old = this.msgIdQueue.shift();
            this.seenMsgIds.delete(old);
        }
    }

    /**
     * 获取本机所有 IPv4 地址
     */
    _getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push(iface.address);
                }
            }
        }
        return ips;
    }

    /**
     * IP 字符串转数值（用于比较大小）
     */
    _ipToNumber(ip) {
        const parts = ip.split('.').map(Number);
        return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
    }

    /**
     * 获取中继状态
     */
    getStatus() {
        const peerList = [];
        for (const peer of this.peers.values()) {
            peerList.push({
                id: peer.id,
                nodeId: peer.identity ? peer.identity.nodeId : null,
                nodeName: peer.identity ? peer.identity.nodeName : 'unknown',
                network: peer.identity ? peer.identity.network : '',
                direction: peer.isClient ? 'outbound' : 'inbound',
                url: peer.url || null
            });
        }

        return {
            enabled: this.peerUrls.length > 0 || this.peers.size > 0,
            relayReady: this.relayReady,
            isClient: this.isClient,
            peerUrl: this.peerUrl,
            peerUrls: this.peerUrls,
            peersCount: this.peers.size,
            connectedPeers: peerList,
            pendingPulls: this.pendingRelayPulls.size
        };
    }
}

module.exports = RelayService;
