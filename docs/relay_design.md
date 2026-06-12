# 跨网中继 (Cross-Network Relay) 设计方案

**版本**: v3.1  
**创建日期**: 2026-06-12  
**基于**: SerialSync v3.0.2  
**状态**: 待审定

---

## 一、背景与目标

### 1.1 现状痛点

SerialSync 当前是点对点架构。在多网络级联场景（A网→B网→C网）中，用户如需将数据从 A网 传至 C网，必须**手动在 B网 进行二次转发**——先从 A网 传到 B网，再手动从 B网 传到 C网。链路虽然物理上是通的，但逻辑上是断裂的。

### 1.2 物理约束

- 每台主机仅有一个串口，无法加装
- 相邻网络通过串口 1:1 物理连接
- 同一网络内的中继节点对通过局域网互通

### 1.3 目标效果

1. **统一虚拟聊天室**：所有网络中的所有用户（串口主机 + WebUI 用户）进入同一个聊天室，实时收发消息
2. **文件通知全链路广播**：任何用户发送文件时，所有网络的用户都能看到文件消息卡片
3. **文件按需透明拉取**：用户点击下载按钮，后台自动完成跨网中继，前端无任何差异
4. **前端完全统一**：所有网络的 WebUI 界面完全一致，不增加任何额外提示或操作
5. **支持 N 网络级联**：方案不局限于三网，支持任意数量的网络链式级联

> **部署策略**：本次重构为全量升级，所有节点统一部署新版本，不考虑与旧版本的兼容性。

---

## 二、拓扑模型

### 2.1 三网络场景（基本）

```
A网                     B网 (局域网)                    C网
┌────┐  串口    ┌────┐           ┌────┐  串口    ┌────┐
│ A1 │←───────→│ B1 │~~~LAN~~~→│ B2 │←───────→│ C1 │
└────┘          └────┘           └────┘          └────┘
  ↑               ↑                ↑               ↑
A2,A3           B3,B4            B3,B4           C2,C3
(WebUI)         (WebUI)          (WebUI)         (WebUI)
```

### 2.2 N 网络级联场景（扩展）

```
A网          B网              C网              D网          E网
┌──┐ 串口 ┌──┐     ┌──┐ 串口 ┌──┐     ┌──┐ 串口 ┌──┐     ┌──┐ 串口 ┌──┐
│A1│←───→│B1│~LAN~│B2│←───→│C1│~LAN~│C2│←───→│D1│~LAN~│D2│←───→│E1│
└──┘      └──┘     └──┘      └──┘     └──┘      └──┘     └──┘      └──┘
```

**规律**：每个中间网络贡献一对中继节点（如 B1+B2、C1+C2、D1+D2），它们通过本网 LAN 互通，各自通过串口连接相邻网络。链路两端的 A1 和 E1 是纯端点节点。

### 2.3 节点角色

| 角色 | 说明 | 配置 | 示例 |
|:---|:---|:---|:---|
| **端点 (Endpoint)** | 链路两端的终端节点，仅连接一条串口 | 无需 relay 配置 | A1、E1 |
| **中继 (Relay)** | 中间网络的节点对，通过 LAN 互通 | 需配置 `relay.peer` | B1↔B2、C1↔C2 |

---

## 三、用户身份标识

### 3.1 设计原则

多网络、多用户进入同一虚拟聊天室，需要区分每条消息的来源。身份标识应：
- 支持用户自定义
- 无需中心化数据库
- 在全链路中唯一可辨识

### 3.2 身份配置

在 `config/default.json` 中新增 `identity` 字段：

```json
{
  "identity": {
    "nodeName": "办公室A-主机",
    "network": "A网"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---|:---|
| `identity.nodeName` | string | 否 | 节点名称，缺省为主机名 |
| `identity.network` | string | 否 | 所属网络名称，缺省为空 |

### 3.3 WebUI 用户昵称

WebUI 用户可在浏览器中设置个人昵称，存储于 `localStorage`。未设置时以客户端 IP 作为默认标识。

### 3.4 消息中的身份信息

每条消息携带完整的发送者信息：

```json
{
  "sender": {
    "nickname": "张三",
    "nodeName": "办公室A-主机",
    "network": "A网",
    "ip": "192.168.1.100"
  }
}
```

聊天气泡显示格式建议：`[A网] 张三` 或 `[A网/办公室A] 192.168.1.100`

> **注意**：身份信息随消息一起在全链路中传播，中继节点不修改 sender 字段，确保原始发送者信息端到端保留。

---

## 四、配置模型

### 4.1 中继节点配置

仅中继节点需要新增配置：

```json
// B1 的配置
{
  "identity": {
    "nodeName": "B1-出口机",
    "network": "B网"
  },
  "relay": {
    "peer": "ws://192.168.1.102:3003/relay"
  }
}

// B2 的配置
{
  "identity": {
    "nodeName": "B2-入口机",
    "network": "B网"
  },
  "relay": {
    "peer": "ws://192.168.1.101:3003/relay"
  }
}
```

### 4.2 端点节点配置

端点节点无需 relay 配置，可选配置 identity：

```json
// A1 的配置（可选）
{
  "identity": {
    "nodeName": "A网主机",
    "network": "A网"
  }
}
```

### 4.3 四网络配置示例

```
A1 ←串口→ B1 ←LAN→ B2 ←串口→ C1 ←LAN→ C2 ←串口→ D1
```

| 节点 | relay.peer | 说明 |
|:---|:---|:---|
| A1 | 无 | 端点 |
| B1 | `ws://B2-IP:3003/relay` | 中继 |
| B2 | `ws://B1-IP:3003/relay` | 中继 |
| C1 | `ws://C2-IP:3003/relay` | 中继 |
| C2 | `ws://C1-IP:3003/relay` | 中继 |
| D1 | 无 | 端点 |

---

## 五、核心机制

### 5.1 WebSocket 连接策略

B1 和 B2 互相配置了对方为 `relay.peer`。为避免建立两条冗余连接，采用**确定性主从策略**：

- **启动时**：节点解析自身 IP 和对端 IP，**IP 值较小的一方作为客户端主动连接**，另一方仅作为服务端监听
- **效果**：全局只有一条 WebSocket 连接，职责明确
- **容错**：若客户端连接失败，定时重试（3s → 6s → 12s，上限 30s）；连接断开后自动重连

```
B1 (192.168.1.101) vs B2 (192.168.1.102)
    → 101 < 102 → B1 主动连接 B2
    → B2 监听 /relay 端点等待 B1 连入
```

### 5.2 消息中继规则

每个中继节点有三个消息方向。核心转发规则：

| 消息来源 | 本地处理 | 转发方向 |
|:---|:---|:---|
| 串口收到 | 本地 WebUI 广播 | → LAN 对端 |
| LAN 对端收到 | 本地 WebUI 广播 | → 串口 |
| 本地 WebUI 用户发送 | — | → 串口 + LAN 对端 |

**防环路核心规则**：来自 LAN 对端的消息**绝不回传**给 LAN 对端，只往串口方向转发。

> 此规则在 N 网络链式拓扑中天然有效：每条消息沿链路单向传播，永远不会回头。

### 5.3 N 网络消息传播示例

```
A1 发送 "你好"

A1 →(串口)→ B1: origin=serial → 显示 + 转发给B2(relay)
                 B2: origin=relay → 显示 + 转发给串口
                     →(串口)→ C1: origin=serial → 显示 + 转发给C2(relay)
                                   C2: origin=relay → 显示 + 转发给串口
                                       →(串口)→ D1: 显示 ✅

结果：A1, B1, B2, C1, C2, D1 全部显示 ✅
```

每个中继对只做一件事：**串口⇄LAN 桥接**。消息自然地沿链路逐跳传播。

### 5.4 消息去重

由于链式拓扑且方向规则严格，正常情况下不会出现重复消息。但为防止异常（如重连瞬间），每条消息携带唯一 `msgId`，接收端基于 `msgId` 去重：

```json
{
  "msgId": "a1_1718100000000_x7k2m",
  "sender": { ... },
  "content": "你好"
}
```

`msgId` 格式：`{节点标识}_{时间戳}_{随机串}`，全链路唯一。

---

## 六、文件中继

### 6.1 两阶段设计

| 阶段 | 触发方式 | 传输内容 | 机制 |
|:---|:---|:---|:---|
| **通知广播** | 文件传输完成时自动触发 | 文件元数据（~100 字节） | 沿中继链路逐跳广播 |
| **按需拉取** | 用户点击下载按钮时触发 | 文件本体 | 逐跳回溯拉取 + 逐跳转发 |

### 6.2 第一阶段：文件通知广播

当文件传输完成（如 A1 的文件到达 B1），B1 发出文件通知，沿中继链路传播：

```
B1 →(relay/LAN)→ B2 →(串口 0x15)→ C1 →(relay/LAN)→ C2 →(串口 0x15)→ D1
```

通知内容：

```json
{
  "fileId": "abc-123",
  "fileName": "report.xlsx",
  "fileSize": 2400000,
  "sender": { "nickname": "张三", "network": "A网" },
  "originMsgId": "notify_1718100000000_abc"
}
```

所有节点的 WebUI 都会显示一条文件消息卡片，与本地文件传输的外观完全一致。

### 6.3 第二阶段：按需逐跳拉取

当用户点击下载按钮且本地没有该文件时，触发逐跳拉取链：

#### 三网络场景（C1 拉取 B1 上的文件）

```
C1 点击下载 → 本地无文件
    → C1 发 FILE_RELAY_REQ via 串口 → B2
        → B2 本地无文件，有 relay 对端 B1
        → B2 via LAN 问 B1：有 report.xlsx 吗？
        → B1：有！via LAN 发给 B2（局域网秒传）
        → B2 收到文件，via 串口发 FILE_OFFER → C1
        → C1 收到文件，WebUI 下载按钮可用 ✅
```

#### N 网络场景（D1 拉取 B1 上的文件）

```
D1 点击下载 → 本地无文件
    → D1 发 FILE_RELAY_REQ via 串口 → C2
        → C2 无文件，转发给 C1 via LAN
            → C1 无文件，发 FILE_RELAY_REQ via 串口 → B2
                → B2 无文件，转发给 B1 via LAN
                    → B1 有文件！via LAN 传给 B2（秒传）
                → B2 有文件，via 串口 FILE_OFFER → C1（串口传输）
            → C1 收到文件，via LAN 传给 C2（秒传）
        → C2 有文件，via 串口 FILE_OFFER → D1（串口传输）
    → D1 收到文件 ✅
```

#### 关键数据结构：待处理中继请求表

每个中继节点维护一个 `pendingRelayPulls` 映射表，记录"谁请求了什么文件，从哪个方向来的"：

```javascript
// pendingRelayPulls: Map<fileId, { direction: 'serial' | 'relay', requestedAt: number }>
```

当 FILE_RELAY_REQ 到达时：
1. 检查本地 `received/` 是否有此文件
2. 如有 → 直接响应（串口方向来的请求走 FILE_OFFER，LAN 方向来的走 HTTP 传输）
3. 如无 → 记录到 `pendingRelayPulls`，向**另一个方向**转发请求

当文件到达时（无论从串口还是 LAN）：
1. 检查 `pendingRelayPulls` 是否有此文件的待处理请求
2. 如有 → 向请求来源方向回传文件，并清除记录

这套机制对 N 网络天然有效——请求逐跳向"有文件的方向"传播，文件逐跳向"请求者方向"回传。

### 6.4 文件传输路径中的耗时分析

| 路径段 | 传输方式 | 速度 | 耗时（1MB 文件） |
|:---|:---|:---|:---|
| LAN 段（同网中继对之间） | HTTP/WebSocket | ~100 MB/s | <1 秒 |
| 串口段 | 串口 115200 bps | ~11 KB/s | ~90 秒 |

**总耗时 ≈ 串口段数 × 单段串口传输时间**。LAN 段耗时可忽略。

例如 4 网络（A→B→C→D）：需经过 3 段串口传输，1MB 文件约 4.5 分钟。

---

## 七、协议扩展

### 7.1 新增帧类型

| TYPE | 名称 | 说明 | Body 格式 |
|:---|:---|:---|:---|
| `0x15` | FILE_NOTIFY | 文件通知广播 | JSON |
| `0x50` | FILE_RELAY_REQ | 请求中继拉取文件 | JSON |
| `0x51` | FILE_RELAY_RESP | 中继拉取响应（错误/状态） | JSON |

> 选择 `0x15` 而非扩展 `0x10 MSG_TEXT` 的理由：
> - **职责分离**：文件通知与聊天消息语义不同，独立帧类型使 ServiceManager 分发路由更清晰
> - **独立扩展**：未来可为 FILE_NOTIFY 添加新字段（如缩略图、校验码）而不影响聊天协议

### 7.2 MSG_TEXT (0x10) Body 格式升级

MSG_TEXT 的 Body 从纯文本升级为 JSON，携带用户身份和消息去重 ID：

```json
{
  "msgId": "a1_1718100000000_x7k2m",
  "sender": {
    "nickname": "张三",
    "nodeName": "A网主机",
    "network": "A网",
    "ip": "192.168.1.100"
  },
  "content": "你好"
}
```

### 7.3 FILE_NOTIFY (0x15) Body 格式

```json
{
  "msgId": "notify_1718100000000_abc",
  "fileId": "abc-123",
  "fileName": "report.xlsx",
  "fileSize": 2400000,
  "sender": {
    "nickname": "张三",
    "network": "A网"
  }
}
```

### 7.4 FILE_RELAY_REQ (0x50) Body 格式

```json
{
  "reqId": "pull_1718100000000_xyz",
  "fileId": "abc-123",
  "fileName": "report.xlsx"
}
```

### 7.5 FILE_RELAY_RESP (0x51) Body 格式

```json
{
  "reqId": "pull_1718100000000_xyz",
  "fileId": "abc-123",
  "status": "not_found",
  "error": "文件不存在或已被删除"
}
```

### 7.6 Relay WebSocket 协议（LAN 对端之间）

B1↔B2 之间的 WebSocket 使用 JSON 消息，`action` 字段标识操作类型：

```json
// 聊天消息转发
{ "action": "chat", "data": { "msgId": "...", "sender": {...}, "content": "你好" } }

// 文件通知转发
{ "action": "file_notify", "data": { "msgId": "...", "fileId": "abc-123", "fileName": "report.xlsx", ... } }

// 文件拉取请求
{ "action": "file_pull_req", "data": { "reqId": "...", "fileId": "abc-123", "fileName": "report.xlsx" } }

// 文件拉取响应
{ "action": "file_pull_resp", "data": { "reqId": "...", "fileId": "abc-123", "available": true, "downloadUrl": "/api/relay/file/abc-123" } }

// 连接握手（交换身份信息）
{ "action": "handshake", "data": { "nodeName": "B1-出口机", "network": "B网", "version": "3.1.0" } }
```

---

## 八、改动清单

### 8.1 新增文件

#### [NEW] `src/core/services/RelayService.js`

核心中继服务。主要职责：

| 模块 | 功能 |
|:---|:---|
| WebSocket 连接管理 | 基于 IP 比较的主从策略连接、断线重连、握手 |
| 消息转发引擎 | 根据消息来源方向执行转发规则 |
| 文件通知广播 | 将文件通知转发给 LAN 对端 |
| 文件中继协调 | 管理 `pendingRelayPulls`，协调逐跳拉取 |
| 文件 LAN 传输 | 通过 HTTP 在 LAN 对端之间传输文件本体 |

关键接口：

```javascript
class RelayService extends EventEmitter {
    getInterestedTypes()          // [0x10, 0x15, 0x50, 0x51]
    setScheduler(scheduler)       // 由 ServiceManager 注入
    setPeerUrl(url)               // 设置 LAN 对端地址
    handleFrame(frame)            // 处理串口帧
    handlePeerConnection(ws)      // 处理来自对端的 WebSocket 连接
    forwardToRelay(origin, data)  // 将消息转发给 LAN 对端
    injectToSerial(type, data)    // 将消息注入串口发送队列
    requestFilePull(fileId, fileName)  // WebUI 触发的文件拉取
}
```

---

### 8.2 后端改动

#### [MODIFY] `src/core/interface/AppController.js`

| 改动项 | 说明 |
|:---|:---|
| 初始化 RelayService | 创建实例，注册到 ServiceManager，读取 relay 配置 |
| 初始化 Identity | 读取 identity 配置，传递给 RelayService 和 MessageService |
| 聊天消息中继钩子 | 串口收到消息时调用 `relayService.forwardToRelay('serial', msg)` |
| 本地发送中继钩子 | `sendChat()` 时调用 `relayService.forwardToRelay('local', msg)` |
| 文件完成通知钩子 | 文件接收完成时通过 relay 广播 FILE_NOTIFY |
| relay 消息注入 | 从 relay 收到聊天消息时，注入串口发出 + 本地 WebUI 广播 |
| relay 文件通知注入 | 从 relay 收到文件通知时，注入串口（0x15）发出 + 本地 WebUI 广播 |

#### [MODIFY] `src/server/ApiServer.js`

| 改动项 | 说明 |
|:---|:---|
| WebSocket upgrade 分流 | `/relay` 路径交给 RelayService，其余走现有 WebSocket |
| 新增 `POST /api/relay/pull` | WebUI 触发文件拉取请求 |
| 新增 `GET /api/relay/file/:fileId` | 供 LAN 对端下载文件（复用现有安全校验逻辑） |
| 发送聊天 API 扩展 | `POST /api/send/chat` 接收 sender 信息（nickname 等） |

#### [MODIFY] `src/core/services/MessageService.js`

| 改动项 | 说明 |
|:---|:---|
| Body 格式升级 | `handleFrame()` 解析 JSON Body，提取 sender 和 content |
| 发送格式升级 | `sendMessage()` 将文本封装为含 sender 信息的 JSON |
| Identity 注入 | 新增 `setIdentity(identity)` 方法，由 AppController 初始化时调用 |

#### [MODIFY] `src/core/services/ServiceManager.js`

| 改动项 | 说明 |
|:---|:---|
| 注册新帧类型 | 将 `0x15`、`0x50`、`0x51` 纳入分发路由 |

---

### 8.3 前端改动

#### [MODIFY] `src/web/src/features/chat/ChatView.jsx`

| 改动项 | 说明 |
|:---|:---|
| 发送消息携带身份 | `POST /api/send/chat` 时附带用户昵称 |
| 昵称设置入口 | 聊天窗口头部区域增加昵称编辑（localStorage 持久化） |

#### [MODIFY] `src/web/src/features/chat/ChatMessage.jsx`

| 改动项 | 说明 |
|:---|:---|
| 显示发送者信息 | 消息气泡显示 `[网络名] 昵称` 格式的发送者标识 |

#### [MODIFY] `src/web/src/features/chat/FileBubble.jsx`

| 改动项 | 说明 |
|:---|:---|
| 下载逻辑分支 | `fullPath` 存在则直接下载；否则调用 `/api/relay/pull` 触发拉取 |
| 拉取中状态显示 | 触发拉取后复用现有进度条显示接收进度 |

#### [MODIFY] `src/web/src/services/WebSocketService.jsx`

| 改动项 | 说明 |
|:---|:---|
| 处理文件通知事件 | 新增 `file_notify` 事件类型，创建聊天消息 + transfer 记录 |
| sender 信息传递 | 将 sender 字段传递给 `addMessage()` |

#### [MODIFY] `src/web/src/store/appStore.js`

| 改动项 | 说明 |
|:---|:---|
| 用户昵称状态 | 新增 `nickname` 状态及 `setNickname()` action（持久化到 localStorage） |

---

### 8.4 配置文件改动

#### [MODIFY] `config/default.json.example`

新增 `identity` 和 `relay` 配置项示例。

---

## 九、数据流总览

### 9.1 聊天消息全链路流转（四网络）

```
A网张三在 A1 WebUI 发 "你好"

WebUI → POST /api/send/chat { text: "你好", nickname: "张三" }
    → A1 MessageService.sendMessage() → 串口 0x10 帧
        → B1 串口收到: 本地显示 + forwardToRelay('serial')
            → B2 relay 收到: 本地显示 + injectToSerial(0x10)
                → C1 串口收到: 本地显示 + forwardToRelay('serial')
                    → C2 relay 收到: 本地显示 + injectToSerial(0x10)
                        → D1 串口收到: 本地显示 ✅

全部 6 个节点的 WebUI 用户均看到：[A网] 张三: 你好
```

### 9.2 文件传输 + 跨网拉取流转

```
阶段一：A1 发文件，B1 接收

A1 → FILE_OFFER → B1 → FILE_ACCEPT → A1
A1 → FILE_CHUNK... → B1 → FILE_FIN
B1 文件落盘 ✅

阶段二：文件通知广播

B1 → forwardToRelay → B2 (LAN)
B2 → 串口 0x15 → C1
C1 → forwardToRelay → C2 (LAN)
C2 → 串口 0x15 → D1
所有 WebUI 看到文件卡片 ✅

阶段三：D1 用户点击下载

D1 POST /api/relay/pull → 本地无文件
D1 → 串口 0x50 → C2
C2 无文件 → relay 问 C1 (LAN)
C1 无文件 → 串口 0x50 → B2
B2 无文件 → relay 问 B1 (LAN)
B1 有文件 → LAN 传给 B2 ⚡ → B2 串口 FILE_OFFER → C1 📡
C1 收到文件 → LAN 传给 C2 ⚡ → C2 串口 FILE_OFFER → D1 📡
D1 收到文件 → WebUI 下载可用 ✅

⚡ = 局域网传输（秒级）  📡 = 串口传输（分钟级）
```

---

## 十、部署说明

本次重构为**全量升级**，所有节点统一部署新版本。

| 配置项 | 未配置时的行为 |
|:---|:---|
| `relay` | RelayService 不建立 WebSocket 连接，作为纯端点节点运行 |
| `identity` | 使用系统主机名作为 nodeName，network 字段为空 |

---

## 十一、验证计划

### 11.1 单元测试

- RelayService 消息方向判断与转发规则
- 消息 msgId 去重逻辑
- pendingRelayPulls 状态机（请求→收到文件→转发→清理）

### 11.2 三网络集成测试

1. A1、B1、B2、C1 四节点部署
2. B1↔B2 配置 relay.peer
3. 聊天消息双向全链路传播验证
4. 文件通知广播验证
5. C1 跨网拉取 B1 文件验证
6. WebUI 用户身份显示验证

### 11.3 四网络集成测试

1. 增加 C1↔C2 relay 对 + D1 端点
2. 聊天消息六节点全链路传播验证
3. D1 跨三段串口拉取文件验证
4. 文件逐跳存储验证（中间节点保留副本）

### 11.4 异常场景测试

- Relay WebSocket 断连 → 聊天消息在各自串口链路正常工作，WebSocket 自动重连
- 中继拉取过程中串口断连 → 现有断点续传机制生效
- 请求的文件已被删除 → FILE_RELAY_RESP 返回错误，FileBubble 显示失败状态
- N 网络中某个中间 relay 对断连 → 两侧子链路各自独立工作

---

## 十二、改动文件索引

| 文件 | 改动类型 | 复杂度 |
|:---|:---|:---|
| `src/core/services/RelayService.js` | **新增** | 🔴 高 |
| `src/core/interface/AppController.js` | 修改 | 🟡 中 |
| `src/server/ApiServer.js` | 修改 | 🟡 中 |
| `src/core/services/MessageService.js` | 修改 | 🟢 小 |
| `src/core/services/ServiceManager.js` | 修改 | 🟢 小 |
| `src/web/src/features/chat/ChatView.jsx` | 修改 | 🟢 小 |
| `src/web/src/features/chat/ChatMessage.jsx` | 修改 | 🟢 小 |
| `src/web/src/features/chat/FileBubble.jsx` | 修改 | 🟡 中 |
| `src/web/src/services/WebSocketService.jsx` | 修改 | 🟢 小 |
| `src/web/src/store/appStore.js` | 修改 | 🟢 小 |
| `config/default.json.example` | 修改 | 🟢 小 |
| `docs/technical_reference.md` | 修改 | 🟢 小 |
