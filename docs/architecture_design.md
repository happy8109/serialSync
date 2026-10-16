# 系统架构设计与技术大账本 (architecture_design.md)

本文档是系统**唯一长期技术全景大账本**。承载系统的全局技术选型、拓扑设计、核心数据与路由模型、分层架构与演进清单。

---

## 1. 核心定位与技术全景 (Tech Stack & Architecture)
- **系统核心目标**：单串口物理约束下，联通多个物理隔离局域网（如 A网、B网、C网），实现跨网全网广播通信（文本聊天、文件互传）、跨网 HTTP API 服务归拢与透明网关调用、以及跨网 TCP 端口转发（原生 SSH/RDP 穿透）。
- **核心运行时 / 语言**：Node.js (LTS) / CommonJS 模块化
- **网络与通信技术选型**：
  - **物理传输层 (Layer 1/2)**：物理串口 (RS232/USB-Serial) + COBS 转义编码 + CRC16 校验 + 可靠滑动窗口链路层 ARQ ([ReliableLink.js](file:///e:/nodejs/serialSync/src/core/transport/ReliableLink.js), [SerialBridge.js](file:///e:/nodejs/serialSync/src/core/transport/SerialBridge.js))
  - **网络层路由引擎 (Layer 3)**：[RoutePacket.js](file:///e:/nodejs/serialSync/src/core/router/RoutePacket.js) 统一协议报文 + [RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js)
  - **网内级联总线 (LAN Bus)**：同网段网关间局域网 WebSocket 多对端链路 ([RelayService.js](file:///e:/nodejs/serialSync/src/core/services/RelayService.js))
  - **跨网服务网关 (RPC Proxy)**：跨网 HTTP 微服务反向代理与服务发现 ([HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js))
  - **跨网 TCP 隧道 (TCP Forwarding)**：原生 Node.js `net` 模块驱动的 TCP 端口转发与多路复用隧道 ([TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js))
- **零外部二进制依赖原则 (Anti-Over-Engineering)**：
  - 严禁引入编译型二进制扩展（如 node-pty、C++ addon）；
  - TCP 端口转发直接使用标准 `net.createServer` 和 `net.createConnection`，终端排版交互 100% 交由原生客户端（Xshell、PuTTY、MobaXterm、VS Code 等）自行处理。

---

## 2. 拓扑与路由模型 (Network Topology & Layer 3 Routing)

### 2.1 物理约束与拓扑结构
```text
  [ A网局域网 ]                  [ B网局域网 ]                  [ C网局域网 ]
+----------------+            +----------------+            +----------------+
|  主机 A1       | ==串口1==> |  主机 B1       |            |  主机 C1       |
| (网关:串口+LAN)|            | (网关:串口+LAN)|            | (网关:串口+LAN)|
+-------||-------+            +-------||-------+            +-------||-------+
      LAN WS                        LAN WS                        LAN WS
+-------||-------+            +-------||-------+            +-------||-------+
|  主机 A2       |            |  主机 B2       | ==串口2==> |  主机 C2       |
| (网关:串口+LAN)|            | (网关:串口+LAN)|            | (普通机/网关)  |
+----------------+            +----------------+            +----------------+
```

### 2.2 路由包寻址规范 (`RoutePacket`)
- **源地址 (`src`)**：`[network]/[nodeName]`（如 `A网/A1`）
- **目标地址 (`dst`)**：
  - `*`：全网广播（文本聊天、文件通知、服务发现、拉取广播）
  - `[network]/*`：特定网段广播（如 `B网/*`）
  - `[network]/[nodeName]`：点对点精准单播（如 `C网/C1`，用于 RPC 调用回传与 TCP 隧道）
- **三重防环与破环机制 (Anti-Loop Circuit Breaker)**：
  1. `packetId` 全局去重（保留最近 2000 个包）；
  2. `ttl` 跳数扣减（默认 8 跳，超限立即静默丢弃）；
  3. **水平分割 (Split-Horizon)**：广播泛洪绝不原路回送。

---

## 3. 核心分层架构与业务子系统 (Subsystems)

```text
src/
├── core/
│   ├── transport/       # 链路层：PacketCodec, ReliableLink, SerialBridge, PacketScheduler
│   ├── router/          # 网络层：RoutePacket, RouteEngine (链路抽象、自学习路由表、水平分割)
│   ├── services/        # 传输与应用层服务：
│   │   ├── RelayService.js       # 多对端 LAN WebSocket 总线与文件拉取协调
│   │   ├── HttpProxyService.js   # 跨网 HTTP 服务注册、自动发现与流式网关调用
│   │   ├── TunnelService.js      # 跨网 TCP 端口转发、会话多路复用与安全白名单
│   │   ├── FileTransferService.js# 文件分片传输、窗口拥塞控制与并发锁状态机
│   │   ├── FileSyncService.js    # 定时与触发式目录镜像同步
│   │   ├── MessageService.js     # 跨网文本聊天服务与去重
│   │   ├── SystemService.js      # 系统级心跳检测与链路诊断
│   │   └── ServiceManager.js     # 服务统一注册与分发管理器
│   └── interface/
│       └── AppController.js      # 全局外观中枢，各服务依赖组装与生命周期管理
└── server/
    ├── ApiServer.js              # RESTful API、统一代理路由与 WebUI WebSocket 服务器
    └── WebServer.js              # 静态页面托管与客户端资产下发
```

---

## 4. 全局演进阶段 (Roadmap & Status)
- [x] **Phase 1**：网络层抽象与核心路由引擎（`RoutePacket` 报文结构与 `RouteEngine` 泛洪/单播/防环）
- [x] **Phase 2**：同网段多对端局域网级联总线（`RelayService` 多 Peer 支持与动态链路绑定）
- [x] **Phase 3**：跨网微服务归拢与代理网关（`HttpProxyService` 跨网路由与 `ApiServer` 网关调用）
- [x] **Phase 4**：全网广播与并发拉取死锁消除（`MessageService` 全网泛洪与文件并发拉取状态拦截）
- [x] **Phase 5**：跨网 TCP 端口转发与隧道多路复用（`TunnelService` 零二进制依赖原生 TCP 穿透）

