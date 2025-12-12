# SerialSync API 转发 (HTTP 透明代理) 设计方案

**版本**: v2.3  
**创建日期**: 2025-12-11  
**状态**: 设计完成，待实现

---

## 一、功能概述

### 1.1 核心目标

实现**串口桥透明代理**功能，允许串口两端设备通过串口访问对端主机上的本地HTTP服务，就像访问本地API一样。

### 1.2 典型应用场景

```
场景示例：设备A运行数据分析服务，设备B需要获取分析结果

┌─────────────────────────────────┐     Serial      ┌──────────────────────────────┐
│  设备B (COM2)                    │   ◄────────►    │  设备A (COM1)                │
│  ┌──────────────────────────┐   │                 │  ┌────────────────────────┐  │
│  │ Web UI / 业务程序        │   │                 │  │ localhost:3000         │  │
│  │  "获取每日简报"          │   │                 │  │ /api/stats/daily       │  │
│  └──────┬───────────────────┘   │                 │  └───────▲────────────────┘  │
│         │ pullService()         │                 │          │                   │
│         │ "daily_brief"         │                 │          │ HTTP GET          │
│         ▼                        │  0x30 Packet    │  ┌───────┴────────────────┐  │
│  ┌──────────────────────────┐   │────────────────►│  │ HttpProxyService       │  │
│  │ HttpProxyService         │   │  {serviceId,    │  │ - 查找注册表           │  │
│  │ (Client Mode)            │   │   params}       │  │ - 调用本地HTTP         │  │
│  │ - 发送请求               │   │                 │  │ - 返回结果             │  │
│  │ - 等待响应               │   │  0x31 Packet    │  └────────────────────────┘  │
│  └──────▲───────────────────┘   │◄────────────────│                              │
│         └─ resolve(data)         │  {result}       │                              │
└─────────────────────────────────┘                 └──────────────────────────────┘
```

### 1.3 设计原则

1. **对等关系**: 串口两端地位平等，都可以提供服务并调用对端服务
2. **配置驱动**: 通过配置文件清晰管理本端提供的API服务
3. **服务发现**: 支持查询对端提供的服务列表
4. **透明代理**: 对业务层屏蔽底层串口通信细节

---

## 二、协议设计

### 2.1 新增包类型

在现有协议 (v2.2) 基础上新增四个包类型：

| TYPE | 名称 | 说明 | Priority |
|------|------|------|----------|
| `0x30` | SERVICE_CALL | 调用远程HTTP服务 | P1 (Interactive) |
| `0x31` | SERVICE_RESULT | 返回调用结果 | P1 (Interactive) |
| `0x32` | SERVICE_QUERY | 查询对端服务列表 | P1 (Interactive) |
| `0x33` | SERVICE_LIST | 返回服务列表 | P1 (Interactive) |
| `0x34` | SERVICE_CHUNK | 大数据分片 | P1 (Interactive) |

**优先级理由**: API调用通常需要快速响应，不应被P2文件传输阻塞。分片机制确保大包不会阻塞P0心跳。

### 2.2 包体格式

#### SERVICE_CALL (0x30)

**用途**: 调用对端的HTTP服务

```json
{
  "id": "req_1702345678_abc123",       // 唯一请求ID
  "service": "daily_brief",             // 服务ID (在对端配置文件中注册)
  "params": {                           // 请求参数 (会作为HTTP参数传递)
    "date": "2025-12-10",
    "verbose": true
  }
}
```

#### SERVICE_RESULT (0x31)

**用途**: 返回HTTP调用结果

```json
{
  "id": "req_1702345678_abc123",       // 对应的请求ID
  "status": 200,                        // HTTP状态码
  "data": "{\"count\":42,\"items\":[...]}", // 响应数据 (保留原始字符串)
  "error": null                         // 错误信息 (如果失败)
}
```

**错误响应示例**:
```json
{
  "id": "req_1702345678_abc123",
  "status": 500,
  "data": null,
  "error": "Service daily_brief not found"
}
```

#### SERVICE_QUERY (0x32)

**用途**: 查询对端提供的服务列表

```json
{
  "id": "query_1702345678_xyz",        // 唯一查询ID
  "filter": {                           // 可选过滤条件
    "enabled": true,                    // 只查询已启用的服务
    "keyword": "stats"                  // 关键词搜索 (匹配id/name/description)
  }
}
```

#### SERVICE_LIST (0x33)

**用途**: 返回本端服务列表

```json
{
  "id": "query_1702345678_xyz",        // 对应的查询ID
  "services": [
    {
      "id": "daily_brief",
      "name": "每日简报",
      "description": "生成指定日期的每日简报，包含结构化数据和中文简报文本",
      "method": "GET",
      "version": "1.0",
      "enabled": true,
      "params": {                        // 参数定义 (可选)
        "date": {
          "type": "string",
          "description": "日期，格式: YYYY-MM-DD",
          "required": false,
          "default": "today"
        },
        "verbose": {
          "type": "boolean",
          "description": "是否返回详细信息",
          "required": false
        }
      }
    },
    {
      "id": "system_info",
      "name": "系统信息",
      "description": "获取系统运行状态",
      "method": "GET",
      "version": "1.0",
      "enabled": true
    }
  ]
}
```

#### SERVICE_CHUNK (0x34)

**用途**: 用于传输超过阈值 (如 4KB) 的大数据响应。

```json
{
  "id": "req_1702345678_abc123",       // 对应的请求ID
  "seq": 0,                             // 分片序号 (0-based)
  "total": 5,                           // 总分片数
  "data": "..."                         // 分片数据 (Base64或Raw String)
}
```

**分片机制**:
当 `SERVICE_RESULT` 的 `data` 字段超过 `service.maxChunkSize` (默认4KB) 时：
1. 发送 `SERVICE_RESULT` 头包，包含 `status` 但 `data` 为 null/empty，标记 `chunked: true`。
2. 随后发送一系列 `SERVICE_CHUNK` 包。
3. 接收端组装完整数据后触发 Promise resolve。

**注意**: `endpoint` 等敏感信息不会通过串口暴露。

---

## 三、架构设计

### 3.1 核心模块

#### HttpProxyService

**文件路径**: `src/core/services/HttpProxyService.js`

**职责**:
1. 管理本地服务注册表 (持久化到 `config/default.json`)
2. 处理对端的服务调用请求 (严格白名单验证)
3. 发起对远程服务的调用
4. 处理服务发现协议 (仅列出配置表，不扫描端口)


**主要数据结构**:

```javascript
class HttpProxyService extends EventEmitter {
  // 本地服务注册表
  localServices: Map<serviceId, {
    id: string,
    name: string,
    description: string,
    version: string,
    endpoint: string,        // HTTP端点 (本地敏感信息)
    method: 'GET'|'POST',
    timeout: number,
    headers: object,
    params: object,          // 参数定义
    enabled: boolean
  }>
  
  // 对端服务缓存 (通过SERVICE_QUERY获取)
  remoteServices: Map<serviceId, ServiceMetadata>
  
  // 待响应的请求
  pendingRequests: Map<requestId, {
    resolve: Function,
    reject: Function,
    timer: Timeout
  }>
}
```

**主要方法**:

| 方法 | 职责 |
|------|------|
| `registerService(id, config)` | 注册本地服务 |
| `loadServicesFromConfig(config)` | 从配置文件批量加载 |
| `pullService(serviceId, params)` | 调用远程服务 (客户端) |
| `handleServiceCall(frame)` | 处理收到的调用请求 (服务端) |
| `callLocalHttp(endpoint, params, options)` | 真正的HTTP调用 |
| `queryRemoteServices(filter)` | 查询对端服务列表 |
| `handleServiceQuery(frame)` | 处理对端的查询请求 |
| `getLocalServicesMetadata()` | 获取本地服务元数据 (公开信息) |
| `getRemoteServices()` | 获取缓存的对端服务 |

### 3.2 集成到现有架构

#### AppController 接口扩展

```javascript
// src/core/interface/AppController.js

class AppController extends EventEmitter {
  constructor() {
    // ...existing code...
    
    this.httpProxyService = new HttpProxyService();
    this.serviceManager.register(this.httpProxyService);
    
    // 从配置文件加载服务
    this.httpProxyService.loadServicesFromConfig(config);
  }
  
  // 新增API方法
  async pullService(serviceId, params) { ... }
  async queryRemoteServices(filter) { ... }
  registerService(serviceId, config) { ... }
  getLocalServices() { ... }
  getRemoteServices() { ... }
}
```

#### ApiServer 接口扩展

```javascript
// src/server/ApiServer.js

// 获取本地服务列表 (包含endpoint等完整配置)
GET /api/services/local

// 获取本地服务元数据 (仅公开信息，不含endpoint)
GET /api/services/local/public

// 注册本地服务
POST /api/services/local
Body: { serviceId, name, description, endpoint, method, ... }

// 查询对端服务列表 (触发串口查询)
POST /api/services/remote/query
Body: { enabled: true, keyword: "stats" }

// 获取缓存的对端服务列表 (不触发串口查询)
GET /api/services/remote

// 获取对端服务详情
GET /api/services/remote/:serviceId

// 调用远程服务
POST /api/services/remote/:serviceId/call
Body: { param1: "value1", param2: "value2" }
```

---

## 四、配置文件设计

### 4.1 配置文件位置

### 4.1 配置文件位置

**统一存储**: `config/default.json`
所有服务注册变更必须实时持久化到此文件，确保重启后不丢失。

### 4.2 配置结构

```json
{
  "serial": {
    "port": "COM1",
    "baudRate": 115200
  },
  
  "services": {
    "enabled": true,              // 是否启用API转发功能
    "autoRegister": true,         // 启动时自动注册配置中的服务
    "defaultTimeout": 30000,      // 默认超时时间 (ms)
    
    "localServices": {
      "daily_brief": {
        "name": "每日简报",
        "description": "生成指定日期的每日简报，包含结构化数据和中文简报文本",
        "version": "1.0",
        "endpoint": "http://localhost:3000/api/stats/daily/brief",
        "method": "GET",
        "timeout": 10000,
        "enabled": true,
        "headers": {
          "Authorization": "Bearer secret_token_123"
        },
        "params": {
          "date": {
            "type": "string",
            "description": "日期，格式: YYYY-MM-DD",
            "required": false,
            "default": "today"
          },
          "verbose": {
            "type": "boolean",
            "description": "是否返回详细信息",
            "required": false,
            "default": false
          }
        }
      },
      
      "system_info": {
        "name": "系统信息",
        "description": "获取当前系统运行状态（CPU、内存、磁盘）",
        "version": "1.0",
        "endpoint": "http://localhost:8080/api/system/info",
        "method": "GET",
        "timeout": 5000,
        "enabled": true
      },
      
      "update_config": {
        "name": "更新配置",
        "description": "动态更新系统配置参数",
        "version": "1.0",
        "endpoint": "http://localhost:3000/api/config/update",
        "method": "POST",
        "timeout": 3000,
        "enabled": true,
        "params": {
          "key": {
            "type": "string",
            "description": "配置键",
            "required": true
          },
          "value": {
            "type": "any",
            "description": "配置值",
            "required": true
          }
        }
      }
    }
  }
}
```

### 4.3 配置说明

#### 服务级配置

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 服务显示名称 |
| `description` | string | 否 | 服务描述 |
| `version` | string | 否 | 服务版本，默认 "1.0" |
| `endpoint` | string | 是 | 本地HTTP端点 (如 `http://localhost:3000/api/xxx`) |
| `method` | string | 否 | HTTP方法，默认 "GET" |
| `timeout` | number | 否 | 请求超时时间 (ms)，默认 10000 |
| `enabled` | boolean | 否 | 是否启用，默认 true |
| `headers` | object | 否 | 自定义HTTP头 (如认证token) |
| `params` | object | 否 | 参数定义 (用于文档和验证) |

---

## 五、通信流程

### 5.1 服务发现流程

```
设备B (查询方)                     设备A (服务提供方)
     │                                   │
     │  1. 用户触发"刷新对端服务"         │
     │─────────────────────────────────► │
     │  POST /api/services/remote/query  │
     │                                   │
     │  2. 发送 SERVICE_QUERY (0x32)     │
     │═══════════════════════════════════►│ 
     │  { id, filter }                   │
     │                                   │ 3. 读取本地注册表
     │                                   │    应用过滤器
     │                                   │
     │  4. 返回 SERVICE_LIST (0x33)      │
     │◄═══════════════════════════════════│
     │  { id, services: [...] }          │
     │                                   │
     │  5. 缓存对端服务列表              │
     │  6. 返回给前端                     │
     │◄───────────────────────────────── │
     │  { success: true, data: [...] }   │
     │                                   │
```

### 5.2 服务调用流程

```
设备B (客户端)                     设备A (服务端)
     │                                   │
     │  1. 用户调用远程服务              │
     │─────────────────────────────────► │
     │  POST /api/services/remote/       │
     │       daily_brief/call            │
     │  { date: "2025-12-10" }           │
     │                                   │
     │  2. 发送 SERVICE_CALL (0x30)      │
     │═══════════════════════════════════►│
     │  { id, service, params }          │
     │                                   │ 3. 检查服务注册
     │                                   │    读取endpoint
     │                                   │
     │                                   │ 4. HTTP调用
     │                                   │───────────┐
     │                                   │           │
     │                                   │ GET http://localhost:3000
     │                                   │      /api/stats/daily/brief
     │                                   │      ?date=2025-12-10
     │                                   │           │
     │                                   │◄──────────┘
     │                                   │ 5. 收到HTTP响应
     │                                   │
     │  6. 返回 SERVICE_RESULT (0x31)    │
     │◄═══════════════════════════════════│
     │  { id, status: 200, data }        │
     │                                   │
     │  7. Promise resolve               │
     │  8. 返回给前端                     │
     │◄───────────────────────────────── │
     │  { success: true, data }          │
     │                                   │
```

### 5.3 错误处理流程

**场景1: 服务不存在**
```
设备B            设备A
  │ SERVICE_CALL  │
  │──────────────►│ 服务 "unknown_service" 不在注册表
  │               │
  │◄──────────────│ SERVICE_RESULT
  │ { status:500, │
  │   error: "Service not found: unknown_service" }
```

**场景2: HTTP调用失败**
```
设备B            设备A
  │ SERVICE_CALL  │
  │──────────────►│ HTTP GET localhost:3000/api/xxx
  │               │──────┐
  │               │      │ Connection refused
  │               │◄─────┘
  │◄──────────────│ SERVICE_RESULT
  │ { status:500, │
  │   error: "HTTP request failed: ECONNREFUSED" }
```

**场景3: 超时**
```
设备B            设备A
  │ SERVICE_CALL  │
  │──────────────►│ HTTP GET (慢速服务)
  │               │──────► timeout (10s)
  │               │
  │◄──────────────│ SERVICE_RESULT
  │ { status:500, │
  │   error: "HTTP request timeout" }
```

**场景4: 请求超时 (无响应)**
```
设备B
  │ SERVICE_CALL
  │══════════════► (包丢失)
  │
  │ 等待30秒 ...
  │
  │ Promise reject
  └─ Error: "Service call timeout: daily_brief"
```

---

## 六、Web UI 设计

### 6.1 服务管理界面

**组件**: `src/web/src/features/api-forwarder/ServiceManager.jsx`

**功能**:
- 左侧列表: 本地服务 (从配置文件加载)
- 右侧列表: 对端服务 (通过SERVICE_QUERY获取)
- 刷新按钮: 重新查询对端服务
- 调用按钮: 跳转到ApiDebugger并预填serviceId

**布局**:
```
┌─────────────────────────────────────────────────────────┐
│  API 转发 - 服务管理                                      │
├─────────────────────┬───────────────────────────────────┤
│  本地服务 (Local)   │  对端服务 (Remote)    [刷新 🔄]   │
├─────────────────────┼───────────────────────────────────┤
│ ┌─────────────────┐ │ ┌─────────────────┐               │
│ │ daily_brief     │ │ │ device_status   │  [调用]       │
│ │ 每日简报        │ │ │ 设备状态        │               │
│ │ GET v1.0 ✅    │ │ │ GET v1.0 ✅    │               │
│ └─────────────────┘ │ └─────────────────┘               │
│ ┌─────────────────┐ │ ┌─────────────────┐               │
│ │ system_info     │ │ │ sensor_data     │  [调用]       │
│ │ 系统信息        │ │ │ 传感器数据      │               │
│ │ GET v1.0 ✅    │ │ │ POST v1.0 ✅   │               │
│ └─────────────────┘ │ └─────────────────┘               │
└─────────────────────┴───────────────────────────────────┘
```

### 6.2 API调试器

**组件**: `src/web/src/features/api-forwarder/ApiDebugger.jsx`

**改进**:
- 从Mock实现改为真实API调用
- 支持从ServiceManager传入预选的serviceId
- 显示真实的RTT和HTTP响应

**核心代码**:
```jsx
const handleSend = async () => {
  setLoading(true);
  const startTime = Date.now();

  try {
    const params = JSON.parse(paramsInput);
    
    const response = await fetch(`/api/services/remote/${serviceId}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const result = await response.json();
    const rtt = Date.now() - startTime;

    if (result.success) {
      setResponse({ data: result.data, rtt });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    setResponse({ error: error.message });
  } finally {
    setLoading(false);
  }
};
```

---

## 七、典型使用场景

### 场景1: 数据采集与分析

**设备A** (工业现场):
- 运行数据采集程序
- 提供API: `sensor_data`, `device_status`

**设备B** (监控中心):
- 通过Web UI查询设备A的传感器数据
- 定时调用 `sensor_data` API获取实时数据

```bash
# 设备B: 查询设备A提供的服务
curl -X POST http://localhost:3001/api/services/remote/query

# 设备B: 获取传感器数据
curl -X POST http://localhost:3001/api/services/remote/sensor_data/call \
  -H 'Content-Type: application/json' \
  -d '{ "sensor_id": "temp_01" }'
```

### 场景2: 双向配置同步

**设备A** 提供:
- `get_config`: 获取配置
- `update_config`: 更新配置

**设备B** 提供:
- `get_config`: 获取配置
- `update_config`: 更新配置

任一设备都可以查询和修改对端的配置。

### 场景3: 报表系统

**设备A**:
- 运行数据库和报表服务
- 提供API: `daily_brief`, `monthly_report`

**设备B**:
- 无数据库，仅有业务应用
- 通过串口调用设备A的报表API

---

## 八、安全与性能考虑

### 8.1 安全措施

### 8.1 安全措施

1. **严格白名单 (No Scanning)**: 本系统**绝不主动扫描**本机端口。只有在 `config/default.json` 中显式配置并启用的服务 (`enabled: true`) 才会对外暴露。
2. **Endpoint不暴露**: `SERVICE_LIST` 响应中只包含服务ID、名称和描述，绝不包含 `endpoint` URL。
3. **认证支持**: 支持在 `headers` 中配置 `Authorization` 等认证信息。
4. **超时保护**: 防止恶意的长时间请求占用资源。

### 8.2 性能优化

1. **优先级调度**: API调用使用P1优先级，避免被文件传输阻塞
2. **请求去重**: 通过 `requestId` 防止重复处理
3. **服务缓存**: 对端服务列表缓存在本地，减少串口查询
4. **超时控制**: 合理的超时时间 (默认30s)

### 8.3 限制与约束

1. **带宽限制**: 适用于小数据量API调用 (建议 < 10KB)
2. **延迟**: 串口传输 + HTTP调用，总延迟约 100ms - 5s
3. **并发限制**: 建议同时调用的服务数 < 5

---

## 九、实现清单

### 9.1 核心模块

- [ ] `src/core/services/HttpProxyService.js`
  - [ ] 服务注册表管理
  - [ ] HTTP调用封装
  - [ ] 请求/响应关联
  - [ ] 服务发现协议处理

### 9.2 集成与接口

- [ ] `src/core/interface/AppController.js` 扩展
- [ ] `src/server/ApiServer.js` 新增路由
- [ ] `config/default.json` 配置示例

### 9.3 Web UI

- [ ] `src/web/src/features/api-forwarder/ServiceManager.jsx`
- [ ] `src/web/src/features/api-forwarder/ApiDebugger.jsx` 改造

### 9.4 文档更新

- [ ] `docs/technical_reference.md` - 协议定义
- [ ] `docs/developer_guide.md` - 使用指南
- [ ] `docs/implementation_plan.md` - 实施计划

### 9.5 测试

- [ ] 单元测试: `HttpProxyService`
- [ ] 集成测试: 双端通信测试
- [ ] 性能测试: 延迟与带宽测试

---

## 十、未来扩展

### 10.1 短期优化

1. **参数验证**: 根据 `params` 定义自动验证请求参数
2. **响应缓存**: 对幂等的GET请求进行短时缓存
3. **重试机制**: 对关键服务自动重试

### 10.2 长期规划

1. **服务版本管理**: 支持多版本API共存
2. **流式响应**: 支持Server-Sent Events等流式数据
3. **WebSocket代理**: 代理WebSocket连接
4. **负载均衡**: 多个相同服务的负载分发

---

## 附录

### A. 完整代码示例

参见设计方案中的各章节代码片段。

### B. 配置文件模板

参见 [四、配置文件设计](#四配置文件设计)

### C. 相关文档

- [技术参考手册](./technical_reference.md)
- [开发指南](./developer_guide.md)
- [实施计划](./implementation_plan.md)
