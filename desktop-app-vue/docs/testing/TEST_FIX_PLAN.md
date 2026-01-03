# Code-Executor测试修复计划

## 当前状态

### ✅ 已通过的测试 (15/24)
- 所有 `checkSafety` 测试 ✅
- 所有 `detectLanguage` 测试 ✅
- `cleanup` 错误处理测试 ✅
- `getCodeExecutor` 单例测试 ✅
- Python环境缺失时的初始化测试 ✅
- Python环境缺失时抛出错误测试 ✅
- 不支持的文件类型检测 ✅

### ❌ 失败的测试 (9/24)
1. `初始化 > 应该成功初始化` - fs.mkdir mock未生效
2. `executePython > 应该成功执行Python代码` - spawn mock未生效
3. `executePython > 应该处理执行错误` - spawn mock未生效
4. `executePython > 应该支持超时设置` - spawn mock未生效
5. `executeFile > 应该成功执行Python文件` - spawn mock未生效
6. `runCommand > 应该成功运行命令` - spawn mock未生效
7. `runCommand > 应该处理命令错误` - spawn mock未生效
8. `runCommand > 应该支持输入数据` - spawn mock未生效
9. `cleanup > 应该清理过期的临时文件` - fs操作mock未生效

## 根本原因分析

### 问题诊断
`code-executor.js` 使用 CommonJS 模块系统 (`require`)：
```javascript
const { spawn } = require('child_process');
const fs = require('fs').promises;
```

而 Vitest 在 jsdom 环境中对 CommonJS 模块的 mock 支持有限：
- `vi.mock()` 主要针对 ES6 模块设计
- CommonJS 的 `require()` 调用发生在模块加载时，mock 难以拦截
- `vi.resetModules()` 会清除缓存但mock仍然不生效

### 已尝试的解决方案

1. ❌ **改进 mock 配置** - 使用 `vi.hoisted`、`beforeAll` 等，仍然无效
2. ❌ **避免模块重置** - 只加载模块一次，mock 仍不生效
3. ❌ **双重 mock 配置** - 同时配置 `default` 和直接属性，无效

## 可行的解决方案

### 方案1：转换为 ES6 模块（不推荐）
**优点：**
- Mock 会完美工作
- 符合现代 JavaScript 最佳实践

**缺点：**
- 整个主进程都是 CommonJS，需要大规模重构
- 可能破坏现有功能
- Electron 主进程对 ES6 模块支持有限

**工作量：** 极大 (需要重构整个主进程)
**风险：** 高

### 方案2：配置独立的 Node 环境测试（推荐）
**实现：**
```javascript
// vitest.config.node.ts
export default defineConfig({
  test: {
    environment: 'node',  // 使用 Node 环境
    include: ['tests/main/**/*.test.js'],  // 只测试主进程代码
  }
});
```

**优点：**
- 更适合测试主进程代码
- 可以使用真实的 fs/spawn 或更好的 mock 工具

**缺点：**
- 需要分离测试配置
- 测试会调用真实系统（需要Python环境）

**工作量：** 中等
**风险：** 低

### 方案3：接受集成测试（推荐 - 短期）
**实现：**
- 保持当前测试结构
- 将依赖系统的测试标记为集成测试
- 重点测试纯逻辑函数（已全部通过）
- 在 CI/CD 中安装Python环境运行完整测试

**优点：**
- 无需大规模代码修改
- 测试更接近实际使用场景
- 纯逻辑测试已经覆盖了安全检查等核心功能

**缺点：**
- 测试依赖环境
- 测试速度较慢

**工作量：** 小
**风险：** 极低

### 方案4：使用 rewire 或类似工具
**实现：**
```bash
npm install --save-dev rewire
```

**优点：**
- 可以mock CommonJS模块的私有变量

**缺点：**
- 额外依赖
- Vitest 兼容性未知

**工作量：** 中等
**风险：** 中等

## 推荐方案

### 短期（立即实施）：方案3 - 接受集成测试
1. 标记依赖系统的测试为集成测试
2. 确保 CI/CD 环境安装 Python
3. 文档化测试要求

### 中期（下个迭代）：方案2 - 独立Node环境测试
1. 创建 `vitest.config.node.ts`
2. 分离主进程和渲染进程测试
3. 为主进程代码使用 Node 环境

### 长期（重构时）：方案1 - ES6模块
- 在整体架构升级时考虑迁移到ES6模块

## 当前测试覆盖率

- **总体：** 62.5% (15/24 通过)
- **核心逻辑：** 100% (checkSafety, detectLanguage 全部通过)
- **集成功能：** 33% (需要真实环境的测试)

## 下一步行动

1. ✅ 完成 PythonExecutionPanel 测试修复（已完成 - 27/27通过）
2. ⏸️ 暂时接受 code-executor 集成测试的局限性
3. 📝 更新 CI/CD 配置，确保Python环境
4. 🔄 在下个迭代考虑方案2（独立Node环境）
