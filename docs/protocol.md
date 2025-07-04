# 协议说明

## 1. 短包协议（send命令/消息/聊天）
- 格式：[0xAA][LEN][DATA][CHECKSUM]
  - 0xAA: 包头 (1字节)
  - LEN: 数据长度 (1字节)
  - DATA: 数据体 (LEN字节)
  - CHECKSUM: 校验和 (1字节，对DATA所有字节累加和 & 0xFF)
- 用于短文本、命令、聊天消息。

## 2. 分块协议（sendfile命令/大文件）
- 格式：[0xAA][TYPE][SEQ(2)][TOTAL(2)][LEN(2)][DATA][CHECKSUM]
  - 0xAA: 包头 (1字节)
  - TYPE: 包类型 (1字节，0x01=DATA, 0x02=ACK, 0x03=RETRY)
  - SEQ: 当前块序号 (2字节)
  - TOTAL: 总块数 (2字节)
  - LEN: 数据长度 (2字节)
  - DATA: 数据体 (LEN字节)
  - CHECKSUM: 校验和 (1字节，对TYPE~LEN+DATA所有字节累加和 & 0xFF)
- 用于大文件、二进制数据的可靠分块传输。

## 3. 设计原则与注意事项
- 分块大小(chunkSize)建议256~1024，过大易丢包。
- 每块数据需ACK确认，超时重试，最大重试次数可配。
- 支持整体压缩，发送端和接收端compression配置需一致。
- 支持自动重连、错误处理、进度事件。

---

如需详细接口、CLI用法等，请查阅 docs/ 目录下其他文档。 