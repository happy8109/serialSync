---
description: 每次修改代码后更新版本号
---

## 版本号更新规则

每次修改 serialSync 项目代码后，**必须**同步更新 `package.json` 中的 `version` 字段。

### 版本号格式
`major.minor.patch`，例如 `2.8.1`

- **major**: 与项目大版本保持一致（当前为 2）
- **minor**: 对应功能阶段（如 ARQ 可靠传输 = 8）
- **patch**: 每次代码修改递增

### 操作步骤
// turbo-all

1. 在完成代码修改后，读取当前 `package.json` 的 version
2. 将 patch 版本号 +1
3. 更新 `package.json` 的 version 字段

### 版本号用途
用户通过启动横幅 `SerialSync Launcher vX.Y.Z` 对比双端版本号，确认代码一致性。
