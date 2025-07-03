# SerialSync - 串口通信程序

一个基于 Node.js 开发的专业串口通信同步程序，提供现代化的 Web 界面和强大的串口通信功能。

## 🌟 功能特性

- **串口通信**: 支持多种串口参数配置
- **自动重连**: 智能的断线重连机制
- **数据校验**: 内置数据完整性校验
- **压缩传输**: 支持数据压缩提高传输效率
- **实时监控**: Web 界面实时显示连接状态
- **日志记录**: 完整的操作日志和安全审计
- **错误处理**: 优雅的错误处理和恢复机制
- **响应式设计**: 支持桌面和移动设备

## 📋 系统要求

- Node.js v16.0.0 或更高版本
- Windows/Linux/macOS 操作系统
- 串口设备（USB转串口适配器或内置串口）

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置串口

编辑 `src/config/default.json` 文件，修改串口配置：

```json
{
  "serial": {
    "port": "COM3",        // Windows: COM3, Linux: /dev/ttyUSB0, macOS: /dev/tty.usbserial
    "baudRate": 115200,    // 波特率
    "dataBits": 8,         // 数据位
    "stopBits": 1,         // 停止位
    "parity": "none"       // 校验位
  }
}
```

### 3. 启动程序

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

### 4. 访问 Web 界面

打开浏览器访问: http://localhost:3000

## 📁 项目结构

```
serial-sync/
├── src/
│   ├── core/              # 核心功能模块
│   │   └── serial/        # 串口通信
│   │       └── SerialManager.js
│   ├── ui/                # 用户界面
│   │   ├── server.js      # Web服务器
│   │   └── public/        # 静态文件
│   │       ├── index.html
│   │       ├── styles.css
│   │       └── app.js
│   ├── utils/             # 工具函数
│   │   └── logger.js      # 日志系统
│   ├── config/            # 配置文件
│   │   └── default.json
│   └── index.js           # 主入口文件
├── logs/                  # 日志文件目录
├── package.json
└── README.md
```

## ⚙️ 配置说明

### 串口配置

| 参数 | 说明 | 默认值 | 可选值 |
|------|------|--------|--------|
| port | 串口端口 | COM3 | COM1-COM99 (Windows) |
| baudRate | 波特率 | 115200 | 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 |
| dataBits | 数据位 | 8 | 7, 8 |
| stopBits | 停止位 | 1 | 1, 2 |
| parity | 校验位 | none | none, even, odd |
| timeout | 超时时间(ms) | 5000 | 1000-30000 |
| autoReconnect | 自动重连 | true | true, false |
| reconnectInterval | 重连间隔(ms) | 3000 | 1000-10000 |
| maxReconnectAttempts | 最大重连次数 | 5 | 1-20 |

### 日志配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| level | 日志级别 | info |
| file | 日志文件路径 | ./logs/sync.log |
| maxSize | 最大文件大小 | 10m |
| maxFiles | 最大文件数量 | 5 |

### 服务器配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| port | Web服务器端口 | 3000 |
| host | 服务器地址 | localhost |

### 同步配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| chunkSize | 数据块大小 | 1024 |
| timeout | 超时时间(ms) | 30000 |
| retryAttempts | 重试次数 | 3 |
| compression | 启用压缩 | true |

## 🔧 使用说明

### Web 界面操作

1. **连接串口**
   - 选择正确的串口端口
   - 配置串口参数（波特率、数据位等）
   - 点击"连接"按钮

2. **发送数据**
   - 在发送区域输入要发送的数据
   - 点击"发送"按钮
   - 数据将分块发送并等待确认

3. **接收数据**
   - 接收到的数据会显示在接收区域
   - 可以保存接收到的数据到文件
   - 支持清空接收缓冲区

4. **查看日志**
   - 实时查看系统操作日志
   - 支持导出日志文件
   - 可以清空日志记录

### 命令行操作

```bash
# 显示帮助信息
node src/index.js --help

# 显示版本信息
node src/index.js --version

# 指定配置文件
node src/index.js --config ./config/custom.json
```

## 📊 性能指标

- **传输速度**: > 10KB/s
- **响应时间**: < 5秒
- **内存使用**: < 100MB
- **CPU使用率**: < 30%
- **启动时间**: < 10秒

## 🔒 安全特性

- **数据校验**: 内置校验和验证
- **安全日志**: 记录所有操作和安全事件
- **错误处理**: 优雅处理所有异常情况
- **访问控制**: 可配置的访问权限

## 🐛 故障排除

### 常见问题

1. **串口连接失败**
   - 检查串口是否被其他程序占用
   - 确认串口参数配置正确
   - 检查设备驱动是否正常

2. **数据传输错误**
   - 检查波特率设置是否匹配
   - 确认数据位、停止位、校验位配置
   - 检查串口线缆连接

3. **Web界面无法访问**
   - 确认服务器端口未被占用
   - 检查防火墙设置
   - 确认Node.js版本符合要求

### 日志分析

程序运行日志保存在 `logs/` 目录下：

- `sync.log`: 主程序日志
- `error.log`: 错误日志
- `audit.log`: 安全审计日志

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request 来改进这个项目。

### 开发环境设置

```bash
# 克隆项目
git clone https://github.com/your-repo/serial-sync.git
cd serial-sync

# 安装依赖
npm install

# 启动开发模式
npm run dev

# 代码检查
npm run lint

# 代码格式化
npm run format
```

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 开发路线与任务规划

### 近期开发目标（核心优先）

1. 串口通信协议化与健壮性
   - 明确协议格式（头部、长度、数据体、校验和、ACK等）
   - 实现协议打包、解包、校验、ACK确认、重传机制
   - 自动重连与连接状态监控
   - 错误处理与详细日志记录
   - 支持大文件分块与流式处理
   - 数据压缩与完整性校验

2. 文件同步与管理功能
   - 文件分块读取与发送
   - 接收端分块重组与校验
   - 断点续传与重传机制
   - 同步任务管理（多文件/批量同步、任务状态查询）

3. 配置、日志、性能与安全
   - 串口、日志、性能参数全部可配置
   - 日志系统完善，关键操作、异常、审计日志全覆盖
   - 性能优化（流式处理、异步机制、缓存等）
   - 文件完整性校验、安全日志

---

### 中远期开发目标

1. 跨平台与易用性提升
   - 支持更多操作系统和串口适配器
   - 提供更友好的安装和部署方式

2. Web UI 与可视化管理
   - 实现美观易用的Web界面，支持文件选择、同步、状态监控、日志查看等
   - 实时显示同步进度与设备状态

3. 高级同步与扩展能力
   - 支持增量同步、定时同步、目录同步等高级功能
   - 插件化/模块化扩展机制，便于集成更多协议或业务逻辑

4. 安全与合规
   - 更完善的安全机制（如加密传输、权限控制等）
   - 完善的安全审计与合规支持

---

> 本开发路线将根据实际需求和反馈动态调整，优先保证核心协议与同步能力的健壮与可扩展性。

---


## 协议与功能设计原则

### 1. 应用场景与基本需求

SerialSync 需同时满足以下两大核心场景：
- **文件传输**：支持大文件分块、断点续传、可靠同步，适用于双机文件共享/同步。
- **字符串传输**：支持中英文消息、低延迟、可靠传输，适用于双机消息/聊天等。

### 2. 协议分层与包格式

- **短包协议（消息/聊天）**：
  - 格式：`[0xAA][LEN][DATA][CHECKSUM]`
  - 用于短消息、命令、聊天等场景。
  - 支持校验和、ACK、重传，可选压缩。
- **分块包协议（文件/大数据）**：
  - 格式：`[0xAA][TYPE][SEQ][TOTAL][LEN][DATA][CHECKSUM]`
  - 用于大文件分块、断点续传、流式处理。
  - 支持分块、ACK、重传、可选压缩。
- 协议需自动区分包类型，兼容短包与分块包。

### 3. SerialManager接口设计原则

- `sendData(data: string|Buffer)`：发送单条消息（短包协议）。
- `sendLargeData(buffer|stream)`：发送大文件（分块协议，自动分块/ACK/重传）。
- `on('data', callback)`：接收消息事件。
- `on('file', callback)`：接收完整文件事件。
- 支持进度、错误、状态等事件。
- 配置参数（压缩、分块大小等）可灵活调整。

### 4. CLI命令设计原则

- `send <data>`：协议化发送字符串，适合消息/聊天。
- `sendfile <filepath>`：协议化分块发送文件，支持大文件、断点续传、进度显示。
- `receivefile <savepath>`：接收文件并保存，支持进度显示。
- `status`：显示当前传输状态、进度、错误等。
- 支持协议版本、配置参数显示，便于调试和兼容性测试。

### 5. 典型用例

- **消息/聊天**：A端`send hello`，B端收到`hello`。
- **文件同步**：A端`sendfile ./a.txt`，B端`receivefile ./b.txt`，文件内容一致。
- **兼容性测试**：A端`rawsend hello`，B端用串口助手收到`hello`。

> 本章节为后续协议实现、CLI开发和测试提供统一设计指导。

## 文件分块传输开发与测试任务

为完善SerialManager的文件同步能力，需重点推进sendfile/receivefile命令及分块协议的开发与测试。具体任务如下：

### 1. 基础能力开发
- sendfile命令：支持大文件分块、协议组包、ACK/重传、进度事件。
- receivefile命令：支持分块重组、完整性校验、保存文件、进度事件。
- SerialManager分块协议接口优化：如sendLargeData、handleChunk、事件分发等。

### 2. 端到端大文件传输测试
- 发送/接收大文件，校验内容一致性（如md5sum、diff等）。
- 观察进度条、ACK、重传等机制是否健壮。

### 3. 健壮性与极端场景测试
- 断点续传、异常断开、丢包、粘包等场景。
- 文件大小非分块整数倍、二进制/文本混合内容。

### 4. 体验与易用性优化
- 进度条、错误提示、文件名/大小显示等用户体验细节。

> 以上任务将作为近期开发与测试的重点，确保SerialSync具备高可靠、高性能的文件同步能力。

## 文件传输功能开发总结

### 1. 协议设计

#### 1.1 短包协议（send命令/消息/聊天）
- 格式：[0xAA][LEN][DATA][CHECKSUM]
  - 0xAA: 包头 (1字节)
  - LEN: 数据长度 (1字节)
  - DATA: 数据体 (LEN字节)
  - CHECKSUM: 校验和 (1字节，对DATA所有字节累加和 & 0xFF)
- 用于发送短文本、命令、聊天消息等。
- 发送端：`SerialManager.sendData(data)`
- 接收端：自动识别短包，emit 'data' 事件。

#### 1.2 分块协议（sendfile命令/大文件）
- 格式：[0xAA][TYPE][SEQ(2)][TOTAL(2)][LEN(2)][DATA][CHECKSUM]
  - 0xAA: 包头 (1字节)
  - TYPE: 包类型 (1字节，0x01=DATA, 0x02=ACK, 0x03=RETRY)
  - SEQ: 当前块序号 (2字节)
  - TOTAL: 总块数 (2字节)
  - LEN: 数据长度 (2字节)
  - DATA: 数据体 (LEN字节)
  - CHECKSUM: 校验和 (1字节，对TYPE~LEN+DATA所有字节累加和 & 0xFF)
- 用于大文件、二进制数据的可靠分块传输。
- 发送端：`SerialManager.sendLargeData(data)`
- 接收端：自动重组分块，emit 'file' 事件。

### 2. 实现逻辑

- `send` 命令：调用 `SerialManager.sendData(data)`，自动打包为短包协议，支持可选压缩。
- `sendfile` 命令：调用 `SerialManager.sendLargeData(data)`，自动分块、打包为分块协议，每块数据发送后等待ACK，超时重试，最大重试次数由 `retryAttempts` 配置。支持整体压缩，分块大小由 `chunkSize` 配置。接收端自动拼包、重组、解压，emit 'file' 事件，支持丢包重传。

### 3. 关键配置说明（config/default.json）
- `sync.chunkSize`：分块大小，建议256~1024，视串口/虚拟串口实际能力调整。
- `sync.timeout`：ACK超时时间（毫秒），建议500~2000。
- `sync.retryAttempts`：每块最大重试次数，建议3~5。
- `sync.compression`：是否启用压缩，true/false。

### 4. 调用方法示例

#### 4.1 发送短消息
```js
const SerialManager = require('./src/core/serial/SerialManager');
const sm = new SerialManager();
await sm.connect();
sm.sendData('hello world');
```

#### 4.2 发送文件
```js
const fs = require('fs');
const SerialManager = require('./src/core/serial/SerialManager');
const sm = new SerialManager();
await sm.connect();
const fileBuf = fs.readFileSync('test.bin');
await sm.sendLargeData(fileBuf);
```

#### 4.3 接收端监听
```js
sm.on('data', (msg) => {
  // 短消息
  console.log('收到消息:', msg.toString());
});
sm.on('file', (fileBuf) => {
  // 大文件
  fs.writeFileSync('received.bin', fileBuf);
  console.log('收到文件，已保存');
});
```

### 5. 经验与注意事项
- 分块大小(chunkSize)过大，虚拟串口/serialport库可能丢包，建议小于1024。
- 每次write后必须drain，确保串口缓冲区flush。
- 超时时间(timeout)和重试次数(retryAttempts)需根据实际环境调整。
- 发送端和接收端compression配置必须一致。
- 支持自动重连、错误处理、进度事件等。

---

如需扩展协议、提升性能、支持更大文件或更高可靠性，可继续在此基础上开发。