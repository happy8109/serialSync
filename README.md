# SerialSync - 串口通信与文件同步工具

一个基于 Node.js 的现代化串口通信与文件同步程序，支持高效可靠的分块协议、自动重连、压缩、日志、Web UI 等。

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

## 📝 常用命令

- `send <data>`：发送短消息
- `sendfile <filepath>`：发送文件（分块协议）
- `receivefile <savepath>`：接收文件
- `autospeed <filepath>`：自动测速最优chunkSize
- `status`：显示状态
- `help`：显示帮助

## 📚 文档索引

- [架构与开发计划](docs/architecture.md)
- [接口说明](docs/api.md)
- [协议说明](docs/protocol.md)
- [CLI用法](docs/cli.md)

---

如需详细开发计划、接口、协议、命令用法等，请查阅 docs/ 目录下对应文档。