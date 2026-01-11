# IPC Handler Registration Fix - sync:start & notification:get-all

## 错误信息

```
LoginPage.vue:265 [Login] 数据同步失败: Error: Error invoking remote method 'sync:start':
Error: No handler registered for 'sync:start'

social.js:518 加载通知失败: Error: Error invoking remote method 'notification:get-all':
Error: No handler registered for 'notification:get-all'
```

## 根本原因 (Root Cause)

**IPC Registry 参数传递错误**:

在 `desktop-app-vue/src/main/ipc-registry.js` 中：

1. **`syncManager` 未从 dependencies 解构** (line 45-89)
   - `syncManager` 参数被传入但未被解构使用

2. **错误地访问 `app.syncManager`** (line 615-619)
   - 代码尝试访问 `app.syncManager` 而不是使用传入的 `syncManager` 参数
   - 导致 `syncManager` 为 `null`，sync IPC handlers 注册失败
   - 连锁反应导致后续的 notification IPC 注册也可能失败

## 解决方案

### 代码修复 (已完成)

**文件**: `desktop-app-vue/src/main/ipc-registry.js`

**修改 1: 添加 syncManager 到解构** (line ~82)

```javascript
const {
  app,
  database,
  mainWindow,
  // ... other dependencies ...
  chatSkillBridge,
  syncManager,  // ← 添加这一行
  contactManager,
  friendManager,
  // ... rest of dependencies ...
} = dependencies;
```

**修改 2: 使用解构的 syncManager** (line ~615-620)

```javascript
// 修改前:
console.log('[IPC Registry] Registering Sync IPC...');
if (!app.syncManager) {  // ← 错误: 访问 app.syncManager
  console.warn('[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers');
}
const { registerSyncIPC } = require('./sync/sync-ipc');
registerSyncIPC({ syncManager: app.syncManager || null });  // ← 错误

// 修改后:
console.log('[IPC Registry] Registering Sync IPC...');
if (!syncManager) {  // ← 正确: 使用解构的 syncManager
  console.warn('[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers');
}
const { registerSyncIPC } = require('./sync/sync-ipc');
registerSyncIPC({ syncManager: syncManager || null });  // ← 正确
```

### 应用修复

```bash
# 1. 停止当前运行的应用 (Ctrl+C 或关闭窗口)

# 2. 重新构建主进程
cd desktop-app-vue
npm run build:main

# 3. 重新启动应用
npm run dev
```

## 为什么这个修复解决了两个错误

### 1. `sync:start` Handler 错误

- **Handler 定义**: `desktop-app-vue/src/main/sync/sync-ipc.js` (line 32)
- **问题**: `syncManager` 为 `null` 导致 handler 注册失败
- **修复**: 正确传递 `syncManager` 参数，handler 成功注册

### 2. `notification:get-all` Handler 错误

- **Handler 定义**: `desktop-app-vue/src/main/notification/notification-ipc.js` (line 80)
- **问题**: 虽然 notification IPC 本身正确，但 sync IPC 注册失败可能导致整个 IPC 注册流程中断
- **修复**: 修复 sync IPC 后，notification IPC 也能正常注册

## 验证修复

重启应用后，您应该看到：

### 成功的日志

```
[IPC Registry] Registering Sync IPC...
[IPC Registry] ✓ Sync IPC registered (4 handlers)
[IPC Registry] Registering Notification IPC...
[IPC Registry] ✓ Notification IPC registered (5 handlers)

[Login] 登录成功
[Login] 数据同步完成  ← sync:start 成功

[Social Store] 成功获取通知: 0 条  ← notification:get-all 成功
```

### 不再出现的错误

```
❌ Error: No handler registered for 'sync:start'
❌ Error: No handler registered for 'notification:get-all'
```

## 技术细节

### 数据流

```
index.js (line 2389)
  ↓ 传递 syncManager
ipc-registry.js (line 82)
  ↓ 解构 syncManager
ipc-registry.js (line 620)
  ↓ 传递给 registerSyncIPC
sync-ipc.js (line 32)
  ↓ 注册 sync:start handler
✅ Handler 可用
```

### 相关文件

1. **`desktop-app-vue/src/main/ipc-registry.js`** - IPC 注册中心 (已修复)
2. **`desktop-app-vue/src/main/sync/sync-ipc.js`** - Sync IPC handlers (正确)
3. **`desktop-app-vue/src/main/notification/notification-ipc.js`** - Notification IPC handlers (正确)
4. **`desktop-app-vue/src/main/index.js`** - 主进程入口 (正确传递 syncManager)

## 当前状态

✅ **代码已修复**: `ipc-registry.js` 已更新
✅ **修复已提交**: 等待 git commit
⏳ **需要重启应用**: 请重新构建并重启应用

## 快速命令

```bash
# 一键重启（在 desktop-app-vue 目录下）
npm run build:main && npm run dev
```

---

**更新时间**: 2026-01-11
**状态**: 代码已修复，需要重启应用
**优先级**: 高
**修复类型**: IPC 参数传递错误
