# serialSync 架构收敛、HTTP 透明反代与聊天文件传输开发方案

> **版本基线**：基于 `v3.0.6`  
> **适用拓扑**：`A1s <-> B1s, B2s <-> C1s`（跨网串口 + 局域网混合多跳总线）  
> **文档定位**：指导后续两阶段重构与演进的统一开发方案。

---

## 1. 生产拓扑与核心工作逻辑校准

### 1.1 典型物理拓扑
```text
[局域网 A]                  [局域网 B]                  [局域网 C]
A1, A2 ---> A1s <---串口---> B1s <---网口(LAN)---> B2s <---串口---> C1s <--- C1
         (源服务)                                                 (消费端)
```

### 1.2 核心架构共识
1. **节点平等与角色边界**：
   - 各个局域网内的普通主机（`A1`、`A2`、`B2`、`B3`、`C1`）**无需部署 `serialSync`**，直接作为标准 HTTP 客户端/服务端或浏览器用户访问本网串口桥。
   - 串口桥主机（`A1s`、`B1s`、`B2s`、`C1s`）在逻辑拓扑上地位完全平等，通过 [RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js) 将**物理串口**和**局域网 WebSocket（`RelayService`）**抽象为统一的通信链路（Link）。
2. **服务广播与自动路由**：
   - 任意主机将本地 HTTP 服务注册到本网串口桥后，串口桥通过串口和网口向全网泛洪服务目录（`PT.LIST`），利用 Split-Horizon（水平分割）与 `packetId` 去重保证多跳不回环。
   - 消费端主机访问本网串口桥汇聚的服务时，由 `RouteEngine` 自动判断目标在本机、本网对端（走 LAN Link）还是跨网对端（走 Serial Link / 多跳接力），调用方无需感知物理路径。
3. **功能边界声明（重要）**：
   - 本文档中讨论的“文件传输与分站仓库”**仅针对聊天界面中的文件发送与接收**（`MessageService` / `FileTransferService` / `RelayService`）。
   - 系统现有的**“文件共享/目录同步”**功能（`FileSyncService.js`）目前不常用，**本轮暂保持原样，待主体功能全部跑通后再单独优化**。

---

## 2. 概念收敛与零配置优化

为解决当前设置项繁复、概念不清的问题，对系统身份与配置模型进行如下收敛：

### 2.1 取消显式“网络名”配置，改为自动派生
- **保留逻辑意义**：`network` 在 [RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js) 中用于路由表按域聚合（`routeTable`）及防止跨网冲突，逻辑上仍然需要。
- **消除人工配置风险**：从前端设置面板中**移除“网络名”输入框**。串口桥首次启动时自动派生唯一且持久的路由域标识（或直接复用不可变的 8 位底层真 ID `nodeId` 作为路由域标识），彻底杜绝因错填相同/错误网络名导致的网络中断。
- **统一展示格式**：前端服务与节点展示统一简化为 `{nodeName} / {serviceId}`（如 `A1s / my_web_app`），底层协议仍通过 `nodeId` 精确寻址。

### 2.2 本网串口桥「IP 地址 <-> 用户名」对照表
- 局域网主机（如 `A2`）通过浏览器访问本网串口桥 `A1s` 的 Web UI 时，`A1s` 自动提取并标准化来访者的局域网 IP（处理 `::ffff:` 前缀）。
- 在串口桥本地持久化维护一张 **`IP <-> 用户名` 对照表**：
  - **自动绑定**：用户在聊天界面首次设置/修改昵称发送消息或文件时，自动将该 IP 与用户名绑定落盘；
  - **人工预设**：支持在串口桥设置界面直接维护内网 IP 与固定用户名的映射（如 `192.168.1.55 -> 张三`）。
- 全网广播聊天消息或文件卡片时，统一展示为 `用户名@串口桥节点名`（如 `张三@A1s`）。

### 2.3 设置面板三层收敛
1. **节点与链路**：串口桥名称（`nodeName`）、只读 `nodeId`、串口连接参数、LAN 对端节点（`peers`）、IP-用户名对照表。
2. **我提供的服务（服务端）**：服务 ID、本地目标地址（如 `http://127.0.0.1:8080`）、模式（默认 `transparent`，可选 `exact`）。
3. **我映射的端口（消费端）**：本地监听端口 <-> 远程服务标识（如 `18080 <-> A1s/my_web_app`）。

---

## 3. 第一阶段：HTTP/1.1 通用透明反向代理重构（核心攻坚）

### 3.1 现存 Gateway 模式失败根因
1. **三段式 FQDN 截断**：[ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js#L370-L394) 的 `_resolveProxyTarget` 仅按两段解析 `serviceId`，导致 `{network}/{nodeName}/{serviceId}` 跨网寻址路径错位。
2. **参数混叠与强行 JSON 化**：`ApiServer` 将 `req.query` 与 `req.body` 混入同一 `params` 对象；[HttpProxyService.callLocalHttp](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js#L542-L584) 非 `GET` 时强行 `JSON.stringify` 并硬编码 `Content-Type: application/json`，导致表单、`multipart` 上传、纯文本及带 Query 的 POST 全部失真。
3. **二进制响应损坏与状态码吞没**：`callLocalHttp` 使用 `data += c` 拼接字符串破坏二进制流；非 `2xx` 直接 `reject` 变成 `502`；`_transparentResponse` 强行 `JSON.parse` 且丢失上游响应头。
4. **路径前缀破坏**：`/api/proxy/:serviceId/*` 前缀破坏了标准 Web 应用的绝对路径资源引用（如 `/assets/logo.png`、`/api/v1/users`）。

### 3.2 透明反代重构设计

#### 1) 服务模式抽象：独立虚拟端口（Transparent Proxy / Virtual Port）
- 在 [HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js) 中新增/完善 **`transparent` 模式**，与轻量调试用的 `exact` 模式职责彻底分离。
- **虚拟端口绑定（Virtual Port）**：
  - 消费端（如 `C1s`）支持为任意远程服务绑定一个本地独立 HTTP 监听端口（使用 Node.js 原生 `http.createServer`，参考 [TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js) 的端口生命周期管理，**零第三方依赖**），例如 `0.0.0.0:18080 -> A1s/my_web_app`（支持仅本机 `127.0.0.1` 或局域网可访问）。
  - 任意标准 HTTP 客户端、SDK 或浏览器只需将 BaseURL 指向 `http://<C1s-IP>:18080`，发出的任何路径（`/api/v1/users?page=1`、`/assets/logo.png`）均原样透传，彻底消除前缀污染。
  - 映射规则持久化至配置文件，服务重启后自动恢复监听。

#### 2) 请求原始透传（Raw Request Forwarding）
- 在 `PT.CALL (0x30)` 中为透明反代定义独立的标准 HTTP 请求信封：
  ```json
  {
    "id": "req_...",
    "mode": "transparent",
    "service": "my_web_app",
    "caller": "...",
    "method": "POST",
    "rawUrl": "/api/v1/users?page=1&tag=a%2Bb",
    "headers": { "content-type": "...", "authorization": "..." },
    "body": "<Base64 string or null>",
    "_wireCompressed": "gzip | none"
  }
  ```
- **Method**：原样透传 `GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS` 等所有标准方法。
- **Raw URL & QueryString**：原样透传 `req.url`（完整路径与原始 QueryString），不拆解、不重组。
- **Headers & Body**：收集完整请求体 `Buffer`，仅剔除 Hop-by-hop 头（`host`、`connection`、`keep-alive`、`transfer-encoding`、`upgrade`、`proxy-connection`、`content-length` 由底层重算），其余头与载荷原始透传。

#### 3) 响应二进制安全与完整透传（Binary-Safe Response）
- 改造 `HttpProxyService.callLocalHttp`：
  - 使用 `Buffer.concat(chunks)` 收集上游响应流，**严禁 `data += c` 字符串拼接**。
  - **不再将非 `2xx` 状态码视为异常 `reject`**，仅在网络不可达、超时或连接重置等传输层错误时返回 `502` 网关错误。
  - 原样返回上游 `statusCode`（200 / 201 / 304 / 400 / 401 / 403 / 404 / 500 等）及关键响应头（`content-type`、`content-encoding`、`content-disposition`、`cache-control`、`etag`、`set-cookie` 等，剔除 Hop-by-hop 头）。
- 改造 `PT.RESULT (0x31)` 与 `PT.CHUNK (0x34)`：
  - 响应信封携带 `statusCode`、`headers`、`_wireCompressed` 与响应体；
  - 分片重组（`handleServiceChunk`）改为严格按序号收集后还原原始 `Buffer`，禁止字符串直接拼接，确保图片、压缩包、音视频与文档下载 100% 字节级无损。

#### 4) 低带宽串口传输优化（原生 `zlib` 自动压缩）
- 发送请求体或响应体前执行判断：
  - 条件：载荷未带 `Content-Encoding`（未压缩）、`Content-Type` 属于文本类（`application/json`、`text/*`、`application/javascript`、`application/xml`、`image/svg+xml`）且字节长度 `> 512` 字节；
  - 动作：使用 Node.js 原生 `zlib.gzipSync` 压缩后编码传输，并标记 `_wireCompressed: 'gzip'`；对端收到后先 `zlib.gunzipSync` 还原为原始 `Buffer` 再交付客户端或上游。
  - 若上游响应本身已带 `Content-Encoding: gzip/br/deflate`，则跳过二次压缩，直接透传原始二进制 `Buffer`。

#### 5) 路径前缀兼容修复（兜底入口）
- 同步修复 [ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js) 中 `_resolveProxyTarget` 对三段式全限定名的解析 Bug，使免开端口的 `/api/proxy/...` 调试入口也能正确路由并复用新的 Binary-Safe 透传通道。

### 3.3 第一阶段涉及模块
- **后端核心**：`src/core/services/HttpProxyService.js`、`src/core/interface/AppController.js`、`src/server/ApiServer.js`
- **前端界面**：`src/web/src/features/api-forwarder/ServiceManager.jsx`（新增虚拟端口绑定/解绑操作与状态展示）、`src/web/src/features/settings/SettingsModal.jsx`（隐藏手动网络名配置）

---

## 4. 第二阶段：聊天界面文件传输升级（MD5 分站仓库 + 并发控制）

### 4.1 整体模型：元数据广播 + 按需智能拉取
1. **发送与广播**：
   - 本机或局域网主机通过串口桥发送文件时，串口桥使用 Node.js 原生 `crypto` **流式计算文件 `MD5`**，将 `{ md5, fileName, size, localPath }` 登记至本机 `fileIndex`。
   - 向全网广播轻量级文件卡片（含 `md5`、`fileName`、`size`、`sender`（`用户名@节点名`）、`originNodeId`），**广播阶段不传输文件实体**。
2. **全网字符聊天同步**：
   - 沿用 `RouteEngine` `PT.MSG_TEXT (0x10)` 全网广播（`dst: '*'`）与 Split-Horizon 去重机制，确保 `A1s <-> B1s <-> B2s <-> C1s` 全网聊天实时互通，并展示 `用户名@节点名`。

### 4.2 沿途分站仓库（Staging Cache）与就近下载
1. **双区存储隔离**：
   - **用户个人接收目录（`received/`）**：仅存放本机用户主动点击下载的文件。
   - **中继分站缓存区（`received/.staging/`）**：存放串口桥在帮下游节点中继跨网文件时顺便落盘的副本（按 `<md5>.blob` 存储，配置最大缓存容量与 LRU/过期自动清理，不污染用户个人接收目录）。
   - 两个区域中已校验完整的副本均统一登记在节点的 `fileIndex`（`md5 -> { path, size, ... }`）中对外提供服务。
2. **原子落盘与 MD5 完整性校验**：
   - 任意节点拉取文件时，先流式写入 `<md5>.part` 临时文件；
   - 传输完成后计算临时文件 MD5，确认 `actualMd5 === expectedMd5` 后再通过 `fs.rename` 原子转正并写入 `fileIndex`，彻底杜绝半截文件被下游误读。
3. **就近副本探测（Nearest-Replica Discovery）**：
   - 当用户（如 `B3`）点击下载某文件时，本网串口桥先发送轻量级 `FILE_LOCATE`（携带 `md5`）探测包；
   - 持有完整副本的节点（例如刚刚帮 `B2` 下载过并缓存了副本的 `B1s`，或已经下载完成的 `B2`）回复 `FILE_HAVE`；
   - 请求方优先选择 **LAN 直连且跳数最少** 的节点直接发起 HTTP 高速拉取，彻底绕开慢速物理串口。

### 4.3 多人同时下载并发竞争控制（Singleflight）
当 `B2` 与 `B3` 几乎同时点击下载同一文件（`md5`），而中继桥 `B1s` 尚无缓存时：
1. **节点级请求合并锁**：
   - 每个节点维护 `activePulls: Map<md5, Promise>`。
   - `B2` 的拉取请求到达 `B1s` 时，`B1s` 发现本地无缓存且 `activePulls` 无记录，则创建上游拉取任务（经串口向 `A1s` 请求）并将 `Promise` 注册进 `activePulls`。
   - `B3` 的请求随后到达 `B1s` 时，直接命中 `activePulls.get(md5)`，**挂起等待同一个 `Promise` 完成，绝不向 `A1s` 发起第二份串口传输**。
2. **落盘后并发分发**：
   - `B1s` 从 `A1s` 拉取完成并原子落盘后，唤醒所有等待该 `md5` 的请求，通过局域网 HTTP 并发流式分发给 `B2` 和 `B3`。
3. **异常安全释放**：
   - 无论拉取成功、校验失败还是超时，都在 `finally` 中移除 `activePulls` 记录并清理残留 `.part` 文件，防止死锁。

---

## 5. 阶段验证标准（由用户实机执行验收）

### 第一阶段验收（HTTP 透明反代）
1. 在 `A1s` 注册一个标准 Web 应用或 RESTful 服务（`transparent` 模式），不手动配置任何 `network` 名称。
2. 在 `C1s` 为该跨网服务绑定本地虚拟端口（如 `18080`）。
3. 使用浏览器或 `curl` 访问 `http://<C1s-IP>:18080/...`，验证：
   - HTML 页面、JS/CSS、图片（PNG/SVG）等二进制静态资源完整加载无损坏；
   - 带复杂 QueryString 的 `GET`、`POST JSON`、`PUT/DELETE`、`multipart/form-data` 上传均原样透传；
   - 上游 `404` / `401` / `304` 状态码与响应头原样返回。

### 第二阶段验收（聊天文件传输与分站缓存）
1. `A2` 通过 `A1s` 绑定用户名后发送文件，全网 `B1s`、`B2s`、`C1s` 均收到带 `用户名@A1s` 与 MD5 的文件卡片，串口无提前传输流量。
2. `B2` 与 `B3` 同时点击下载：串口仅传输一次，落盘后 `B2`、`B3` 均成功获取文件且 MD5 一致；随后 `C1s` 或新节点再次点击下载时，可直接从就近缓存节点拉取。
