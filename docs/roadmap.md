# SerialSync 重构路线图 (Roadmap)

本文档规划了从 v1.2.0 向 v2.0 架构演进的详细步骤。

> **当前重点**：优先实现串口桥核心 (Core) 和 CLI 工具，暂不涉及 Web UI 的适配。

---

## Phase 1: 核心重构 (Core Refactoring)
**目标**：建立稳定的“串口桥”和“调度器”，替换现有的 `SerialManager` 底层。

- [ ] **Step 1.1: 提取 PacketCodec**
    - 创建 `src/core/transport/PacketCodec.js`。
    - 实现 CRC-16 算法。
    - 实现 COBS 编解码。
    - 实现 Frame 封装与解析。
    - 编写单元测试 `test/PacketCodec.test.js`。

- [ ] **Step 1.2: 实现 SerialBridge**
    - 创建 `src/core/transport/SerialBridge.js`。
    - 实现 `connect`, `disconnect`。
    - 实现底层流处理循环（读取 -> COBS Decode -> CRC Check -> emit 'frame'）。
    - 实现流控机制（监听 `drain` 事件）。

- [ ] **Step 1.3: 实现 PacketScheduler**
    - 创建 `src/core/transport/PacketScheduler.js`。
    - 实现 P0-P3 四级优先级队列。
    - 实现调度循环：`next()` -> `bridge.write()` -> `wait drain` -> `next()`。

## Phase 2: 服务迁移 (Service Migration)
**目标**：将现有业务逻辑迁移到新的 Service 架构。

- [ ] **Step 2.1: 基础服务框架**
    - 定义 `Service` 基类和 `ServiceManager`。
    - 实现 `SystemService` (心跳、握手)。

- [ ] **Step 2.2: 迁移消息服务**
    - 创建 `src/core/services/MessageService.js`。
    - 实现聊天消息的发送/接收逻辑。

- [ ] **Step 2.3: 迁移文件服务 (重头戏)**
    - 创建 `src/core/services/FileTransferService.js`。
    - 实现 `TransferSession` 状态管理。
    - 实现文件切片读取、写入。
    - 实现断点续传逻辑（基于 Hash 和 Chunk Bitmap）。

## Phase 3: CLI 集成 (CLI Integration)
**目标**：构建基于新架构的命令行工具，用于开发测试。

- [ ] **Step 3.1: 实现 AppController**
    - 创建 `src/core/interface/AppController.js`。
    - 实现命令分发逻辑。

- [ ] **Step 3.2: 重写 CLI**
    - 创建 `src/cli_v2.js`。
    - 使用 `inquirer` 实现交互式菜单。
    - 对接 `AppController`，支持连接、发消息、传文件、查看状态。
    - 增加 Debug 命令（模拟丢包、暂停等）。

## Phase 4: Web UI 适配 (Deferred)
*暂时搁置，待核心和 CLI 稳定后再进行。*
