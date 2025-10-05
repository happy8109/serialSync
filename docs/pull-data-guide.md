# 拉式数据传输功能使用指南（配置文件版本）

## 功能概述

拉式数据传输功能允许双端系统通过串口桥进行数据拉取，支持配置文件管理服务，实现以下场景：
- A端提供数据服务（如C#应用程序、每日简报API等）
- B端通过串口桥拉取A端的数据
- B端对外提供HTTP API供其他程序调用
- 所有服务配置统一管理在 `config/default.json` 中

## 架构说明

```
外部程序 ──HTTP API──> B端串口桥 ──串口──> A端串口桥 ──HTTP──> A端C#应用/API
     ↑                                                      ↓
     └────────── 响应数据 ──────────────────────────────────┘
```

## 配置文件管理

### 服务配置结构

在 `config/default.json` 中添加 `services` 配置：

```json
{
  "services": {
    "enabled": true,
    "autoRegister": true,
    "defaultTimeout": 30000,
    "localServices": {
      "service_id": {
        "name": "服务名称",
        "description": "服务描述",
        "version": "1.0",
        "type": "http",
        "endpoint": "http://localhost:8080/api/data",
        "method": "GET",
        "timeout": 5000,
        "enabled": true,
        "defaultParams": {
          "param1": "value1"
        }
      }
    }
  }
}
```

### 配置参数说明

- `enabled`: 是否启用服务功能
- `autoRegister`: 是否自动从配置文件注册服务
- `defaultTimeout`: 默认超时时间（毫秒）
- `localServices`: 本地服务配置
  - `name`: 服务显示名称
  - `description`: 服务描述
  - `version`: 服务版本
  - `type`: 服务类型（目前支持 `http`）
  - `endpoint`: HTTP端点URL
  - `method`: HTTP方法（GET/POST/PUT等）
  - `timeout`: 服务超时时间
  - `enabled`: 是否启用该服务
  - `defaultParams`: 默认参数

## 快速开始

### 1. 配置服务

在 `config/default.json` 中添加服务配置：

```json
{
  "services": {
    "enabled": true,
    "autoRegister": true,
    "defaultTimeout": 30000,
    "localServices": {
      "daily_brief": {
        "name": "每日简报",
        "description": "生成指定日期的每日简报，包含结构化数据和中文简报文本",
        "version": "1.0",
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
}
```

### 2. A端设置（服务提供方）

```javascript
const SerialManager = require('./src/core/serial/SerialManager');

const serialManager = new SerialManager();

// 服务会自动从配置文件加载，无需手动注册
// 只需要连接串口即可
await serialManager.connect();

console.log('已加载的服务:', serialManager.getLocalServices().map(s => s.name));
```

### 3. B端设置（服务消费方）

```javascript
const SerialManager = require('./src/core/serial/SerialManager');

const serialManager = new SerialManager();

// 连接串口
await serialManager.connect();

// 拉取对端数据（使用配置中的服务）
const result = await serialManager.pullData('daily_brief', { 
  date: '2025-01-01',
  regions: '魏都区,东城区'
});
console.log('拉取结果:', result);
```

### 4. HTTP API使用

B端提供HTTP API供外部程序调用：

```bash
# 获取服务列表
GET http://localhost:3000/api/services

# 拉取今日简报（默认参数）
GET http://localhost:3000/api/pull/daily_brief

# 拉取指定日期简报
GET http://localhost:3000/api/pull/daily_brief?date=2025-01-01

# 拉取指定辖区简报
GET http://localhost:3000/api/pull/daily_brief?regions=魏都区,东城区

# 拉取指定排序方式简报
GET http://localhost:3000/api/pull/daily_brief?order=name_asc

# 组合参数
GET http://localhost:3000/api/pull/daily_brief?date=2025-01-01&regions=魏都区,东城区&order=count_asc

# POST方式拉取（支持复杂参数）
POST http://localhost:3000/api/pull/daily_brief
Content-Type: application/json
{
  "date": "2025-01-01",
  "regions": "魏都区,东城区",
  "order": "count_desc"
}
```

## 服务类型支持

### HTTP服务

配置示例：
```json
{
  "api_service": {
    "name": "API服务",
    "type": "http",
    "endpoint": "http://localhost:8080/api/data",
    "method": "GET",
    "timeout": 5000,
    "defaultParams": {
      "format": "json"
    }
  }
}
```

### 自定义服务

对于非HTTP服务，可以注册自定义处理函数：

```javascript
serialManager.onPullRequest(async (serviceId, params) => {
  switch (serviceId) {
    case 'custom_service':
      // 自定义处理逻辑
      return await handleCustomService(params);
    default:
      throw new Error(`Unknown service: ${serviceId}`);
  }
});
```

## 高级功能

### 参数合并

配置中的 `defaultParams` 会与请求参数合并：

```json
{
  "service_with_defaults": {
    "defaultParams": {
      "format": "json",
      "version": "1.0"
    }
  }
}
```

请求时：
```javascript
await serialManager.pullData('service_with_defaults', { 
  date: '2025-01-01' 
});
// 实际参数: { format: "json", version: "1.0", date: "2025-01-01" }
```

### 服务启用/禁用

可以通过配置控制服务的启用状态：

```json
{
  "disabled_service": {
    "enabled": false
  }
}
```

### 动态服务注册

除了配置文件，还可以动态注册服务：

```javascript
serialManager.registerLocalService('dynamic_service', {
  name: '动态服务',
  description: '动态注册的服务',
  type: 'http',
  endpoint: 'http://localhost:8080/api/dynamic',
  method: 'POST',
  timeout: 10000
});
```

## 错误处理

- 服务未注册：`Service ${serviceId} not found in local services`
- 服务已禁用：`Service ${serviceId} is disabled`
- 串口未连接：`串口未连接`
- 请求超时：`Request timeout`
- HTTP错误：`HTTP ${statusCode}: ${statusMessage}`

## 配置管理最佳实践

1. **服务分组**：按功能模块分组配置服务
2. **环境区分**：不同环境使用不同的配置文件
3. **参数验证**：在服务端验证参数有效性
4. **超时设置**：根据服务复杂度设置合适的超时时间
5. **错误处理**：配置服务时考虑错误处理策略

## 示例配置

完整的服务配置示例（基于你的实际API）：

```json
{
  "services": {
    "enabled": true,
    "autoRegister": true,
    "defaultTimeout": 30000,
    "localServices": {
      "daily_brief": {
        "name": "每日简报",
        "description": "生成指定日期的每日简报，包含结构化数据和中文简报文本",
        "version": "1.0",
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
}
```

### API参数说明

每日简报API支持的参数：
- `date`（可选）：日期，格式 `YYYY-MM-DD`，默认今天
- `regions`（可选）：辖区过滤，逗号分隔，如 `魏都区,东城区`
- `order`（可选）：排序方式
  - `count_desc`：按人数降序（默认）
  - `count_asc`：按人数升序
  - `name_asc`：按名称升序

### 响应格式

API返回包含结构化数据和中文简报文本的完整信息：

```json
{
  "success": true,
  "data": {
    "date": "2025-10-04",
    "totalInControl": 142,
    "byRegion": [
      { "region": "魏都区", "count": 21 },
      { "region": "东城区", "count": 24 }
    ],
    "flows": {
      "inToday": [
        { "region": "魏都区", "count": 2 }
      ],
      "outToday": [
        { "region": "东城区", "count": 1 }
      ]
    },
    "tags": {
      "byRegion": [
        { "region": "魏都区", "taggedCount": 2, "dangerousCount": 1 }
      ],
      "totalTagged": 18,
      "totalDangerous": 5
    },
    "summaryText": "2025年10月4日全市在控142人，魏都区21人、东城区24人..."
  }
}
```

## 注意事项

1. 确保配置文件格式正确（JSON格式）
2. 服务端点必须可访问
3. 超时时间设置合理
4. 定期检查服务状态
5. 备份配置文件

## 示例代码

完整的使用示例请参考 `examples/pull-data-example.js` 文件。
