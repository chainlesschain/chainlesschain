# code-ipc

**Source**: `src/main/code-tools/code-ipc.js`

**Generated**: 2026-02-15T07:37:13.846Z

---

## const

```javascript
const
```

* Code Tools IPC Handlers
 * 代码工具相关的 IPC 处理函数
 *
 * 包含10个代码处理handlers:
 * - code:generate - 生成代码
 * - code:generateTests - 生成单元测试
 * - code:review - 代码审查
 * - code:refactor - 代码重构
 * - code:explain - 解释代码
 * - code:fixBug - 修复bug
 * - code:generateScaffold - 生成项目脚手架
 * - code:executePython - 执行Python代码
 * - code:executeFile - 执行代码文件
 * - code:checkSafety - 检查代码安全性

---

## function registerCodeIPC(context)

```javascript
function registerCodeIPC(context)
```

* 注册所有代码工具相关的 IPC handlers
 * @param {Object} context - 上下文对象，包含 llmManager 等

---

