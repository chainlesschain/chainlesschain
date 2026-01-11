# IPC 测试工具

本目录包含用于测试和验证 IPC handlers 注册状态的工具。

---

## 📦 工具列表

### 1. check-ipc-status.js

**用途**: 分析应用日志，检查 IPC handlers 注册状态

**特点**:
- 无需修改应用代码
- 快速检查关键模块
- 输出清晰的状态报告

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
  ✅ Conversation IPC (16 handlers)
  ✅ Sync IPC (4 handlers)
  ✅ Notification IPC (5 handlers)

关键模块状态:
  ✅ Conversation IPC (16 handlers)
  ✅ Sync IPC (4 handlers)
  ✅ Notification IPC (5 handlers)

🎉 所有模块都已正确注册！
```

---

### 2. test-ipc-handlers-main.js

**用途**: 在主进程中直接检查 IPC handlers 是否注册

**特点**:
- 直接访问 ipcMain
- 检查 listener 数量
- 详细的测试报告

**使用方法**:

**方法 1: 独立运行**
```bash
# 需要先修改为可独立运行的 Electron 应用
electron test-ipc-handlers-main.js
```

**方法 2: 集成到应用**
```javascript
// 在 src/main/index.js 中添加
if (process.env.NODE_ENV === 'development') {
  setTimeout(() => {
    const { runTests } = require('./test-ipc-handlers-main');
    runTests();
  }, 5000);
}
```

**输出示例**:
```
============================================================
IPC Handlers 注册验证测试
============================================================

📋 Conversation IPC:
  ✅ conversation:get-by-project (1 listener)
  ✅ conversation:create (1 listener)
  ✅ conversation:update (1 listener)
  结果: 16/16 (100.0%) ✅

📋 Sync IPC:
  ✅ sync:start (1 listener)
  ✅ sync:stop (1 listener)
  结果: 4/4 (100.0%) ✅

总计: 25/25 handlers 已注册
成功率: 100.0%

🎉 所有 IPC handlers 都已正确注册！
```

---

### 3. test-ipc-registration.js

**用途**: 在渲染进程中测试 IPC handlers 是否可调用

**特点**:
- 在浏览器控制台运行
- 测试实际的 IPC 通信
- 检测 handler 是否真正可用

**使用方法**:

1. 在应用中打开开发者工具 (F12)
2. 在控制台中运行:
```javascript
testIPCRegistration()
```

**输出示例**:
```
========== IPC Handlers 注册验证 ==========

📋 测试 CONVERSATION IPC Handlers:
  ✅ conversation:get-by-project
  ✅ conversation:create
  ✅ conversation:update
  结果: 9/9 通过

📋 测试 SYNC IPC Handlers:
  ✅ sync:start
  ✅ sync:stop
  结果: 4/4 通过

========== 测试总结 ==========
总计: 18/18 handlers 已注册
成功率: 100.0%

🎉 所有关键 IPC handlers 都已正确注册！
```

---

## 🚀 快速开始

### 场景 1: 应用启动后检查 IPC 状态

```bash
# 1. 启动应用
npm run dev

# 2. 在另一个终端运行检查脚本
node check-ipc-status.js
```

### 场景 2: 修改代码后验证

```bash
# 1. 修改 IPC 相关代码
# 2. 重新构建主进程
npm run build:main

# 3. 重启应用
npm run dev

# 4. 检查状态
node check-ipc-status.js
```

### 场景 3: 调试 IPC 注册问题

```bash
# 1. 查看详细日志
tail -f /path/to/app.log | grep "IPC"

# 2. 运行检查脚本
node check-ipc-status.js

# 3. 如果发现问题，查看完整指南
cat docs/guides/IPC_REGISTRATION_GUIDE.md
```

---

## 📊 测试覆盖范围

### 关键模块

| 模块 | Handlers 数量 | 优先级 |
|------|--------------|--------|
| Conversation IPC | 16 | 高 |
| Sync IPC | 4 | 高 |
| Notification IPC | 5 | 高 |
| Speech IPC | 34 | 中 |
| LLM IPC | 14 | 高 |
| Database IPC | 22 | 高 |
| Project Core IPC | 34 | 高 |

### 测试类型

1. **静态检查** (check-ipc-status.js)
   - 分析日志文件
   - 检查注册状态
   - 快速诊断

2. **动态检查** (test-ipc-handlers-main.js)
   - 检查 listener 数量
   - 验证 handler 存在
   - 详细报告

3. **功能测试** (test-ipc-registration.js)
   - 实际调用 IPC
   - 测试通信是否正常
   - 端到端验证

---

## 🔧 故障排查

### 问题 1: check-ipc-status.js 报告未找到模块

**原因**: 日志文件路径不正确或应用未运行

**解决方案**:
```bash
# 1. 检查应用是否运行
ps aux | grep electron

# 2. 确认日志文件路径
# 修改 check-ipc-status.js 中的 LOG_FILE 变量

# 3. 重新运行
node check-ipc-status.js
```

### 问题 2: test-ipc-handlers-main.js 无法运行

**原因**: 需要 Electron 环境

**解决方案**:
```bash
# 方法 1: 集成到应用中（推荐）
# 在 src/main/index.js 中添加测试代码

# 方法 2: 使用 electron 命令
electron test-ipc-handlers-main.js
```

### 问题 3: test-ipc-registration.js 在控制台报错

**原因**: 函数未正确加载

**解决方案**:
```javascript
// 1. 确保脚本已加载
// 2. 在控制台检查
typeof testIPCRegistration  // 应该返回 'function'

// 3. 如果未定义，手动加载
// 复制 test-ipc-registration.js 的内容到控制台
```

---

## 📚 相关文档

- **完整指南**: `docs/guides/IPC_REGISTRATION_GUIDE.md`
- **快速参考**: `docs/guides/IPC_QUICK_REFERENCE.md`
- **修复文档**: `docs/fixes/NOTIFICATION_ERROR_SOLUTION.md`

---

## 🤝 贡献

如果你发现问题或有改进建议，请：

1. 查看现有文档
2. 运行测试工具诊断
3. 提交 issue 或 PR

---

**工具版本**: v1.0
**最后更新**: 2026-01-12
**维护者**: Claude Sonnet 4.5
