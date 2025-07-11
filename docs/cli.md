# CLI用法（v1.1）

> 本项目核心目标：高效可靠的串口文字与文件同步，详见 architecture.md。

## 版本说明
- 当前版本：**v1.1**（全面 inquirer 交互重构，另存为/参数提示等功能增强）

## 交互体验说明
- 所有命令行交互均基于 inquirer 实现，支持参数补全、确认选择、路径输入等，提升用户体验。
- 文件接收支持自动保存与“另存为”两种模式，详见 receivefile 命令。

## 主要命令
- `list`：列出可用串口
- `connect [port]`：连接串口（可指定端口）
- `disconnect`：断开连接
- `send <data>`：发送短消息（短包协议）
- `sendfile <filepath>`：发送文件（分块/扩展协议，自动确认/元数据/进度）
- `sendfile-confirm <filepath>`：发送文件（需接收方确认，交互式同意/拒绝）
- `receivefile <savepath>`：手动指定保存路径，实现“另存为...”功能，优先于自动保存
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

# 手动指定保存路径（另存为）
receivefile received_files2/r1.exe

# 自动测速
autospeed test.bin
```

## 文件接收说明
- **自动确认模式**：`sendfile` 命令发送的文件会自动保存到配置目录（由 config/sync.saveDir 决定），无需用户确认。
- **需确认模式**：`sendfile-confirm` 命令发送的文件会弹出交互提示，用户可选择同意/拒绝，并可指定保存路径。
- **receivefile 命令**：用于手动指定文件保存路径，实现“文件另存为...”功能。执行 receivefile <savepath> 后，收到的下一个文件将优先保存到指定路径。

## autospeed 命令
- 执行前会自动输出当前 chunkSize、timeout、retryAttempts、compression、confirmTimeout 等关键参数，便于测试环境溯源。

## 进度与统计
- 发送/接收文件时，终端实时显示进度、速率、丢块、重试等统计信息。
- autospeed命令可帮助你自动评估最优chunkSize。

---

如需详细协议、接口、开发进度等，请查阅 docs/protocol.md、docs/development-progress.md。 

---

## 多文件队列传输建议
- 串口速率有限，SerialManager 只需保证单文件传输的健壮性。
- 多文件队列传输推荐由 CLI/UI/脚本层实现队列调度，无需在 SerialManager 内部增加复杂度。
- 典型实现方式：循环调用 sendFile，监听 progress/file 事件。

### 伪代码示例
```js
async function sendFilesInQueue(fileList) {
  for (const file of fileList) {
    await serialManager.sendFile(file);
    // 可监听 progress/file 事件，更新UI进度
  }
}
``` 