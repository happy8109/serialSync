# SerialSync - 串口通信与文件同步工具

> 项目愿景：
> - 串口双机文件共享/同步
> - 点对点文件/字符传输（聊天）
> - 跨平台、无网络环境下的易用性

一个基于 Node.js 的现代化串口通信与文件同步程序，支持高效可靠的分块协议、自动重连、压缩、日志、Web UI 等。

## 🤖 开发工具

本项目使用 **Cursor** 作为主要开发工具。

## 🆕 v1.2.0 主要特性

### UI界面优化
- **状态显示简化**：首页串口状态显示简化为4个核心参数（连接状态、串口、波特率、数据块大小），界面更清爽
- **文件同步面板**：新增文件同步面板，与聊天面板并排显示，为后续文件同步功能预留空间
- **布局改进**：聊天面板和文件同步面板采用flex布局，响应式设计，小屏幕自动垂直堆叠
- **按钮文本优化**：发送按钮改为"发送信息"，文件传输按钮改为"文件传输"，更直观明确

### 功能完善
- **配置参数动态加载**：修复sync参数（如chunkSize）修改后需要重启服务的问题，实现动态配置加载
- **串口参数配置**：支持串口基本参数和文件传输参数的tab页面配置，参数修改后立即生效
- **文件传输功能**：支持文件上传、进度显示、传输统计（速率、丢块、重试次数）
- **实时通信**：支持字符传输和文件传输，WebSocket实时推送进度和状态

### 技术改进
- **配置管理优化**：SerialManager.connect()方法重新读取配置文件，确保参数实时生效
- **错误处理增强**：完善错误提示和异常处理，提升用户体验
- **代码结构优化**：清理重复代码，优化CSS样式，提升代码可维护性

## 🚀 快速开始

```bash
npm install
npm run cli COM3
npm run cli /dev/ttyAMA1
node src/index.js --port 3001
```

- 配置文件：`config/default.json`
- 日志目录：`logs/`
- Web界面：http://localhost:3001

## 🌟 主要功能
- 串口通信与自动重连
- 聊天窗口字符消息收发（Web UI/CLI）
- 单文件分块传输、断点续传、重试、进度条
- 数据压缩、完整性校验
- CLI命令与Web UI
- 日志与安全审计
- 配置参数动态加载
- 文件同步面板（预留）

## 📝 常用命令

- `send <data>`：发送短消息
- `sendfile <filepath>`：发送文件（分块协议，自动保存）
- `sendfile-confirm <filepath>`：发送文件（需接收方确认）
- `receivefile <savepath>`：手动指定保存路径，实现"另存为..."
- `autospeed <filepath>`：自动测速最优chunkSize，执行前输出当前关键参数
- `status`：显示状态
- `help`：显示帮助

## 📁 目录结构

```
serial-sync/
├── src/
│   ├── core/serial/SerialManager.js
│   ├── ui/
│   │   ├── public/
│   │   │   ├── index.html
│   │   │   ├── css/styles.css
│   │   │   └── js/app.js
│   │   ├── api/
│   │   └── services/
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
- [UI改进记录](docs/ui-improvements.md)

## 🎯 下一步计划

- [ ] 文件同步功能实现（文件监控、自动同步、冲突解决）
- [ ] 多文件队列传输
- [ ] 高级压缩算法
- [ ] 传输历史记录与校验
- [ ] 用户权限和安全机制
- [ ] 移动端适配

---

如需详细开发计划、接口、协议、命令用法等，请查阅 docs/ 目录下对应文档。