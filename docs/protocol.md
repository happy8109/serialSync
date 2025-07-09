# 协议说明

> 本项目核心目标：高效可靠的串口文字与文件同步，详见 architecture.md。

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

---

## 4. 扩展协议设计与未来方向

### 4.1 扩展协议包类型与格式
- **FILE_REQ (0x10)**：文件传输请求，包含文件名（当前仅传递文件名字符串，后续可扩展为JSON）。
  - 格式：[0xAA][0x10][REQ_ID][LEN][FILENAME][CHECKSUM]
    - 0xAA: 包头 (1字节)
    - 0x10: 包类型 (1字节)
    - REQ_ID: 请求ID (1字节)
    - LEN: 文件名长度 (1字节)
    - FILENAME: 文件名字符串（如 "test.txt"）
    - CHECKSUM: 校验和 (1字节，对TYPE~FILENAME所有字节累加和 & 0xFF)

- **FILE_ACCEPT (0x11)**：接收端同意接收。
  - 格式：[0xAA][0x11][REQ_ID][0][CHECKSUM]
    - 0x11: 包类型 (1字节)
    - REQ_ID: 请求ID (1字节)
    - 0: 数据长度为0
    - CHECKSUM: 校验和

- **FILE_REJECT (0x12)**：接收端拒绝接收。
  - 格式：[0xAA][0x12][REQ_ID][LEN][REASON][CHECKSUM]
    - 0x12: 包类型 (1字节)
    - REQ_ID: 请求ID (1字节)
    - LEN: 原因字符串长度 (1字节)
    - REASON: 拒绝原因（可选）
    - CHECKSUM: 校验和

- **分块数据包 (DATA/ACK/RETRY)**
  - 格式：[0xAA][TYPE][REQ_ID][SEQ(2)][TOTAL(2)][LEN(2)][DATA][CHECKSUM]
    - TYPE: 0x01=DATA, 0x02=ACK, 0x03=RETRY
    - REQ_ID: 请求ID (1字节)，关联 FILE_REQ
    - 其余同分块协议

### 4.2 事件流与接口机制
- 发送端：`sendFile()` → 发送 FILE_REQ → 等待 FILE_ACCEPT/REJECT → 若 ACCEPT，开始分块发送
- 接收端：收到 FILE_REQ → 触发 `fileRequest(meta, accept, reject)` 事件（可交互/自动）→ 回复 ACCEPT/REJECT → 若 ACCEPT，准备接收分块
- 传输完成后，emit `file(meta, savePath)` 事件，参数包含最终保存路径、元数据等
- 进度事件：`fileProgress(info)`，包含百分比、速率、丢块、重试等

### 4.3 会话对象与多任务支持
- 每次收到 FILE_REQ，新建会话对象，记录文件名、保存路径、是否需确认等
- 分块数据到达时，查找会话对象，重组后 emit file 事件，带上 meta 信息
- 传输完成后清理会话对象，避免多任务/多文件时错乱

### 4.4 UI/CLI/自动化对接建议
- 业务层（CLI/自动化/未来UI）只需监听事件，所有元数据和保存路径都通过事件参数传递
- 彻底避免依赖全局变量，事件参数即为"真相"
- 支持两种模式：需确认型（适合UI/点对点/需人工确认）、无需确认型（如 sendfile -e，适合自动同步）
- 为UI/自动化预留接口，如自动弹窗、自动保存、历史记录等

### 4.5 设计目标
- 兼容现有分块协议，协议层与业务层解耦，便于后续扩展和团队协作
- 支持高效、健壮的点对点同步、自动化批量同步、UI交互等多场景

---

#### 【示例包】
- 发送端发起请求：
  `[0xAA][0x10][0x01][06][74 65 73 74 2e 74 78 74][CHECKSUM]`  // "test.txt"
- 接收端同意：
  `[0xAA][0x11][0x01][0][CHECKSUM]`
- 接收端拒绝：
  `[0xAA][0x12][0x01][LEN]["空间不足"][CHECKSUM]`
- 分块数据包：
  `[0xAA][0x01][0x01][SEQ][TOTAL][LEN][DATA][CHECKSUM]`

---

如需详细开发进度、接口说明，请查阅 docs/development-progress.md、docs/api.md。 