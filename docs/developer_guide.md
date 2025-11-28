# SerialSync 开发指南

本文档包含项目路线图、开发环境设置、测试方法及 CLI 工具使用说明。

---

## 1. 项目状态与路线图 (Roadmap)

**当前版本**: v2.1 (Core Refactoring Complete)

### 已完成功能 (Phase 1-3)
- [x] **核心传输层**: PacketCodec (COBS/CRC), SerialBridge, PacketScheduler (QoS)。
- [x] **服务层**: MessageService (Chat), FileTransferService (Sliding Window), SystemService。
- [x] **CLI 工具**: 基于 `inquirer` 的交互式命令行工具。
- [x] **性能优化**: 大文件传输吞吐量提升 5-10 倍。
- [x] **断点续传**: 基于文件 Hash 的断点恢复 (v2.2)。

### 未来规划 (Phase 4 - API & UI)
- [x] **API Server**: 基于 Express/WS 的 REST + WebSocket 服务。
- [ ] **Web UI**: 基于 React/Vue 的可视化控制台。

---

## 2. 快速开始

### 2.1 环境要求
- Node.js v14+
- 虚拟串口工具 (开发测试用):
    - Windows: [com0com](http://com0com.sourceforge.net/)
    - Linux/Mac: `socat`

### 2.2 安装依赖
```bash
npm install
```

### 2.3 启动 API Server (推荐)
```bash
# 启动服务器 (默认端口 3000)
node src/server/index.js

# 启动并自动连接串口 (方便测试)
node src/server/index.js COM1 3000
```
访问 `test/api_client.html` 进行测试。

---

## 3. 测试指南

### 3.1 模拟环境测试 (推荐)
无需硬件或虚拟串口，直接在内存中模拟两个设备的通信。
```bash
node test/simulated_env.js
```
*测试内容*: Chat 消息收发, Ping RTT 测试, 模拟文件传输调度。

### 3.2 真实/虚拟串口测试
需要成对的串口 (如 `COM1` <-> `COM2`)。

**方式 A: 使用 CLI (交互式)**
1.  打开终端 A: `node src/cli.js COM1`
2.  打开终端 B: `node src/cli.js COM2`

**方式 B: 使用 API Server (Web 控制)**
1.  打开终端 A: `node src/server/index.js COM1 3000`
2.  打开终端 B: `node src/server/index.js COM2 3001`
3.  打开浏览器访问 `test/api_client.html`，分别连接到两个端口。

---

## 4. CLI 使用说明

CLI 启动后进入交互式 REPL 模式。

### 常用命令
*   **`chat <message>`**: 发送文本消息。
    *   示例: `chat Hello World`
*   **`ping`**: 发送心跳包并测量 RTT。
*   **`file <path>`**: 发送真实文件。
    *   示例: `file ./test_data/image.jpg`
*   **`file <count>`**: 发送模拟文件数据 (用于测试吞吐量)。
    *   示例: `file 1000` (发送 1000 个 Chunk)
*   **`status`**: 查看当前连接状态和统计信息。

---

## 5. 最近变更 (Changelog Summary)

**2025-11-28 (v2.3)**
*   **API Server**: 实现了基于 Express/WebSocket 的 API 服务层。
*   **Core Refactor**: 重构 `FileTransferService` 为事件驱动，支持实时进度推送。
*   **Auto Connect**: Server 支持通过命令行参数或配置文件自动连接串口。
*   **Test Client**: 新增 `test/api_client.html` 用于 API 功能验证。

**2025-11-25 (v2.1)**
*   **文件传输优化**: 引入滑动窗口机制 (Window=50)，大幅减少 ACK 数量。
*   **进度可视化**: CLI 新增双端实时进度条。
*   **文档重构**: 整理为 `technical_reference.md` 和 `developer_guide.md`。

---

## 6. API Server 设计规范 (Phase 4)

为了支持 Web UI 和桌面应用集成，我们将实现一个基于 HTTP/WebSocket 的 API Server 层，封装核心功能。

### 6.1 架构概览
*   **Core SDK**: `AppController` (Node.js)，负责业务逻辑。
*   **API Server**: `Express` + `ws`，负责对外暴露接口。
*   **Clients**: Web UI / Desktop App / CLI。

### 6.2 REST API 接口
用于控制指令和状态查询。

| 方法 | 路径 | 描述 | 参数示例 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/ports` | 列出可用串口 | - |
| `POST` | `/api/connect` | 连接串口 | `{ "path": "COM1", "baudRate": 115200 }` |
| `POST` | `/api/disconnect` | 断开连接 | - |
| `POST` | `/api/config` | 修改系统配置 | `{ "chunkSize": 4096, "windowSize": 100 }` |
| `POST` | `/api/send/chat` | 发送消息 | `{ "text": "Hello" }` |
| `POST` | `/api/send/file` | 发送文件 | `{ "path": "C:/data.bin" }` (或 multipart 上传) |
| `POST` | `/api/transfer/:fileId/pause` | 暂停传输 | - |
| `POST` | `/api/transfer/:fileId/resume` | 恢复传输 | - |
| `POST` | `/api/transfer/:fileId/cancel` | 取消传输 | - |

### 6.3 WebSocket 事件
用于实时数据推送。

*   **Log**: `{ "type": "log", "level": "info", "message": "..." }`
*   **Status**: `{ "type": "status", "connected": true, "port": "COM1" }`
*   **Progress**: `{ "type": "progress", "file": "test.bin", "percent": 45, "speed": "1.2MB/s" }`
*   **Chat**: `{ "type": "chat", "from": "remote", "text": "Hi there" }`
