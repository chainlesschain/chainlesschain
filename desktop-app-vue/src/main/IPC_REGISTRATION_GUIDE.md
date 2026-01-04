# IPC Handler 注册保护机制使用指南

## 概述

IPC Guard 是一个统一的IPC handler注册保护机制，用于防止重复注册和提供全局的注册管理。

## 问题背景

在Electron应用中，IPC handler的重复注册会导致以下问题：

1. **警告信息**: Electron会在控制台输出警告信息
2. **Handler覆盖**: 新注册的handler会覆盖旧的handler
3. **内存泄漏**: 在测试或热重载场景下可能导致内存泄漏
4. **不可预期的行为**: 可能导致应用行为异常

## 解决方案

### IPC Guard 模块

位置: `desktop-app-vue/src/main/ipc-guard.js`

提供以下功能：

1. **Channel级别保护**: 防止同一个channel被重复注册
2. **Module级别保护**: 防止整个模块被重复注册
3. **统计跟踪**: 跟踪所有已注册的channels和modules
4. **注销管理**: 支持单个channel、整个module或全局的注销

### 核心API

```javascript
const ipcGuard = require('./ipc-guard');

// 检查函数
ipcGuard.isChannelRegistered(channel)     // 检查channel是否已注册
ipcGuard.isModuleRegistered(moduleName)   // 检查module是否已注册

// 注册函数
ipcGuard.safeRegisterHandler(channel, handler, moduleName)    // 安全注册单个handler
ipcGuard.safeRegisterHandlers(handlers, moduleName)           // 批量注册handlers
ipcGuard.safeRegisterModule(moduleName, registerFunc)         // 注册整个模块
ipcGuard.markModuleRegistered(moduleName)                     // 标记模块为已注册

// 注销函数
ipcGuard.unregisterChannel(channel)       // 注销单个channel
ipcGuard.unregisterModule(moduleName)     // 注销整个module
ipcGuard.resetAll()                       // 重置所有注册

// 统计函数
ipcGuard.getStats()                       // 获取统计信息
ipcGuard.printStats()                     // 打印统计信息
```

## 使用方法

### 方法1: 模块级保护（推荐）

在每个IPC模块的注册函数中添加模块级保护：

```javascript
// llm-ipc.js
const ipcGuard = require('../ipc-guard');

function registerLLMIPC({ llmManager, mainWindow, ... }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered('llm-ipc')) {
    console.log('[LLM IPC] Handlers already registered, skipping...');
    return;
  }

  const { ipcMain } = require('electron');

  // 注册所有handlers
  ipcMain.handle('llm:check-status', async () => { ... });
  ipcMain.handle('llm:query', async (_event, prompt, options) => { ... });
  // ... 更多handlers

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('llm-ipc');

  console.log('[LLM IPC] ✓ All LLM IPC handlers registered successfully');
}

module.exports = { registerLLMIPC };
```

### 方法2: Channel级保护

对单个handler进行保护：

```javascript
const ipcGuard = require('../ipc-guard');

// 安全注册单个handler
ipcGuard.safeRegisterHandler(
  'llm:check-status',
  async () => { /* handler逻辑 */ },
  'llm-ipc'
);
```

### 方法3: 批量注册

批量注册多个handlers：

```javascript
const ipcGuard = require('../ipc-guard');

const handlers = {
  'llm:check-status': async () => { /* ... */ },
  'llm:query': async (_event, prompt) => { /* ... */ },
  'llm:chat': async (_event, messages) => { /* ... */ }
};

const result = ipcGuard.safeRegisterHandlers(handlers, 'llm-ipc');
console.log(`注册: ${result.registered}, 跳过: ${result.skipped}`);
```

## 已更新的模块

以下模块已经集成了IPC Guard保护机制：

- [x] `ipc-registry.js` - 注册中心（全局保护）
- [x] `llm/llm-ipc.js` - LLM服务（模块级保护）
- [x] `conversation/conversation-ipc.js` - 对话管理（模块级保护）
- [x] `config/config-ipc.js` - 配置管理（已有保护）
- [x] `system/system-ipc.js` - 系统控制（已有保护）
- [x] `advanced-features-ipc.js` - 高级特性（已有保护）
- [x] `ipc/file-ipc.js` - 文件操作（已有保护）

## 待更新的模块

以下模块需要集成IPC Guard保护机制：

- [ ] `rag/rag-ipc.js`
- [ ] `import/import-ipc.js`
- [ ] `database/database-ipc.js`
- [ ] `git/git-ipc.js`
- [ ] `did/did-ipc.js`
- [ ] `p2p/p2p-ipc.js`
- [ ] `social/social-ipc.js`
- [ ] `project/project-core-ipc.js`
- [ ] `project/project-ai-ipc.js`
- [ ] `project/project-export-ipc.js`
- [ ] `project/project-rag-ipc.js`
- [ ] `project/project-git-ipc.js`
- [ ] ... 其他IPC模块

## 测试

单元测试位于: `tests/unit/ipc-guard.test.js`

运行测试:
```bash
npm test -- ipc-guard.test.js
```

## E2E测试集成

在E2E测试中，可以使用`resetAll()`来重置所有注册状态：

```javascript
// 在测试setup中
beforeEach(() => {
  const { ipcGuard } = require('../../src/main/ipc-registry');
  ipcGuard.resetAll();
});
```

## 统计和调试

查看当前注册状态：

```javascript
const { ipcGuard } = require('./ipc-registry');

// 获取统计信息
const stats = ipcGuard.getStats();
console.log('总Channels:', stats.totalChannels);
console.log('总Modules:', stats.totalModules);
console.log('Channels列表:', stats.channels);
console.log('Modules列表:', stats.modules);

// 打印统计信息
ipcGuard.printStats();
```

## 注意事项

1. **命名规范**: 模块名应该与文件名保持一致（例如 `llm-ipc`）
2. **注册顺序**: 确保在所有handler注册完成后调用 `markModuleRegistered()`
3. **测试隔离**: 在测试中使用 `resetAll()` 来确保每个测试的独立性
4. **异常处理**: `safeRegister*` 函数会自动捕获异常并返回false，检查返回值以确保注册成功

## 迁移现有代码

如果你的IPC模块还没有保护机制，按以下步骤迁移：

1. 在文件顶部导入IPC Guard:
   ```javascript
   const ipcGuard = require('../ipc-guard');
   ```

2. 在注册函数开头添加重复检查:
   ```javascript
   if (ipcGuard.isModuleRegistered('your-module-name')) {
     console.log('[Your Module] Handlers already registered, skipping...');
     return;
   }
   ```

3. 在注册函数结尾标记模块已注册:
   ```javascript
   ipcGuard.markModuleRegistered('your-module-name');
   ```

4. 测试确保没有破坏现有功能

## 相关Issue

- 修复IPC handler注册问题 (影响AI对话功能)
- 防止E2E测试中的重复注册警告
- 支持热重载和开发环境下的模块更新

## 贡献

如果你发现任何问题或有改进建议，请提交Issue或PR。
