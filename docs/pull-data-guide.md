# 拉式数据传输功能指南

## 概述

拉式数据传输功能允许双端通过串口桥进行数据拉取，实现真正的对等通信。一端可以暴露服务，另一端可以通过API请求拉取数据。

## 架构设计

### 核心概念

1. **服务提供方（A端）**：暴露本地服务，响应拉取请求
2. **服务消费方（B端）**：通过API请求拉取对端数据
3. **串口桥**：作为数据传输的桥梁，不关心具体业务逻辑
4. **服务注册表**：管理本地可用的服务定义

### 通信流程

```
B端API请求 → B端串口桥 → 串口传输 → A端串口桥 → A端本地服务 → 返回数据
```

## 配置说明

### 服务配置结构

在 `config/default.json` 中添加服务配置：

```json
{
  "services": {
    "enabled": true,
    "autoRegister": true,
    "defaultTimeout": 10000
  },
  "localServices": {
    "service_id": {
      "name": "服务名称",
      "description": "服务描述",
      "version": "1.0.0",
      "type": "http",
      "endpoint": "http://localhost:3000/api/endpoint",
      "method": "GET",
      "timeout": 10000,
      "enabled": true,
      "defaultParams": {
        "param1": "value1"
      }
    }
  }
}
```

### 配置参数说明

- **services.enabled**: 是否启用服务功能
- **services.autoRegister**: 是否自动注册配置的服务
- **services.defaultTimeout**: 默认超时时间（毫秒）
- **localServices**: 本地服务定义
  - **name**: 服务显示名称
  - **description**: 服务描述
  - **version**: 服务版本
  - **type**: 服务类型（目前支持"http"）
  - **endpoint**: 服务端点URL
  - **method**: HTTP方法（GET/POST）
  - **timeout**: 服务超时时间
  - **enabled**: 是否启用该服务
  - **defaultParams**: 默认参数

## 使用方法

### 1. A端设置（服务提供方）

#### 启动A端
```bash
node src/index.js --port 3001 --serial COM4
```

#### 确保本地API服务运行
确保你的C#应用程序或其他API服务在 `http://localhost:3000` 运行。

#### 配置服务定义
在 `config/default.json` 中配置要暴露的服务：

```json
{
  "localServices": {
    "daily_brief": {
      "name": "每日简报",
      "description": "获取每日统计简报",
      "version": "1.0.0",
      "type": "http",
      "endpoint": "http://localhost:3000/api/stats/daily/brief",
      "method": "GET",
      "timeout": 10000,
      "enabled": true,
      "defaultParams": {
        "order": "count_desc"
      }
    }
  }
}
```

### 2. B端设置（服务消费方）

#### 启动B端
```bash
node src/index.js --port 3002 --serial COM5
```

#### 通过API拉取数据
```bash
# 基本拉取
curl http://localhost:3002/api/pull/daily_brief

# 带参数拉取
curl -X POST http://localhost:3002/api/pull/daily_brief \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-01-01", "order": "count_asc"}'
```

### 3. API接口说明

#### 拉取数据接口
- **GET** `/api/pull/:serviceId` - 拉取指定服务的数据
- **POST** `/api/pull/:serviceId` - 带参数拉取数据

#### 服务管理接口
- **GET** `/api/services` - 获取本地注册的服务列表
- **POST** `/api/services/:serviceId` - 注册新的本地服务
- **GET** `/api/serial-status` - 获取串口连接状态

## 实际应用示例

### 场景：C#应用程序数据拉取

#### 1. C#应用程序设置
确保你的C#应用程序暴露HTTP API：
```csharp
// 示例：ASP.NET Web API
[Route("api/stats/daily/brief")]
[HttpGet]
public IActionResult GetDailyBrief(string date = null, string order = "count_desc")
{
    // 返回每日简报数据
    return Ok(new {
        success = true,
        data = new {
            date = date ?? DateTime.Today.ToString("yyyy-MM-dd"),
            totalInControl = 142,
            byRegion = new[] { /* 区域数据 */ },
            summaryText = "今日简报内容"
        }
    });
}
```

#### 2. 串口桥配置
在 `config/default.json` 中配置服务：
```json
{
  "localServices": {
    "daily_brief": {
      "name": "每日简报",
      "description": "获取每日统计简报",
      "type": "http",
      "endpoint": "http://localhost:3000/api/stats/daily/brief",
      "method": "GET",
      "enabled": true,
      "defaultParams": {
        "order": "count_desc"
      }
    }
  }
}
```

#### 3. 双端启动
```bash
# A端（C#应用 + 串口桥）
node src/index.js --port 3001 --serial COM4

# B端（串口桥）
node src/index.js --port 3002 --serial COM5
```

#### 4. 数据拉取
```bash
# 在B端拉取A端数据
curl http://localhost:3002/api/pull/daily_brief
```

## 错误处理

### 常见错误及解决方案

1. **串口未连接**
   ```
   {"success":false,"error":"串口未连接，请先连接串口"}
   ```
   解决：通过Web界面连接串口

2. **服务不存在**
   ```
   {"success":false,"error":"Service daily_brief not found"}
   ```
   解决：检查服务配置和注册

3. **HTTP服务调用失败**
   ```
   {"success":false,"error":"HTTP service call failed: ECONNREFUSED"}
   ```
   解决：确保本地API服务正在运行

4. **超时错误**
   ```
   {"success":false,"error":"Request timeout"}
   ```
   解决：增加超时时间或检查网络连接

## 开发调试

### 使用虚拟串口测试

1. **安装虚拟串口软件**（如Virtual Serial Port Driver）
2. **创建虚拟串口对**（如COM4 ↔ COM5）
3. **启动双端测试**：
   ```bash
   # 终端1 - A端
   node src/index.js --port 3001 --serial COM4
   
   # 终端2 - B端
   node src/index.js --port 3002 --serial COM5
   ```

### 串口占用检查

使用内置的串口管理工具：
```bash
# 检查串口占用情况
node check-ports.js COM4 COM5

# 清理占用进程
# 工具会提供交互式清理选项
```

## 技术实现

### 消息协议

#### PULL_REQUEST 消息
```json
{
  "type": "PULL_REQUEST",
  "requestId": "unique-request-id",
  "serviceId": "daily_brief",
  "params": {
    "date": "2025-01-01",
    "order": "count_asc"
  }
}
```

#### PULL_RESPONSE 消息
```json
{
  "type": "PULL_RESPONSE",
  "requestId": "unique-request-id",
  "success": true,
  "data": "response-data-string"
}
```

### SerialManager 新增方法

- `pullData(serviceId, params)` - 拉取指定服务的数据
- `onPullRequest(handler)` - 注册拉取请求处理函数
- `registerLocalService(serviceId, metadata)` - 注册本地服务
- `callHttpService(endpoint, params, options)` - 调用HTTP服务

## 最佳实践

1. **服务设计**：保持服务接口简单，避免复杂的数据结构
2. **超时设置**：根据数据量合理设置超时时间
3. **错误处理**：实现完善的错误处理和重试机制
4. **参数验证**：在服务端验证输入参数
5. **日志记录**：记录关键操作和错误信息
6. **测试验证**：使用虚拟串口进行充分测试

## 扩展功能

### 未来计划

1. **服务发现**：自动发现对端可用服务
2. **负载均衡**：支持多个服务实例
3. **数据缓存**：实现数据缓存机制
4. **安全认证**：添加服务访问控制
5. **监控统计**：服务调用统计和监控