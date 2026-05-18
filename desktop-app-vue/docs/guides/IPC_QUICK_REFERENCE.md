# IPC 注册快速参考

**快速查找常见问题的解决方案**

---

## 🚨 常见错误

### 错误 1: "No handler registered for 'xxx'"

**原因**: IPC handler 未注册

**解决方案**:

```bash
# 1. 重新构建主进程
npm run build:main

# 2. 重启应用
npm run dev

# 3. 检查注册状态
node check-ipc-status.js
```

### 错误 2: "Attempted to register a second handler"

**原因**: 重复注册

**解决方案**:

```javascript
// 使用 IPC Guard 防止重复注册
if (ipcGuard.isModuleRegistered("my-module")) {
  return;
}
// ... 注册代码
ipcGuard.markModuleRegistered("my-module");
```

### 错误 3: 依赖未定义 (undefined)

**原因**: 依赖未正确传递

**解决方案**:

```javascript
// 在 ipc-registry.js 中检查解构
const {
  syncManager, // ⚠️ 确保在这里列出
  // ... 其他依赖
} = dependencies;

// 使用解构的变量，不要用 app.syncManager
registerSyncIPC({ syncManager });
```

---

## ✅ 快速检查清单

### 添加新的 IPC Handler

- [ ] 在对应的 `*-ipc.js` 文件中实现 handler
- [ ] 使用 `ipcGuard` 防止重复注册
- [ ] 添加错误处理 (try-catch)
- [ ] 在 `ipc-registry.js` 中注册模块
- [ ] 在 `preload/index.js` 中暴露 API
- [ ] 运行 `npm run build:main`
- [ ] 测试 handler 是否工作

### 调试 IPC 问题

- [ ] 查看控制台日志
- [ ] 运行 `node check-ipc-status.js`
- [ ] 检查依赖是否正确传递
- [ ] 验证 IPC Guard 状态
- [ ] 确认主进程已重新构建

---

## 🔧 常用命令

```bash
# 重新构建主进程
npm run build:main

# 重启应用
npm run dev

# 检查 IPC 状态
node check-ipc-status.js

# 查看日志
tail -f /path/to/app.log | grep "IPC"
```

---

## 📝 代码模板

### 创建新的 IPC 模块

```javascript
// src/main/my-module/my-module-ipc.js

const { ipcMain } = require("electron");
const ipcGuard = require("../ipc-guard");

function registerMyModuleIPC({ dependency1, dependency2 }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered("my-module-ipc")) {
    console.log("[My Module IPC] Already registered, skipping...");
    return;
  }

  // 注册 handlers
  ipcMain.handle("my-module:action", async (event, data) => {
    try {
      // 实现逻辑
      const result = await doSomething(data);
      return { success: true, data: result };
    } catch (error) {
      console.error("[My Module IPC] Error:", error);
      return { success: false, error: error.message };
    }
  });

  // 标记为已注册
  ipcGuard.markModuleRegistered("my-module-ipc");
  console.log("[My Module IPC] ✅ Registered 1 handler");
}

module.exports = { registerMyModuleIPC };
```

### 在 IPC Registry 中注册

```javascript
// src/main/ipc/ipc-registry.js

// 在 registerAllIPC 函数中添加
try {
  console.log("[IPC Registry] Registering My Module IPC...");
  const { registerMyModuleIPC } = require("./my-module/my-module-ipc");
  registerMyModuleIPC({ dependency1, dependency2 });
  console.log("[IPC Registry] ✓ My Module IPC registered");
} catch (error) {
  console.error("[IPC Registry] ❌ My Module IPC failed:", error.message);
  console.log("[IPC Registry] ⚠️ Continuing...");
}
```

### 在 Preload 中暴露 API

```javascript
// src/preload/index.js

contextBridge.exposeInMainWorld("electronAPI", {
  // ... 其他 API
  myModule: {
    action: (data) => ipcRenderer.invoke("my-module:action", data),
  },
});
```

### 在渲染进程中使用

```javascript
// src/renderer/components/MyComponent.vue

async function performAction() {
  try {
    const result = await window.electronAPI.myModule.action(data);
    if (result.success) {
      console.log("Success:", result.data);
    } else {
      console.error("Error:", result.error);
    }
  } catch (error) {
    console.error("IPC call failed:", error);
  }
}
```

---

## 🔍 故障排查流程

```
1. 检查错误信息
   ↓
2. 运行 check-ipc-status.js
   ↓
3. 查看日志中的 [IPC Registry] 输出
   ↓
4. 检查依赖是否正确传递
   ↓
5. 验证主进程是否重新构建
   ↓
6. 重启应用
   ↓
7. 再次测试
```

---

## 📚 相关文档

- **完整指南**: `docs/guides/IPC_REGISTRATION_GUIDE.md`
- **修复文档**: `docs/fixes/NOTIFICATION_ERROR_SOLUTION.md`
- **测试工具**: `check-ipc-status.js`, `test-ipc-handlers-main.js`

---

**快速参考版本**: v1.0
**最后更新**: 2026-01-12
