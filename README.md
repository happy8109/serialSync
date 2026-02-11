# SerialSync - 串口通信与文件同步工具 (v2.9)

![Version](https://img.shields.io/badge/version-2.9.4-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-green.svg)
![Platform](https://img.shields.io/badge/platform-windows%20%7C%20linux%20%7C%20kylin-orange.svg)

SerialSync 是一个基于 Node.js 的现代化串口通信与文件同步工具，专为工业现场、隔离网络及串口调试场景设计。

## ✨ 核心特性

- **高可靠传输**：采用 **COBS** 衬垫编码与 **CRC-16** 校验，彻底消除粘包与数据溢出。支持 **ARQ 可靠传输层** 自动重传，帧丢失率接近零。
- **现代化 Web UI**：
  - **50/50 布局**：聊天区域与工具/同步面板等宽显示，视野更均衡。
  - **实时任务流**：四列日志展示（System, File, API, Sync），支持独立滚动与像素级对齐。
- **API 转发 (Gateway)**：支持透明代理，通过串口远程调用对端的 HTTP 服务。
- **文件同步 (Sync)**：支持局域网/串口双模式同步，具备智能冲突检测。
- **断点续传**：基于单重传块的选择性重传机制，支持大文件高效稳定传输。

## 🚀 快速开始

### 环境要求
- **Node.js**: 推荐使用 **v18.16.1** (LTS)。
  > [!NOTE]
  > v18.16.1 是 Windows 7 可用的最后一个稳定版本，具有最佳的兼容性。

### 安装与运行
本项目采用自动化依赖管理，一次安装即可同步配置前端与后端。

```powershell
# 1. 安装所有依赖 (含自动执行前端安装)
npm install

# 2. 启动应用 (标准模式：全功能运行)
npm run app

# 3. 环境清理 (如需更换 Node 版本或解决锁定)
npm run clean
```

### 访问地址
- **本地**: `http://localhost:5174`
- **局域网**: `http://<Your-IP>:5174` (支持移动端/其他电脑访问)

## 📁 目录结构

```text
serial-sync/
├── config/             # 系统配置文件
├── docs/               # 详细手册与设计文档
├── scripts/            # 工具脚本 (含 clean.ps1)
├── src/
│   ├── core/           # 传输协议核心 (PacketCodec, ReliableLink, Scheduler)
│   ├── server/         # API Server 逻辑 (Express & WebSocket)
│   ├── web/            # React 前端代码 (Vite & TailwindCSS)
│   └── launcher.js     # 多进程启动器
└── package.json        # 项目配置与自动化钩子
```

## 🛠️ 开发与维护

详见 [开发指南 (Developer Guide)](docs/developer_guide.md)。

---
*© 2024-2026 SerialSync Team. 串口连接，同步未来。*