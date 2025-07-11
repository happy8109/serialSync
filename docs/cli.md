# CLI用法

> 本项目核心目标：高效可靠的串口文字与文件同步，详见 architecture.md。

## 主要命令

- `list`：列出可用串口
- `connect [port]`：连接串口（可指定端口）
- `disconnect`：断开连接
- `send <data>`：发送短消息（短包协议）
- `sendfile <filepath>`：发送文件（分块/扩展协议，自动确认/元数据/进度）
- `sendfile-confirm <filepath>`：发送文件（需接收方确认，交互式同意/拒绝）
- `autospeed <filepath>`：自动测速多种chunkSize，输出对比
- `status`：显示状态
- `help`：显示帮助
- `quit`：退出程序

## 典型用法

```bash
# 连接串口
connect COM3

# 发送短消息
send hello world

# 发送文件（推荐，自动确认/自动保存）
sendfile test.bin

# 发送文件（需接收方确认）
sendfile-confirm test.bin

# 自动测速
autospeed test.bin
```

## 文件接收说明
- **自动确认模式**：`sendfile` 命令发送的文件会自动保存到配置目录（由 config/sync.saveDir 决定），无需用户确认。
- **需确认模式**：`sendfile-confirm` 命令发送的文件会弹出交互提示，用户可选择同意/拒绝，并可指定保存路径。
- receivefile 命令仅用于兼容/调试场景，推荐使用自动接收。

## 进度与统计
- 发送/接收文件时，终端实时显示进度、速率、丢块、重试等统计信息。
- autospeed命令可帮助你自动评估最优chunkSize。

---

如需详细协议、接口、开发进度等，请查阅 docs/protocol.md、docs/development-progress.md。 