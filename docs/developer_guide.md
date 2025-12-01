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

---

## 7. Web UI 设计规范 (Phase 4)

基于 React + Vite 的现代化前端界面，定位为**高效、稳定的工具软件**。

### 7.1 设计原则
1.  **离线优先 (Offline First)**: 生产环境无互联网连接，所有资源（字体、图标、JS库）必须本地化打包，严禁使用 CDN。
2.  **兼容性 (Legacy Support)**: 适配低版本浏览器（目标 Chrome 64+），使用 `@vitejs/plugin-legacy` 进行 Polyfill 注入。
3.  **高信息密度 (High Density)**: 界面紧凑，减少留白，一屏展示更多关键信息（传输列表、日志流）。
4.  **低延迟 (Low Latency)**: 操作响应迅速，进度条平滑，无多余装饰性动画。

### 7.2 技术栈
*   **Framework**: React 18 + Vite
*   **Styling**: Tailwind CSS (Utility-first, 易于维护)
*   **Components**: Shadcn/ui (基于 Radix UI，无样式依赖，易于定制)
*   **State Management**: Zustand (轻量级全局状态管理)
*   **Icons**: Lucide React (SVG Icons)

### 7.3 功能模块规划

#### A. 布局 (Layout)
*   **Sidebar**: 极简图标导航 (Chat, File, API, Settings) + 底部连接状态指示。
*   **Main View**: 占据 95% 区域，无干扰。

#### B. 核心功能区
1.  **Chat (Default View)**:
    *   纯文本消息流，用于快速验证链路。
    *   **多行支持**: 输入框支持 `Shift+Enter` 换行，`Enter` 发送；消息显示保留换行格式 (`pre-wrap`)。
2.  **File Transfer**:
    *   **Active Transfers**: 紧凑列表，显示 `文件名 | 进度条 | 速度 (MB/s) | 剩余时间 | [Pause/Cancel]`。
    *   **Dropzone**: 底部拖拽区域，支持直接拖入文件发送。
3.  **API Forwarder (Debugger)**:
    *   类似 Postman 的精简界面。
    *   **Request**: Service ID 输入框 + JSON 参数编辑器。
    *   **Response**: 格式化 JSON 视图 + RTT 统计。
    *   **History**: 最近调用记录。
4.  **Dashboard (Live Stream)**:
    *   实时展示所有信道占用情况（QoS 可视化）。
    *   显示当前正在进行的 P0 (Ping), P1 (Chat/API), P2 (File) 任务。

### 7.4 目录结构
采用 Feature-based 结构，便于扩展。
```text
src/web/
├── public/              # 静态资源
├── src/
│   ├── components/      # 通用 UI 组件 (Button, Card, Input)
│   ├── lib/             # 工具库 (utils, constants)
│   ├── features/        # 核心业务模块
│   │   ├── chat/        # 聊天模块
│   │   ├── file-transfer/ # 文件传输模块
│   │   ├── api-forwarder/ # API 转发模块
│   │   └── dashboard/     # 仪表盘与任务流
│   ├── layout/          # 布局组件
│   ├── services/        # API 客户端与 WebSocket 封装
│   └── App.jsx          # 路由配置
├── vite.config.js       # 构建配置 (含 legacy 插件)
└── tailwind.config.js   # 样式配置
```

### 7.5 任务优先级管理 (QoS)
前端需配合后端 `PacketScheduler` 进行可视化展示：
*   **P0 (System)**: 仅在状态栏显示延迟 (Ping RTT)，不干扰主界面。
*   **P1 (Chat/API)**: 高优先级，聊天消息和 API 请求立即插入任务流顶端。
*   **P2 (File)**: 中优先级，大文件传输显示在传输列表，不阻塞 P1 任务。
*   **P3 (Sync)**: 低优先级，后台同步任务仅在 Dashboard 底部显示简略状态。

---

## 8. Linux / Kylin V10 部署指南

本项目完全兼容 Linux 环境（包括银河麒麟 Kylin V10 SP1），但需注意以下系统级配置。

### 8.1 依赖安装
`serialport` 是原生模块，在 Linux 下安装需要编译工具链。
```bash
# Debian/Ubuntu/Kylin
sudo apt-get update
sudo apt-get install build-essential python3
```

### 8.2 串口权限
Linux 默认普通用户无权访问串口设备（如 `/dev/ttyUSB0` 或 `/dev/ttyS0`）。
**解决方法**: 将当前用户加入 `dialout` 组。
```bash
sudo usermod -a -G dialout $USER
#以此生效需注销并重新登录
```
或者临时授权：
```bash
sudo chmod 666 /dev/ttyUSB0
```

### 8.3 浏览器兼容性
Kylin V10 自带浏览器通常基于 Chromium 内核。
*   Web UI 构建配置已启用 `Legacy Mode`。
*   目标兼容: **Chrome 64+**。
*   Polyfills: 构建时会自动注入 `ResizeObserver`, `Promise` 等垫片，确保在老旧内核上界面不崩坏。

### 8.4 CPU 架构
请确认目标机器架构：
*   **x86_64 (兆芯/海光/Intel/AMD)**: 使用标准 Node.js 安装包。
*   **ARM64 (飞腾/鲲鹏)**: 需下载 Node.js ARM64 版本 (`node-vxx-linux-arm64.tar.xz`)。


