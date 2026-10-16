# 全局会话交接备忘录 (SESSION_HANDOFF.md)

本文档是系统**唯一的跨会话开发状态与上下文交接中枢**。用于在新会话启动（`session-bootstrap`）时秒级还原上下文，以及在会话收尾（`git-commit-suggestion`）时固化阶段成果。

---

## 📌 当前进行中任务基准 (Active Context)
- **当前核心主线**：单串口级联多网联通综合重构 (Phase 1 ~ Phase 5 全量完成)
- **当前版本基准**：`3.0.4`
- **当前分支状态**：`main`

---

## 🎯 核心业务与功能最新里程碑 (Core Feature Baseline)
> **说明**：记录最近一次核心业务功能演进的物理提交与资产清单，供新会话启动时 100% 无损还原业务上下文。辅助性的文档/工作流变更不得覆写此处内容。

### [里程碑：多网络单串口中继与跨网能力全面重构交付 (Phase 1 ~ Phase 5)]
- **重构成果概述**：
  1. **Phase 1 (网络层核心路由引擎)**：
     - 新增 [RoutePacket.js](file:///e:/nodejs/serialSync/src/core/router/RoutePacket.js)：定义网络层统一 3 层报文（源地址 `[net]/[node]`、目标地址 `*` / `[net]/*` / `[net]/[node]`、跳数 `ttl`、全局 `packetId`），支持串口 Buffer 与 WebSocket JSON 双模编解码。
     - 新增 [RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js)：实现通信链路泛化抽象、水平分割泛洪广播、自学习动态路由表单播定向转发与三重防环熔断机制。
  2. **Phase 2 (同网段多对端局域网总线)**：
     - 升级 [RelayService.js](file:///e:/nodejs/serialSync/src/core/services/RelayService.js)：突破单 Peer 限制，支持 `relay.peers` 局域网 WebSocket 多对端管理，动态挂载 `lan:[nodeName]` 链路到路由引擎，全双工传输 `route_packet`。
  3. **Phase 3 (跨网微服务归拢与代理网关)**：
     - 升级 [HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js) 与 [ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js)：实现本地微服务零网络跳数直接调用、跨网微服务 `PT.CALL` / `PT.RESULT` 单播路由、服务发现元数据携带全局节点标识，支持 `/api/proxy/[net]/[serviceId]/[subpath]` 级联调用与健康检查。
  4. **Phase 4 (全网消息广播与并发拉取死锁消除)**：
     - 升级 [MessageService.js](file:///e:/nodejs/serialSync/src/core/services/MessageService.js) 与 [FileTransferService.js](file:///e:/nodejs/serialSync/src/core/services/FileTransferService.js)：聊天消息接入路由引擎全网泛洪；文件传输引擎增加 `isReceiving`、`isSending` 状态检视，中继拉取增加并发防死锁拦截，防止重复触发串口传输。
  5. **Phase 5 (跨网 TCP 端口转发与隧道多路复用)**：
     - 新增 [TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js)：基于 Node.js 原生 `net` 模块（零二进制依赖），提供本地 TCP 监听服务器与远程真实服务（SSH/RDP/MySQL/Web）的双向透明流中继。定义 `PT.TUNNEL_CTRL` (0x40) 与 `PT.TUNNEL_DATA` (0x41) 协议帧，支持多会话隔离多路复用、受控端安全白名单及链路丢失主动资源销毁。
- **最新已就绪核心资产 (严禁重复返工)**：
  1. [src/core/router/RoutePacket.js](file:///e:/nodejs/serialSync/src/core/router/RoutePacket.js) & [src/core/router/RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js)
  2. [src/core/services/RelayService.js](file:///e:/nodejs/serialSync/src/core/services/RelayService.js)
  3. [src/core/services/HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js)
  4. [src/core/services/TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js)
  5. [src/core/services/MessageService.js](file:///e:/nodejs/serialSync/src/core/services/MessageService.js) & [src/core/services/FileTransferService.js](file:///e:/nodejs/serialSync/src/core/services/FileTransferService.js)
  6. [src/core/interface/AppController.js](file:///e:/nodejs/serialSync/src/core/interface/AppController.js) & [src/server/ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js)
- **本轮开发确立的核心规范与红线**：
  - 物理串口链路层协议（COBS + CRC16 + ARQ）保持 100% 稳定，网络层报文作为 Payload 封装，禁止破坏底层稳定性；
  - 严禁引入 C++ 编译型原生依赖（如 node-pty），TCP 隧道只做透明流中继，用户操作界面全部交由通用原生客户端（Xshell、PuTTY 等）；
  - 受控端执行穿透必须经过 `targetWhitelist` 白名单审查，防范未授权内网穿透。

---

## 🛠️ 最近一次工程与工作流维护记录 (Last Workflow Maintenance)
- **维护时间**：2026-10-16
- **维护内容**：完成跨网单串口级联重构方案全 5 阶段代码编写、依赖注入与架构大账本固化。

---

## 📜 历史交接归档流水 (Archive History)
| 日期 | 版本 | 类型 | 关键成果概述 |
| :--- | :--- | :--- | :--- |
| 2026-10-16 | 3.0.4 | refactor | 完成多网单串口路由、LAN多对端总线、跨网API网关、TCP端口转发隧道重构与WebUI设置适配 |
| 2026-10-11 | 1.0.0.0 | init | 初始化工程脚手架与通用协同工作流 |

