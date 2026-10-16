/**
 * HttpProxyService.js
 * API Forwarding & Transparent Proxy Service
 * Protocol v2.3 (0x30-0x34)
 */

const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('config');
const { logger } = require('../../utils/logger');

// Packet Types
const PT = {
    CALL: 0x30,
    RESULT: 0x31,
    QUERY: 0x32,
    LIST: 0x33,
    CHUNK: 0x34
};

class HttpProxyService extends EventEmitter {
    constructor() {
        super();
        this.serviceId = 'http-proxy';
        this.logger = logger.create('HttpProxy');

        // Service Registry
        this.localServices = new Map();
        this.remoteServices = new Map();

        // Pending Requests
        this.pendingRequests = new Map();

        // Scheduler & RouteEngine
        this.scheduler = null;
        this.routeEngine = null;

        // Node Identity
        this.identity = { nodeName: '', network: '' };

        // Config Path for persistence
        this.configPath = path.join(process.cwd(), 'config', 'default.json');

        // Auto Discovery
        this.discoveryTimer = null;
        const autoRegister = config.has('services.autoRegister') ? config.get('services.autoRegister') : false;
        if (autoRegister) {
            this.setAutoDiscovery(true);
        }

        // Start Health Check Loop
        this.healthCheckTimer = setInterval(() => this._checkLocalServices(), 30000); // Check every 30s
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    setRouteEngine(routeEngine) {
        this.routeEngine = routeEngine;
    }

    setIdentity(identity) {
        if (!identity) return;
        if (identity.nodeName) this.identity.nodeName = identity.nodeName;
        if (identity.network !== undefined) this.identity.network = identity.network;
    }

    setAutoDiscovery(enabled) {
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = null;
        }

        if (enabled) {
            this.logger.info('Auto-discovery enabled: broadcasting every 60s');
            // Initial broadcast
            setTimeout(() => this.queryRemoteServices().catch(() => { }), 1000);

            // Periodical broadcast
            this.discoveryTimer = setInterval(() => {
                this.queryRemoteServices().catch(err => {
                    // Ignore timeouts in auto-discovery as it's fire-and-forget for discovery
                });
            }, 60000); // 60s interval
        } else {
            this.logger.info('Auto-discovery disabled');
        }
    }

    getInterestedTypes() {
        return Object.values(PT);
    }

    /**
     * Handle incoming frames
     */
    handleFrame(frame) {
        try {
            switch (frame.type) {
                case PT.CALL:
                    this.handleServiceCall(frame);
                    break;
                case PT.RESULT:
                    this.handleServiceResult(frame);
                    break;
                case PT.QUERY:
                    this.handleServiceQuery(frame);
                    break;
                case PT.LIST:
                    this.handleServiceList(frame);
                    break;
                case PT.CHUNK:
                    this.handleServiceChunk(frame);
                    break;
            }
        } catch (err) {
            this.logger.error(`Error handling frame type ${frame.type}`, err);
        }
    }

    // =========================================================================
    // Service Management & Persistence
    // =========================================================================

    /**
     * Load services from config module
     */
    loadServicesFromConfig(cfg) {
        const services = cfg.has('services.localServices') ? cfg.get('services.localServices') : {};

        for (const [id, svcConfig] of Object.entries(services)) {
            if (svcConfig.enabled !== false) {
                this.registerService(id, svcConfig, false); // false = no persist during load
            }
        }
        this.logger.info(`Loaded ${this.localServices.size} local services`);
    }

    /**
     * Register a local service
     * @param {string} id 
     * @param {Object} config 
     * @param {boolean} persist - Whether to save to disk
     */
    registerService(id, config, persist = true) {
        this.localServices.set(id, {
            id,
            name: config.name || id,
            description: config.description || '',
            version: config.version || '1.0',
            endpoint: config.endpoint,
            mode: config.mode || 'exact',
            method: config.method || 'GET',
            timeout: config.timeout || 10000,
            headers: config.headers || {},
            params: config.params || {},
            enabled: config.enabled !== false,
            status: 'unknown',
            lastCheck: 0
        });

        if (persist) {
            this._persistConfig();
        }

        // Trigger immediate check
        this._checkServiceHealth(this.localServices.get(id));
    }

    /**
     * Persist current services to config/default.json
     */
    async _persistConfig() {
        try {
            let currentConfig = {};
            if (fs.existsSync(this.configPath)) {
                currentConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            }

            if (!currentConfig.services) currentConfig.services = {};
            if (!currentConfig.services.localServices) currentConfig.services.localServices = {};

            // Update localServices from memory
            for (const [id, svc] of this.localServices) {
                const entry = {
                    name: svc.name,
                    description: svc.description,
                    version: svc.version,
                    endpoint: svc.endpoint,
                    method: svc.method,
                    timeout: svc.timeout,
                    enabled: svc.enabled,
                    headers: svc.headers,
                    params: svc.params
                };
                if (svc.mode === 'gateway') entry.mode = 'gateway';
                currentConfig.services.localServices[id] = entry;
            }

            fs.writeFileSync(this.configPath, JSON.stringify(currentConfig, null, 2), 'utf8');
            this.logger.info('Config persisted to disk');
        } catch (err) {
            this.logger.error('Failed to persist config', err);
        }
    }

    /**
     * Unregister a local service
     * @param {string} id 
     * @param {boolean} persist
     */
    unregisterService(id, persist = true) {
        if (this.localServices.has(id)) {
            this.localServices.delete(id);

            if (persist) {
                try {
                    let currentConfig = {};
                    if (fs.existsSync(this.configPath)) {
                        currentConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                    }

                    if (currentConfig.services && currentConfig.services.localServices) {
                        delete currentConfig.services.localServices[id];
                        fs.writeFileSync(this.configPath, JSON.stringify(currentConfig, null, 2), 'utf8');
                        this.logger.info(`Service ${id} data removed from config`);
                    }
                } catch (e) {
                    this.logger.error('Failed to update config for removal:', e);
                }
            }
        }
    }

    // =========================================================================
    // Client Side: Invoke Remote or Local Service
    // =========================================================================

    /**
     * Call a service (Local direct execution or remote multi-network routing)
     */
    async pullService(serviceId, params = {}, timeout = 30000) {
        // 1. 如果请求的是本地服务，直接本地执行（零网络开销）
        if (this.localServices.has(serviceId)) {
            return await this._callLocalService(serviceId, params);
        }

        // 2. 解析目标网络与真实服务名称
        let targetDst = '*';
        let actualServiceId = serviceId;

        if (serviceId.includes('/')) {
            const parts = serviceId.split('/');
            const targetNet = parts[0];
            actualServiceId = parts.slice(1).join('/');

            // 查询已知远程服务条目
            const remote = this.remoteServices.get(serviceId);
            if (remote && remote.targetNode) {
                targetDst = remote.targetNode;
            } else {
                targetDst = `${targetNet}/*`;
            }
        } else if (this.remoteServices.has(serviceId)) {
            const remote = this.remoteServices.get(serviceId);
            if (remote && remote.targetNode) {
                targetDst = remote.targetNode;
            } else if (remote && remote.network) {
                targetDst = `${remote.network}/*`;
            }
        }

        const requestId = this._generateRequestId();
        const request = {
            id: requestId,
            service: actualServiceId,
            caller: this.routeEngine ? this.routeEngine.localAddress : '',
            params
        };

        const payload = Buffer.from(JSON.stringify(request));

        if (this.routeEngine) {
            this.routeEngine.send({
                type: PT.CALL,
                dst: targetDst,
                payload,
                priority: 1
            });
            this.logger.info(`[PULL] Requesting ${serviceId} -> dst=${targetDst} (${requestId})`);
        } else if (this.scheduler) {
            this.scheduler.enqueue(PT.CALL, 0, payload, 1);
            this.logger.info(`[PULL] Requesting ${serviceId} via Serial (${requestId})`);
        } else {
            throw new Error('No transport available to call service');
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Service call timeout: ${serviceId}`));
            }, timeout);

            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timer,
                chunks: [], // For reassembly
                totalChunks: 0
            });
        });
    }

    /**
     * 直接在本地执行本地注册的 API 服务
     */
    async _callLocalService(serviceId, params = {}) {
        if (!this.localServices.has(serviceId)) {
            throw new Error(`Local service not found: ${serviceId}`);
        }
        const svc = this.localServices.get(serviceId);
        if (!svc.enabled) {
            throw new Error(`Local service disabled: ${serviceId}`);
        }

        let endpoint = svc.endpoint;
        let method = svc.method;
        let targetHeaders = { ...svc.headers };
        let reqBody = null;

        if (params.__gateway) {
            if (svc.mode === 'gateway') {
                const gatewayMeta = params.__gateway;
                method = gatewayMeta.method || 'GET';
                if (gatewayMeta.path) {
                    const baseUrl = endpoint.replace(/\/+$/, '');
                    const subPath = gatewayMeta.path.startsWith('/') ? gatewayMeta.path : `/${gatewayMeta.path}`;
                    endpoint = `${baseUrl}${subPath}`;
                }
            }
            delete params.__gateway;
        }

        if (params.__headers) {
            const inboundHeaders = params.__headers;
            const skipHeaders = ['host', 'connection', 'content-length'];
            for (const [k, v] of Object.entries(inboundHeaders)) {
                if (!skipHeaders.includes(k.toLowerCase())) {
                    targetHeaders[k] = v;
                }
            }
            delete params.__headers;
        }

        if (params.__body !== undefined) {
            reqBody = params.__body;
            delete params.__body;
        }

        const callParams = reqBody !== null ? reqBody : params;
        return await this.callLocalHttp(endpoint, callParams, {
            method,
            headers: targetHeaders,
            timeout: svc.timeout
        });
    }

    /**
     * Handle header packet (0x31) or small response
     */
    handleServiceResult(frame) {
        let response;
        try {
            response = JSON.parse(frame.body.toString());
        } catch (err) {
            this.logger.error('Invalid JSON in SERVICE_RESULT');
            return;
        }

        const { id, status, data, error, chunked, total } = response;
        const pending = this.pendingRequests.get(id);

        if (!pending) return; // Cleanup timed out request

        if (error) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.reject(new Error(error));
            return;
        }

        if (chunked) {
            // Prepare for chunks
            pending.totalChunks = total;
            pending.chunks = new Array(total);
            this.logger.info(`[CHUNK] Expecting ${total} chunks for ${id}`);
        } else {
            // Direct success
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.resolve(data);
        }
    }

    /**
     * Handle chunk (0x34)
     */
    handleServiceChunk(frame) {
        let chunk;
        try {
            chunk = JSON.parse(frame.body.toString());
        } catch (err) { return; }

        const { id, seq, total, data } = chunk;
        const pending = this.pendingRequests.get(id);

        if (!pending) return;

        pending.chunks[seq] = data;

        // Check if complete
        let receivedCount = 0;
        let totalSize = 0;
        for (let i = 0; i < total; i++) {
            if (pending.chunks[i]) {
                receivedCount++;
                totalSize += pending.chunks[i].length;
            }
        }

        if (receivedCount === total) {
            this.logger.info(`[CHUNK] Reassembled ${id}, size: ${totalSize}`);
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);

            // Reassemble
            const fullData = pending.chunks.join('');
            pending.resolve(fullData);
        }
    }


    // =========================================================================
    // Server Side: Handle Incoming Call
    // =========================================================================

    async handleServiceCall(frame) {
        let request;
        try {
            request = JSON.parse(frame.body.toString());
        } catch (e) { return; }

        const { id, service, params, caller } = request;
        const targetCaller = caller || (frame.route ? frame.route.src : '*');

        // 1. Strict Whitelist Check
        if (!this.localServices.has(service)) {
            return this._sendResult(id, 500, null, `Service not found: ${service}`, targetCaller);
        }

        const svc = this.localServices.get(service);
        if (!svc.enabled) {
            return this._sendResult(id, 500, null, `Service disabled: ${service}`, targetCaller);
        }

        // Meta Extraction
        let endpoint = svc.endpoint;
        let method = svc.method;
        let targetHeaders = { ...svc.headers };
        let reqBody = null;

        // Extract metadata from params
        if (params.__gateway) {
            if (svc.mode === 'gateway') {
                const gatewayMeta = params.__gateway;
                method = gatewayMeta.method || 'GET';
                
                if (gatewayMeta.path) {
                    const baseUrl = endpoint.replace(/\/+$/, '');
                    const subPath = gatewayMeta.path.startsWith('/') ? gatewayMeta.path : `/${gatewayMeta.path}`;
                    endpoint = `${baseUrl}${subPath}`;
                }
            }
            delete params.__gateway;
        }

        if (params.__headers) {
            // Merge headers (excluding host and connection to avoid conflicts)
            const inboundHeaders = params.__headers;
            const skipHeaders = ['host', 'connection', 'content-length'];
            for (const [k, v] of Object.entries(inboundHeaders)) {
                if (!skipHeaders.includes(k.toLowerCase())) {
                    targetHeaders[k] = v;
                }
            }
            delete params.__headers;
        }

        if (params.__body !== undefined) {
            reqBody = params.__body;
            delete params.__body;
        }

        // 2. HTTP Call
        try {
            // For gateway mode with explicit body, we pass it down
            const callParams = reqBody !== null ? reqBody : params;
            
            const result = await this.callLocalHttp(endpoint, callParams, {
                method: method,
                headers: targetHeaders,
                timeout: svc.timeout
            });

            // 3. Send Result (Segmented if needed)
            this._sendResult(id, 200, result, null, targetCaller);

        } catch (err) {
            this._sendResult(id, 500, null, err.message, targetCaller);
        }
    }

    async callLocalHttp(endpoint, params, options) {
        const url = require('url');
        const parsedUrl = url.parse(endpoint);
        const method = options.method || 'GET';

        return new Promise((resolve, reject) => {
            let path = parsedUrl.path;
            let postData = null;

            if (method === 'GET') {
                const qs = new URLSearchParams(params).toString();
                if (qs) path += '?' + qs;
            } else {
                postData = JSON.stringify(params);
            }

            const httpMod = parsedUrl.protocol === 'https:' ? https : http;
            const req = httpMod.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                timeout: options.timeout
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
                    else reject(new Error(`HTTP ${res.statusCode}`));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

            if (postData) req.write(postData);
            req.end();
        });
    }

    _sendResult(requestId, status, data, error, caller = null) {
        // threshold 4KB
        const CHUNK_SIZE = 4096;

        if (this.routeEngine && caller) {
            if (error || !data || data.length <= CHUNK_SIZE) {
                const payload = Buffer.from(JSON.stringify({ id: requestId, status, data, error }));
                this.routeEngine.send({
                    type: PT.RESULT,
                    dst: caller,
                    payload,
                    priority: 1
                });
            } else {
                const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
                const header = Buffer.from(JSON.stringify({
                    id: requestId,
                    status,
                    chunked: true,
                    total: totalChunks
                }));
                this.routeEngine.send({
                    type: PT.RESULT,
                    dst: caller,
                    payload: header,
                    priority: 1
                });

                for (let i = 0; i < totalChunks; i++) {
                    const chunkData = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    const chunkPacket = Buffer.from(JSON.stringify({
                        id: requestId,
                        seq: i,
                        total: totalChunks,
                        data: chunkData
                    }));
                    this.routeEngine.send({
                        type: PT.CHUNK,
                        dst: caller,
                        payload: chunkPacket,
                        priority: 1
                    });
                }
            }
            return;
        }

        // 回退至调度器发送
        if (this.scheduler) {
            if (error || !data || data.length <= CHUNK_SIZE) {
                const payload = JSON.stringify({ id: requestId, status, data, error });
                this.scheduler.enqueue(PT.RESULT, 0, Buffer.from(payload), 1);
            } else {
                const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
                const header = JSON.stringify({
                    id: requestId,
                    status,
                    chunked: true,
                    total: totalChunks
                });
                this.scheduler.enqueue(PT.RESULT, 0, Buffer.from(header), 1);

                for (let i = 0; i < totalChunks; i++) {
                    const chunkData = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    const chunkPacket = JSON.stringify({
                        id: requestId,
                        seq: i,
                        total: totalChunks,
                        data: chunkData
                    });
                    this.scheduler.enqueue(PT.CHUNK, 0, Buffer.from(chunkPacket), 1);
                }
            }
        }
    }

    // =========================================================================
    // Service Discovery
    // =========================================================================

    async queryRemoteServices(filter = {}) {
        // Also trigger local health check immediately
        this._checkLocalServices();

        const id = this._generateRequestId();
        const network = (this.identity && this.identity.network) || '';
        const caller = this.routeEngine ? this.routeEngine.localAddress : '';
        const payload = JSON.stringify({ id, filter, caller, network });

        try {
            if (this.routeEngine) {
                this.routeEngine.send({
                    type: PT.QUERY,
                    dst: '*',
                    payload: Buffer.from(payload),
                    priority: 1
                });
            } else if (this.scheduler) {
                this.scheduler.enqueue(PT.QUERY, 0, Buffer.from(payload), 1);
            }

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error('Query timeout'));
                }, 10000); // 10s timeout for query

                this.pendingRequests.set(id, { resolve, reject, timer });
            });
        } catch (err) {
            this.logger.warn('Failed to send service query');
            return Promise.resolve([]); // Return empty list gracefully
        }
    }

    handleServiceQuery(frame) {
        let query;
        try { query = JSON.parse(frame.body.toString()); } catch (e) { return; }

        const { id, filter, caller } = query;
        const targetCaller = caller || (frame.route ? frame.route.src : '*');
        const network = (this.identity && this.identity.network) || '';
        const nodeName = (this.identity && this.identity.nodeName) || '';

        let services = Array.from(this.localServices.values()).map(s => ({
            id: s.id,
            globalId: network ? `${network}/${s.id}` : s.id,
            name: s.name,
            description: s.description,
            version: s.version,
            mode: s.mode,          // 对端需要知道是否为网关模式
            method: s.method,
            enabled: s.enabled,
            params: s.params,
            status: s.status,
            network,
            nodeName
        }));

        if (filter && filter.enabled) {
            services = services.filter(s => s.enabled);
        }

        const resp = JSON.stringify({ id, services, network, nodeName });

        if (this.routeEngine && targetCaller) {
            this.routeEngine.send({
                type: PT.LIST,
                dst: targetCaller,
                payload: Buffer.from(resp),
                priority: 1
            });
        } else if (this.scheduler) {
            this.scheduler.enqueue(PT.LIST, 0, Buffer.from(resp), 1);
        }
    }

    handleServiceList(frame) {
        let resp;
        try { resp = JSON.parse(frame.body.toString()); } catch (e) { return; }

        const { id, services, network, nodeName } = resp;
        const pending = this.pendingRequests.get(id);

        if (Array.isArray(services)) {
            services.forEach(s => {
                const net = s.network || network || '';
                const node = s.nodeName || nodeName || '';
                const globalId = s.globalId || (net ? `${net}/${s.id}` : s.id);
                const targetNode = net && node ? `${net}/${node}` : (frame.route ? frame.route.src : null);

                const entry = {
                    ...s,
                    globalId,
                    network: net,
                    nodeName: node,
                    targetNode
                };

                this.remoteServices.set(globalId, entry);
                if (!this.remoteServices.has(s.id)) {
                    this.remoteServices.set(s.id, entry);
                }
            });
        }

        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.resolve(this.getRemoteServices());
        }
    }

    // =========================================================================
    // Util
    // =========================================================================

    _generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }

    getLocalServicesMeta() {
        return Array.from(this.localServices.values()).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            endpoint: s.endpoint,
            mode: s.mode,          // 暴露 mode 给前端
            method: s.method,
            enabled: s.enabled,
            status: s.status
        }));
    }

    getRemoteServices() {
        const seen = new Set();
        const result = [];
        for (const [key, s] of this.remoteServices) {
            const uniqueKey = s.globalId || s.id;
            if (!seen.has(uniqueKey)) {
                seen.add(uniqueKey);
                result.push(s);
            }
        }
        return result;
    }

    clearRemoteServices() {
        this.remoteServices.clear();
    }

    // =========================================================================
    // Health Check
    // =========================================================================

    _checkLocalServices() {
        for (const service of this.localServices.values()) {
            this._checkServiceHealth(service);
        }
    }

    async _checkServiceHealth(service) {
        if (!service.enabled) {
            service.status = 'unknown'; // Disabled services are not checked
            return;
        }

        try {
            // Simple probe
            const url = require('url');
            const parsedUrl = url.parse(service.endpoint);
            const httpMod = parsedUrl.protocol === 'https:' ? https : http;

            const reqHeaders = { ...service.headers, 'x-health-probe': '1' };
            const dummyBody = '{}';

            if (['POST', 'PUT', 'PATCH'].includes(service.method)) {
                if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
                    reqHeaders['Content-Type'] = 'application/json';
                }
                reqHeaders['Content-Length'] = Buffer.byteLength(dummyBody);
            }

            const req = httpMod.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.path,
                method: service.method, // Try with configured method
                headers: reqHeaders,
                agent: false, // 禁用连接池保持，以免长时间霸占串行带宽
                timeout: 5000 // 5s timeout
            }, res => {
                // Any HTTP response means the target server is listening and reachable.
                // Even 400, 404, 405, or 500 means it processed our health probe.
                service.status = 'online';
                service.lastCheck = Date.now();
                // 恢复为强力销毁连接，防止继续下载 Body 数据拖慢整个底层串口总线
                res.destroy();
            });

            req.on('error', (err) => {
                service.status = 'offline';
                service.lastCheck = Date.now();
                // this.logger.debug(`Service ${service.id} check failed: ${err.message}`);
            });

            req.on('timeout', () => {
                req.destroy();
                service.status = 'offline';
                service.lastCheck = Date.now();
            });

            if (['POST', 'PUT', 'PATCH'].includes(service.method)) {
                req.write(dummyBody);
            }

            req.end();

        } catch (err) {
            service.status = 'offline';
            service.lastCheck = Date.now();
        }
    }

    /**
     * Broadcast discovery query
     */
    broadcastDiscovery() {
        // Fire and forget, ignore timeouts to prevent unhandled rejections
        return this.queryRemoteServices().catch(err => {
            this.logger.debug('Broadcast discovery timeout (expected if no peers)');
        });
    }
}

module.exports = HttpProxyService;
