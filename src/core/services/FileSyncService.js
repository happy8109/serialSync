/**
 * FileSyncService.js
 * 负责后台文件同步逻辑 (P3 优先级)
 * 重构说明：强化订阅机制，独立路径计算，增强 recursive 扫描支持。
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { resolvePath } = require('../../utils/pathUtils');

const syncLogger = logger.create('FileSync');

const TYPE = {
    SYNC_LIST_REQ: 0x40,
    SYNC_LIST_RESP: 0x41,
    SYNC_PULL_REQ: 0x42,
    SYNC_SHARES_QUERY: 0x44,
    SYNC_SHARES_ANNOUNCE: 0x45
};

class FileSyncService extends EventEmitter {
    constructor() {
        super();
        this.scheduler = null;
        this.fileTransferService = null;
        this.tasks = new Map(); // id -> task
        this.timers = new Map(); // id -> interval object
        this.discoveredShares = new Map();

        this.pendingQueries = new Map();
        this.queryCounter = 0;
        this.peerActivities = new Map();
        this.runningTasks = new Set();
    }

    setScheduler(scheduler) { this.scheduler = scheduler; }

    setFileTransferService(service) {
        this.fileTransferService = service;
        this.fileTransferService.on('offer', (offerEvent) => this._handleFileOffer(offerEvent));
    }

    /**
     * 广播查询：询问对端有哪些公开共享
     */
    broadcastDiscovery() {
        this._sendJson(TYPE.SYNC_SHARES_QUERY, {}, 1);
    }

    /**
     * 核心逻辑：拦截 Offer。
     * 只有当本地【已订阅】且【允许 Pull/Both】且【路径有效】时，才会接过 Offer。
     */
    _handleFileOffer(offerEvent) {
        if (!offerEvent.meta?.shareId || !offerEvent.meta?.entryName) return;

        const { shareId, entryName } = offerEvent.meta;
        // 匹配本地启用的任务
        const task = Array.from(this.tasks.values()).find(t =>
            t.shareId.toLowerCase() === shareId.toLowerCase() &&
            t.enabled &&
            (t.direction === 'both' || t.direction === 'remoteToLocal')
        );

        if (!task) {
            syncLogger.debug(`Ignoring offer: No active subscription for ${shareId}`);
            return;
        }

        const entry = (task.entries || []).find(e => e.name === entryName);
        if (!entry || !entry.localPath) return;

        // 计算物理落地路径
        // 核心修复：确保落地路径是经过解析的绝对路径
        let targetDir = resolvePath(entry.localPath);
        try {
            if (fs.existsSync(targetDir) && fs.statSync(targetDir).isFile()) {
                targetDir = path.dirname(targetDir);
            }
        } catch (e) { }

        // 告诉底层引擎：这个文件我接收，请存到这里。
        offerEvent.handled = true;
        offerEvent.customSaveDir = targetDir;

        this._log(task.id, `同步落地: [${entryName}] ${offerEvent.name}`);
        syncLogger.info(`Accepted Sync file: ${offerEvent.name} -> ${targetDir}`);
    }

    updateTasks(tasksConfig) {
        if (!Array.isArray(tasksConfig)) return;
        const currentIds = new Set(tasksConfig.map(t => t.id));
        for (const id of this.tasks.keys()) {
            if (!currentIds.has(id)) { this._stopTask(id); this.tasks.delete(id); }
        }
        for (const config of tasksConfig) {
            this.tasks.set(config.id, config);
            if (config.enabled) this._startTask(config.id);
            else this._stopTask(config.id);
        }
    }

    _startTask(id) {
        this._stopTask(id);
        const task = this.tasks.get(id);
        if (!task) return;
        const interval = this._parseInterval(task.frequency || '1m');
        this.timers.set(id, setInterval(() => {
            this.runSync(id).catch(() => { });
        }, interval));
    }

    _stopTask(id) {
        if (this.timers.has(id)) {
            clearInterval(this.timers.get(id));
            this.timers.delete(id);
        }
        this.runningTasks.delete(id);
    }

    async runSync(taskId) {
        if (this.runningTasks.has(taskId)) return;
        const task = this.tasks.get(taskId);
        if (!task || !task.enabled) return;

        // 如果已有该 ShareID 的传输在进行，跳过探测，防止干扰
        if (this.fileTransferService.getActiveTransferCount({ shareId: task.shareId }) > 0) return;

        this.runningTasks.add(taskId);
        try {
            syncLogger.info(`Sync Cycle Started: ${task.name}`);

            // 扫描本地
            const localState = {};
            for (const entry of task.entries) {
                const realLocalPath = resolvePath(entry.localPath);
                if (fs.existsSync(realLocalPath)) {
                    localState[entry.name] = this._scanDir(realLocalPath);
                }
            }

            // 获取远端列表 (Pull Model)
            const remoteState = await this._getRemoteList(task.shareId).catch(() => null);
            if (!remoteState) return;

            for (const entry of task.entries) {
                const localFiles = localState[entry.name] || [];
                const remoteFiles = remoteState[entry.name] || [];
                const diff = this._computeDiff(localFiles, remoteFiles, task.direction);

                // Push
                for (const f of diff.push) {
                    const realLocalPath = resolvePath(entry.localPath);
                    const fullPath = fs.statSync(realLocalPath).isFile() ? realLocalPath : path.join(realLocalPath, f.name);
                    this._log(task.id, `推送更新: ${f.name}`);
                    await this.fileTransferService.sendFile(fullPath, 3, { shareId: task.shareId, entryName: entry.name, isHidden: true });
                }

                // Pull (主动请求对端发送)
                for (const f of diff.pull) {
                    this._log(task.id, `请求拉取: ${f.name}`);
                    this._sendJson(TYPE.SYNC_PULL_REQ, { shareId: task.shareId, entryName: entry.name, fileName: f.name }, 1);
                }
            }
        } catch (e) {
            syncLogger.error(`runSync Error [${task.name}]:`, e);
        } finally {
            this.runningTasks.delete(taskId);
        }
    }

    _scanDir(root, base = root) {
        if (!fs.existsSync(root)) return [];
        const stats = fs.statSync(root);
        if (stats.isFile()) return [{ name: path.basename(root), size: stats.size, mtime: stats.mtimeMs }];

        let results = [];
        try {
            const list = fs.readdirSync(root);
            for (const name of list) {
                const p = path.join(root, name);
                const s = fs.statSync(p);
                if (s.isDirectory()) {
                    results = results.concat(this._scanDir(p, base));
                } else {
                    results.push({ name: path.relative(base, p).replace(/\\/g, '/'), size: s.size, mtime: s.mtimeMs });
                }
            }
        } catch (e) { }
        return results;
    }

    _computeDiff(local, remote, direction) {
        const push = [], pull = [];
        const localMap = new Map(local.map(f => [f.name, f]));
        const remoteMap = new Map(remote.map(f => [f.name, f]));

        if (direction === 'localToRemote' || direction === 'both') {
            for (const lf of local) {
                const rf = remoteMap.get(lf.name);
                if (!rf || (lf.mtime > rf.mtime && Math.abs(lf.mtime - rf.mtime) > 2000)) push.push(lf);
            }
        }
        if (direction === 'remoteToLocal' || direction === 'both') {
            for (const rf of remote) {
                const lf = localMap.get(rf.name);
                if (!lf || (rf.mtime > lf.mtime && Math.abs(rf.mtime - lf.mtime) > 2000)) pull.push(rf);
            }
        }
        return { push, pull };
    }

    async _getRemoteList(shareId) {
        return new Promise((resolve, reject) => {
            const qid = this.queryCounter++;
            const t = setTimeout(() => { this.pendingQueries.delete(qid); reject('timeout'); }, 30000);
            this.pendingQueries.set(qid, (data) => { clearTimeout(t); resolve(data); });
            this._sendJson(TYPE.SYNC_LIST_REQ, { shareId, qid }, 1);
        });
    }

    _handleListReq(frame) {
        const req = JSON.parse(frame.body.toString());
        const task = Array.from(this.tasks.values()).find(t => t.shareId.toLowerCase() === req.shareId.toLowerCase() && t.enabled);
        if (!task) return this._sendJson(TYPE.SYNC_LIST_RESP, { qid: req.qid, error: 'Denied' }, 1);

        const res = {};
        for (const entry of task.entries) {
            const realLocalPath = resolvePath(entry.localPath);
            res[entry.name] = this._scanDir(realLocalPath);
        }
        this._sendJson(TYPE.SYNC_LIST_RESP, { qid: req.qid, entries: res }, 1);
    }

    _handleListResp(frame) {
        const resp = JSON.parse(frame.body.toString());
        const cb = this.pendingQueries.get(resp.qid);
        if (cb) { this.pendingQueries.delete(resp.qid); cb(resp.entries || {}); }
    }

    _handlePullReq(frame) {
        const req = JSON.parse(frame.body.toString());
        const task = Array.from(this.tasks.values()).find(t => t.shareId.toLowerCase() === req.shareId.toLowerCase() && t.enabled);
        if (!task) return;

        const entry = task.entries.find(e => e.name === req.entryName);
        if (!entry) return;

        const realLocalPath = resolvePath(entry.localPath);
        const fullPath = fs.statSync(realLocalPath).isFile() ? realLocalPath : path.join(realLocalPath, req.fileName);
        if (fs.existsSync(fullPath)) {
            this.fileTransferService.sendFile(fullPath, 3, { shareId: req.shareId, entryName: req.entryName, isHidden: true });
        }
    }

    handleFrame(frame) {
        switch (frame.type) {
            case TYPE.SYNC_LIST_REQ: this._handleListReq(frame); break;
            case TYPE.SYNC_LIST_RESP: this._handleListResp(frame); break;
            case TYPE.SYNC_PULL_REQ: this._handlePullReq(frame); break;
            case TYPE.SYNC_SHARES_QUERY: this._handleSharesQuery(frame); break;
            case TYPE.SYNC_SHARES_ANNOUNCE: this._handleSharesAnnounce(frame); break;
        }
    }

    _handleSharesQuery(frame) {
        const myShares = Array.from(this.tasks.values())
            .filter(t => t.enabled && t.direction !== 'remoteToLocal')
            .map(t => ({ shareId: t.shareId, name: t.name, description: t.description }));
        this._sendJson(TYPE.SYNC_SHARES_ANNOUNCE, { shares: myShares }, 1);
    }

    _handleSharesAnnounce(frame) {
        const data = JSON.parse(frame.body.toString());
        if (data.shares) {
            data.shares.forEach(s => this.discoveredShares.set(s.shareId, s));
            this.emit('discovery_update', Array.from(this.discoveredShares.values()));
        }
    }

    _parseInterval(freq) {
        const m = freq.match(/^(\d+)([smh])$/);
        if (!m) return 60000;
        const v = parseInt(m[1]);
        if (m[2] === 's') return v * 1000;
        if (m[2] === 'm') return v * 60000;
        if (m[2] === 'h') return v * 3600000;
        return 60000;
    }

    _sendJson(type, data, priority = 2) {
        if (this.scheduler) this.scheduler.enqueue(type, 0, Buffer.from(JSON.stringify(data)), priority);
    }

    _log(taskId, message, level = 'info') {
        this.emit('task_log', { taskId, message, level, timestamp: Date.now() });
    }

    getInterestedTypes() { return Object.values(TYPE); }
    getDiscoveredShares() { return Array.from(this.discoveredShares.values()); }
    getPeerActivities() { return {}; }
}

module.exports = FileSyncService;
