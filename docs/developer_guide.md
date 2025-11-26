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

### 未来规划 (Phase 4 - Deferred)
- [ ] **Web UI**: 基于 Socket.io 的 Web 界面。
- [ ] **断点续传**: 基于文件 Hash 的断点恢复。

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

**步骤**:
1.  打开终端 A (模拟设备 1):
    ```bash
    node src/cli.js COM1
    ```
2.  打开终端 B (模拟设备 2):
    ```bash
    node src/cli.js COM2
    ```

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

**2025-11-25 (v2.1)**
*   **文件传输优化**: 引入滑动窗口机制 (Window=50)，大幅减少 ACK 数量。
*   **进度可视化**: CLI 新增双端实时进度条。
*   **文档重构**: 整理为 `technical_reference.md` 和 `developer_guide.md`。
