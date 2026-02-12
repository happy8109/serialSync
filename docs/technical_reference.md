# SerialSync 技术参考手册 (v2.9.6)

本文档整合了 SerialSync 的系统架构、通信协议规范及核心性能机制。

**v2.9.6 新增**: 持续性心跳握手 + UI 三态指示器 — 详见下方 §3.7

**v2.9 新增**: ARQ 可靠传输层 + 传输性能优化 — 详见下方 §3.5 & §3.6

**v2.3 新增**: API转发 (HTTP透明代理) — 详见 [api_forwarding_design.md](./api_forwarding_design.md)

---

## 1. 系统架构 (Architecture)

### 1.1 核心理念
将底层通信与上层业务彻底解耦，引入"串口桥"与"优先级队列"机制，实现高可靠、多任务并发的串口通信系统。通过统一的 **应用控制层 (AppController)** 为客户端提供一致接口。

### 1.2 分层架构设计

系统自底向上分为以下各层：

1.  **链路层 (Link Layer)**：`SerialBridge`
    *   负责物理串口管理、**COBS 编解码** (帧同步)、**CRC-16 校验** (完整性)、流控及 **PING/PONG 心跳探测**。
2.  **可靠传输层 (Reliable Transport Layer)**：`ReliableLink` *(v2.8 新增)*
    *   基于 ARQ (Automatic Repeat reQuest) 的链路层可靠传输。支持滑动窗口 (WINDOW_SIZE=4)、自动重传、序列号确认和去重。
3.  **调度层 (Scheduling Layer)**：`PacketScheduler`
    *   管理 P0-P3 四级优先级队列，实现抢占式调度。支持 ARQ 和直接串口两种发送路径。
4.  **业务层 (Service Layer)**：`Services`
    *   模块化的业务逻辑实现 (文件传输、聊天、系统服务)。
5.  **接口层 (Interface Layer)**：`AppController`
    *   系统的统一入口 (Facade)，负责命令路由和状态广播。
6.  **接入层 (Access Layer)**：`ApiServer`
    *   基于 HTTP/WebSocket 的 API 服务，为 Web/Desktop 客户端提供远程控制能力。支持 1MB 负载解析。
7.  **持久化层 (Persistence Layer)**：`Store`
    *   Web 端基于 Zustand Persist 实现聊天历史与传输状态的跨会话保存。

### 1.3 核心组件

*   **SerialBridge**: 封装 `serialport`，利用 COBS 的 `0x00` 定界符实现天然的脏数据清洗 (Resync)。
*   **PacketScheduler**: 
    *   **P0 (System)**: Ping/Pong, ACK (最高优先级，不可阻塞)
    *   **P1 (Interactive)**: Chat, Commands (高优先级，低延迟)
    *   **P2 (Active)**: Manual File Transfer (中优先级)
    *   **P3 (Background)**: Auto Sync, Logs (低优先级)
*   **FileTransferService**: 实现基于滑动窗口的文件传输。

---

## 2. 通信协议 (Protocol v2.1)

### 2.1 物理层编码
采用 **COBS (Consistent Overhead Byte Stuffing)** 编码。
*   **定界符**: `0x00`
*   **优势**: 数据中无 `0x00`，实现可靠的帧同步；开销极低 (~0.4%)。

### 2.2 帧结构
`[TYPE(1)] [SEQ(4)] [LEN(2)] [BODY(N)] [CRC(2)]` (解码 COBS 后)
*   **SEQ (4 Bytes)**: 序列号升级为 32 位，以支持超过 64MB 的大文件传输 (当 Chunk=1KB 时)。

### 2.3 包类型定义

| 层级 | TYPE | 名称 | 说明 | Body 格式 |
| :--- | :--- | :--- | :--- | :--- |
| **System** | `0x00` | PING | 心跳请求 | 空 |
| | `0x01` | PONG | 心跳响应 | 空 |
| | `0x02` | HANDSHAKE | 握手 | JSON |
| | `0x03` | ACK | 通用确认 | JSON: `{seq}` |
| **Message** | `0x10` | MSG_TEXT | 文本消息 | UTF-8 String |
| **Transfer** | `0x20` | FILE_OFFER | 发送请求 | JSON: `{id, name, size, chunks, hash}` |
| | `0x21` | FILE_ACCEPT | 接受响应 | JSON: `{id, accepted, nextSeq}` |
| | `0x22` | FILE_CHUNK | 文件数据 | `[FileID(36)] [Data(N)]` |
| | `0x23` | FILE_ACK | 传输确认 | JSON: `{id, nextSeq}` |
| | `0x24` | FILE_FIN | 传输完成 | JSON: `{id}` |
| **API Proxy** | `0x30` | SERVICE_CALL | HTTP服务调用 | JSON: `{id, service, params}` |
| | `0x31` | SERVICE_RESULT | 服务调用响应 | JSON: `{id, status, data, error}` |
| | `0x32` | SERVICE_QUERY | 查询服务列表 | JSON: `{id, filter}` |
| | `0x33` | SERVICE_LIST | 返回服务列表 | JSON: `{id, services}` |
| | `0x34` | SERVICE_CHUNK | 大数据分片 | JSON: `{id, seq, total, data}` |
| **File Sync** | `0x40` | SYNC_LIST_REQ | 获取文件列表请求 | JSON: `{shareId, qid}` |
| | `0x41` | SYNC_LIST_RESP | 返回文件列表响应 | JSON: `{qid, entries}` |
| | `0x42` | SYNC_PULL_REQ | 主动请求拉取文件 | JSON: `{shareId, entryName, fileName}` |
| | `0x43` | SYNC_DELETE_REQ | 请求删除远程文件 | JSON: `{shareId, entryName, fileName}` |
| | `0x44` | SYNC_SHARES_QUERY | 询问对端公开共享 | 空 |
| | `0x45` | SYNC_SHARES_ANNOUNCE | 宣告本地公开共享 | JSON: `{shares}` |

---

## 3. 核心机制与性能优化

### 3.1 应用层滑动窗口流控 (File Sliding Window)
针对大文件传输 (v2.1 引入)：
*   **窗口大小**: **25 个 Chunk** (约 50KB)。发送端一次性发送窗口内数据。
*   **ACK 机制**: 接收端每收到 **5 个 Chunk** 发送一次 `FILE_ACK`(`ackInterval=5`)，告知期望的 `nextSeq`。(v2.9.4 优化)
*   **重传策略**: ARQ 模式下由链路层保证可靠性，应用层不再重传数据帧 (`reliableTransport` 标志)。非 ARQ 模式下保留选择性重传。

### 3.2 断点续传 (Resumable Upload)
v2.2 新增功能，基于文件 Hash 和元数据文件：
1.  **Hash 校验**: `FILE_OFFER` 携带文件 MD5 Hash。
2.  **状态持久化**: 接收端在传输过程中维护 `.meta` 文件记录已接收的 Bitmap。
3.  **续传握手**: 
    *   接收端收到 Offer 时，若本地存在匹配的 `.meta`，则在 `FILE_ACCEPT` 中返回 `nextSeq`。
    *   发送端收到 `nextSeq` 后，直接跳转窗口位置，跳过已传数据。
4.  **原子完成与冲突处理**: 传输完成后，接收端将 `.part` 临时文件重命名为正式文件名。若文件名冲突，支持自增重命名（如 `file_1.zip`）。(v2.5 增强)

### 3.3 性能指标
在 115200 bps 波特率下 (v2.9.4 实测)：
*   **吞吐量**: ~11.2 KB/s (理论极限 11.52 KB/s 的 **97%**)。
*   **传输速度**: 1MB 文件约 89 秒，接近物理带宽上限。
*   **提升**: 相比 v2.9.1 (停等+双层重传)，传输时间缩短 **65%**，有效帧数减少 **55%**。

### 3.4 参数调优建议

| 场景 | 窗口大小 | Chunk 大小 | ACK 频率 | ARQ 窗口 |
| :--- | :--- | :--- | :--- | :--- |
| **标准 (默认, v2.9)** | 25 | 2048 B | 每 5 包 | 4 帧 |
| **高质量链路** | 50 | 2048 B | 每 10 包 | 8 帧 |
| **低质量/无线** | 10 | 512 B | 每 5 包 | 2 帧 |

### 3.5 ARQ 可靠传输层 (v2.8 新增)
`ReliableLink` 在链路层提供帧级别的可靠传输保障：
*   **滑动窗口**: `WINDOW_SIZE=4`，最多 4 帧并发在飞。
*   **帧间延时**: `FRAME_INTERVAL=50ms`，控制发送节奏。
*   **超时重传**: `ACK_TIMEOUT=5000ms`，未收到 ACK 的帧自动重传。
*   **序列号管理**: 10-bit FSeq (0-1023) 循环使用，FAck 捎带确认。
*   **去重**: 接收端基于 FSeq 去重，防止重复帧交付上层。
*   **pendingQueue 保护**: 上限 50 条，溢出丢弃最旧条目防止 OOM。

### 3.6 双层重传消除 (v2.9.3)
ARQ 模式下存在两层重传机制冲突：
*   **链路层**: `ReliableLink` 的 ACK_TIMEOUT (5s) 自动重传。
*   **应用层**: `FileTransferService` 的 watchdog (5s) 数据重传。

两层同时触发会导致帧序号浪费（实测 fSeq 翻倍）。解决方案：
*   `AppController` 初始化时传递 `reliableTransport: bridge.enableARQ`。
*   `FileTransferService._watchdog()` 检测到 `reliableTransport=true` 时跳过数据帧重传，仅保留控制帧 (Offer/Accept) 的重传。

### 3.7 心跳与链路状态管理 (v2.9.5)
`SerialBridge` 通过持续性 PING/PONG 心跳机制管理链路状态，取代了之前的盲等计时器 (`linkReadyDelay`)。

**状态机**:
```
串口 open → linkReady=false → 每 2s 发 raw PING（快探测）
                ↓ 收到对端任何合法帧
         linkReady=true → 每 10s 发 raw PING（慢保活）
                ↓ 连续 3 次无 PONG
         linkReady=false → 切回 2s 快探测 → emit('linkLost')
```

**关键参数**:

| 参数 | 值 | 含义 |
| :--- | :--- | :--- |
| `PROBE_INTERVAL` | 2000ms | 快探测间隔 (linkReady=false) |
| `KEEPALIVE_INTERVAL` | 10000ms | 慢保活间隔 (linkReady=true) |
| `MAX_MISS` | 3 | 连续丢失 N 次 PONG 判定断连 |

**ARQ 兼容**: 心跳 PING/PONG 使用 fSeq=0 标识，在 bridge 层拦截处理，不进入 ARQ 管道（避免被当作重复帧丢弃）。

**联动机制**:
*   `linkLost` → 清空远程服务缓存、UI 指示灯切换为橙色。
*   `linkReady` → 自动触发服务发现和同步发现、UI 指示灯切换为绿色。
*   UI 三态指示器：🟢 对端在线 / 🟠 等待对端 / 🔴 串口断开。

---

## 4. API 转发 (HTTP 透明代理) - v2.3

### 4.1 核心概念

API转发功能允许串口两端设备通过串口访问对端主机上的本地HTTP服务。两端设备地位平等，均可提供服务并调用对端服务。

**典型应用**:
- 工业现场设备 ↔ 监控中心: 远程数据采集
- 双向配置同步: 设备互相读取/更新配置
- 报表系统: 无数据库设备访问有数据库设备的报表API

### 4.2 协议支持

通过 `0x30-0x33` 四个包类型实现:
- **服务调用**: `SERVICE_CALL` → 本地HTTP调用 → `SERVICE_RESULT`
- **服务发现**: `SERVICE_QUERY` → 查询注册表 → `SERVICE_LIST`

### 4.3 配置示例

```json
{
  "services": {
    "enabled": true,
    "localServices": {
      "daily_brief": {
        "name": "每日简报",
        "endpoint": "http://localhost:3000/api/stats/daily/brief",
        "method": "GET",
        "timeout": 10000
      }
    }
  }
}
```

---

## 5. 文件同步 (File Sync) - v2.7 增强

### 5.1 路径解析机制 (Path Resolution)

为了支持跨平台（Windows/Linux）和绝对路径落地，引入了 `pathUtils.js` 工具类：
- **家目录识别**: 自动将 `~/` 或 `~\\` 前缀解析为当前系统的 `os.homedir()`。
- **绝对路径转换**: 使用 `path.resolve()` 确保所有配置的路径在进入文件系统操作前均转换为物理绝对路径。
- **落地隔离**: 同步落地路径独立于聊天文件传输，支持通过 `customSaveDir` 参数自定义物理存储位置。

### 5.2 1:1 镜像同步 (Unidirectional Deletion)

在单向同步模式（`remoteToLocal` 或 `localToRemote`）下，系统实现严格的内容镜像：
- **删除探测**: `_computeDiff` 逻辑升级，能够识别出在源端已删除（或重命名）但在目标端依然存在的冗余文件。
- **自动清理**: 
    - 如果是本地订阅端多出文件，系统自动执行 `fs.unlinkSync`。
    - 如果是远端多出文件，通过 `SYNC_DELETE_REQ (0x43)` 指令通知对端清理。
- **安全性**: 双向同步模式 (`both`) 下不执行自动删除，以防止并发修改下的数据丢失。

---

## 6. 隔离网络数据摆渡 (Air-gap Data Bridge) - v2.6 愿景

### 6.1 场景概述

SerialSync 作为一个“串口桥”，其核心价值之一是实现两个物理隔离网络之间的安全数据交换。在这种场景下，串口两端的电脑充当“摆渡站”。

**业务逻辑：**
- **公共聊天室**：串口两端的网络内，任何第三方电脑均可通过 Web UI 参与聊天。系统不引入数据库，所有历史记录由前端持久化或在内存中流转。
- **异步文件交换**：第三方电脑 A 上传文件到摆渡站 A，摆渡站 A 通过串口自动同步到摆渡站 B。摆渡站 B 的 Web UI 提供下载链接，供网络 B 内的第三方电脑 D 下载。

### 6.2 身份识别机制

为了在无数据库环境下区分来自同一网络的不同用户，采用以下混合机制：
1.  **临时昵称 (Nickname)**：用户可在 UI 设置中自定义昵称，存储于浏览器的 `localStorage` 中。
2.  **默认身份 (Default ID)**：若用户未设置昵称，系统自动获取客户端的 **局域网 IP 地址** 作为默认代号。
3.  **协议扩展**：`MSG_TEXT (0x10)` 包的 Payload 结构扩展为 JSON，包含 `sender`（昵称+IP）和 `content` 字段。

### 6.3 调度与开发冲突处理

系统通过以下机制确保在大文件同步时，第三方用户的交互体验不受影响：
- **抢占式调度 (QoS)**：`PacketScheduler` 确保聊天消息（P1）可以随时抢占文件分片（P2）的带宽，实现低延迟沟通。
- **流多路复用**：`FileTransferService` 支持基于 `FileId` 的多任务并行。来自不同用户的多个文件上传请求会被并行切片并交织发送。
- **静态资源暴露**：摆渡站后端将 `received_files` 目录映射为静态资源路径，允许 Web UI 生成直接下载链接。

---
