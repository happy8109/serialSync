# SerialSync 开发指南

本文档包含项目路线图、开发环境设置、测试方法及 CLI 工具使用说明。

---

## 1. 项目状态与路线图 (Roadmap)

**当前版本**: v2.3 (API Forwarding Development)

### 已完成功能 (Phase 1-3)
- [x] **核心传输层**: PacketCodec (COBS/CRC), SerialBridge, PacketScheduler (QoS)。
- [x] **服务层**: MessageService (Chat), FileTransferService (Sliding Window), SystemService。
- [x] **CLI 工具**: 基于 `inquirer` 的交互式命令行工具。
- [x] **性能优化**: 大文件传输吞吐量提升 5-10 倍。
- [x] **断点续传**: 基于文件 Hash 的断点恢复 (v2.2)。
- [x] **API Server**: 基于 Express/WS 的 REST + WebSocket 服务。
- [x] **Web UI**: 基于 React + Vite + TailwindCSS 的可视化控制台。

### 当前开发 (Phase 4 - API Forwarding)
- [ ] **API 转发 (HTTP 透明代理)**: 通过串口访问对端主机上的本地HTTP服务。
  - 支持服务发现、双向调用、配置驱动
  - 详细设计: [API Forwarding Design](./api_forwarding_design.md)

详细开发计划请参考: [Implementation Plan](./implementation_plan.md)

---

## 2. 快速开始

### 2.1 环境要求
- Node.js v14+ (推荐 Node.js 18.x LTS, v20+ 需要注意 Win7 兼容性)
- 虚拟串口工具 (开发测试用):
    - Windows: [com0com](http://com0com.sourceforge.net/)
    - Linux/Mac: `socat`

#### 2.1.1 Node.js 兼容性与 Windows 7 支持
本系统后端完美兼容 **Node.js v14+**（包括 Windows 7 下的 Node.js 18.x）。
前端构建工具链 (Vite/React) 对 Node 版本有要求，若在 **Windows 7** 或 **Node.js 18** 环境下部署，请注意：
1. **Node.js 版本**: 建议安装 `v18.16.1` (Windows 7 可用的最后一个稳定版本)。
2. **前端依赖降级**:
   - `vite`: `^4.5.x`
   - `@vitejs/plugin-react`: `^4.2.x`
   - `react`: `^18.3.x`
   - **移除** `react-router-dom` v7+ (仅在开发环境中需要降级，生产环境build完的静态文件无此要求)
3. **部署提示**: 如果遇到 `EBADENGINE` 错误，请参考上述版本组合修改 `src/web/package.json`。

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

**2025-12-10 (v2.3.2) - Multi-file Selection & Status Fixes**
*   **File Transfer**: 支持多文件选择与批量拖拽上传功能。
*   **Status Indicator**: 修复断开连接后指示灯状态不更新的问题。
*   **Stability**: 进一步加强 Vite 开发服务器的 WebSocket 错误屏蔽机制。

**2025-12-09 (v2.3.1) - UI & Stability Fixes**
*   **Web UI Fixes**: 修复传输列表滚动条不可见及布局溢出问题；优化列表排序为倒序。
*   **Stability**: 修复 React StrictMode 下 WebSocket 重复连接导致的双重日志问题。
*   **Dev Experience**: 屏蔽开发环境下 Vite 代理的 ECONNRESET/ECONNABORTED 噪音报错。
*   **Config**: 添加 `.vscode/settings.json` 以消除 Tailwind CSS 误报。

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

## 7. Web UI 架构 (Phase 4)

前端项目位于 `src/web` 目录下，采用 React + Vite + TailwindCSS 技术栈。

### 7.1 目录结构
```text
src/web/
├── public/              # 静态资源
├── src/
│   ├── components/      # 通用 UI 组件 (Button, Card, Input)
│   ├── lib/             # 工具库 (utils, constants)
│   ├── features/        # 核心业务模块
│   │   ├── chat/        # 聊天模块 (已实现)
│   │   ├── file-transfer/ # 文件传输模块 (已实现)
│   │   ├── api-forwarder/ # API 转发模块
│   │   └── dashboard/     # 仪表盘与任务流 (已实现 LiveTaskStream)
│   ├── layout/          # 布局组件
│   ├── services/        # API 客户端与 WebSocket 封装
│   ├── store/           # 状态管理 (Zustand)
│   └── App.jsx          # 路由配置
├── vite.config.js       # 构建配置 (含 legacy 插件)
└── tailwind.config.js   # 样式配置
```

### 7.2 前后端交互机制
前端通过 `WebSocketService` 保持与 API Server 的长连接，实现全双工通信：
1.  **状态同步**: 监听 `status` 事件更新连接状态。
2.  **实时日志**: 监听 `log` 和 `error` 事件，在 `LiveTaskStream` 组件中实时展示系统活动。
3.  **聊天消息**: 监听 `chat` 事件更新消息列表；发送消息时调用 `POST /api/send/chat`。
4.  **文件传输**: 监听 `progress` 和 `complete` 事件更新传输进度。

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

---

## 9. API 转发使用指南 (v2.3)

### 9.1 功能概述

API转发功能允许串口两端设备通过串口访问对端主机上的本地HTTP服务，实现HTTP透明代理。

**典型应用场景**:
- 工业现场设备 ↔ 监控中心: 远程数据采集
- 双向配置同步: 设备互相读取/更新配置
- 报表系统: 无数据库设备访问有数据库设备的报表API

### 9.2 配置本地服务

编辑 `config/default.json`:

```json
{
  "services": {
    "enabled": true,
    "autoRegister": true,
    "localServices": {
      "daily_brief": {
        "name": "每日简报",
        "description": "生成指定日期的每日简报",
        "endpoint": "http://localhost:3000/api/stats/daily/brief",
        "method": "GET",
        "timeout": 10000,
        "enabled": true
      },
      "system_info": {
        "name": "系统信息",
        "endpoint": "http://localhost:8080/api/system/info",
        "method": "GET",
        "enabled": true
      }
    }
  }
}
```

### 9.3 使用方式

#### 方式A: Web UI

1. 打开 Web UI: `http://localhost:3000`
2. 进入"API转发"页面
3. 点击"刷新"查询对端服务列表
4. 选择服务并输入参数
5. 点击"调用"获取结果

#### 方式B: REST API

```bash
# 1. 查询对端服务列表
curl -X POST http://localhost:3000/api/services/remote/query \
  -H 'Content-Type: application/json' \
  -d '{ "enabled": true }'

# 2. 调用对端服务
curl -X POST http://localhost:3000/api/services/remote/daily_brief/call \
  -H 'Content-Type: application/json' \
  -d '{ "date": "2025-12-10", "verbose": true }'

# 3. 查看本地服务列表
curl http://localhost:3000/api/services/local/public
```

### 9.4 详细文档

完整的设计方案、协议定义和实现细节请参考:
- [API转发设计文档](./api_forwarding_design.md)
- [技术参考手册 - API转发章节](./technical_reference.md#4-api-转发-http-透明代理---v23)
