# LLM IPC 修复 - 快速参考指南

## 什么被修改了?

### 1. 源代码修改 (3 行核心变化)
```javascript
// 删除
const { ipcMain } = require('electron');

// 添加到函数签名
ipcMain: injectedIpcMain

// 添加到函数开头
const electron = require('electron');
const ipcMain = injectedIpcMain || electron.ipcMain;
```

### 2. 测试文件重写
- 从: 464 行静态分析
- 到: 568 行动态测试
- 新增: 38 个测试用例

## 为什么要修复?

| 问题 | 影响 | 解决方案 |
|-----|-----|--------|
| 无法测试 handler 实现 | 功能验证不完整 | 依赖注入 + Mock 对象 |
| 测试与 electron 耦合 | 无法独立测试 | 注入 mock ipcMain |
| 无法验证依赖交互 | 集成问题未发现 | Mock 所有依赖 |

## 修复的关键要素

### 依赖注入模式
```javascript
// 使用可选参数接收 ipcMain
function registerLLMIPC({ ..., ipcMain: injectedIpcMain })

// 支持两种调用方式:

// 1. 生产环境 (使用真实的 electron.ipcMain)
registerLLMIPC({ llmManager, mainWindow, ... })

// 2. 测试环境 (注入 mock)
registerLLMIPC({
  llmManager: mockLlmManager,
  mainWindow: mockMainWindow,
  ...,
  ipcMain: mockIpcMain
})
```

### Handler 注册捕获
```javascript
// Mock 对象捕获所有注册
mockIpcMain = {
  handle: (channel, handler) => {
    handlers[channel] = handler;  // 保存 handler 供测试使用
  }
};

// 现在可以测试 handler
const handler = handlers['llm:check-status'];
const result = await handler({});
```

## 如何验证修复?

### 快速检查
```bash
# 1. 查看源文件修改
grep -n "ipcMain: injectedIpcMain" src/main/llm/llm-ipc.js
grep -n "const ipcMain = injectedIpcMain" src/main/llm/llm-ipc.js

# 2. 查看测试文件
grep -n "mockIpcMain = {" tests/unit/llm/llm-ipc.test.js
grep -n "ipcMain: mockIpcMain" tests/unit/llm/llm-ipc.test.js
```

### 完整测试
```bash
# 运行测试
npm test -- tests/unit/llm/llm-ipc.test.js

# 预期结果: 38 tests passed
```

## 修改了什么 handler?

**所有 14 个 handlers**:
- llm:check-status
- llm:query
- llm:chat
- llm:chat-with-template
- llm:query-stream
- llm:get-config
- llm:set-config
- llm:list-models
- llm:clear-context
- llm:embeddings
- llm:get-selector-info
- llm:select-best
- llm:generate-report
- llm:switch-provider

## 影响范围

### 生产环境
✓ **无影响** - 当不提供 ipcMain 参数时,使用真实的 electron.ipcMain

### 测试环境
✓ **显著改进** - 从无法验证功能到完整的动态测试

### 维护性
✓ **提升** - 遵循标准化模式,易于理解和扩展

## 常见问题

### Q1: 这会破坏现有代码吗?
**A**: 不会。`ipcMain` 是可选参数,现有调用不需要改变。

### Q2: 生产性能会受影响吗?
**A**: 不会。参数检查只在函数初始化时执行一次。

### Q3: 如何在我的代码中使用?
**A**: 无需改变。已有的调用完全兼容。

```javascript
// 已有的代码继续工作
const { registerLLMIPC } = require('./llm/llm-ipc');
registerLLMIPC({ llmManager, mainWindow, ... });
```

### Q4: 如何添加新的 handler?
**A**: 遵循相同模式即可:

```javascript
// 1. 声明 handler
ipcMain.handle('llm:new-feature', async (_event, params) => {
  // 实现逻辑
});

// 2. 添加到测试
it('should register llm:new-feature handler', () => {
  expect(handlers['llm:new-feature']).toBeDefined();
});

it('llm:new-feature should invoke appropriate method', async () => {
  const handler = handlers['llm:new-feature'];
  const result = await handler({}, params);
  expect(mockLlmManager.newFeature).toHaveBeenCalled();
});
```

## 文件导航

| 文件 | 用途 |
|-----|-----|
| `src/main/llm/llm-ipc.js` | 源文件(已修改) |
| `tests/unit/llm/llm-ipc.test.js` | 测试文件(已重写) |
| `LLM_IPC_FIX_REPORT.md` | 详细修复报告 |
| `CONSISTENCY_VERIFICATION.md` | 一致性验证 |
| `EXECUTION_SUMMARY.md` | 完整执行摘要 |
| `QUICK_REFERENCE.md` | 本文件 |

## 与其他模块的对比

这个修复遵循的模式与以下模块相同:
- Organization IPC (`src/main/organization/organization-ipc.js`)
- Import IPC (`src/main/import/import-ipc.js`)

如果你需要修复其他 IPC 模块,可以参考这个方案。

## 关键变化总结

| 方面 | 修改前 | 修改后 |
|-----|------|------|
| IPC 获取 | 全局导入 | 参数注入/全局导入 |
| 测试类型 | 静态分析 | 动态执行 |
| Mock 依赖 | 不支持 | 完全支持 |
| Handler 验证 | 名称检查 | 功能验证 |
| 向后兼容 | 100% | 100% |

## 快速排查清单

如果遇到问题,检查:
- [ ] 源文件第 21 行有 `ipcMain: injectedIpcMain` 参数?
- [ ] 源文件第 23-24 行有依赖注入逻辑?
- [ ] 所有 `ipcMain.handle()` 调用使用注入的 `ipcMain`?
- [ ] 测试文件有 `mockIpcMain` 对象?
- [ ] 测试在 `registerLLMIPC` 调用中传递 `ipcMain: mockIpcMain`?
- [ ] 所有 14 个 handler 在测试中被验证?

## 成功标志

✓ 修复完成的标志:
1. 源文件正确支持依赖注入
2. 测试可以直接调用 handlers
3. 所有 38 个测试通过
4. 与其他模块风格一致
5. 文档完整准确

---

**需要帮助?**
- 查看 `LLM_IPC_FIX_REPORT.md` 获取详细信息
- 查看 `CONSISTENCY_VERIFICATION.md` 了解设计标准
- 查看 `EXECUTION_SUMMARY.md` 获取完整上下文
