/**
 * TunnelService.js
 * 负责跨网 TCP 端口转发与隧道多路复用 (Phase 5)
 * 协议类型:
 *   PT.TUNNEL_CTRL (0x40) - 隧道生命周期控制 (OPEN_REQ, OPEN_ACK, OPEN_REJ, CLOSE_REQ)
 *   PT.TUNNEL_DATA (0x41) - 二进制 TCP 流量透明透传
 * 
 * 架构特点:
 *   1. 零二进制依赖：纯 Node.js 原生 net 模块驱动，免编译、免集成终端。
 *   2. 双向多路复用：一个物理链路支持多会话并发，Session 隔离。
 *   3. 协议无关：不仅支持 SSH (Xshell/PuTTY)，还可穿透 RDP、MySQL、Web 等任何 TCP 服务。
 *   4. 白名单防护：受控端可配置 targetWhitelist，防止未授权内网穿透。
 */

const net = require('net');
const EventEmitter = require('events');
const os = require('os');
const { logger } = require('../../utils/logger');
const tunnelLogger = logger.create('Tunnel');

const PT = {
    TUNNEL_CTRL: 0x40,
    TUNNEL_DATA: 0x41
};

const CTRL_CMD = {
    OPEN_REQ: 'OPEN_REQ',
    OPEN_ACK: 'OPEN_ACK',
    OPEN_REJ: 'OPEN_REJ',
    CLOSE_REQ: 'CLOSE_REQ'
};

const MAX_CHUNK_SIZE = 1024; // 串口链路友好切片大小

class TunnelService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.routeEngine = null;

        // 本节点身份
        this.identity = {
            nodeName: os.hostname(),
            network: ''
        };

        // 安全与行为配置
        this.config = {
            enabled: true,
            allowRemoteTunnel: true,
            targetWhitelist: ['127.0.0.1:22', '127.0.0.1:23', '127.0.0.1:3389'], // 默认受控白名单
            clientTunnels: [] // 本地发起的监听隧道
        };

        // 控制端 TCP 服务器 Map<tunnelId, { server, config, listening }>
        this.servers = new Map();

        // 控制端发起的会话 Map<sessionId, Session>
        // Session: { sessionId, tunnelId, clientSocket, targetNode, targetHost, targetPort, status, pendingData, bytesIn, bytesOut }
        this.clientSessions = new Map();

        // 受控端承接的会话 Map<sessionId, Session>
        // Session: { sessionId, targetSocket, clientNode, bytesIn, bytesOut }
        this.targetSessions = new Map();

        this._sessionCounter = 0;
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    setRouteEngine(routeEngine) {
        this.routeEngine = routeEngine;
    }

    setIdentity(identity) {
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network) this.identity.network = identity.network;
    }

    setConfig(cfg = {}) {
        if (!cfg) return;
        if (cfg.enabled !== undefined) this.config.enabled = !!cfg.enabled;
        if (cfg.allowRemoteTunnel !== undefined) this.config.allowRemoteTunnel = !!cfg.allowRemoteTunnel;
        if (Array.isArray(cfg.targetWhitelist)) this.config.targetWhitelist = cfg.targetWhitelist;

        if (Array.isArray(cfg.clientTunnels)) {
            this.config.clientTunnels = cfg.clientTunnels;
            // 重新同步并启动本地监听服务
            this.syncTunnels(this.config.clientTunnels);
        }
    }

    getInterestedTypes() {
        return [PT.TUNNEL_CTRL, PT.TUNNEL_DATA];
    }

    // =========================================================================
    // 控制端本地 TCP Server 管理 (Port Forwarder)
    // =========================================================================

    /**
     * 批量同步配置中的本地监听隧道
     * @param {Array<Object>} tunnelsConfig
     */
    syncTunnels(tunnelsConfig = []) {
        const activeIds = new Set(tunnelsConfig.map(t => t.id || `tunnel_${t.localPort}`));

        // 停止不在配置中的旧服务器
        for (const [id, entry] of this.servers.entries()) {
            if (!activeIds.has(id)) {
                this.stopTunnel(id);
            }
        }

        // 启动新增或更新的隧道服务器
        for (const t of tunnelsConfig) {
            const id = t.id || `tunnel_${t.localPort}`;
            if (!this.servers.has(id)) {
                this.startTunnel({ ...t, id });
            }
        }
    }

    /**
     * 启动一个本地端口转发隧道监听服务
     * @param {Object} tunnelConfig
     * @param {string} tunnelConfig.id - 隧道唯一ID
     * @param {number} tunnelConfig.localPort - 本机监听端口 (如 2222)
     * @param {string} [tunnelConfig.localHost='127.0.0.1'] - 本机监听网卡 (127.0.0.1 更安全)
     * @param {string} tunnelConfig.targetNode - 目标节点或网络 (如 "C网/C1" 或 "C1")
     * @param {string} tunnelConfig.targetHost - 目标真实服务主机 (如 "127.0.0.1")
     * @param {number} tunnelConfig.targetPort - 目标真实服务端口 (如 22)
     */
    startTunnel(tunnelConfig) {
        const { id, localPort, localHost = '127.0.0.1', targetNode, targetHost, targetPort } = tunnelConfig;

        if (!localPort || !targetNode || !targetPort) {
            tunnelLogger.error(`[隧道] 启动失败，参数不完整: ${JSON.stringify(tunnelConfig)}`);
            return false;
        }

        if (this.servers.has(id)) {
            tunnelLogger.warn(`[隧道] ${id} 已存在，忽略重复创建`);
            return true;
        }

        const server = net.createServer((clientSocket) => {
            this._handleClientConnection(id, tunnelConfig, clientSocket);
        });

        server.on('error', (err) => {
            tunnelLogger.error(`[隧道] Server 异常 (${id} on ${localHost}:${localPort}): ${err.message}`);
            this.emit('tunnel_error', { id, error: err.message });
        });

        server.listen(localPort, localHost, () => {
            tunnelLogger.info(`[隧道] 启动成功: 本地 [${localHost}:${localPort}] ⇄ 跨网 [${targetNode} -> ${targetHost}:${targetPort}]`);
            this.servers.set(id, {
                id,
                server,
                config: tunnelConfig,
                listening: true
            });
            this.emit('tunnel_started', tunnelConfig);
        });

        return true;
    }

    /**
     * 停止指定的本地隧道监听服务
     * @param {string} id
     */
    stopTunnel(id) {
        const entry = this.servers.get(id);
        if (!entry) return;

        tunnelLogger.info(`[隧道] 停止本地隧道监听: ${id}`);
        try {
            entry.server.close();
        } catch (e) {}
        this.servers.delete(id);

        // 销毁属于该隧道的活跃客户端连接
        for (const [sessionId, session] of this.clientSessions.entries()) {
            if (session.tunnelId === id) {
                this._closeClientSession(sessionId, 'Tunnel stopped');
            }
        }

        this.emit('tunnel_stopped', { id });
    }

    /**
     * 处理外部软件连入本地端口 (如 Xshell 连入 127.0.0.1:2222)
     */
    _handleClientConnection(tunnelId, tunnelConfig, clientSocket) {
        const sessionId = `${this.identity.nodeName}_tun_${++this._sessionCounter}_${Date.now()}`;
        const { targetNode, targetHost, targetPort } = tunnelConfig;

        tunnelLogger.info(`[隧道] 外部客户端连接就绪: session=${sessionId} -> 目标=${targetNode}(${targetHost}:${targetPort})`);

        const session = {
            sessionId,
            tunnelId,
            clientSocket,
            targetNode,
            targetHost,
            targetPort,
            status: 'opening', // opening -> connected -> closed
            pendingData: [],
            createdAt: Date.now(),
            bytesIn: 0,
            bytesOut: 0
        };

        this.clientSessions.set(sessionId, session);

        // 1. 发起跨网建立请求 OPEN_REQ
        this._sendTunnelCtrl(targetNode, {
            command: CTRL_CMD.OPEN_REQ,
            sessionId,
            targetHost,
            targetPort
        });

        // 2. 监听外部 socket 读写
        clientSocket.on('data', (chunk) => {
            session.bytesIn += chunk.length;
            if (session.status === 'connected') {
                this._sliceAndSendData(session.targetNode, sessionId, chunk);
            } else {
                // 连接尚未握手确认前，先暂存数据
                session.pendingData.push(chunk);
            }
        });

        clientSocket.on('close', () => {
            tunnelLogger.debug(`[隧道] 外部客户端断开: session=${sessionId}`);
            this._closeClientSession(sessionId, 'Client disconnected');
        });

        clientSocket.on('error', (err) => {
            tunnelLogger.warn(`[隧道] 外部客户端 Socket 异常: session=${sessionId}, err=${err.message}`);
            this._closeClientSession(sessionId, err.message);
        });
    }

    /**
     * 切片并通过 RouteEngine 发送 TUNNEL_DATA 载荷
     */
    _sliceAndSendData(targetDst, sessionId, buffer) {
        for (let offset = 0; offset < buffer.length; offset += MAX_CHUNK_SIZE) {
            const slice = buffer.slice(offset, Math.min(offset + MAX_CHUNK_SIZE, buffer.length));
            const packed = this._packDataPayload(sessionId, slice);

            if (this.routeEngine) {
                this.routeEngine.send({
                    type: PT.TUNNEL_DATA,
                    dst: targetDst,
                    payload: packed,
                    priority: 1
                });
            } else if (this.scheduler) {
                this.scheduler.enqueue(PT.TUNNEL_DATA, 0, packed, 1);
            }
        }
    }

    /**
     * 发送控制信令
     */
    _sendTunnelCtrl(targetDst, ctrlObj) {
        const body = Buffer.from(JSON.stringify(ctrlObj), 'utf8');
        if (this.routeEngine) {
            this.routeEngine.send({
                type: PT.TUNNEL_CTRL,
                dst: targetDst,
                payload: body,
                priority: 1
            });
        } else if (this.scheduler) {
            this.scheduler.enqueue(PT.TUNNEL_CTRL, 0, body, 1);
        }
    }

    // =========================================================================
    // 报文分发与核心逻辑 (Frame / Packet Handling)
    // =========================================================================

    /**
     * 处理收到的协议帧 (由 ServiceManager 或 RouteEngine 触发)
     */
    handleFrame(frame) {
        if (!this.config.enabled) return;

        const srcNode = frame.route ? frame.route.src : '*';

        if (frame.type === PT.TUNNEL_CTRL) {
            this._handleTunnelCtrl(frame.body, srcNode);
        } else if (frame.type === PT.TUNNEL_DATA) {
            this._handleTunnelData(frame.body);
        }
    }

    /**
     * 控制帧信令处理 (OPEN_REQ, OPEN_ACK, OPEN_REJ, CLOSE_REQ)
     */
    _handleTunnelCtrl(bodyBuf, srcNode) {
        try {
            const ctrl = JSON.parse(bodyBuf.toString('utf8'));
            const { command, sessionId, targetHost, targetPort, error } = ctrl;

            switch (command) {
                case CTRL_CMD.OPEN_REQ:
                    this._onReceiveOpenReq(sessionId, targetHost, targetPort, srcNode);
                    break;

                case CTRL_CMD.OPEN_ACK:
                    this._onReceiveOpenAck(sessionId);
                    break;

                case CTRL_CMD.OPEN_REJ:
                    this._onReceiveOpenRej(sessionId, error);
                    break;

                case CTRL_CMD.CLOSE_REQ:
                    this._onReceiveCloseReq(sessionId);
                    break;

                default:
                    tunnelLogger.warn(`[隧道] 未知控制指令: ${command}`);
            }
        } catch (err) {
            tunnelLogger.error(`[隧道] 解析控制帧失败: ${err.message}`);
        }
    }

    /**
     * 受控端收到 OPEN_REQ: 连接本地目标服务
     */
    _onReceiveOpenReq(sessionId, targetHost, targetPort, clientNode) {
        tunnelLogger.info(`[隧道] 收到穿透连接请求: session=${sessionId} 来源=${clientNode} -> ${targetHost}:${targetPort}`);

        // 1. 安全白名单审查
        if (!this._isTargetAllowed(targetHost, targetPort)) {
            tunnelLogger.warn(`[隧道] 拒绝未授权目标访问: ${targetHost}:${targetPort}`);
            this._sendTunnelCtrl(clientNode, {
                command: CTRL_CMD.OPEN_REJ,
                sessionId,
                error: `Target ${targetHost}:${targetPort} not permitted by whitelist`
            });
            return;
        }

        // 2. 连接本地真实 TCP 服务
        const targetSocket = net.createConnection({ host: targetHost, port: targetPort }, () => {
            tunnelLogger.info(`[隧道] 成功连接本地目标服务: session=${sessionId} (${targetHost}:${targetPort})`);

            const session = {
                sessionId,
                targetSocket,
                clientNode,
                createdAt: Date.now(),
                bytesIn: 0,
                bytesOut: 0
            };
            this.targetSessions.set(sessionId, session);

            // 回复控制端 OPEN_ACK
            this._sendTunnelCtrl(clientNode, {
                command: CTRL_CMD.OPEN_ACK,
                sessionId
            });
        });

        targetSocket.on('data', (chunk) => {
            const session = this.targetSessions.get(sessionId);
            if (session) {
                session.bytesOut += chunk.length;
                this._sliceAndSendData(session.clientNode, sessionId, chunk);
            }
        });

        targetSocket.on('close', () => {
            tunnelLogger.debug(`[隧道] 目标服务断开: session=${sessionId}`);
            this._closeTargetSession(sessionId, true);
        });

        targetSocket.on('error', (err) => {
            tunnelLogger.warn(`[隧道] 目标服务 Socket 异常: session=${sessionId}, err=${err.message}`);
            // 如果是在握手建立前报错，回复 OPEN_REJ
            if (!this.targetSessions.has(sessionId)) {
                this._sendTunnelCtrl(clientNode, {
                    command: CTRL_CMD.OPEN_REJ,
                    sessionId,
                    error: err.message
                });
            } else {
                this._closeTargetSession(sessionId, true);
            }
        });
    }

    /**
     * 控制端收到 OPEN_ACK: 隧道握手成功
     */
    _onReceiveOpenAck(sessionId) {
        const session = this.clientSessions.get(sessionId);
        if (!session) return;

        tunnelLogger.info(`[隧道] 跨网隧道完全建立: session=${sessionId}`);
        session.status = 'connected';

        // 刷新建立前暂存的握手报文 (如 SSH-2.0-xxx banner)
        if (session.pendingData.length > 0) {
            for (const chunk of session.pendingData) {
                this._sliceAndSendData(session.targetNode, sessionId, chunk);
            }
            session.pendingData = [];
        }
    }

    /**
     * 控制端收到 OPEN_REJ: 远端拒绝
     */
    _onReceiveOpenRej(sessionId, error) {
        tunnelLogger.warn(`[隧道] 目标拒绝连接: session=${sessionId}, reason=${error}`);
        this._closeClientSession(sessionId, `Rejected: ${error}`);
    }

    /**
     * 任意一端收到 CLOSE_REQ: 对端请求断开
     */
    _onReceiveCloseReq(sessionId) {
        if (this.clientSessions.has(sessionId)) {
            this._closeClientSession(sessionId, 'Remote requested close', false);
        }
        if (this.targetSessions.has(sessionId)) {
            this._closeTargetSession(sessionId, false);
        }
    }

    /**
     * 数据帧处理 (PT.TUNNEL_DATA)
     */
    _handleTunnelData(bodyBuf) {
        const unpacked = this._unpackDataPayload(bodyBuf);
        if (!unpacked) return;

        const { sessionId, payload } = unpacked;

        // 1. 如果本节点是控制端，写入外部客户端 socket
        const clientSession = this.clientSessions.get(sessionId);
        if (clientSession && clientSession.clientSocket) {
            clientSession.bytesOut += payload.length;
            clientSession.clientSocket.write(payload);
            return;
        }

        // 2. 如果本节点是受控端，写入目标真实服务 socket
        const targetSession = this.targetSessions.get(sessionId);
        if (targetSession && targetSession.targetSocket) {
            targetSession.bytesIn += payload.length;
            targetSession.targetSocket.write(payload);
        }
    }

    // =========================================================================
    // 会话生命周期与清理
    // =========================================================================

    _closeClientSession(sessionId, reason, notifyRemote = true) {
        const session = this.clientSessions.get(sessionId);
        if (!session) return;

        this.clientSessions.delete(sessionId);

        if (session.clientSocket) {
            try { session.clientSocket.destroy(); } catch (e) {}
        }

        if (notifyRemote && session.targetNode) {
            this._sendTunnelCtrl(session.targetNode, {
                command: CTRL_CMD.CLOSE_REQ,
                sessionId
            });
        }

        tunnelLogger.debug(`[隧道] 控制端会话销毁: session=${sessionId}, reason=${reason}`);
    }

    _closeTargetSession(sessionId, notifyRemote = true) {
        const session = this.targetSessions.get(sessionId);
        if (!session) return;

        this.targetSessions.delete(sessionId);

        if (session.targetSocket) {
            try { session.targetSocket.destroy(); } catch (e) {}
        }

        if (notifyRemote && session.clientNode) {
            this._sendTunnelCtrl(session.clientNode, {
                command: CTRL_CMD.CLOSE_REQ,
                sessionId
            });
        }

        tunnelLogger.debug(`[隧道] 受控端会话销毁: session=${sessionId}`);
    }

    /**
     * 链路故障或系统停止时回收全部活跃会话
     */
    closeAllSessions() {
        tunnelLogger.warn('[隧道] 回收所有跨网活跃隧道会话');
        for (const sessionId of Array.from(this.clientSessions.keys())) {
            this._closeClientSession(sessionId, 'System reset', false);
        }
        for (const sessionId of Array.from(this.targetSessions.keys())) {
            this._closeTargetSession(sessionId, false);
        }
    }

    /**
     * 停止所有服务与监听
     */
    stop() {
        this.closeAllSessions();
        for (const id of Array.from(this.servers.keys())) {
            this.stopTunnel(id);
        }
    }

    // =========================================================================
    // 安全白名单校验与编解码辅助
    // =========================================================================

    _isTargetAllowed(host, port) {
        if (!this.config.allowRemoteTunnel) return false;
        if (!this.config.targetWhitelist || this.config.targetWhitelist.length === 0) return false;

        const target = `${host}:${port}`.toLowerCase();
        for (const rule of this.config.targetWhitelist) {
            const r = String(rule).toLowerCase().trim();
            if (r === '*' || r === '*:*') return true;
            if (r === target) return true;
            if (r === String(port)) return true; // 仅指定端口
        }
        return false;
    }

    /**
     * 封包: [2B idLen] + [idBytes] + [raw payload]
     */
    _packDataPayload(sessionId, buffer) {
        const idBuf = Buffer.from(sessionId, 'utf8');
        const out = Buffer.alloc(2 + idBuf.length + buffer.length);
        out.writeUInt16BE(idBuf.length, 0);
        idBuf.copy(out, 2);
        buffer.copy(out, 2 + idBuf.length);
        return out;
    }

    /**
     * 解包: 提取 sessionId 与原始 payload
     */
    _unpackDataPayload(buf) {
        if (!buf || buf.length < 2) return null;
        const idLen = buf.readUInt16BE(0);
        if (buf.length < 2 + idLen) return null;
        const sessionId = buf.slice(2, 2 + idLen).toString('utf8');
        const payload = buf.slice(2 + idLen);
        return { sessionId, payload };
    }

    /**
     * 获取状态快照供 WebUI / 监控展现
     */
    getStatus() {
        const tunnels = [];
        for (const [id, entry] of this.servers.entries()) {
            tunnels.push({
                id,
                localPort: entry.config.localPort,
                localHost: entry.config.localHost || '127.0.0.1',
                targetNode: entry.config.targetNode,
                targetHost: entry.config.targetHost,
                targetPort: entry.config.targetPort,
                listening: entry.listening
            });
        }

        return {
            enabled: this.config.enabled,
            allowRemoteTunnel: this.config.allowRemoteTunnel,
            whitelist: this.config.targetWhitelist,
            tunnels,
            activeClientSessions: this.clientSessions.size,
            activeTargetSessions: this.targetSessions.size
        };
    }
}

module.exports = TunnelService;
