# WinForms 串口互通客户端开发文档（独立版）

本文档定义了一套可直接实现的串口通信与文件传输协议与实现规范，供 Windows 桌面端 WinForms 程序开发参考。按照本文实现，即可与对端应用实现字符与单文件的稳定互通。本文档可独立于任意现有源码使用。

## 1. 目标与范围

- 功能范围
  - 短消息：单包文本/二进制发送与接收
  - 文件传输：分块可靠传输，ACK/重试/进度统计
- 互通保证
  - 按本文规定的帧格式（字节序/校验和/时序）实现，即可互通
- 运行环境
  - Windows 10+；.NET Framework 4.7.2+ 或 .NET 6/7（Windows）
  - 串口库：System.IO.Ports.SerialPort

## 2. 协议总览

- 同步字节：0xAA（包头）
- 多字节整型字节序：大端（Big Endian, BE）
- 校验和：对参与校验字段逐字节累加并取 & 0xFF
- 压缩（可选）：
  - 若启用 compression=true：发送端对整份“文件数据”进行 Deflate 压缩；接收端在“全部分块重组完毕后”整体解压
  - 双方必须配置一致（compression=true/false）

## 3. 帧格式规范

### 3.1 短包（文本/命令）

- 格式：`[0xAA][LEN][DATA][CHECKSUM]`
  - LEN：1 字节，DATA 长度（0~200，推荐限制上限以防误判）
  - CHECKSUM：对 DATA 的逐字节累加 & 0xFF
- 用途：聊天、指令、少量二进制数据

### 3.2 文件会话控制（请求/同意/拒绝）

- FILE_REQ (0x10)：`[0xAA][0x10][REQ_ID][LEN][META_JSON][CHECKSUM]`
  - REQ_ID：1 字节，会话标识（建议 1~200）
  - META_JSON（UTF-8）：`{"name":"file.ext","size":12345,"requireConfirm":true/false}`
  - CHECKSUM：对 TYPE~META_JSON 的逐字节累加 & 0xFF
- FILE_ACCEPT (0x11)：`[0xAA][0x11][REQ_ID][0][CHECKSUM]`
- FILE_REJECT (0x12)：`[0xAA][0x12][REQ_ID][LEN][REASON][CHECKSUM]`
  - REASON：UTF-8 可选文本
  - CHECKSUM：对 TYPE~REASON 的逐字节累加 & 0xFF

### 3.3 分块数据（带会话）

- DATA/ACK/RETRY：
  - 格式：`[0xAA][TYPE][REQ_ID][SEQ(2)][TOTAL(2)][LEN(2)][DATA][CHECKSUM]`
  - TYPE：0x01=DATA，0x02=ACK，0x03=RETRY
  - REQ_ID：1 字节，会话标识
  - SEQ/TOTAL/LEN：UInt16 BE
  - DATA：LEN 字节（ACK/RETRY 的 LEN 必须为 0）
  - CHECKSUM：对 TYPE、REQ_ID、SEQ、TOTAL、LEN 及 DATA 逐字节累加 & 0xFF

校验和伪代码：

```text
checksum = 0
for b in bytes_to_check:
  checksum = (checksum + b) & 0xFF
```

## 4. 时序与状态机

### 4.1 文件发送端

1) 生成 `REQ_ID`，构造 META_JSON（name, size, requireConfirm）
2) 发送 `FILE_REQ`
3) 等待对端 `FILE_ACCEPT`（或收到 `FILE_REJECT`）
   - 超时（confirmTimeout）则失败
4) 若接受：
   - 将文件（或压缩后的文件数据）按 `chunkSize` 切片
   - 循环发送 `DATA(reqId, seq, total, len, data)`
     - 每块等待匹配的 `ACK(reqId, seq)`；超时则重发，超过 `retryAttempts` 失败
   - 全部 ACK 收齐即完成

### 4.2 文件接收端

1) 收到 `FILE_REQ`：解析 META_JSON
   - 若 `requireConfirm=false` 且 `autoAccept=true`：立即发送 `FILE_ACCEPT` 并创建会话
   - 否则弹窗询问，同意则 `FILE_ACCEPT`，拒绝则 `FILE_REJECT`（可带 REASON）
2) 接收 `DATA`：
   - 校验通过则缓存至会话（按 seq 保存），立即回 `ACK(reqId, seq)`
   - 可重复接收相同 seq（重传），应仍回 ACK 并保持幂等
3) 当所有分块齐全：
   - 按 seq 递增拼接
   - 若 `compression=true`，整体解压
   - 保存文件到 `savePath`，通知 UI 完成

### 4.3 短消息

- 收到后即投递至 UI，不需要 ACK

## 5. 超时与重试建议

- 等待 ACK 超时：`timeout`（建议 300~800ms，可配置）
- 重试次数：`retryAttempts`（建议 5~10，可配置）
- 确认超时：`confirmTimeout`（建议 5~30s，可配置，需确认时使用）
- 超过最大重试：终止会话并上报错误

## 6. 串口与缓冲实现要点（WinForms/C#）

- 串口参数建议：
  - `PortName`：用户选择的 COMx
  - `BaudRate`：与对端一致（常见 115200/230400/921600）
  - `DataBits=8, StopBits=One, Parity=None`
  - 硬件流控：建议开启（如可用）
- 接收缓冲与拆帧：
  - 维护可增长缓冲（List<byte>/MemoryStream）
  - 每次收到数据后循环：
    - 寻找包头 0xAA；丢弃之前的噪声
    - 解析优先级：
      1) FILE_REQ/ACCEPT/REJECT：最小 4 字节；整帧长度 = `4 + LEN + 1`
      2) 分块帧：最小 9 字节；读取 `LEN(2)`，整帧 = `9 + LEN + 1`
      3) 短包：最小 2 字节；读取 `LEN`，整帧 = `3 + LEN`（LEN>200 视为异常，丢弃包头重试）
    - 若缓冲不足整帧，等待后续数据
    - 取整帧并校验和，通过后分发
- 大端读取：`ushort be = (ushort)((hi<<8)|lo)`
- 线程：串口读写在后台线程执行，通过 `BeginInvoke` 或 `SynchronizationContext` 更新 UI

## 7. 组件与接口划分（建议）

- SerialTransport：串口 Open/Close/Write 与 `OnBytesReceived(byte[])`
- ProtocolHandler：协议编解码、状态机、会话管理（reqId→session）
  - 事件：
    - `OnTextReceived(byte[])`
    - `OnFileRequest(meta{name,size}, accept(savePath), reject(reason), requireConfirm)`
    - `OnFileProgress({type:'send'|'receive', reqId, seq, total, percent, speed, lostBlocks, totalRetries, meta})`
    - `OnFileReceived(buffer, meta, savePath)`
    - `OnError(Exception)`
- FileTransferService：高层 API `SendText(string/byte[])`, `SendFile(path, requireConfirm)`
- UI：端口选择/连接、文本发送、文件选择、进度条、日志、接收确认弹窗
- Logging：建议使用 NLog/Serilog

## 8. 配置项（本地化持久）

- 串口：`port, baudRate, dataBits, stopBits, parity, rtscts`
- 传输：`chunkSize(256~1024)，timeout(ms)，retryAttempts，compression(bool)，confirmTimeout(ms)`
- 行为：`autoAccept(bool，仅在 requireConfirm=false 时生效)，saveDir`

## 9. 进度与统计

- 发送端：
  - `percent = round((seq+1)/total*100)`
  - `speed(B/s) = sentBytes / elapsedSeconds`
  - `lostBlocks`：发生过重试的块计数
  - `totalRetries`：累计重试次数
- 接收端：
  - `percent = round(receivedChunks/total*100)`
  - `speed(B/s) = receivedBytes / elapsedSeconds`

## 10. UI 交互建议

- 主窗体分区：
  - 串口状态（连接/端口/波特率/块大小）
  - 文本（输入框、发送、消息列表）
  - 文件（路径、是否确认、发送、进度条：百分比/速率/丢块/重试）
  - 事件日志（最近事件/错误）
- 接收确认弹窗：显示 name/size、选择保存目录、确认/拒绝；超时策略可配置

## 11. 错误与边界处理

- 非法帧：丢弃至下一 `0xAA`
- 帧长度异常/越界：丢弃本帧并记录
- 校验失败：丢弃且不回 ACK
- 会话不存在的 DATA：忽略（可能未接受）
- 重复 DATA：保持幂等，仍回 ACK
- 取消/中断：清理会话、关闭句柄、删除不完整文件

## 12. 测试清单（互操作）

- 短消息：中英文/二进制、连续收发
- 文件：小/中/大文件；`requireConfirm` 开/关
- 压缩：compression 开/关（双方一致）
- 超时重试：模拟延迟/丢包仍能完成
- 错误注入：校验失败帧、重复 DATA、未知 reqId
- 目录权限：不可写目录错误可控
- 性能：>50 KB/s，CPU<30%，内存<100MB

## 13. C# 关键实现片段

### 13.1 计算校验和（通用）

```csharp
byte CalcChecksum(ReadOnlySpan<byte> span) {
    int sum = 0;
    for (int i = 0; i < span.Length; i++) sum = (sum + span[i]) & 0xFF;
    return (byte)sum;
}
```

### 13.2 打包分块（DATA/ACK/RETRY）

```csharp
byte[] PackChunk(byte type, byte reqId, ushort seq, ushort total, ReadOnlySpan<byte> data) {
    ushort len = (ushort)data.Length;
    var header = new byte[9];
    header[0] = 0xAA;
    header[1] = type;
    header[2] = reqId;
    header[3] = (byte)(seq >> 8);
    header[4] = (byte)(seq & 0xFF);
    header[5] = (byte)(total >> 8);
    header[6] = (byte)(total & 0xFF);
    header[7] = (byte)(len >> 8);
    header[8] = (byte)(len & 0xFF);

    var payload = data.ToArray();
    var toCheck = new byte[1 + 1 + 2 + 2 + 2 + payload.Length]; // TYPE..LEN + DATA
    Buffer.BlockCopy(header, 1, toCheck, 0, 8);                  // exclude 0xAA
    Buffer.BlockCopy(payload, 0, toCheck, 8, payload.Length);

    byte checksum = CalcChecksum(toCheck);
    var packet = new byte[header.Length + payload.Length + 1];
    Buffer.BlockCopy(header, 0, packet, 0, header.Length);
    Buffer.BlockCopy(payload, 0, packet, header.Length, payload.Length);
    packet[packet.Length - 1] = checksum;
    return packet;
}
```

### 13.3 FILE_REQ 打包（JSON 元数据）

```csharp
byte[] PackFileReq(byte reqId, string metaJsonUtf8) {
    var meta = System.Text.Encoding.UTF8.GetBytes(metaJsonUtf8);
    var header = new byte[] { 0xAA, 0x10, reqId, (byte)meta.Length };
    var checkSpan = new byte[1 + 1 + 1 + meta.Length]; // TYPE, REQ_ID, LEN, META
    header.AsSpan(1, 3).CopyTo(checkSpan.AsSpan(0, 3));
    meta.AsSpan().CopyTo(checkSpan.AsSpan(3));
    byte checksum = CalcChecksum(checkSpan);

    var packet = new byte[header.Length + meta.Length + 1];
    Buffer.BlockCopy(header, 0, packet, 0, header.Length);
    Buffer.BlockCopy(meta, 0, packet, header.Length, meta.Length);
    packet[^1] = checksum;
    return packet;
}
```

### 13.4 接收缓冲拆帧（核心循环思路）

```csharp
void ProcessBuffer(List<byte> buf) {
    while (true) {
        int start = buf.IndexOf(0xAA);
        if (start < 0) { buf.Clear(); return; }
        if (start > 0) buf.RemoveRange(0, start);
        if (buf.Count < 2) return;

        byte typeOrLen = buf[1];

        if (buf.Count >= 4 && (typeOrLen == 0x10 || typeOrLen == 0x11 || typeOrLen == 0x12)) {
            byte type = buf[1];
            byte reqId = buf[2];
            int len = buf[3];
            int need = 4 + len + 1;
            if (buf.Count < need) return;
            var frame = buf.GetRange(0, need).ToArray();
            buf.RemoveRange(0, need);
            if (ValidateFileCtrlFrame(frame)) DispatchFileCtrl(frame);
            continue;
        }

        if (buf.Count >= 9 && (typeOrLen == 0x01 || typeOrLen == 0x02 || typeOrLen == 0x03)) {
            int len = (buf[7] << 8) | buf[8];
            int need = 9 + len + 1;
            if (buf.Count < need) return;
            var frame = buf.GetRange(0, need).ToArray();
            buf.RemoveRange(0, need);
            if (ValidateChunkFrame(frame)) DispatchChunk(frame);
            continue;
        }

        if (buf.Count >= 2) {
            int len = buf[1];
            if (len > 200) { buf.RemoveAt(0); continue; }
            int need = 3 + len;
            if (buf.Count < need) return;
            var frame = buf.GetRange(0, need).ToArray();
            buf.RemoveRange(0, need);
            if (ValidateShortFrame(frame)) DispatchShort(frame);
            continue;
        }

        return;
    }
}
```

### 13.5 Deflate 压缩/解压（整文件）

```csharp
byte[] DeflateCompress(byte[] input) {
    using var ms = new MemoryStream();
    using (var ds = new System.IO.Compression.DeflateStream(ms, System.IO.Compression.CompressionLevel.Fastest, true))
        ds.Write(input, 0, input.Length);
    return ms.ToArray();
}

byte[] DeflateDecompress(byte[] input) {
    using var inMs = new MemoryStream(input);
    using var ds = new System.IO.Compression.DeflateStream(inMs, System.IO.Compression.CompressionMode.Decompress);
    using var outMs = new MemoryStream();
    ds.CopyTo(outMs);
    return outMs.ToArray();
}
```

## 14. 推荐默认配置

- 串口：`baudRate=115200, dataBits=8, stopBits=1, parity=None, rtscts=启用(如支持)`
- 传输：`chunkSize=512, timeout=500ms, retryAttempts=8, compression=false, confirmTimeout=15000ms`
- 行为：`autoAccept=true, saveDir=用户下载目录或自定义目录`

## 15. 关键兼容点提醒

- 所有多字节字段均为大端（BE）
- 短包 LEN 建议 ≤200，避免误判
- ACK 帧 `LEN` 必须为 0（分块协议）
- 压缩仅作用于“完整文件数据”，不是对每个分块单独压缩
- 任意帧校验失败必须丢弃且不回 ACK
- 接收端对重复 DATA 必须仍然回 ACK，保证重传幂等

## 16. 参考常量

```text
SYNC=0xAA
TYPE: DATA=0x01, ACK=0x02, RETRY=0x03, FILE_REQ=0x10, FILE_ACCEPT=0x11, FILE_REJECT=0x12
```

---

按此文档实现后，一个独立的 WinForms 项目即可完成字符与单文件的稳定互通，无需依赖任何现有源码。


