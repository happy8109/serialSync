# CLI用法

## 主要命令

- `list`：列出可用串口
- `connect [port]`：连接串口（可指定端口）
- `disconnect`：断开连接
- `send <data>`：发送短消息
- `sendfile <filepath>`：发送文件（分块协议/大文件/进度）
- `receivefile <savepath>`：接收文件并保存（分块协议/进度）
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

# 发送文件
sendfile test.bin

# 接收文件
receivefile received.bin

# 自动测速
autospeed test.bin
```

## 进度与统计
- 发送/接收文件时，终端实时显示进度、速率、丢块、重试等统计信息。
- autospeed命令可帮助你自动评估最优chunkSize。

---

如需详细协议、接口等，请查阅 docs/ 目录下其他文档。 