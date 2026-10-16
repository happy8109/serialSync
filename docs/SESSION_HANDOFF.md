# 全局会话交接备忘录 (SESSION_HANDOFF.md)

本文档是系统**唯一的跨会话开发状态与上下文交接中枢**。用于在新会话启动（`session-bootstrap`）时秒级还原上下文，以及在会话收尾（`git-commit-suggestion`）时固化阶段成果。

---

## 📌 当前进行中任务基准 (Active Context)
- **当前核心主线**：服务发现对齐、远程微服务全限定名寻址与 8 位字母数字不可变物理真 ID (nodeId) 架构落地
- **当前版本基准**：`3.0.5`
- **当前分支状态**：`main`

---

## 🎯 核心业务与功能最新里程碑 (Core Feature Baseline)
> **说明**：记录最近一次核心业务功能演进的物理提交与资产清单，供新会话启动时 100% 无损还原业务上下文。辅助性的文档/工作流变更不得覆写此处内容。

### [里程碑：服务发现实时对齐、微服务全限定名寻址与不可变物理真 ID 架构落地]
- **重构成果概述**：
  1. **服务发现增量对齐与自清理机制**：
     - 在 [HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js) 实现发送方关联对齐（Reconciliation）：当收到对端服务列表广播时，自动比对并淘汰历史已记录但对端已下线的陈旧服务。
     - 增加 `broadcastLocalServices()`，在本地服务注册/注销时立刻向全网广播 `PT.LIST`，配合 WebSocket 事件推送实现前端双端秒级无感同步。
  2. **微服务全限定名 (FQDN) 寻址与自拦截 Bug 彻底修复**：
     - 修复 `pullService` 优先级倒置 Bug：颠倒了原先“本地优先”的逻辑，使远程微服务与三段式全限定名优先进入网络路由引擎，彻底解决 Node-A 调用对端 `system_info` 却拦截在本端执行返回自身配置的痛点。
     - 升级服务标识为三层全限定名 `{network}/{nodeName}/{serviceId}`，并提供 `{network}/{serviceId}` 和 `{serviceId}` 的平滑别名解析。
     - 升级 [ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js) 远程调用 REST 接口以支持全路径转发，并在前端 [ServiceManager.jsx](file:///e:/nodejs/serialSync/src/web/src/features/api-forwarder/ServiceManager.jsx)、[ChatMessage.jsx](file:///e:/nodejs/serialSync/src/web/src/features/chat/ChatMessage.jsx)、[FileBubble.jsx](file:///e:/nodejs/serialSync/src/web/src/features/chat/FileBubble.jsx) 呈现多网节点来源角标。
  3. **8 位小写字母+数字不可变底层真 ID (nodeId) 架构**：
     - 确立物理实体与上层逻辑身份解耦原则：底层物理设备以不可变 8 位字母加数字（严格正则 `/^[a-z0-9]{8}$/`，不含下划线）为真 ID，上层自由配置 `{network}/{nodeName}`。
     - 在 [AppController.js](file:///e:/nodejs/serialSync/src/core/interface/AppController.js) 实现初次启动自生成与自动持久化至 `config/default.json`，且在运行时配置更新中被保护免遭覆写。
     - 贯通网络层 [RoutePacket.js](file:///e:/nodejs/serialSync/src/core/router/RoutePacket.js)、[RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js)、[HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js)、[MessageService.js](file:///e:/nodejs/serialSync/src/core/services/MessageService.js)、[RelayService.js](file:///e:/nodejs/serialSync/src/core/services/RelayService.js)、[TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js) 全线身份流转与握手协议。
     - 在 Web UI 顶栏 [MainLayout.jsx](file:///e:/nodejs/serialSync/src/web/src/layout/MainLayout.jsx) 与设置面板 [SettingsModal.jsx](file:///e:/nodejs/serialSync/src/web/src/features/settings/SettingsModal.jsx) 呈现只读 `nodeId` 标识。
- **最新已就绪核心资产 (严禁重复返工)**：
  1. [src/core/services/HttpProxyService.js](file:///e:/nodejs/serialSync/src/core/services/HttpProxyService.js)
  2. [src/core/interface/AppController.js](file:///e:/nodejs/serialSync/src/core/interface/AppController.js)
  3. [src/core/router/RoutePacket.js](file:///e:/nodejs/serialSync/src/core/router/RoutePacket.js) & [src/core/router/RouteEngine.js](file:///e:/nodejs/serialSync/src/core/router/RouteEngine.js)
  4. [src/core/services/MessageService.js](file:///e:/nodejs/serialSync/src/core/services/MessageService.js)
  5. [src/core/services/RelayService.js](file:///e:/nodejs/serialSync/src/core/services/RelayService.js)
  6. [src/core/services/TunnelService.js](file:///e:/nodejs/serialSync/src/core/services/TunnelService.js)
  7. [src/server/ApiServer.js](file:///e:/nodejs/serialSync/src/server/ApiServer.js)
  8. [src/web/src/layout/MainLayout.jsx](file:///e:/nodejs/serialSync/src/web/src/layout/MainLayout.jsx) & [src/web/src/features/settings/SettingsModal.jsx](file:///e:/nodejs/serialSync/src/web/src/features/settings/SettingsModal.jsx)
- **本轮开发确立的核心规范与红线**：
  - `nodeId` 生成与格式规则：小写英文字母与数字混合随机生成，长度严格固定为 8 位，严禁包含下划线，避免与复合键切分混淆。
  - 寻址匹配原则：`RoutePacket.matchesDestination` 优先支持对端 `nodeId` 物理直达，并兼容上层 `{network}/{nodeName}` 逻辑寻址。

---

## 🛠️ 最近一次工程与工作流维护记录 (Last Workflow Maintenance)
- **维护时间**：2026-10-16
- **维护内容**：实现服务发现增量对齐、微服务全限定名寻址、8位字母数字不可变真 ID (nodeId) 全栈贯通与 TCP 隧道操作码冲突消除。

---

## 📜 历史交接归档流水 (Archive History)
| 日期 | 版本 | 类型 | 关键成果概述 |
| :--- | :--- | :--- | :--- |
| 2026-10-16 | 3.0.5 | feature | 实现服务发现自动清理对齐、微服务全限定名寻址与 8 位字母数字不可变 nodeId 架构全栈贯通 |
| 2026-10-16 | 3.0.4 | refactor | 完成多网单串口路由、LAN多对端总线、跨网API网关、TCP端口转发隧道重构与WebUI设置适配 |
| 2026-10-11 | 1.0.0.0 | init | 初始化工程脚手架与通用协同工作流 |
