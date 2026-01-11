# IPC 注册机制说明文档

**版本**: v1.0
**日期**: 2026-01-12
**作者**: Claude Sonnet 4.5

---

## 📋 目录

1. [概述](#概述)
2. [IPC 注册流程](#ipc-注册流程)
3. [关键组件](#关键组件)
4. [错误处理机制](#错误处理机制)
5. [测试工具](#测试工具)
6. [常见问题](#常见问题)
7. [最佳实践](#最佳实践)

---

## 概述

ChainlessChain 使用 Electron 的 IPC (Inter-Process Communication) 机制实现主进程和渲染进程之间的通信。本文档详细说明了 IPC handlers 的注册机制、错误处理和测试方法。

### 核心文件

| 文件 | 作用 |
|------|------|
| `src/main/ipc-registry.js` | IPC 注册中心，统一管理所有 IPC handlers |
| `src/main/ipc-guard.js` | IPC 守卫，防止重复注册 |
| `src/main/*/\*-ipc.js` | 各模块的 IPC handlers 实现 |
| `src/preload/index.js` | Preload 脚本，暴露 API 给渲染进程 |

---

## IPC 注册流程

### 1. 注册阶段

IPC 注册分为多个阶段，按照依赖关系顺序执行：

```
Phase 1: 核心系统 IPC
  ├─ Database IPC (22 handlers)
  ├─ Config IPC (5 handlers)
  └─ System IPC (16 handlers)

Phase 2: AI 和 LLM IPC
  ├─ LLM IPC (14 handlers)
  ├─ RAG IPC (7 handlers)
  └─ Web Search IPC (4 handlers)

Phase 3: 身份和社交 IPC
  ├─ DID IPC (24 handlers)
  ├─ P2P IPC (18 handlers)
  ├─ Social IPC (33 handlers)
  └─ VC IPC (10 handlers)

Phase 4: 项目管理 IPC
  ├─ Project Core IPC (34 handlers)
  ├─ Project AI IPC (16 handlers)
  ├─ Project Export IPC (17 handlers)
  ├─ Project RAG IPC (10 handlers)
  └─ Project Git IPC (14 handlers)

Phase 5: 文件和模板 IPC
  ├─ File IPC (17 handlers)
  ├─ Template IPC (20 handlers)
  ├─ Knowledge IPC (17 handlers)
  ├─ Prompt Template IPC (11 handlers)
  └─ Image IPC (22 handlers)

Phase 6: 媒体处理 IPC
  ├─ Speech IPC (34 handlers)
  ├─ Video IPC (18 handlers)
  ├─ PDF IPC (4 handlers)
  └─ Document IPC (1 handler)

Phase 7: 其他功能 IPC
  ├─ Sync IPC (4 handlers)
  ├─ Notification IPC (5 handlers)
  ├─ Conversation IPC (16 handlers)
  └─ Import IPC (8 handlers)
```

### 2. 注册代码示例

```javascript
// src/main/ipc-registry.js

function registerAllIPC(dependencies) {
  try {
    // 解构依赖
    const {
      database,
      llmManager,
      mainWindow,
      syncManager,  // ⚠️ 重要：必须正确解构
      // ... 其他依赖
    } = dependencies;

    // 注册 Sync IPC
    console.log('[IPC Registry] Registering Sync IPC...');
    if (!syncManager) {
      console.warn('[IPC Registry] ⚠️ syncManager 未初始化');
    }
    const { registerSyncIPC } = require('./sync/sync-ipc');
    registerSyncIPC({ syncManager: syncManager || null });
    console.log('[IPC Registry] ✓ Sync IPC registered (4 handlers)');

    // 注册 Notification IPC
    console.log('[IPC Registry] Registering Notification IPC...');
    const { registerNotificationIPC } = require('./notification/notification-ipc');
    registerNotificationIPC({ database, mainWindow });
    console.log('[IPC Registry] ✓ Notification IPC registered (5 handlers)');

    // 注册 Conversation IPC
    console.log('[IPC Registry] Registering Conversation IPC...');
    const { registerConversationIPC } = require('./conversation/conversation-ipc');
    registerConversationIPC({ database, llmManager, mainWindow });
    console.log('[IPC Registry] ✓ Conversation IPC registered (16 handlers)');

  } catch (error) {
    console.error('[IPC Registry] ❌ Registration failed:', error);
    throw error;
  }
}
```

### 3. 单个模块注册示例

```javascript
// src/main/conversation/conversation-ipc.js

function registerConversationIPC({ database, llmManager, mainWindow, ipcMain: injectedIpcMain }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered('conversation-ipc')) {
    console.log('[Conversation IPC] ⚠️ Handlers already registered, skipping...');
    return;
  }

  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  // 注册 handler
  ipcMain.handle('conversation:create', async (event, conversationData) => {
    try {
      // 实现逻辑
      return { success: true, data: result };
    } catch (error) {
      console.error('[Conversation IPC] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // 标记为已注册
  ipcGuard.markModuleRegistered('conversation-ipc');
  console.log('[Conversation IPC] ✅ Successfully registered 16 handlers');
}

module.exports = { registerConversationIPC };
```

---

## 关键组件

### 1. IPC Guard (ipc-guard.js)

防止重复注册和管理 IPC handlers 的生命周期。

**主要功能**:
- `isModuleRegistered(moduleName)` - 检查模块是否已注册
- `markModuleRegistered(moduleName)` - 标记模块为已注册
- `isChannelRegistered(channel)` - 检查通道是否已注册
- `markChannelRegistered(channel)` - 标记通道为已注册
- `resetAll()` - 重置所有注册状态

**使用示例**:
```javascript
const ipcGuard = require('./ipc-guard');

// 检查是否已注册
if (ipcGuard.isModuleRegistered('my-module')) {
  console.log('Module already registered');
  return;
}

// 注册 handlers...

// 标记为已注册
ipcGuard.markModuleRegistered('my-module');
```

### 2. IPC Registry (ipc-registry.js)

统一管理所有 IPC handlers 的注册。

**主要功能**:
- `registerAllIPC(dependencies)` - 注册所有 IPC handlers
- `unregisterAllIPC(ipcMain)` - 注销所有 IPC handlers

**依赖注入**:
```javascript
registerAllIPC({
  app,
  database,
  mainWindow,
  llmManager,
  ragManager,
  syncManager,  // ⚠️ 必须传递
  // ... 其他依赖
});
```

---

## 错误处理机制

### 1. 模块级错误处理

为每个可能失败的模块添加 try-catch 保护：

```javascript
// ✅ 正确：有错误处理
if (app.initializeSpeechManager) {
  try {
    console.log('[IPC Registry] Registering Speech IPC...');
    const { registerSpeechIPC } = require('./speech/speech-ipc');
    registerSpeechIPC({ initializeSpeechManager });
    console.log('[IPC Registry] ✓ Speech IPC registered');
  } catch (speechError) {
    console.error('[IPC Registry] ❌ Speech IPC registration failed:', speechError.message);
    console.log('[IPC Registry] ⚠️ Continuing with other IPC registrations...');
  }
}

// ❌ 错误：没有错误处理
if (app.initializeSpeechManager) {
  console.log('[IPC Registry] Registering Speech IPC...');
  const { registerSpeechIPC } = require('./speech/speech-ipc');
  registerSpeechIPC({ initializeSpeechManager });  // 如果失败，整个流程中断
  console.log('[IPC Registry] ✓ Speech IPC registered');
}
```

### 2. Handler 级错误处理

每个 IPC handler 内部也应该有错误处理：

```javascript
ipcMain.handle('conversation:create', async (event, data) => {
  try {
    // 验证参数
    if (!data || !data.projectId) {
      throw new Error('Missing required parameter: projectId');
    }

    // 执行操作
    const result = await createConversation(data);

    return { success: true, data: result };
  } catch (error) {
    console.error('[Conversation IPC] Error in conversation:create:', error);
    return { success: false, error: error.message };
  }
});
```

### 3. 降级策略

当某些依赖不可用时，提供降级方案：

```javascript
// 检查依赖是否可用
if (!syncManager) {
  console.warn('[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers');
}

// 传递 null，让模块内部处理
registerSyncIPC({ syncManager: syncManager || null });
```

---

## 测试工具

### 1. IPC 状态检查脚本

**文件**: `check-ipc-status.js`

**用途**: 分析应用日志，检查 IPC handlers 注册状态

**使用方法**:
```bash
node check-ipc-status.js
```

**输出示例**:
```
============================================================
IPC 注册状态分析
============================================================

✅ 已注册的模块:
  ✅ Database IPC (22 handlers)
  ✅ LLM IPC (14 handlers)
  ✅ Conversation IPC (16 handlers)
  ✅ Sync IPC (4 handlers)
  ✅ Notification IPC (5 handlers)

============================================================
总结
============================================================
已注册: 5/5
总 handlers: 61

🎉 所有模块都已正确注册！
```

### 2. IPC Handlers 主进程测试

**文件**: `test-ipc-handlers-main.js`

**用途**: 在主进程中直接检查 IPC handlers 是否注册

**使用方法**:
```bash
# 方法1: 直接运行（需要修改主进程入口）
node test-ipc-handlers-main.js

# 方法2: 在应用启动后调用
# 在 src/main/index.js 中添加:
const { runTests } = require('./test-ipc-handlers-main');
setTimeout(() => runTests(), 5000);
```

### 3. IPC Handlers 渲染进程测试

**文件**: `test-ipc-registration.js`

**用途**: 在渲染进程中测试 IPC handlers 是否可调用

**使用方法**:
```javascript
// 在浏览器控制台中运行
testIPCRegistration();
```

---

## 常见问题

### Q1: 为什么某些 IPC handlers 没有注册？

**可能原因**:
1. **依赖未正确传递** - 检查 `registerAllIPC` 的参数
2. **模块注册失败** - 查看日志中的错误信息
3. **重复注册被阻止** - IPC Guard 检测到重复注册

**解决方法**:
```bash
# 1. 查看日志
tail -f /path/to/app.log | grep "IPC"

# 2. 运行检查脚本
node check-ipc-status.js

# 3. 检查依赖传递
# 确保在 ipc-registry.js 中正确解构所有依赖
```

### Q2: 如何调试 IPC 注册问题？

**步骤**:
1. 启用详细日志
2. 检查 IPC Guard 状态
3. 验证依赖是否正确初始化
4. 使用测试工具验证

**示例**:
```javascript
// 在 ipc-registry.js 中添加调试日志
console.log('[IPC Registry] Dependencies:', {
  hasDatabase: !!database,
  hasLLMManager: !!llmManager,
  hasSyncManager: !!syncManager,
  // ... 其他依赖
});
```

### Q3: 如何防止重复注册？

**使用 IPC Guard**:
```javascript
const ipcGuard = require('./ipc-guard');

function registerMyIPC() {
  // 检查是否已注册
  if (ipcGuard.isModuleRegistered('my-module')) {
    console.log('Already registered, skipping...');
    return;
  }

  // 注册 handlers...

  // 标记为已注册
  ipcGuard.markModuleRegistered('my-module');
}
```

### Q4: 如何处理模块注册失败？

**添加 try-catch 保护**:
```javascript
try {
  console.log('[IPC Registry] Registering Module...');
  registerModule(dependencies);
  console.log('[IPC Registry] ✓ Module registered');
} catch (error) {
  console.error('[IPC Registry] ❌ Module registration failed:', error.message);
  console.log('[IPC Registry] ⚠️ Continuing with other modules...');
  // 不要 throw，让其他模块继续注册
}
```

---

## 最佳实践

### 1. 依赖管理

✅ **正确做法**:
```javascript
// 在 ipc-registry.js 中正确解构
const {
  app,
  database,
  syncManager,  // ✅ 明确列出
  // ... 其他依赖
} = dependencies;

// 使用解构的变量
registerSyncIPC({ syncManager });
```

❌ **错误做法**:
```javascript
// 没有解构，直接访问
registerSyncIPC({ syncManager: app.syncManager });  // ❌ 可能为 undefined
```

### 2. 错误处理

✅ **正确做法**:
```javascript
// 模块级 try-catch
try {
  registerModule();
} catch (error) {
  console.error('Module failed:', error.message);
  // 继续执行，不影响其他模块
}

// Handler 级 try-catch
ipcMain.handle('my:handler', async (event, data) => {
  try {
    return { success: true, data: await doSomething(data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

❌ **错误做法**:
```javascript
// 没有错误处理
registerModule();  // ❌ 失败会中断整个流程

ipcMain.handle('my:handler', async (event, data) => {
  return await doSomething(data);  // ❌ 错误会导致未捕获的异常
});
```

### 3. 日志记录

✅ **正确做法**:
```javascript
console.log('[Module] Registering handlers...');
console.log('[Module] ✓ Handler registered: my:handler');
console.log('[Module] ✅ All handlers registered (5 handlers)');
```

❌ **错误做法**:
```javascript
console.log('Registering...');  // ❌ 没有模块标识
console.log('Done');  // ❌ 信息不明确
```

### 4. 防止重复注册

✅ **正确做法**:
```javascript
if (ipcGuard.isModuleRegistered('my-module')) {
  console.log('[Module] Already registered, skipping...');
  return;
}

// 注册 handlers...

ipcGuard.markModuleRegistered('my-module');
```

❌ **错误做法**:
```javascript
// 没有检查，直接注册
ipcMain.handle('my:handler', ...);  // ❌ 可能重复注册
```

### 5. 测试验证

✅ **正确做法**:
```javascript
// 在开发环境中自动运行测试
if (process.env.NODE_ENV === 'development') {
  setTimeout(() => {
    const { runTests } = require('./test-ipc-handlers-main');
    runTests();
  }, 5000);
}
```

---

## 附录

### A. 完整的 IPC Handlers 列表

参见 `check-ipc-status.js` 中的 `IPC_MODULES` 定义。

### B. 相关文档

- `NOTIFICATION_ERROR_SOLUTION.md` - 通知 IPC 修复方案
- `TASK_PLANNING_FIX.md` - 任务规划修复说明
- `CONVERSATION_IPC_FIX.md` - 对话 IPC 修复文档

### C. 修改历史

| 日期 | 版本 | 修改内容 |
|------|------|----------|
| 2026-01-12 | v1.0 | 初始版本 |

---

**文档维护**: Claude Sonnet 4.5
**最后更新**: 2026-01-12
