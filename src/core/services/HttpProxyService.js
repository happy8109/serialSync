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

        // Scheduler
        this.scheduler = null;

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
    // Client Side: Invoke Remote Service
    // =========================================================================

    /**
     * Call a remote service
     */
    async pullService(serviceId, params = {}, timeout = 30000) {
        const requestId = this._generateRequestId();
        const request = {
            id: requestId,
            service: serviceId,
            params
        };

        const payload = Buffer.from(JSON.stringify(request));

        // P1 Priority
        this.scheduler.enqueue(PT.CALL, 0, payload, 1);
        this.logger.info(`[PULL] Requesting ${serviceId} (${requestId})`);

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

        const { id, service, params } = request;

        // 1. Strict Whitelist Check
        if (!this.localServices.has(service)) {
            return this._sendResult(id, 500, null, `Service not found: ${service}`);
        }

        const svc = this.localServices.get(service);
        if (!svc.enabled) {
            return this._sendResult(id, 500, null, `Service disabled: ${service}`);
        }

        // 2. HTTP Call
        try {
            const result = await this.callLocalHttp(svc.endpoint, params, {
                method: svc.method,
                headers: svc.headers,
                timeout: svc.timeout
            });

            // 3. Send Result (Segmented if needed)
            this._sendResult(id, 200, result);

        } catch (err) {
            this._sendResult(id, 500, null, err.message);
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

    _sendResult(requestId, status, data, error) {
        // threshold 4KB
        const CHUNK_SIZE = 4096;

        if (error || !data || data.length <= CHUNK_SIZE) {
            // Send single packet
            const payload = JSON.stringify({ id: requestId, status, data, error });
            this.scheduler.enqueue(PT.RESULT, 0, Buffer.from(payload), 1);
        } else {
            // Segmented
            const totalChunks = Math.ceil(data.length / CHUNK_SIZE);

            // 1. Header
            const header = JSON.stringify({
                id: requestId,
                status,
                chunked: true,
                total: totalChunks
            });
            this.scheduler.enqueue(PT.RESULT, 0, Buffer.from(header), 1);

            // 2. Chunks
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

    // =========================================================================
    // Service Discovery
    // =========================================================================

    async queryRemoteServices(filter = {}) {
        // Also trigger local health check immediately
        this._checkLocalServices();

        const id = this._generateRequestId();
        const payload = JSON.stringify({ id, filter });

        try {
            this.scheduler.enqueue(PT.QUERY, 0, Buffer.from(payload), 1);

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error('Query timeout'));
                }, 10000); // 10s timeout for query

                this.pendingRequests.set(id, { resolve, reject, timer });
            });
        } catch (err) {
            this.logger.warn('Failed to send service query (Serial not connected?)');
            return Promise.resolve([]); // Return empty list gracefully
        }
    }

    handleServiceQuery(frame) {
        let query;
        try { query = JSON.parse(frame.body.toString()); } catch (e) { return; }

        const { id, filter } = query;
        let services = Array.from(this.localServices.values()).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            version: s.version,
            mode: s.mode,          // 对端需要知道是否为网关模式
            method: s.method,
            enabled: s.enabled,
            params: s.params,
            status: s.status
        })); // Exclude endpoint!

        if (filter && filter.enabled) {
            services = services.filter(s => s.enabled);
        }

        const resp = JSON.stringify({ id, services });
        this.scheduler.enqueue(PT.LIST, 0, Buffer.from(resp), 1);
    }

    handleServiceList(frame) {
        let resp;
        try { resp = JSON.parse(frame.body.toString()); } catch (e) { return; }

        const { id, services } = resp;
        const pending = this.pendingRequests.get(id);

        // Cache them
        this.remoteServices.clear();
        services.forEach(s => this.remoteServices.set(s.id, s));

        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.resolve(services);
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
        return Array.from(this.remoteServices.values());
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
