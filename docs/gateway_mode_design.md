# API 透明代理升级方案：Base URL 网关模式 (v3.0)

**版本**: v3.0  
**创建日期**: 2026-04-17  
**基于**: [api_forwarding_design.md](./api_forwarding_design.md) (v2.3)  
**状态**: 设计完成，待实现

---

## 一、升级背景

### 1.1 现有架构的局限

当前 API 透明代理采用**精确端点模式**：一个 `serviceId` 绑定一个固定的 HTTP endpoint URL。这对简单的单接口服务足够，但在面对 **多接口 REST API**（如 Ollama、Home Assistant、Grafana 等）时，需要为每个接口分别注册服务，维护成本高且不便于第三方集成。

### 1.2 升级目标

引入 **Base URL 网关模式 (Gateway Mode)**，一个 `serviceId` 覆盖目标服务的所有 API 路径，同时保持向后兼容。

```
旧模式 (精确端点):
  ollama-models → http://62.146.4.53:11434/api/tags         (GET)
  ollama-chat   → http://62.146.4.53:11434/api/generate     (POST)
  ollama-chat2  → http://62.146.4.53:11434/api/chat         (POST)
  每个接口一个 serviceId，需注册 N 个服务

新模式 (Base URL 网关):
  ollama        → http://62.146.4.53:11434                  (ANY)
  一个 serviceId 覆盖所有路径
  /api/proxy/ollama/api/tags      → GET  http://62.146.4.53:11434/api/tags
  /api/proxy/ollama/api/generate  → POST http://62.146.4.53:11434/api/generate
  /api/proxy/ollama/api/chat      → POST http://62.146.4.53:11434/api/chat
```

---

## 二、设计方案

### 2.1 服务注册模型扩展

在现有的服务配置中新增 `mode` 字段：

| 字段 | 类型 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `mode` | string | `"exact"` / `"gateway"` | `"exact"` | 代理模式 |

- **`exact` (精确模式)**: 现有行为，`endpoint` 是完整 URL，`method` 固定。
- **`gateway` (网关模式)**: `endpoint` 是 Base URL，子路径和 HTTP 方法由请求方动态指定。

#### 配置示例

```json
{
  "services": {
    "localServices": {
      "system_info": {
        "name": "系统信息",
        "endpoint": "http://localhost:8080/api/system/info",
        "method": "GET",
        "timeout": 10000,
        "enabled": true
      },
      "ollama": {
        "name": "Ollama 大语言模型",
        "description": "本地部署的 LLM 服务",
        "endpoint": "http://62.146.4.53:11434",
        "mode": "gateway",
        "timeout": 120000,
        "enabled": true
      }
    }
  }
}
```

> [!NOTE]
> 无 `mode` 字段的旧配置自动视为 `"exact"` 模式，完全向后兼容。

### 2.2 协议帧扩展

#### SERVICE_CALL (0x30) 帧体扩展

```json
// 旧格式 (精确模式，保持不变)
{
  "id": "req_xxx",
  "service": "system_info",
  "params": { "verbose": true }
}

// 新格式 (网关模式，新增 path 和 method 字段)
{
  "id": "req_xxx",
  "service": "ollama",
  "path": "/api/generate",
  "method": "POST",
  "params": { "model": "qwen2", "prompt": "你好", "stream": false }
}
```

**新增字段说明**:

| 字段 | 类型 | 条件 | 说明 |
| :--- | :--- | :--- | :--- |
| `path` | string | 网关模式必填 | 子路径，如 `/api/generate` |
| `method` | string | 网关模式可选 | HTTP 方法，默认使用客户端请求的方法 |

> [!IMPORTANT]
> `path` 字段只在 `mode: "gateway"` 的服务上生效。精确模式下即使携带 `path` 也会被忽略，确保向后兼容。

### 2.3 路由规则

#### ApiServer 路由变更

当前路由：
```
/api/proxy/:serviceId
```

升级后路由（新增通配）：
```
/api/proxy/:serviceId          → 精确模式 (保持不变)
/api/proxy/:serviceId/*        → 网关模式 (新增)
```

**路径提取逻辑**:
```
请求: GET /api/proxy/ollama/api/tags?model=qwen2
  → serviceId = "ollama"
  → subPath   = "/api/tags"
  → query     = { model: "qwen2" }
  → method    = "GET"

请求: POST /api/proxy/ollama/api/generate
  → serviceId = "ollama"
  → subPath   = "/api/generate"
  → body      = { model: "qwen2", prompt: "你好" }
  → method    = "POST"
```

### 2.4 数据流

```
对端 (请求方)                                     本端 (服务方)
     │                                                  │
     │  GET /api/proxy/ollama/api/tags                  │
     │                                                  │
     │  1. ApiServer 提取:                              │
     │     serviceId = "ollama"                         │
     │     subPath = "/api/tags"                        │
     │     method = "GET"                               │
     │                                                  │
     │  2. pullService("ollama",                        │
     │       { path: "/api/tags", method: "GET" })      │
     │                                                  │
     │  3. SERVICE_CALL (0x30) ═══════════════════════► │
     │     { id, service: "ollama",                     │
     │       path: "/api/tags", method: "GET" }         │
     │                                                  │
     │                        4. handleServiceCall():    │
     │                           查到 ollama 是 gateway  │
     │                           拼接: base + path       │
     │                           = http://62.146.4.53   │
     │                             :11434/api/tags      │
     │                                                  │
     │                        5. HTTP GET 实际调用       │
     │                                                  │
     │  6. SERVICE_RESULT (0x31) ◄═════════════════════ │
     │     { id, status: 200, data: [...] }             │
     │                                                  │
     │  7. 返回 JSON 给调用方                            │
     │                                                  │
```

---

## 三、改动清单

### 3.1 后端核心改动

#### [MODIFY] `src/server/ApiServer.js`

**改动 1**: 新增带通配符的路由

```javascript
// 现有路由保持不变 (精确模式)
router.all('/proxy/:serviceId', async (req, res) => { ... });

// 新增：网关模式路由 (捕获子路径)
router.all('/proxy/:serviceId/*', async (req, res) => {
    const { serviceId } = req.params;
    const subPath = '/' + req.params[0]; // Express 通配符捕获

    // 智能提取参数
    let params = {};
    if (Object.keys(req.query).length > 0) {
        params = { ...req.query };
    }
    if (req.body && Object.keys(req.body).length > 0) {
        params = { ...params, ...req.body };
    }

    // 附加网关信息
    params.__gateway = {
        path: subPath,
        method: req.method
    };

    try {
        const result = await this.controller.pullService(serviceId, params);
        // ... 透明返回 (复用现有逻辑)
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

> [!TIP]
> 使用 `params.__gateway` 内嵌网关元数据，避免污染用户参数空间。`pullService` 的函数签名无需变更。

---

#### [MODIFY] `src/core/services/HttpProxyService.js`

**改动 1**: `registerService` 增加 `mode` 字段

```javascript
registerService(id, config, persist = true) {
    this.localServices.set(id, {
        id,
        name: config.name || id,
        description: config.description || '',
        version: config.version || '1.0',
        endpoint: config.endpoint,
        mode: config.mode || 'exact',    // 新增
        method: config.method || 'GET',
        timeout: config.timeout || 10000,
        headers: config.headers || {},
        params: config.params || {},
        enabled: config.enabled !== false,
        status: 'unknown',
        lastCheck: 0
    });
    // ...
}
```

**改动 2**: `pullService` 将网关元数据注入 CALL 帧

```javascript
async pullService(serviceId, params = {}, timeout = 30000) {
    const requestId = this._generateRequestId();

    // 提取并剥离网关元数据
    const gateway = params.__gateway;
    const cleanParams = { ...params };
    delete cleanParams.__gateway;

    const request = {
        id: requestId,
        service: serviceId,
        params: cleanParams
    };

    // 网关模式：注入 path 和 method
    if (gateway) {
        request.path = gateway.path;
        request.method = gateway.method;
    }

    const payload = Buffer.from(JSON.stringify(request));
    this.scheduler.enqueue(PT.CALL, 0, payload, 1);
    // ... Promise 逻辑不变
}
```

**改动 3**: `handleServiceCall` 支持路径拼接

```javascript
async handleServiceCall(frame) {
    let request;
    try {
        request = JSON.parse(frame.body.toString());
    } catch (e) { return; }

    const { id, service, params, path, method } = request;

    if (!this.localServices.has(service)) {
        return this._sendResult(id, 500, null, `Service not found: ${service}`);
    }

    const svc = this.localServices.get(service);
    if (!svc.enabled) {
        return this._sendResult(id, 500, null, `Service disabled: ${service}`);
    }

    try {
        let endpoint = svc.endpoint;
        let httpMethod = svc.method;

        if (svc.mode === 'gateway' && path) {
            // 网关模式：Base URL + 子路径
            endpoint = svc.endpoint.replace(/\/+$/, '') + path;
            httpMethod = method || 'GET';
        }

        const result = await this.callLocalHttp(endpoint, params, {
            method: httpMethod,
            headers: svc.headers,
            timeout: svc.timeout
        });

        this._sendResult(id, 200, result);

    } catch (err) {
        this._sendResult(id, 500, null, err.message);
    }
}
```

**改动 4**: `handleServiceQuery` 返回 `mode` 字段

在 SERVICE_LIST 响应中增加 `mode` 字段，让对端知道该服务支持网关模式：

```javascript
let services = Array.from(this.localServices.values()).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    version: s.version,
    method: s.method,
    mode: s.mode,        // 新增
    enabled: s.enabled,
    params: s.params,
    status: s.status
}));
```

**改动 5**: `_checkServiceHealth` 适配网关模式

网关模式下健康检查应探测 Base URL 根路径（而非拼接子路径）：

```javascript
// 精确模式：探测 endpoint 原始 URL
// 网关模式：探测 base URL (通常返回 200 或 404 都算健康)
const checkUrl = svc.mode === 'gateway' ? svc.endpoint : svc.endpoint;
// 网关模式下放宽状态码判断，非 ECONNREFUSED 即视为在线
```

---

#### [MODIFY] `src/core/services/HttpProxyService.js` - `_persistConfig`

持久化时保存 `mode` 字段：

```javascript
currentConfig.services.localServices[id] = {
    name: svc.name,
    description: svc.description,
    version: svc.version,
    endpoint: svc.endpoint,
    mode: svc.mode,       // 新增
    method: svc.method,
    timeout: svc.timeout,
    enabled: svc.enabled,
    headers: svc.headers,
    params: svc.params
};
```

---

### 3.2 前端 UI 改动

#### [MODIFY] `src/web/src/features/api-forwarder/ServiceManager.jsx`

**改动 1**: 服务注册表单新增 `mode` 选项

```jsx
<div className="space-y-1">
    <label className="text-xs font-medium text-muted-foreground">代理模式</label>
    <select
        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
        value={newService.mode || 'exact'}
        onChange={e => setNewService({ ...newService, mode: e.target.value })}
    >
        <option value="exact">精确端点 (Exact)</option>
        <option value="gateway">网关模式 (Gateway)</option>
    </select>
</div>
```

**改动 2**: 网关模式下隐藏 `method` 选择（因为方法由请求方动态指定）

```jsx
{(newService.mode !== 'gateway') && (
    <div className="space-y-1">
        <label>请求方法</label>
        <select ...>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
        </select>
    </div>
)}
```

**改动 3**: 远程服务列表中网关模式服务的标识

```jsx
<div className="text-xs bg-muted px-1.5 py-0.5 rounded">
    {service.mode === 'gateway' ? '🌐 Gateway' : service.method}
</div>
```

**改动 4**: 网关模式的代理地址提示变化

```jsx
const getProxyUrl = (service) => {
    const base = `${window.location.protocol}//${window.location.hostname}:${window.location.port}/api/proxy/${service.id}`;
    return service.mode === 'gateway' ? `${base}/<子路径>` : base;
};
```

---

### 3.3 配置模板更新

#### [MODIFY] `config/default.json.example`

新增网关模式服务示例：

```json
{
  "services": {
    "localServices": {
      "system_info": {
        "name": "系统信息",
        "endpoint": "http://localhost:8080/api/system/info",
        "method": "GET",
        "enabled": true
      },
      "ollama": {
        "name": "Ollama LLM",
        "description": "本地大语言模型服务 (网关模式)",
        "endpoint": "http://localhost:11434",
        "mode": "gateway",
        "timeout": 120000,
        "enabled": true
      }
    }
  }
}
```

---

## 四、向后兼容性保证

| 场景 | 行为 | 兼容性 |
| :--- | :--- | :--- |
| 旧配置无 `mode` 字段 | 默认 `"exact"`，走原有逻辑 | ✅ 完全兼容 |
| 旧版 CALL 帧无 `path` 字段 | `handleServiceCall` 走精确模式 | ✅ 完全兼容 |
| 新版对端 + 旧版本端 | 旧版忽略未知字段 `path`/`method` | ✅ 兼容（降级为精确模式） |
| `/api/proxy/:serviceId` 路由 | 保持不变 | ✅ 完全兼容 |

---

## 五、验证计划

### 5.1 精确模式回归测试

确保现有功能不受影响：
- 注册精确端点服务 → 服务发现 → 调用 → 验证结果
- 健康检查仍正常工作

### 5.2 网关模式功能测试

以 Ollama 为例：

```bash
# 1. 注册网关服务（在 Ollama 所在端）
# 在 Web UI 中添加: ollama, gateway 模式, endpoint=http://62.146.4.53:11434

# 2. 对端刷新服务发现

# 3. 验证各种路径和方法
curl http://192.168.9.206:3003/api/proxy/ollama/api/tags
curl -X POST http://192.168.9.206:3003/api/proxy/ollama/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2","prompt":"你好","stream":false}'
curl -X POST http://192.168.9.206:3003/api/proxy/ollama/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2","messages":[{"role":"user","content":"你好"}],"stream":false}'

# 4. 验证多层子路径
curl http://192.168.9.206:3003/api/proxy/ollama/api/show
```

### 5.3 异常场景测试

- 网关模式服务目标不可达 → 返回错误
- 子路径不存在 → 透传目标服务器的 404
- 超时 → 正常超时处理
- 不带子路径访问网关服务 → 透传到 Base URL 根路径

---

## 六、未来扩展空间

本次升级为后续增强预留了扩展点：

| 特性 | 方向 | 依赖本次改动 |
| :--- | :--- | :--- |
| **请求头透传** | CALL 帧新增 `headers` 字段 | `callLocalHttp` 已支持 |
| **响应头透传** | RESULT 帧新增 `contentType` 字段 | 需扩展 `_sendResult` |
| **流式响应** | 新增 `0x35 SERVICE_STREAM` 帧类型 | 需新的分片协议 |
| **路径级白名单** | `allowedPaths: ["/api/generate", "/api/tags"]` | 网关模式的细粒度安全 |
| **请求体大小限制** | `maxRequestSize` 配置 | 防止超大 prompt 堵塞串口 |

---

## 附录：改动文件索引

| 文件 | 改动类型 | 复杂度 |
| :--- | :--- | :--- |
| `src/server/ApiServer.js` | 新增 `/proxy/:serviceId/*` 路由 | 🟢 小 |
| `src/core/services/HttpProxyService.js` | 注册 + CALL + 路径拼接 + 持久化 + 健康检查 | 🟡 中 |
| `src/web/src/features/api-forwarder/ServiceManager.jsx` | 表单 + 展示适配 | 🟡 中 |
| `config/default.json.example` | 新增网关模式示例 | 🟢 小 |
| `docs/api_forwarding_design.md` | 补充网关模式章节 | 🟢 小 |
| `docs/technical_reference.md` | 更新协议帧格式 | 🟢 小 |
