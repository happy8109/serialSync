# SerialSync 串口通信测试指南

## 🧪 测试环境搭建

### 虚拟机测试方案（推荐）

#### 1. 准备硬件
- 两个USB转串口适配器
- 串口交叉线（或直连线）

#### 2. 虚拟机设置
```bash
# 在VirtualBox中创建虚拟机
# 操作系统：Ubuntu 20.04 LTS
# 内存：2GB
# 硬盘：20GB
```

#### 3. 串口配置
**主机（Windows）：**
- 串口1：COM3
- 串口2：COM4

**虚拟机（Linux）：**
- 串口1：/dev/ttyUSB0
- 串口2：/dev/ttyUSB1

#### 4. 部署步骤
```bash
# 在虚拟机中
sudo apt update
sudo apt install nodejs npm
sudo apt install udev

# 克隆项目
git clone <your-repo>
cd serial-sync

# 安装依赖
npm install

# 配置串口权限
sudo usermod -a -G dialout $USER
sudo chmod 666 /dev/ttyUSB*
```

## 🔧 测试步骤

### 1. 基础连接测试
```bash
# 测试串口是否可用
# Windows
mode COM3: BAUD=115200 PARITY=N DATA=8 STOP=1

# Linux
stty -F /dev/ttyUSB0 115200 cs8 -cstopb -parenb
```

### 2. 系统启动测试
```bash
# 主机端
NODE_ENV=host npm start

# 客户端
NODE_ENV=guest npm start
```

### 3. Web界面测试
1. 打开浏览器访问对应端口
2. 检查串口列表是否正确显示
3. 测试连接/断开功能
4. 验证配置更新

### 4. 数据传输测试

#### 简单文本测试
```bash
# 在主机端发送
echo "Hello from Host" > COM3

# 在客户端接收
cat < COM4
```

#### 大文件测试
```bash
# 创建测试文件
dd if=/dev/urandom of=test.dat bs=1M count=10

# 通过串口传输
# 使用我们的程序进行传输
```

### 5. 性能测试
```bash
# 测试传输速度
time dd if=/dev/zero bs=1M count=100 | nc -w 10 localhost 3000

# 测试延迟
ping -c 100 localhost
```

## 📊 测试用例

### 用例1：基础通信
- **目标**：验证基本的串口通信功能
- **步骤**：
  1. 连接两个串口
  2. 发送简单文本
  3. 验证接收正确
- **预期结果**：数据完整传输

### 用例2：大文件传输
- **目标**：测试大文件分块传输
- **步骤**：
  1. 准备1MB测试文件
  2. 通过串口传输
  3. 验证文件完整性
- **预期结果**：文件传输成功，校验和正确

### 用例3：断线重连
- **目标**：测试自动重连机制
- **步骤**：
  1. 建立连接
  2. 物理断开串口
  3. 重新连接
  4. 验证自动重连
- **预期结果**：自动重连成功

### 用例4：错误处理
- **目标**：测试错误恢复能力
- **步骤**：
  1. 发送损坏数据
  2. 验证重传机制
  3. 测试超时处理
- **预期结果**：错误被正确处理

### 用例5：并发测试
- **目标**：测试多客户端支持
- **步骤**：
  1. 启动多个客户端
  2. 同时发送数据
  3. 验证数据隔离
- **预期结果**：数据正确路由

## 🐛 故障排除

### 常见问题

#### 1. 串口权限问题
```bash
# Linux
sudo chmod 666 /dev/ttyUSB*
sudo usermod -a -G dialout $USER

# Windows
# 检查设备管理器中的端口设置
```

#### 2. 端口被占用
```bash
# 查看端口占用
netstat -tulpn | grep :3000

# 杀死进程
kill -9 <PID>
```

#### 3. 串口连接失败
```bash
# 检查串口是否可用
ls -l /dev/ttyUSB*
dmesg | grep tty

# 测试串口
minicom -D /dev/ttyUSB0
```

#### 4. 数据传输错误
- 检查波特率设置
- 验证数据位、停止位、校验位
- 检查串口线缆连接

## 📈 性能基准

### 目标性能指标
- **传输速度**：> 10KB/s
- **响应时间**：< 5秒
- **内存使用**：< 100MB
- **CPU使用率**：< 30%
- **启动时间**：< 10秒

### 测试工具
```bash
# 性能监控
htop
iotop
nethogs

# 网络测试
iperf3
netcat
```

## 📝 测试报告模板

### 测试环境
- 操作系统：Windows 10 / Ubuntu 20.04
- Node.js版本：v18.x
- 串口设备：USB转串口适配器
- 测试时间：YYYY-MM-DD HH:MM

### 测试结果
| 测试用例 | 状态 | 备注 |
|---------|------|------|
| 基础通信 | ✅/❌ | |
| 大文件传输 | ✅/❌ | |
| 断线重连 | ✅/❌ | |
| 错误处理 | ✅/❌ | |
| 并发测试 | ✅/❌ | |

### 性能数据
- 平均传输速度：__ KB/s
- 平均响应时间：__ ms
- 内存使用峰值：__ MB
- CPU使用率：__ %

### 问题记录
1. 问题描述
2. 复现步骤
3. 解决方案
4. 验证结果

## 🎯 下一步

完成基础测试后，可以进一步测试：
1. 压力测试
2. 长时间稳定性测试
3. 多平台兼容性测试
4. 安全性测试 