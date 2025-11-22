# 文件同步功能设计方案

> 本文档记录 SerialSync 项目文件同步功能的详细设计方案，基于现有架构和协议基础。

## 1. 核心概念与目标

### 1.1 功能目标
文件同步功能的核心目标是实现**双向自动文件同步**，让两台设备通过串口实现类似"网盘/同步盘"的文件互通。主要包括：

- **自动监控**：监控指定目录的文件变化
- **智能同步**：检测文件差异，自动同步新增、修改、删除的文件
- **冲突解决**：处理同名文件的修改冲突
- **队列管理**：管理多个同步任务和文件传输队列

### 1.2 应用场景
- 无网络环境下的文件共享
- 工业设备间的数据同步
- 实验室设备的数据备份
- 嵌入式系统的配置同步

## 2. 技术架构设计

### 2.1 分层架构
```
┌─────────────────────────────────────┐
│           UI/CLI 层                 │  ← 用户交互、任务管理
├─────────────────────────────────────┤
│         FileSyncManager             │  ← 同步逻辑、冲突解决
├─────────────────────────────────────┤
│         TransferQueue               │  ← 统一传输队列、优先级调度
├─────────────────────────────────────┤
│         SerialManager               │  ← 底层串口通信
└─────────────────────────────────────┘
```

### 2.2 核心组件设计

#### FileSyncManager（同步管理器）
- 管理同步任务配置
- 监控文件系统变化
- 生成同步计划
- 处理冲突解决策略

#### TransferQueue（统一传输队列）
- 统一管理所有传输任务（消息、单文件、同步文件）
- 支持优先级调度，确保串口链路独占
- 支持暂停/恢复/取消
- 提供传输统计和进度
- 向后兼容现有功能（send命令、sendfile命令）

## 3. 同步策略设计

### 3.1 同步模式
- **实时同步**：文件变化立即触发同步
- **定时同步**：按配置的时间间隔自动同步
- **手动同步**：用户主动触发同步

### 3.2 冲突解决策略
- **时间优先**：以最近修改时间为准
- **大小优先**：以文件大小为准
- **用户选择**：弹出选择对话框
- **自动重命名**：添加时间戳后缀

### 3.3 文件过滤
- **包含规则**：指定文件类型、目录
- **排除规则**：排除临时文件、系统文件
- **大小限制**：限制同步文件的最大大小

## 4. 协议扩展设计

### 4.1 新增包类型
基于现有的扩展协议，需要增加以下包类型：

```javascript
// 同步协议包类型
const SYNC_PACKET_TYPES = {
  SYNC_REQ: 0x20,        // 同步请求
  SYNC_ACCEPT: 0x21,     // 同意同步
  SYNC_REJECT: 0x22,     // 拒绝同步
  FILE_LIST: 0x23,       // 文件清单
  SYNC_PLAN: 0x24,       // 同步计划
  SYNC_COMPLETE: 0x25    // 同步完成
};
```

### 4.2 同步流程协议
1. **SYNC_REQ**：发起同步请求，包含同步配置
2. **SYNC_ACCEPT/REJECT**：对方确认或拒绝同步
3. **FILE_LIST**：交换文件清单（文件名、大小、修改时间、MD5）
4. **SYNC_PLAN**：生成同步计划（需要传输的文件列表）
5. **文件传输**：使用现有的分块协议传输文件
6. **SYNC_COMPLETE**：同步完成确认

### 4.3 协议包格式

#### SYNC_REQ 包格式
```
[0xAA][0x20][REQ_ID][LEN][SYNC_CONFIG_JSON][CHECKSUM]
```
- 0xAA: 包头 (1字节)
- 0x20: 包类型 (1字节)
- REQ_ID: 请求ID (1字节)
- LEN: 配置JSON长度 (1字节)
- SYNC_CONFIG_JSON: 同步配置（JSON格式）
- CHECKSUM: 校验和 (1字节)

#### FILE_LIST 包格式
```
[0xAA][0x23][REQ_ID][LEN][FILE_LIST_JSON][CHECKSUM]
```
- FILE_LIST_JSON: 文件清单（JSON格式）

## 5. 数据结构设计

### 5.1 同步任务配置
```javascript
const syncTask = {
  id: 'task1',
  name: '文档同步',
  enabled: true,
  srcPath: 'D:/docs',
  dstPath: '/mnt/docs',
  direction: 'bidirectional', // 'A->B', 'B->A', 'bidirectional'
  strategy: 'mtime',          // 冲突策略
  recursive: true,            // 递归子目录
  include: ['*.txt', '*.doc', '*.pdf'],
  exclude: ['*.tmp', 'node_modules', '.git'],
  maxFileSize: 100 * 1024 * 1024, // 100MB
  schedule: '0 */10 * * * *',     // cron表达式
  priority: 10
};
```

### 5.2 文件清单结构
```javascript
const fileList = {
  files: [
    {
      path: 'docs/readme.txt',
      size: 1024,
      mtime: 1640995200000,
      md5: 'abc123...',
      action: 'upload' // 'upload', 'download', 'delete'
    }
  ],
  totalSize: 1024000,
  fileCount: 10
};
```

### 5.3 同步计划结构
```javascript
const syncPlan = {
  planId: 'plan_001',
  tasks: [
    {
      file: 'docs/readme.txt',
      action: 'upload',
      priority: 10,
      size: 1024
    }
  ],
  totalFiles: 5,
  totalSize: 5120
};
```

## 6. 实现步骤规划

### 阶段1：基础框架（预计2-3天）
1. 创建 `FileSyncManager` 类
2. 创建 `FileTransferQueue` 类
3. 扩展 `SerialManager` 支持同步协议
4. 实现基本的文件清单交换

### 阶段2：核心功能（预计3-4天）
1. 实现文件监控（使用 `chokidar` 库）
2. 实现文件差异检测
3. 实现冲突解决策略
4. 实现队列调度算法

### 阶段3：高级功能（预计2-3天）
1. 实现定时同步
2. 实现断点续传
3. 实现同步历史记录
4. 实现性能优化

## 7. 关键技术点

### 7.1 文件监控
- 使用 `chokidar` 库实现跨平台文件监控
- 支持递归监控和文件过滤
- 防抖处理，避免频繁触发

```javascript
const chokidar = require('chokidar');

const watcher = chokidar.watch(syncPath, {
  ignored: /(^|[\/\\])\../, // 忽略隐藏文件
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  }
});
```

### 7.2 文件差异检测
- 基于文件大小、修改时间、MD5哈希
- 支持增量同步，只传输变化的部分
- 处理文件重命名和移动

```javascript
function detectFileChanges(localFiles, remoteFiles) {
  const changes = {
    upload: [],
    download: [],
    delete: []
  };
  
  // 比较逻辑实现
  return changes;
}
```

### 7.3 队列调度
- 优先级队列实现
- 支持任务暂停/恢复
- 错误重试机制
- 并发控制（串口限制为单文件传输）

### 7.4 性能优化
- 文件清单压缩传输
- 批量文件传输优化
- 内存使用优化
- 传输速率自适应

## 8. 配置管理

### 8.1 配置文件扩展
在 `config/default.json` 中增加同步配置：

```json
{
  "sync": {
    "tasks": [
      {
        "id": "default",
        "name": "默认同步",
        "enabled": true,
        "srcPath": "./sync_folder",
        "direction": "bidirectional",
        "strategy": "mtime",
        "recursive": true,
        "schedule": "0 */5 * * * *"
      }
    ],
    "queue": {
      "maxConcurrent": 1,
      "retryAttempts": 3,
      "retryDelay": 5000
    },
    "filters": {
      "include": ["*.txt", "*.doc", "*.pdf"],
      "exclude": ["*.tmp", "node_modules", ".git"],
      "maxFileSize": 104857600
    }
  }
}
```

### 8.2 配置验证
- 路径有效性检查
- 权限验证
- 配置格式验证

## 9. 用户界面设计

### 9.1 CLI 命令
```bash
# 同步任务管理
serialSync sync list                    # 列出所有同步任务
serialSync sync add <name> <path>       # 添加同步任务
serialSync sync remove <id>             # 删除同步任务
serialSync sync start <id>              # 启动同步任务
serialSync sync stop <id>               # 停止同步任务

# 手动同步
serialSync sync now <id>                # 立即执行同步
serialSync sync status <id>             # 查看同步状态
serialSync sync logs <id>               # 查看同步日志
```

### 9.2 Web UI 界面
- 同步任务管理面板
- 实时同步状态显示
- 文件差异对比视图
- 冲突解决对话框
- 同步历史记录

## 10. 风险评估与应对

### 10.1 技术风险
- **串口带宽限制**：大文件同步可能很慢
- **文件冲突处理**：复杂场景下的冲突解决
- **内存使用**：大量文件时的内存占用
- **文件系统权限**：跨平台权限问题

### 10.2 应对策略
- 实现文件大小限制和分块传输
- 提供多种冲突解决策略
- 优化内存使用，支持流式处理
- 完善的错误处理和权限检查

### 10.3 性能目标
- 小文件（<1MB）：传输时间 < 30秒
- 中等文件（1-10MB）：传输时间 < 5分钟
- 大文件（>10MB）：支持断点续传
- 内存使用：< 100MB
- CPU使用：< 30%

## 11. 测试计划

### 11.1 单元测试
- FileSyncManager 功能测试
- FileTransferQueue 调度测试
- 协议包解析测试
- 文件差异检测测试

### 11.2 集成测试
- 端到端同步测试
- 多文件队列测试
- 冲突解决测试
- 性能压力测试

### 11.3 用户测试
- CLI 命令易用性测试
- Web UI 界面测试
- 错误处理测试
- 跨平台兼容性测试

## 12. 后续扩展计划

### 12.1 功能扩展
- 支持文件夹同步
- 支持增量同步
- 支持加密传输
- 支持多设备同步

### 12.2 性能优化
- 压缩算法优化
- 传输协议优化
- 缓存机制优化
- 并发传输优化

### 12.3 用户体验
- 图形化配置界面
- 实时同步状态可视化
- 同步历史记录管理
- 移动端适配

---

## 文档更新记录

- **2025-01-27**：初始版本，基于项目架构讨论创建
- 后续更新请在此处记录

---

> 本文档为 SerialSync 项目文件同步功能的详细设计方案，开发过程中请严格遵循此设计规范。
