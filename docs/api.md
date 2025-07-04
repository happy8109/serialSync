# 接口说明（SerialManager）

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
| file | 收到完整文件 | Buffer（文件内容） |
| progress | 文件分块进度 | {type, seq, total, percent, speed, lostBlocks, totalRetries} |
| error | 错误事件 | Error |
| connected | 串口已连接 | 无 |
| disconnected | 串口已断开 | 无 |

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
await sm.sendLargeData(fileBuf);

// 监听事件
sm.on('data', (msg) => {
  console.log('收到消息:', msg.toString());
});
sm.on('file', (fileBuf) => {
  fs.writeFileSync('received.bin', fileBuf);
  console.log('收到文件，已保存');
});
sm.on('progress', ({type, seq, total, percent, speed, lostBlocks, totalRetries}) => {
  console.log(`进度: ${type} ${seq+1}/${total} ${percent}% 速率:${speed} 丢块:${lostBlocks} 重试:${totalRetries}`);
});
sm.on('error', (err) => {
  console.error('串口错误:', err);
});
``` 