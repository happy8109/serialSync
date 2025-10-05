# 接口说明（SerialManager）

> 本项目核心目标：高效可靠的串口文字与文件同步，详见 architecture.md。

## 主要方法

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| async connect(portOverride?) | 连接串口 | portOverride: string（可选） | Promise<void> |
| disconnect() | 断开串口 | 无 | void |
| getConnectionStatus() | 获取连接状态 | 无 | {isConnected, port, reconnectAttempts, maxReconnectAttempts} |
| async sendData(data) | 发送短消息/字符串 | data: string/Buffer | Promise<void> |
| async sendLargeData(data) | 发送大文件/二进制 | data: Buffer | Promise<void> |

## 主要事件

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| data | 收到短消息 | Buffer（消息内容） |
| file | 收到完整文件 | Buffer（文件内容）, meta, savePath |
| progress | 文件分块进度 | {type: 'send'/'receive', reqId, seq, total, percent, speed, lostBlocks, totalRetries, meta} |
| error | 错误事件 | Error |
| connected | 串口已连接 | 无 |
| disconnected | 串口已断开 | 无 |

## progress 事件参数结构

```js
{
  type: 'send' | 'receive', // 发送/接收
  reqId: number,            // 会话ID
  seq: number,              // 当前块序号
  total: number,            // 总块数
  percent: number,          // 进度百分比
  speed: number,            // 速率（B/s）
  lostBlocks: number,       // 丢块数
  totalRetries: number,     // 总重试次数
  meta: object              // 文件元数据
}
```

## 典型用法

```js
const SerialManager = require('./src/core/serial/SerialManager');
const sm = new SerialManager();

// 连接串口
await sm.connect();

// 发送短消息
await sm.sendData('hello world');

// 发送文件
const fs = require('fs');
const fileBuf = fs.readFileSync('test.bin');
await sm.sendFile(fileBuf, { name: 'test.bin' });

// 监听事件
sm.on('data', (msg) => {
  console.log('收到消息:', msg.toString());
});
sm.on('file', (fileBuf, meta, savePath) => {
  fs.writeFileSync(savePath, fileBuf);
  console.log('收到文件，已保存到:', savePath);
});
sm.on('progress', ({type, seq, total, percent, speed, lostBlocks, totalRetries}) => {
  if (type === 'send') {
    process.stdout.write(`\r发送进度: ${percent}% (${seq+1}/${total}) 速率:${speed}B/s 丢块:${lostBlocks} 总重试:${totalRetries}`);
  } else if (type === 'receive') {
    process.stdout.write(`\r接收进度: ${percent}% (${seq+1}/${total}) 速率:${speed}B/s`);
  }
});
sm.on('error', (err) => {
  console.error('串口错误:', err);
});
```

## 拉式数据传输API

### 对端调用说明

**调用格式**：
```
http://localhost:{B端端口}/api/pull/{服务ID}
```

**实际示例**：
- 服务ID：`daily_brief`（来自配置文件 `services.localServices.daily_brief`）
- B端端口：`3002`（通过 `--port 3002` 启动参数指定）
- 完整调用地址：`http://localhost:3002/api/pull/daily_brief`

**配置映射关系**：
```json
{
  "services": {
    "localServices": {
      "daily_brief": {  // ← 服务ID
        "endpoint": "http://localhost:3000/api/stats/daily/brief"  // ← 实际API端点
      }
    }
  }
}
```

**数据流程**：
1. B端调用：`http://localhost:3002/api/pull/daily_brief`
2. 提取服务ID：`daily_brief`
3. 查找配置：`services.localServices.daily_brief`
4. 调用A端API：`http://localhost:3000/api/stats/daily/brief`
5. 通过串口返回数据给B端

---

如需详细协议、开发进度等，请查阅 docs/protocol.md、docs/development-progress.md。 