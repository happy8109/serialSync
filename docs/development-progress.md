# SerialSync 开发进度记录

## 当前版本：v1.1（2024-07-11）

### 阶段目标
- 实现基础串口通信和文件传输功能，提升 CLI 交互体验，增强灵活性和可维护性。

### 本轮主要成果
- **CLI 交互全面 inquirer 化**：所有命令参数、确认、路径输入均为交互式体验，解决 readline 冲突、输入卡死等历史问题。
- **receivefile 命令修复**：支持“另存为”优先保存，自动保存与手动保存机制分流，适配未来 UI 场景。
- **autospeed 命令增强**：执行前自动输出当前 chunkSize、timeout、retryAttempts、compression、confirmTimeout 等关键参数，便于测试环境溯源。
- **进度与统计优化**：发送/接收/测速等命令均有实时进度、速率、丢块、重试等统计信息，体验一致。
- **bug 修复与体验提升**：解决主提示符丢失、输入冲突、重复输出等问题，CLI 体验大幅提升。

---

## 典型终端输出示例

### 发送端
```
✅ serial-sync> sendfile-confirm test_files/s10.zip
发送进度: 100% (5298/5324) 速率: 962.05KB/s 丢块: 5 总重试: 5
文件发送完成，总字节数: 11713983
```

### 接收端
```
✅ serial-sync>
📁 收到文件传输请求:
   文件名: s10.zip
   大小: 11.2 MB
? 是否同意接收此文件? Yes
接收进度: 100% (5298/5324) 速率: 934.64KB/s
[自动保存] 文件已保存到: received_files\s10.zip
```

### 另存为（receivefile）
```
✅ serial-sync> receivefile received_files2/r1.exe
等待接收文件...
📁 收到文件传输请求:
   文件名: s1.exe
   大小: 1.3 MB
接收进度: 100% (670/673) 速率: 796.67KB/s
[另存为] 文件已保存到: received_files2/r1.exe
```

### autospeed
```
--- 当前测试环境参数 ---
chunkSize: 256
timeout: 200 ms
retryAttempts: 3
compression: 关闭
confirmTimeout: 30000 ms
saveDir: received_files
----------------------
[128] 进度: 100% (10707/10760) 速率: 119.01KB/s 丢块: 26 总重试: 26
...
```

---

## 技术要点与优化
- 事件驱动架构，协议层与 CLI 解耦，便于后续 UI 对接。
- receivefile 机制为“文件另存为...”等高级场景预留接口。
- autospeed 参数提示便于测试环境溯源和对比。
- 代码、文档、配置保持同步，便于团队协作和查阅。

---

## 下一步计划
- [ ] 多文件队列传输
- [ ] 高级压缩算法
- [ ] 传输历史记录与校验
- [ ] Web UI/可视化进度

