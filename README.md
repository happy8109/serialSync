# SerialSync - 串口通信与文件同步工具

一个基于 Node.js 的现代化串口通信与文件同步程序，支持高效可靠的分块协议、自动重连、压缩、日志、Web UI 等。

## 🆕 v1.1 主要特性
- **CLI 全面 inquirer 交互重构**：所有命令参数、确认、路径输入均为交互式体验，支持补全与友好提示。
- **receivefile 命令支持“另存为”**：可手动指定文件保存路径，优先于自动保存，适配未来 UI 场景。
- **autospeed 命令增强**：执行前自动输出当前 chunkSize、timeout、retryAttempts、compression、confirmTimeout 等关键参数，便于测试环境溯源。
- **进度与统计优化**：发送/接收/测速等命令均有实时进度、速率、丢块、重试等统计信息，体验一致。

## 🚀 快速开始

```bash
npm install
npm run dev
# 或 npm start
```

- 配置文件：`config/default.json`
- 日志目录：`logs/`
- Web界面：http://localhost:3000

## 🌟 主要功能
- 串口通信与自动重连
- 文件分块传输、断点续传、重试
- 数据压缩、完整性校验
- CLI命令与Web UI
- 日志与安全审计

## 📝 常用命令

- `send <data>`：发送短消息
- `sendfile <filepath>`：发送文件（分块协议，自动保存）
- `sendfile-confirm <filepath>`：发送文件（需接收方确认）
- `receivefile <savepath>`：手动指定保存路径，实现“另存为...”
- `autospeed <filepath>`：自动测速最优chunkSize，执行前输出当前关键参数
- `status`：显示状态
- `help`：显示帮助

## 📁 目录结构

```
serial-sync/
├── src/
│   ├── core/serial/SerialManager.js
│   ├── ui/
│   ├── utils/
│   ├── config/
│   └── ...
├── logs/
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── protocol.md
│   └── cli.md
├── README.md
└── ...
```

## 📚 文档索引

- [架构与开发计划](docs/architecture.md)
- [接口说明](docs/api.md)
- [协议说明](docs/protocol.md)
- [CLI用法](docs/cli.md)
- [开发进度与接口评估](docs/development-progress.md)

---

如需详细开发计划、接口、协议、命令用法等，请查阅 docs/ 目录下对应文档。