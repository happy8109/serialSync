# SerialSync 开发实施计划 (Implementation Plan)

本文档详细列出了 SerialSync 项目的后续开发计划和任务清单。

## 1. 项目概况与目标

SerialSync 旨在提供一个高效、可靠的串口文件传输与通信工具。
当前版本 (v2.3) 已完成核心传输层、服务层及 API Server 的开发。
接下来的重点是完善 Web UI，提升用户体验，并进行系统级集成测试。

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

- [ ] **配置管理**
    - [ ] 前端设置页面 (修改分片大小, 窗口大小, 超时设置)
    - [ ] 配置持久化 (保存到后端 config)

### Phase 3: 测试与发布

- [ ] **自动化测试**
    - [ ] 完善 API Server 的单元测试
    - [ ] 编写 E2E 测试脚本 (模拟串口环境)

- [ ] **打包与部署**
    - [ ] 前端构建 (Vite build)
    - [ ] 后端打包 (pkg 或 ncc)
    - [ ] (可选) Electron 封装，生成桌面安装包

## 3. 已知问题与待办 (Backlog)

- [ ] **Bug**: `src/web/src/src` 目录似乎是冗余的，需要清理。
- [ ] **Refactor**: 统一前后端的类型定义 (Shared Types)。
- [ ] **Feature**: 支持文件夹传输 (目前仅支持单文件)。
- [ ] **Feature**: 传输历史记录持久化 (SQLite/JSON DB)。

## 4. 开发规范

- **语言**: Node.js (Backend), React (Frontend)
- **风格**: ESLint + Prettier
- **提交**: Conventional Commits (feat, fix, docs, refactor)
