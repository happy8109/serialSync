# SerialSync 开发实施计划 (Implementation Plan)

本文档详细列出了 SerialSync 项目的后续开发计划和任务清单。

## 1. 项目概况与目标

SerialSync 旨在提供一个高效、可靠的串口文件传输与通信工具。
当前版本 (v2.5) 已完成核心传输层、服务层、API Server 以及 IM 风格的统一聊天界面。
接下来的重点是 Phase 3 的 API 转发功能完善及后续的自动化测试。

## 2. 任务清单 (Task List)

### Phase 1: Web UI 核心功能开发 (当前阶段)

- [ ] **UI 框架搭建**
    - [x] 初始化 Vite + React 项目结构
    - [x] 配置 TailwindCSS (已修复 `.vscode` 配置消除警告)
    - [ ] 完善路由配置 (React Router)
    - [ ] 封装通用组件 (Button, Input, Card, Modal, Toast)

- [x] **仪表盘 (Dashboard)**
    - [x] 串口连接/断开控制组件
    - [x] 系统状态显示 (连接状态, 波特率, RTT 延迟)
    - [x] 实时日志显示窗口 (LiveTaskStream) (已修复 WebSocket 重复连接问题)

- [x] **聊天功能 (Chat)**
    - [x] 消息列表展示 (区分发送方/接收方)
    - [x] 消息发送输入框
    - [x] 支持发送快捷指令

- [x] **文件传输 (File Transfer)**
    - [x] 文件选择与拖拽上传区域 (已支持多选)
    - [x] 传输列表 (发送/接收队列) (已修复滚动条与布局溢出问题，列表改为倒序)
    - [x] 进度条显示 (百分比, 速度, 剩余时间)
    - [x] 传输控制 (暂停, 恢复, 取消)

### Phase 2: 系统集成与优化

- [ ] **前后端联调**
    - [x] 验证 Web UI 与 API Server 的 WebSocket 通信
    - [x] 确保大文件传输时 UI 不卡顿
    - [x] 错误处理与用户提示 (已屏蔽开发环境代理噪音)

- [x] **配置管理**
    - [x] 前端设置页面 (修改分片大小, 窗口大小, 超时设置, 串口参数, 系统配置)
    - [x] 配置持久化 (保存到后端 config, 并支持热重载)

### Phase 3: API 转发 (HTTP 透明代理) - v2.3 新增

详细设计文档: [api_forwarding_design.md](./api_forwarding_design.md)

- [x] **核心模块开发**
    - [x] `src/core/services/HttpProxyService.js`
        - [x] 服务注册表管理 (registerService, loadServicesFromConfig)
        - [x] HTTP调用封装 (callLocalHttp)
        - [x] 请求/响应关联机制 (pendingRequests Map)
        - [x] 服务发现协议 (handleServiceQuery, queryRemoteServices)
    - [x] 更新 `src/core/interface/AppController.js`
        - [x] 集成 HttpProxyService
        - [x] 暴露API: pullService, queryRemoteServices, registerService
    - [x] 更新 `src/server/ApiServer.js`
        - [x] 新增路由: `/api/services/*` (local/remote/query/call)

- [x] **协议支持**
    - [x] 定义包类型常量 (0x30-0x33)
    - [x] 实现包体编解码 (JSON格式)
    - [x] 集成到 PacketScheduler (P1优先级)

- [x] **配置文件**
    - [x] 更新 `config/default.json` 添加 `services` 配置块
    - [x] 编写配置文件说明文档
    - [x] 提供配置模板示例

- [x] **Web UI 开发**
    - [x] `src/web/src/features/api-forwarder/ServiceManager.jsx`
        - [x] 本地服务列表展示
        - [x] 对端服务查询与列表展示
        - [x] 刷新对端服务功能
    - [x] 改造 `src/web/src/features/api-forwarder/ApiDebugger.jsx`
        - [x] 从Mock实现改为真实API调用
        - [x] 支持从ServiceManager传入serviceId
        - [x] 显示真实的RTT和HTTP响应

- [x] **测试**
    - [x] 单元测试: HttpProxyService
    - [x] 集成测试: 双端通信测试 (COM1 ↔ COM2)
    - [x] 性能测试: 延迟与带宽测试

### Phase 4: 统一聊天与文件传输融合 (Unified IM-Style)

- [x] **数据持久化实现**
    - [x] 修改 `appStore.js` 引入 `zustand/persist` 中间件
    - [x] 配置 `messages` 和 `transfers` 的持久化存储
    - [x] 实现旧数据的清理与兼容逻辑 (v2.5)

- [x] **UI 布局与交互重构**
    - [x] 改造 `ChatView.jsx` 布局为 IM 样式 (左收右发)
    - [x] 增加附件按钮与拖拽发送文件支持 (`Dropzone` 逻辑集成)
    - [x] 取消独立的 "File Transfer" 标签页

- [x] **消息气泡组件化**
    - [x] 封装 `ChatMessage` 通用气泡容器
    - [x] 开发 `FileBubble` 组件 (展示实时传输进度、速度及控制按钮)
    - [x] 处理系统消息显示 (串口状态变化等)

- [x] **逻辑关联与同步**
    - [x] 实现发送/接收文件时自动在 `messages` 中插入 `file` 类型消息
    - [x] 确保 `FileBubble` 能够正确订阅后台传输进度
    - [x] 处理传输任务失败、取消后的 UI 反馈 (保留记录并标记为“已取消”)
    - [x] **New**: 实时传输速度显示与物理文件存在性检查
    - [x] **New**: “打开文件”与“打开位置（高亮）”系统集成
    - [x] **New**: 输入框字数限制 (10000) 与后端 Payload 限制提升 (1MB)

### Phase 5: 测试与发布

- [ ] **自动化测试**
    - [ ] 完善 API Server 的单元测试
    - [ ] 编写 E2E 测试脚本 (模拟串口环境)

- [ ] **打包与部署**
    - [ ] 前端构建 (Vite build)
    - [ ] 后端打包 (pkg 或 ncc)
    - [ ] (可选) Electron 封装，生成桌面安装包

## 3. 已知问题与待办 (Backlog)

- [x] **Bug**: `src/web/src/src` 目录似乎是冗余的，需要清理。(已清理旧代码)
- [ ] **Refactor**: 统一前后端的类型定义 (Shared Types)。
- [ ] **Feature**: 支持文件夹传输 (目前仅支持单文件)。
- [x] **Feature**: 传输历史记录持久化 (已纳入 Phase 4)。

## 附录：统一聊天与文件传输详细设计方案 (v2.4)

### 概述 (Overview)
将独立的文件传输面板融合进聊天窗口，打造符合用户直觉的 IM (即时通讯) 风格体验。

### 核心设计原则
*   **融合 (Unified)**: 文件即消息。
*   **直观 (Intuitive)**: 经典 "左收右发" 气泡布局。
*   **协调 (Coordinated)**: 保持极简、深色设计语言。
*   **持久 (Persistent)**: 刷新页面不丢失上下文。

### 详细设计规格
1. **持久化**: 前端 LocalStorage + Zustand Persist。
2. **气泡类型**:
    * **文本气泡**: 纯文本，自动换行。
    * **文件卡片**: 显示图标、文件名、进度条、速度、[暂停/取消/打开] 按钮。
    * **系统消息**: 居中显示的重要状态变更。
3. **消息模型**: 扩展 `type`, `from`, `content`, `fileId` 等字段。

## 4. 开发规范

- **语言**: Node.js (Backend), React (Frontend)
- **风格**: ESLint + Prettier
- **提交**: Conventional Commits (feat, fix, docs, refactor)
