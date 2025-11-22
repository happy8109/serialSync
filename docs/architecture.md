# SerialSync 架构设计 (v2.2)

> **核心理念**：将底层通信与上层业务彻底解耦，引入"串口桥"与"优先级队列"机制，实现高可靠、多任务并发的串口通信系统。同时，通过统一的**应用控制层 (AppController)**，为 Web UI 和 CLI 提供一致的交互接口。

---

## 1. 系统架构概览

系统采用 **四层架构** 设计，自底向上分别为：

1.  **链路层 (Link Layer)**：`SerialBridge`
    *   负责物理串口的连接、断开、自动重连。
    *   负责 **COBS 编解码**，确保帧同步的绝对可靠。
    *   负责 **CRC-16 校验**，确保数据完整性。
    *   负责流控（Backpressure）。

2.  **调度层 (Scheduling Layer)**：`PacketScheduler`
    *   负责管理多级优先级队列（Priority Queues）。
    *   负责帧（Frame）的调度与发送。
    *   **特点**：抢占式调度，确保高优先级任务（如心跳、聊天）不被大数据传输阻塞。

3.  **业务层 (Service Layer)**：`Services`
    *   实现具体的业务逻辑（文件传输、聊天、API 转发）。
    *   **特点**：模块化，通过注册机制挂载到系统。

4.  **接口层 (Interface Layer)**：`AppController`
    *   作为系统的统一入口 (Facade)。
    *   负责命令的分发和状态的广播。
    *   适配不同的客户端（Web UI, CLI）。

```mermaid
graph TD
    subgraph Clients [客户端]
        WebUI[Web Interface (Socket.io)]
        CLI[Command Line (Inquirer)]
    end

    subgraph Interface Layer [接口层]
        Controller[AppController]
    end

    subgraph Service Layer [业务层]
        Chat[MessageService]
        File[FileTransferService]
        Sync[SyncService]
        Sys[SystemService]
    end

    subgraph Scheduling Layer [调度层]
        Q0[P0: System/Critical]
        Q1[P1: Interactive]
        Q2[P2: Active Transfer]
        Q3[P3: Background]
        
        Scheduler[PacketScheduler]
    end

    subgraph Link Layer [链路层]
        Bridge[SerialBridge]
        Codec[PacketCodec (COBS/CRC)]
        Port[Physical SerialPort]
    end

    WebUI <-->|JSON/Events| Controller
    CLI <-->|Func/Events| Controller

    Controller --> Chat
    Controller --> File
    Controller --> Sync
    Controller --> Sys

    Chat -->|P1| Q1
    File -->|P2| Q2
    Sync -->|P3| Q3
    Sys -->|P0| Q0
    
    Q0 & Q1 & Q2 & Q3 --> Scheduler
    Scheduler --> Bridge
    Bridge --> Codec
    Codec --> Port
```

---

## 2. 核心组件设计

### 2.1 链路层：SerialBridge & PacketCodec

**职责**：
*   **连接管理**：封装 `serialport` 库，提供统一的 `connect`, `disconnect`, `reconnect` 接口。
*   **COBS 编解码**：
    *   **发送**：`Raw Frame` -> `CRC` -> `COBS Encode` -> `0x00` -> `Port`
    *   **接收**：`Port` -> `Buffer` -> `Split by 0x00` -> `COBS Decode` -> `CRC Check` -> `Frame`
*   **脏数据清洗 (Resync)**：
    *   得益于 COBS，Resync 变得极其简单：只要丢弃当前缓冲区直到下一个 `0x00`，即可立即恢复同步。

### 2.2 调度层：PacketScheduler

**优先级定义**：

| 优先级 | 名称 | 典型用途 | 特性 |
| :--- | :--- | :--- | :--- |
| **P0** | **System** | Ping/Pong, ACK, NACK | **最高优先级**，极小包，立即发送，不可阻塞 |
| **P1** | **Interactive** | Chat, Command, API Request | **高优先级**，用户交互，延迟敏感 |
| **P2** | **Active** | Manual File Transfer | **中优先级**，用户主动发起的文件传输 |
| **P3** | **Background** | Auto Sync, Logs | **低优先级**，后台任务，随时可被抢占 |

### 2.3 业务层：Services

#### FileTransferService (文件传输服务)
*   **切片化**：将大文件切分为固定大小的 Chunk。
*   **选择性重传 (Selective Repeat)**：
    *   接收端维护 Bitmap，记录已收到的 Chunks。
    *   定期发送 `FILE_ACK` (含 Bitmap)。
    *   发送端根据 Bitmap 仅重传丢失的包。
*   **断点续传**：
    *   基于文件 Hash 和 Bitmap。
    *   重连后，接收端发送当前的 Bitmap，发送端直接从断点继续。

#### MessageService (消息服务)
*   处理聊天消息、短文本。
*   直接使用 P1 优先级发送。

#### SystemService (系统服务)
*   **心跳保活**：每隔 N 秒发送 Ping (P0)，等待 Pong。超时则判定断连。
*   **握手协商**：连接建立后，交换版本号和能力集（Capabilities）。

### 2.4 接口层：AppController

**职责**：
*   **命令路由**：将 `send_msg`, `start_transfer` 等高层命令路由到对应的 Service。
*   **状态聚合**：收集各 Service 的状态（如连接状态、传输进度、日志），统一格式后广播给前端。
*   **配置管理**：处理配置的动态更新，并通知相关 Service。

---

## 3. 关键机制详解

### 3.1 流量控制与背压 (Flow Control)
为了防止 Node.js 层的发送速率超过物理串口的波特率导致缓冲区溢出：
1.  `SerialBridge` 监听 `port.write()` 的返回值。如果返回 `false`，标记 `isCongested = true`，并触发 `pause` 事件。
2.  `PacketScheduler` 收到 `pause` 事件，停止 `dequeue` 操作。
3.  当串口底层触发 `drain` 事件，`SerialBridge` 标记 `isCongested = false`，触发 `resume` 事件。
4.  `PacketScheduler` 恢复工作。

### 3.2 脏数据清洗 (Resync)
在串口通信中，干扰可能导致字节错位。
*   **COBS 的优势**：`0x00` 是唯一的帧定界符。
*   **清洗逻辑**：如果 CRC 校验失败，直接丢弃该帧。下一帧从下一个 `0x00` 开始，天然自动同步，无需复杂的"寻找包头"逻辑。

---

## 4. 目录结构规划 (重构后)

```
src/
├── core/
│   ├── transport/          # 传输层核心
│   │   ├── SerialBridge.js # 串口桥 (含 COBS Stream 处理)
│   │   ├── PacketCodec.js  # 编解码器 (CRC 计算, Frame 封装)
│   │   └── PacketScheduler.js # 调度器
│   ├── services/           # 业务服务
│   │   ├── ServiceManager.js
│   │   ├── FileTransferService.js
│   │   ├── MessageService.js
│   │   └── SystemService.js
│   ├── interface/          # 接口层 (新增)
│   │   └── AppController.js
│   └── protocol/           # 协议定义
│       ├── Frame.js
│       └── Constants.js
├── ui/                     # 前端代码 (保持不变)
├── utils/                  # 工具类
├── index.js                # 入口
└── config/                 # 配置
```
