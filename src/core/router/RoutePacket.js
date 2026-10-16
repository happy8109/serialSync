/**
 * RoutePacket.js
 * 统一网络层路由数据包 (Layer 3 Packet)
 * 
 * 职责：
 * 1. 规范跨网通信的源地址(src)、目标地址(dst)、跳数限制(ttl)与全局唯一标识(packetId)
 * 2. 提供高性能的二进制编解码 (toBuffer / fromBuffer)，用于物理串口信道传输
 * 3. 提供结构化的 JSON 序列化 (toJSON / fromJSON)，用于局域网 WebSocket 高速中继
 */

const MAGIC_BYTE = 0x52; // 'R' (Route)

class RoutePacket {
    /**
     * @param {Object} options
     * @param {string} options.src - 源节点标识，格式 "[网络名]/[节点名]"，如 "A网/A1"
     * @param {string} options.dst - 目标地址，如 "C网/C1"、"A网/*"、"*" (全网广播)
     * @param {number} [options.ttl=8] - 最大跳数限制 (Time-To-Live)，每经一跳减 1
     * @param {number} options.type - 业务协议帧类型 (如 0x10=MSG_TEXT, 0x15=FILE_NOTIFY, 0x30=API_CALL)
     * @param {number} [options.seq=0] - 业务序列号
     * @param {string} [options.packetId] - 全局唯一包标识，缺省自动生成
     * @param {Buffer|string|Object} [options.payload] - 业务数据载荷
     */
    constructor(options = {}) {
        this.src = options.src || '';
        this.dst = options.dst || '*';
        this.ttl = typeof options.ttl === 'number' ? options.ttl : 8;
        this.type = typeof options.type === 'number' ? options.type : 0x00;
        this.seq = typeof options.seq === 'number' ? options.seq : 0;

        // 全局唯一包 ID (源地址 + 时间戳 + 随机串)
        this.packetId = options.packetId || RoutePacket.generateId(this.src);

        // 统一 payload 为 Buffer 存储
        if (Buffer.isBuffer(options.payload)) {
            this.payload = options.payload;
        } else if (typeof options.payload === 'string') {
            this.payload = Buffer.from(options.payload, 'utf8');
        } else if (options.payload !== undefined && options.payload !== null) {
            this.payload = Buffer.from(JSON.stringify(options.payload), 'utf8');
        } else {
            this.payload = Buffer.alloc(0);
        }
    }

    /**
     * 生成全局唯一包标识
     * @param {string} src
     * @returns {string}
     */
    static generateId(src = 'node') {
        const cleanSrc = src.replace(/[\/\\:\s]/g, '_');
        const rand = Math.random().toString(36).substr(2, 6);
        return `${cleanSrc}_${Date.now()}_${rand}`;
    }

    /**
     * 是否为全网广播包
     * @returns {boolean}
     */
    isBroadcast() {
        return this.dst === '*' || this.dst === '*/*';
    }

    /**
     * 是否为指定网络广播包 (如 "A网/*")
     * @param {string} network
     * @returns {boolean}
     */
    isNetworkBroadcast(network) {
        if (!this.dst.includes('/*')) return false;
        const targetNet = this.dst.split('/')[0];
        return targetNet === '*' || targetNet === network;
    }

    /**
     * 检查目标地址是否匹配本地节点
     * @param {string} localNetwork - 本机网络名，如 "A网"
     * @param {string} localNodeName - 本机节点名，如 "A1"
     * @returns {boolean}
     */
    matchesDestination(localNetwork, localNodeName, localNodeId = '') {
        // 1. 全网广播
        if (this.isBroadcast()) return true;

        const [dstNet, dstNode] = this.dst.split('/');

        // 2. 匹配本机底层真 ID (8位纯字母)
        if (localNodeId && (this.dst === localNodeId || dstNode === localNodeId || dstNet === localNodeId)) {
            return true;
        }

        // 3. 网络内广播 (如 "A网/*")
        if (dstNet === localNetwork && (dstNode === '*' || !dstNode)) {
            return true;
        }

        // 4. 单播精确匹配 (如 "A网/A1" 或 "A网/nodeId")
        if (dstNet === localNetwork && (dstNode === localNodeName || (localNodeId && dstNode === localNodeId))) {
            return true;
        }

        // 5. 单段匹配 (无网络前缀，仅匹配节点名或真 ID)
        if (!dstNode && (dstNet === localNodeName || (localNodeId && dstNet === localNodeId))) {
            return true;
        }

        return false;
    }

    /**
     * 跳数递减
     * @returns {number} 剩余跳数
     */
    decrementTtl() {
        if (this.ttl > 0) {
            this.ttl -= 1;
        }
        return this.ttl;
    }

    /**
     * 序列化为紧凑的二进制 Buffer (用于串口信道传输)
     * 
     * 格式结构：
     * [Magic(1B)=0x52] + [TTL(1B)] + [Flags(1B)] + [Type(1B)] + [Seq(4B)] +
     * [srcLen(1B)] + [src(NB)] + [dstLen(1B)] + [dst(MB)] +
     * [idLen(1B)] + [packetId(KB)] + [Payload(Remains)]
     * 
     * @returns {Buffer}
     */
    toBuffer() {
        const srcBuf = Buffer.from(this.src, 'utf8');
        const dstBuf = Buffer.from(this.dst, 'utf8');
        const idBuf = Buffer.from(this.packetId, 'utf8');

        if (srcBuf.length > 255 || dstBuf.length > 255 || idBuf.length > 255) {
            throw new Error('RoutePacket: Address or ID string exceeds 255 bytes limit');
        }

        const flags = (this.isBroadcast() ? 0x01 : 0x00);
        const headerLen = 1 + 1 + 1 + 1 + 4 + (1 + srcBuf.length) + (1 + dstBuf.length) + (1 + idBuf.length);
        const totalLen = headerLen + this.payload.length;

        const buf = Buffer.alloc(totalLen);
        let offset = 0;

        buf.writeUInt8(MAGIC_BYTE, offset++);             // Magic
        buf.writeUInt8(this.ttl & 0xFF, offset++);        // TTL
        buf.writeUInt8(flags, offset++);                  // Flags
        buf.writeUInt8(this.type & 0xFF, offset++);       // Type
        buf.writeUInt32BE(this.seq >>> 0, offset); offset += 4; // Seq

        buf.writeUInt8(srcBuf.length, offset++);          // srcLen
        srcBuf.copy(buf, offset); offset += srcBuf.length;

        buf.writeUInt8(dstBuf.length, offset++);          // dstLen
        dstBuf.copy(buf, offset); offset += dstBuf.length;

        buf.writeUInt8(idBuf.length, offset++);          // idLen
        idBuf.copy(buf, offset); offset += idBuf.length;

        if (this.payload.length > 0) {
            this.payload.copy(buf, offset);
        }

        return buf;
    }

    /**
     * 从二进制 Buffer 反序列化 RoutePacket
     * @param {Buffer} buffer
     * @returns {RoutePacket|null} 若非合法的 RoutePacket 则返回 null
     */
    static fromBuffer(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
            return null;
        }

        let offset = 0;
        const magic = buffer.readUInt8(offset++);
        if (magic !== MAGIC_BYTE) {
            return null;
        }

        try {
            const ttl = buffer.readUInt8(offset++);
            const flags = buffer.readUInt8(offset++);
            const type = buffer.readUInt8(offset++);
            const seq = buffer.readUInt32BE(offset); offset += 4;

            const srcLen = buffer.readUInt8(offset++);
            if (offset + srcLen > buffer.length) return null;
            const src = buffer.toString('utf8', offset, offset + srcLen);
            offset += srcLen;

            const dstLen = buffer.readUInt8(offset++);
            if (offset + dstLen > buffer.length) return null;
            const dst = buffer.toString('utf8', offset, offset + dstLen);
            offset += dstLen;

            const idLen = buffer.readUInt8(offset++);
            if (offset + idLen > buffer.length) return null;
            const packetId = buffer.toString('utf8', offset, offset + idLen);
            offset += idLen;

            const payload = buffer.slice(offset);

            return new RoutePacket({
                src,
                dst,
                ttl,
                type,
                seq,
                packetId,
                payload
            });
        } catch (err) {
            return null;
        }
    }

    /**
     * 快速检查 Buffer 是否为 RoutePacket 格式
     * @param {Buffer} buffer 
     * @returns {boolean}
     */
    static isRoutePacketBuffer(buffer) {
        return Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer[0] === MAGIC_BYTE;
    }

    /**
     * 序列化为结构化 JSON (用于 WebSocket 局域网传输)
     * @returns {Object}
     */
    toJSON() {
        return {
            packetId: this.packetId,
            src: this.src,
            dst: this.dst,
            ttl: this.ttl,
            type: this.type,
            seq: this.seq,
            payloadBase64: this.payload.toString('base64'),
            payloadLength: this.payload.length
        };
    }

    /**
     * 从结构化 JSON 反序列化 RoutePacket
     * @param {Object} json
     * @returns {RoutePacket}
     */
    static fromJSON(json) {
        if (!json || typeof json !== 'object') {
            throw new Error('RoutePacket.fromJSON: invalid json input');
        }

        let payloadBuf;
        if (json.payloadBase64) {
            payloadBuf = Buffer.from(json.payloadBase64, 'base64');
        } else if (json.payload) {
            if (Buffer.isBuffer(json.payload)) {
                payloadBuf = json.payload;
            } else if (typeof json.payload === 'string') {
                payloadBuf = Buffer.from(json.payload, 'utf8');
            } else {
                payloadBuf = Buffer.from(JSON.stringify(json.payload), 'utf8');
            }
        } else {
            payloadBuf = Buffer.alloc(0);
        }

        return new RoutePacket({
            packetId: json.packetId,
            src: json.src,
            dst: json.dst,
            ttl: typeof json.ttl === 'number' ? json.ttl : 8,
            type: typeof json.type === 'number' ? json.type : 0x00,
            seq: typeof json.seq === 'number' ? json.seq : 0,
            payload: payloadBuf
        });
    }
}

module.exports = RoutePacket;
