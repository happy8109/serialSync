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
            nodeName: os.hostname(),
            network: ''
        };

        // 消息去重（保留最近 500 条 msgId）
        this.seenMsgIds = new Set();
        this.msgIdQueue = [];
        this.MAX_SEEN_IDS = 500;

        // 文件中继：待处理拉取请求表
        // Map<fileId, { direction: 'serial'|'relay', requestedAt: number, reqId: string }>
        this.pendingRelayPulls = new Map();
        this.PULL_TIMEOUT = 300000; // 拉取超时 5 分钟

        // 文件接收目录
        this.receivedDir = path.join(process.cwd(), 'received');

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

    /**
     * 设置节点身份
     */
    setIdentity(identity) {
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network) this.identity.network = identity.network;
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
                        try { peer.ws.close(); } catch (e) {}
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
                relayLogger.info(`[中继] 对端握手: ${data.network ? '[' + data.network + '] ' : ''}${data.nodeName}`);

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
                this._handleRelayPullReq(data);
                break;

            case 'file_pull_resp':
                this._handleRelayPullResp(data);
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
    async requestFilePull(fileId, fileName) {
        // 1. 检查本地是否有文件
        const localFile = this._findLocalFile(fileId, fileName);
        if (localFile) {
            return { available: true, fullPath: localFile };
        }

        // 1.5 防死锁检测：如果本地正在通过串口接收该文件，无需向外重复请求，直接挂起等待接收完成
        if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
            relayLogger.info(`[中继] 本地 WebUI 拉取文件，但文件已在串口接收中: ${fileId}，进入就绪等待`);
            const reqId = `pull_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            this.pendingRelayPulls.set(fileId, {
                direction: 'local',
                requestedAt: Date.now(),
                reqId,
                fileName
            });
            return { available: false, pulling: true, reqId, status: 'receiving' };
        }

        // 2. 发起拉取请求
        const reqId = `pull_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // 记录待处理请求（来自 local/WebUI）
        this.pendingRelayPulls.set(fileId, {
            direction: 'local',
            requestedAt: Date.now(),
            reqId,
            fileName
        });

        // 优先通过路由引擎广播拉取
        if (this.routeEngine) {
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.routeEngine.send({
                type: PT.FILE_RELAY_REQ,
                dst: '*',
                payload: body,
                priority: 1
            });
        } else if (this.relayReady) {
            // 优先通过 relay 对端拉取（LAN 快）
            this._sendToPeer({
                action: 'file_pull_req',
                data: { reqId, fileId, fileName }
            });
        } else if (this.scheduler) {
            // 通过串口请求
            const body = Buffer.from(JSON.stringify({ reqId, fileId, fileName }), 'utf8');
            this.scheduler.enqueue(PT.FILE_RELAY_REQ, 0, body, 1);
        } else {
            this.pendingRelayPulls.delete(fileId);
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

            // 检查本地是否有文件
            const localFile = this._findLocalFile(fileId, fileName);
            if (localFile) {
                relayLogger.info(`[中继] 本地找到文件，直接通过串口发送: ${localFile}`);
                // 通知上层发起 FILE_OFFER（由 AppController 处理）
                this.emit('relay_send_file', { fileId, fileName, fullPath: localFile });
                return;
            }

            // 防死锁：若本地正在从串口接收该文件，将请求登记为挂起，接收完成后自动向串口回送
            if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
                relayLogger.info(`[中继] 本地正在接收该文件 (${fileId})，暂缓向外拉取，等待接收完成`);
                this.pendingRelayPulls.set(fileId, {
                    direction: 'serial',
                    requestedAt: Date.now(),
                    reqId,
                    fileName
                });
                return;
            }

            // 本地没有，记录请求方向（来自串口），转发给 relay 对端
            this.pendingRelayPulls.set(fileId, {
                direction: 'serial',
                requestedAt: Date.now(),
                reqId,
                fileName
            });

            if (this.relayReady) {
                relayLogger.info(`[中继] 本地无文件，转发拉取请求到 LAN 对端`);
                this._sendToPeer({
                    action: 'file_pull_req',
                    data: { reqId, fileId, fileName }
                });
            } else {
                // 无 relay 对端可用，返回错误
                relayLogger.warn(`[中继] 本地无文件且无 relay 对端，拉取失败`);
                this.pendingRelayPulls.delete(fileId);
                const resp = { reqId, fileId, status: 'not_found', error: '文件不存在' };
                const body = Buffer.from(JSON.stringify(resp), 'utf8');
                this.scheduler.enqueue(PT.FILE_RELAY_RESP, 0, body, 1);
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
    _handleRelayPullReq(data) {
        const { reqId, fileId, fileName } = data;

        relayLogger.info(`[中继] LAN 收到文件拉取请求: ${fileName} (${fileId})`);

        // 检查本地是否有文件
        const localFile = this._findLocalFile(fileId, fileName);
        if (localFile) {
            relayLogger.info(`[中继] 本地找到文件，返回下载地址`);
            this._sendToPeer({
                action: 'file_pull_resp',
                data: {
                    reqId, fileId,
                    available: true,
                    downloadUrl: `/api/relay/file/${fileId}`
                }
            });
            return;
        }

        // 防死锁：检查是否正在通过串口接收该文件
        if (this.fileTransferService && this.fileTransferService.isReceiving(fileId)) {
            relayLogger.info(`[中继] 文件正在接收中 (${fileId})，暂缓向外拉取，待接收完成后自动回传`);
            this.pendingRelayPulls.set(fileId, {
                direction: 'relay',
                requestedAt: Date.now(),
                reqId,
                fileName
            });
            return;
        }

        // 本地没有且未在接收，记录请求方向（来自 relay），转发到串口
        this.pendingRelayPulls.set(fileId, {
            direction: 'relay',
            requestedAt: Date.now(),
            reqId,
            fileName
        });

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
            this.pendingRelayPulls.delete(fileId);
            this._sendToPeer({
                action: 'file_pull_resp',
                data: { reqId, fileId, available: false, error: '无串口链路可用' }
            });
        }
    }

    /**
     * 处理从 relay 对端收到的文件拉取响应
     */
    _handleRelayPullResp(data) {
        const { reqId, fileId, available, downloadUrl, error } = data;

        relayLogger.info(`[中继] LAN 收到拉取响应: ${available ? '可用' : '不可用'} for ${fileId}`);

        const pending = this.pendingRelayPulls.get(fileId);
        if (!pending) {
            relayLogger.debug(`[中继] 无匹配的待处理拉取请求: ${fileId}`);
            return;
        }

        if (available && downloadUrl) {
            // 从 LAN 对端下载文件
            this._downloadFromPeer(fileId, pending.fileName, downloadUrl, pending.direction);
        } else {
            // 拉取失败
            relayLogger.warn(`[中继] 文件拉取失败: ${error || '未知错误'}`);

            if (pending.direction === 'serial' && this.scheduler) {
                // 回传错误给串口请求方
                const resp = { reqId, fileId, status: 'not_found', error: error || '文件不存在' };
                const body = Buffer.from(JSON.stringify(resp), 'utf8');
                this.scheduler.enqueue(PT.FILE_RELAY_RESP, 0, body, 1);
            }

            this.pendingRelayPulls.delete(fileId);
            // 通知本地 WebUI
            this.emit('relay_pull_failed', { fileId, error: error || '文件不存在' });
        }
    }

    /**
     * 从 LAN 对端下载文件
     */
    _downloadFromPeer(fileId, fileName, downloadUrl, requestDirection) {
        const peerUrlObj = new URL(this.peerUrl);
        const fullUrl = `http://${peerUrlObj.hostname}:${peerUrlObj.port}${downloadUrl}`;

        relayLogger.info(`[中继] 从 LAN 对端下载文件: ${fullUrl}`);

        // 确保 received 目录存在
        if (!fs.existsSync(this.receivedDir)) {
            fs.mkdirSync(this.receivedDir, { recursive: true });
        }

        const filePath = path.join(this.receivedDir, fileName);
        const fileStream = fs.createWriteStream(filePath);

        http.get(fullUrl, (res) => {
            if (res.statusCode !== 200) {
                relayLogger.error(`[中继] 下载失败: HTTP ${res.statusCode}`);
                fileStream.close();
                fs.unlinkSync(filePath);
                this.pendingRelayPulls.delete(fileId);
                this.emit('relay_pull_failed', { fileId, error: `HTTP ${res.statusCode}` });
                return;
            }

            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                relayLogger.info(`[中继] LAN 下载完成: ${filePath}`);

                // 更新文件索引
                this.fileIndex.set(fileId, { fileName, fullPath: filePath, local: true });

                // 根据请求来源方向，回传文件
                if (requestDirection === 'serial') {
                    // 串口方向请求的 → 通过串口发送文件
                    relayLogger.info(`[中继] 向串口方向转发文件: ${fileName}`);
                    this.emit('relay_send_file', { fileId, fileName, fullPath: filePath });
                } else if (requestDirection === 'local') {
                    // 本地 WebUI 请求的 → 通知 WebUI 文件已就绪
                    this.emit('relay_pull_complete', { fileId, fileName, fullPath: filePath });
                }
                // relay 方向的请求不应在此处理（file_pull_resp 已经响应了）

                this.pendingRelayPulls.delete(fileId);
            });
        }).on('error', (err) => {
            relayLogger.error(`[中继] LAN 下载错误: ${err.message}`);
            fileStream.close();
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            this.pendingRelayPulls.delete(fileId);
            this.emit('relay_pull_failed', { fileId, error: err.message });
        });
    }

    /**
     * 文件接收完成回调（当串口接收到文件后，检查是否有待处理的 relay/local 拉取请求）
     * 由 AppController 在文件传输完成时调用
     */
    onFileReceived(fileId, fileName, fullPath) {
        // 更新文件索引
        this.fileIndex.set(fileId, { fileName, fullPath, local: true });

        // 检查是否有待处理的中继拉取请求
        const pending = this.pendingRelayPulls.get(fileId);
        if (pending) {
            if (pending.direction === 'relay') {
                // relay 方向请求的 → 通过 LAN 回传文件下载地址
                relayLogger.info(`[中继] 文件到达，回传给 LAN 对端: ${fileName}`);
                this._sendToPeer({
                    action: 'file_pull_resp',
                    data: {
                        reqId: pending.reqId,
                        fileId,
                        available: true,
                        downloadUrl: `/api/relay/file/${fileId}`
                    }
                });
                this.pendingRelayPulls.delete(fileId);
            } else if (pending.direction === 'local') {
                // 本地 WebUI 之前挂起的拉取
                relayLogger.info(`[中继] 接收完成，通知本地 WebUI 文件已就绪: ${fileName}`);
                this.emit('relay_pull_complete', { fileId, fileName, fullPath });
                this.pendingRelayPulls.delete(fileId);
            } else if (pending.direction === 'serial') {
                // 串口方向请求的 → 发送文件至串口对端
                relayLogger.info(`[中继] 接收完成，向串口对端发送文件: ${fileName}`);
                this.emit('relay_send_file', { fileId, fileName, fullPath });
                this.pendingRelayPulls.delete(fileId);
            }
        }
    }

    // =====================================================================
    // 工具方法
    // =====================================================================

    /**
     * 查找本地文件
     */
    _findLocalFile(fileId, fileName) {
        // 先查文件索引
        const indexed = this.fileIndex.get(fileId);
        if (indexed && indexed.local && indexed.fullPath && fs.existsSync(indexed.fullPath)) {
            return indexed.fullPath;
        }

        // 回退：在 received 目录中按文件名查找
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
