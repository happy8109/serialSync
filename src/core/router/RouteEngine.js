/**
 * RouteEngine.js
 * 全系统网络层路由交换中枢 (Layer 3 Routing Engine)
 * 
 * 核心机制：
 * 1. 统一通信接口抽象 (Link Abstraction)：物理串口与局域网 WebSocket 统一定义为 Link
 * 2. 路由交换决策：本地交付、泛洪扩散 (水平分割 Split-Horizon)、单播逐跳转发
 * 3. 动态拓扑感知：基于接收报文自学习邻居与网络可达性 (Self-Learning Routing Table)
 * 4. 三重环路熔断保护：packetId 去重 + TTL 逐跳递减 + 水平分割绝不原路回弹
 */

const EventEmitter = require('events');
const os = require('os');
const RoutePacket = require('./RoutePacket');
const { logger } = require('../../utils/logger');
const routeLogger = logger.create('RouteEngine');

class RouteEngine extends EventEmitter {
    /**
     * @param {Object} options
     * @param {Object} [options.identity] - 节点身份 { nodeName, network }
     * @param {number} [options.maxSeenPackets=1000] - 去重队列上限
     * @param {number} [options.defaultTtl=8] - 缺省跳数
     */
    constructor(options = {}) {
        super();

        // 节点身份与地址
        this.identity = {
            nodeId: (options.identity && options.identity.nodeId) || '',
            nodeName: (options.identity && options.identity.nodeName) || os.hostname(),
            network: (options.identity && options.identity.network) || ''
        };

        // 活跃通信链路集合: Map<linkId, { id, type: 'serial'|'lan', send: Function, isReady: Function }>
        this.links = new Map();

        // 去重滑动窗口 (packetId 去重)
        this.seenPacketIds = new Set();
        this.seenQueue = [];
        this.maxSeenPackets = options.maxSeenPackets || 1000;

        // 缺省 TTL
        this.defaultTtl = options.defaultTtl || 8;

        // 动态路由缓存表: Map<targetNetwork, { linkId, lastUpdated, hopCount }>
        this.routeTable = new Map();
        this.ROUTE_EXPIRE_MS = 60000; // 路由项 60s 老化刷新
    }

    /**
     * 获取本机标准格式地址: "[网络名]/[节点名]"
     * @returns {string}
     */
    get localAddress() {
        return `${this.identity.network ? this.identity.network : 'default'}/${this.identity.nodeName}`;
    }

    /**
     * 更新节点身份
     * @param {Object} identity
     */
    setIdentity(identity) {
        if (!identity) return;
        if (identity.nodeId) this.identity.nodeId = identity.nodeId;
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network !== undefined) this.identity.network = identity.network;
        routeLogger.info(`[路由] 节点身份更新: ${this.localAddress} (id=${this.identity.nodeId || 'none'})`);
    }

    // =========================================================================
    // 链路管理 (Link Management)
    // =========================================================================

    /**
     * 注册通信链路
     * @param {string} linkId - 链路唯一标识，如 "serial", "lan:192.168.1.102"
     * @param {Object} link - 链路适配接口
     * @param {'serial'|'lan'} link.type - 链路介质类型
     * @param {Function} link.send - 发送方法 (packet: RoutePacket, priority: number) => boolean
     * @param {Function} link.isReady - 是否就绪 () => boolean
     */
    registerLink(linkId, link) {
        if (!link || typeof link.send !== 'function') {
            throw new Error(`RouteEngine: Link ${linkId} must implement send() method`);
        }

        this.links.set(linkId, {
            id: linkId,
            type: link.type || 'unknown',
            send: link.send,
            isReady: typeof link.isReady === 'function' ? link.isReady : () => true
        });

        routeLogger.info(`[路由] 注册通信链路: ${linkId} (${link.type})`);
        this.emit('links_changed', this.getLinksStatus());
    }

    /**
     * 注销通信链路
     * @param {string} linkId
     */
    unregisterLink(linkId) {
        if (this.links.has(linkId)) {
            this.links.delete(linkId);
            routeLogger.warn(`[路由] 注销通信链路: ${linkId}`);

            // 清理与该链路关联的路由条目
            for (const [net, entry] of this.routeTable.entries()) {
                if (entry.linkId === linkId) {
                    this.routeTable.delete(net);
                }
            }

            this.emit('links_changed', this.getLinksStatus());
        }
    }

    /**
     * 获取所有链路状态
     * @returns {Array<Object>}
     */
    getLinksStatus() {
        const result = [];
        for (const [id, link] of this.links) {
            result.push({
                id,
                type: link.type,
                ready: link.isReady()
            });
        }
        return result;
    }

    // =========================================================================
    // 路由核心处理引擎 (Packet Routing & Forwarding)
    // =========================================================================

    /**
     * 接收外部链路送达的路由数据包
     * @param {RoutePacket} packet - 路由包对象
     * @param {string} fromLinkId - 来源链路标识，如 "serial" 或 "lan:peer1"
     */
    handleIncomingPacket(packet, fromLinkId) {
        if (!packet || !(packet instanceof RoutePacket)) {
            routeLogger.error('[路由] 收到无效的报文格式');
            return;
        }

        // 1. 防环第一关：全局 packetId 去重
        if (this._isDuplicate(packet.packetId)) {
            routeLogger.debug(`[路由] 命中去重缓存，丢弃重复包: ${packet.packetId}`);
            return;
        }
        this._markSeen(packet.packetId);

        // 2. 自学习路由表：记录源网络经由 fromLinkId 可达
        this._learnRoute(packet.src, fromLinkId);

        // 3. 防环第二关：检查并扣减 TTL
        if (packet.ttl <= 0) {
            routeLogger.warn(`[路由] 跳数超限 (TTL<=0)，阻断包: ${packet.packetId} from=${packet.src} dst=${packet.dst}`);
            return;
        }

        // 4. 本地消费判定
        const isForLocal = packet.matchesDestination(this.identity.network, this.identity.nodeName, this.identity.nodeId);
        if (isForLocal) {
            routeLogger.debug(`[路由] 本地交付: ${packet.packetId} type=0x${packet.type.toString(16)} src=${packet.src}`);
            this.emit('local_packet', packet);
        }

        // 5. 转发判定
        const isBroadcast = packet.isBroadcast();
        const isNetBroadcast = packet.isNetworkBroadcast(this.identity.network);

        // 扣减跳数（准备向下一跳转发）
        packet.decrementTtl();

        if (isBroadcast || isNetBroadcast) {
            // 广播报文：向除进站链路以外的所有活跃链路泛洪扩散 (水平分割 Split-Horizon)
            this._floodExcept(packet, fromLinkId);
        } else if (!isForLocal) {
            // 目标非本机的单播报文：定向路由转发
            this._forwardUnicast(packet, fromLinkId);
        }
    }

    /**
     * 本地应用服务发起主动发送
     * @param {Object} options
     * @param {number} options.type - 协议帧类型
     * @param {string} [options.dst='*'] - 目标地址
     * @param {Buffer|string|Object} options.payload - 载荷
     * @param {number} [options.priority=1] - 优先级 (0-3)
     * @param {number} [options.seq=0] - 序列号
     * @param {number} [options.ttl] - 自定义 TTL
     * @returns {RoutePacket}
     */
    send(options) {
        const packet = new RoutePacket({
            src: this.localAddress,
            dst: options.dst || '*',
            type: options.type,
            seq: options.seq || 0,
            ttl: options.ttl || this.defaultTtl,
            payload: options.payload
        });

        // 标记自身发出的包已见，防止未来回绕
        this._markSeen(packet.packetId);

        const priority = typeof options.priority === 'number' ? options.priority : 1;

        if (packet.isBroadcast()) {
            // 广播包：向所有活跃链路发送
            this._floodAll(packet, priority);
        } else {
            // 单播包：定向投递
            this._forwardUnicast(packet, null, priority);
        }

        return packet;
    }

    // =========================================================================
    // 内部转发与路由算法
    // =========================================================================

    /**
     * 向指定除外的链路泛洪广播 (水平分割 Split-Horizon)
     */
    _floodExcept(packet, excludeLinkId, priority = 1) {
        for (const [linkId, link] of this.links) {
            if (linkId === excludeLinkId) continue; // 绝不回原路
            if (!link.isReady()) continue;

            try {
                link.send(packet, priority);
                routeLogger.debug(`[路由] 泛洪扩散 -> ${linkId} (packet=${packet.packetId})`);
            } catch (err) {
                routeLogger.error(`[路由] 泛洪失败 -> ${linkId}: ${err.message}`);
            }
        }
    }

    /**
     * 向所有活跃链路广播
     */
    _floodAll(packet, priority = 1) {
        this._floodExcept(packet, null, priority);
    }

    /**
     * 单播定向转发
     */
    _forwardUnicast(packet, excludeLinkId, priority = 1) {
        const [targetNet] = packet.dst.split('/');

        // 1. 查找路由表
        const route = this.routeTable.get(targetNet);
        if (route && route.linkId !== excludeLinkId) {
            const link = this.links.get(route.linkId);
            if (link && link.isReady()) {
                routeLogger.info(`[路由] 定向命中路由表: 目标=${targetNet} -> 链路=${route.linkId} (packet=${packet.packetId})`);
                link.send(packet, priority);
                return;
            }
        }

        // 2. 路由表未收敛或失效时的兜底策略：向除进站链路外的所有其他链路转发探索
        routeLogger.debug(`[路由] 目标网络 ${targetNet} 未知，泛洪转发寻址 (packet=${packet.packetId})`);
        this._floodExcept(packet, excludeLinkId, priority);
    }

    /**
     * 自学习路由更新
     */
    _learnRoute(srcAddress, fromLinkId) {
        if (!srcAddress || !fromLinkId) return;
        const [srcNet] = srcAddress.split('/');
        if (!srcNet || srcNet === this.identity.network) return; // 不学习本网条目

        const now = Date.now();
        const existing = this.routeTable.get(srcNet);

        if (!existing || existing.linkId !== fromLinkId || (now - existing.lastUpdated > 10000)) {
            this.routeTable.set(srcNet, {
                linkId: fromLinkId,
                lastUpdated: now
            });
            routeLogger.debug(`[路由] 自学习路由更新: 目标网络 [${srcNet}] -> 下一跳 [${fromLinkId}]`);
        }
    }

    /**
     * 去重检查
     */
    _isDuplicate(packetId) {
        return this.seenPacketIds.has(packetId);
    }

    /**
     * 标记已见
     */
    _markSeen(packetId) {
        if (!packetId) return;
        this.seenPacketIds.add(packetId);
        this.seenQueue.push(packetId);

        if (this.seenQueue.length > this.maxSeenPackets) {
            const oldest = this.seenQueue.shift();
            this.seenPacketIds.delete(oldest);
        }
    }

    /**
     * 获取路由表与状态摘要
     */
    getStatus() {
        const routes = {};
        for (const [net, r] of this.routeTable) {
            routes[net] = { linkId: r.linkId, ageSeconds: Math.round((Date.now() - r.lastUpdated) / 1000) };
        }

        return {
            localAddress: this.localAddress,
            activeLinks: this.getLinksStatus(),
            cachedRoutes: routes,
            seenPacketsCount: this.seenPacketIds.size
        };
    }
}

module.exports = RouteEngine;
