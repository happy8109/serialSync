# SerialSync - 串口通信与文件同步工具 (v2.0 Refactoring)

> **当前状态**：正在进行 v2.0 架构重构。旧版本 (v1.2.0) 代码仍在 `src/` 中，但开发重心已转移至新架构。

## 🚧 重构进行中 (Refactoring in Progress)

本项目正在经历一次彻底的架构升级，旨在解决 v1.x 版本中的稳定性、并发处理和扩展性问题。

### 🎯 重构目标 (v2.0 Goals)
*   **高可靠性**：引入 **COBS** 编码和 **CRC-16** 校验，彻底解决粘包、乱码和数据校验问题。
*   **多任务并发**：引入 **优先级队列 (Priority Queues)**，确保聊天、心跳等高优先级任务不被大文件传输阻塞。
*   **断点续传**：基于 **Bitmap ACK** 的选择性重传机制，实现高效、精准的断点续传。
*   **架构解耦**：采用 **四层架构** (Link -> Scheduling -> Service -> Interface)，分离底层通信与上层业务。

### 📚 新版文档 (Documentation)
*   [架构设计 (Architecture)](docs/architecture.md)
*   [通信协议 (Protocol)](docs/protocol.md)
*   [重构路线图 (Roadmap)](docs/roadmap.md)

---

## 🛠️ 旧版功能 (v1.2.0 Legacy)

> 以下内容适用于 v1.2.0 版本，新版本发布后将更新。

一个基于 Node.js 的现代化串口通信与文件同步程序。

### 快速开始
```bash
npm install
npm run cli COM3  # 启动 CLI
node src/index.js # 启动 Web 服务
```

### 主要功能
- 串口通信与自动重连
- 聊天窗口字符消息收发
- 单文件分块传输
- Web UI 界面

---

## 📁 目录结构 (规划中)

```
serial-sync/
├── src/
│   ├── core/               # v2.0 核心代码 (开发中)
│   │   ├── transport/      # 传输层 (Bridge, Codec, Scheduler)
│   │   ├── services/       # 业务层 (File, Chat, System)
│   │   └── interface/      # 接口层 (AppController)
│   ├── ui/                 # Web 前端资源
│   ├── cli.js              # v1.0 CLI (旧)
│   ├── cli_v2.js           # v2.0 CLI (规划中)
│   └── index.js            # 入口文件
├── docs/                   # 设计文档
│   ├── archive/            # 旧文档归档
│   ├── architecture.md     # v2.0 架构
│   ├── protocol.md         # v2.0 协议
│   └── roadmap.md          # 开发计划
└── ...
```