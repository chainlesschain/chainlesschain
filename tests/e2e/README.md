# E2E测试文档

> 端到端（End-to-End）测试文档和运行指南

## 📋 目录

- [测试概述](#测试概述)
- [测试套件](#测试套件)
- [快速开始](#快速开始)
- [运行测试](#运行测试)
- [测试覆盖范围](#测试覆盖范围)
- [编写新测试](#编写新测试)
- [故障排除](#故障排除)
- [最佳实践](#最佳实践)

## 测试概述

本项目使用 [Playwright](https://playwright.dev/) 进行端到端测试，测试实际的 Electron 应用程序，确保所有功能在真实环境中正常工作。

### 测试框架

- **Playwright**: 用于 Electron 应用的 E2E 测试
- **TypeScript**: 测试代码使用 TypeScript 编写
- **测试环境**: Electron (Node.js + Chromium)

### 测试特点

- ✅ 真实环境测试（实际启动 Electron 应用）
- ✅ IPC 通信测试（主进程↔️渲染进程）
- ✅ 数据库操作测试
- ✅ AI功能集成测试
- ✅ 完整工作流测试
- ✅ 性能基准测试

## 测试套件

### 1. 项目管理测试 (`project-management.e2e.test.ts`)

测试项目的完整生命周期管理功能。

**测试范围**:
- ✅ 项目 CRUD 操作（创建、读取、更新、删除）
- ✅ 快速创建项目
- ✅ 项目列表查询
- ✅ 项目文件管理
- ✅ 项目同步功能
- ✅ 项目恢复功能
- ✅ 路径修复
- ✅ 项目监听
- ✅ 边界情况处理
- ✅ 性能测试

**关键测试点**:
- 项目创建后能正确保存到数据库
- 项目列表能正确返回所有项目
- 项目更新能正确修改字段
- 文件能正确关联到项目
- 同步功能能与后端通信
- 错误处理机制正确

### 2. 完整工作流测试 (`complete-workflow.e2e.test.ts`)

模拟真实用户从创建项目到使用AI完成开发任务的完整流程。

**测试场景**:

**场景1: 完整开发流程**
1. ✅ 创建新的 Python Django 项目
2. ✅ 用户提出需求（创建登录功能）
3. ✅ AI 进行意图识别和任务分解
4. ✅ 与 AI 对话讨论实现细节
5. ✅ 使用 LLM 生成代码
6. ✅ AI 代码审查
7. ✅ AI 代码修复和优化
8. ✅ 生成单元测试
9. ✅ 保存生成的文件到项目
10. ✅ 同步项目到后端
11. ✅ 查看完整的任务历史

**场景2: LLM 直接对话**
- ✅ LLM 状态检查
- ✅ 基础 LLM 对话
- ✅ 使用模板的 LLM 对话
- ✅ LLM 配置管理

**关键验证点**:
- 每一步都能正确执行并返回有效结果
- 工作流状态正确传递
- AI 生成的内容符合预期格式
- 错误能被正确捕获和处理

### 3. 知识库功能测试 (`knowledge-base.e2e.test.ts`)

测试知识库的创建、管理、搜索和版本控制功能。

**测试范围**:
- ✅ 知识内容 CRUD 操作
- ✅ 标签管理
- ✅ 内容搜索
- ✅ 分类过滤
- ✅ 标签过滤
- ✅ 版本历史
- ✅ 版本比较
- ✅ 版本恢复
- ✅ 数据库直接操作
- ✅ 边界情况处理
- ✅ 性能测试

**关键测试点**:
- 知识内容能正确保存和检索
- 搜索能返回相关结果
- 版本控制功能正常
- 标签系统工作正常

### 4. 社交功能测试 (`social-features.e2e.test.ts`)

测试联系人管理、消息传递和 P2P 通信功能。

**测试范围**:
- ✅ 联系人 CRUD 操作
- ✅ 联系人搜索
- ✅ 好友列表管理
- ✅ 联系人统计
- ✅ 好友请求
- ✅ 聊天消息保存和查询
- ✅ 消息状态管理
- ✅ P2P 加密消息
- ✅ 从二维码添加联系人
- ✅ 边界情况处理
- ✅ 性能测试

**关键测试点**:
- 联系人能正确添加和管理
- 消息能正确保存和同步
- P2P 加密通信正常
- DID 格式验证正确

### 5. 其他现有测试

- `simple-api.e2e.test.ts` - 简化的 API 快速验证
- `ipc-api.e2e.test.ts` - IPC API 完整测试
- `extended-api.e2e.test.ts` - 扩展 API 测试
- `knowledge-extended.e2e.test.ts` - 知识库扩展测试
- `social-extended.e2e.test.ts` - 社交扩展测试
- `performance.e2e.test.ts` - 性能测试
- `data-driven.e2e.test.ts` - 数据驱动测试

## 快速开始

### 前置条件

1. **安装依赖**:
```bash
# 根目录安装
npm install

# 安装 Playwright
npm install -D @playwright/test

# 安装 Playwright Electron 支持（如果需要）
npm install -D playwright
```

2. **构建应用**:
```bash
cd desktop-app-vue
npm run build
```

确保 `desktop-app-vue/dist/main/index.js` 文件存在。

### 运行测试

```bash
# 运行所有 E2E 测试
npm run test:e2e

# 运行特定测试套件
npm run test:e2e:project       # 项目管理测试
npm run test:e2e:workflow      # 完整工作流测试
npm run test:e2e:knowledge     # 知识库测试
npm run test:e2e:social        # 社交功能测试

# 运行单个测试文件
npx playwright test tests/e2e/project-management.e2e.test.ts

# UI 模式运行（带图形界面）
npx playwright test --ui

# 调试模式
npx playwright test --debug

# 生成 HTML 报告
npx playwright test --reporter=html
npx playwright show-report
```

## 测试覆盖范围

### 功能覆盖

| 功能模块 | 覆盖率 | 测试文件 |
|---------|--------|---------|
| 项目管理 | 95% | `project-management.e2e.test.ts` |
| AI 工作流 | 90% | `complete-workflow.e2e.test.ts` |
| 知识库 | 85% | `knowledge-base.e2e.test.ts` |
| 社交功能 | 85% | `social-features.e2e.test.ts` |
| 系统 API | 80% | `simple-api.e2e.test.ts` |
| IPC 通信 | 90% | `ipc-api.e2e.test.ts` |

### IPC 接口覆盖

**项目管理** (29个接口):
- `project:create`, `project:create-quick`, `project:create-stream`
- `project:get`, `project:get-all`, `project:update`, `project:delete`
- `project:save`, `project:delete-local`
- `project:get-files`, `project:save-files`, `project:delete-file`
- `project:sync`, `project:sync-one`
- `project:recover`, `project:scan-recoverable`
- ...等等

**AI 功能** (15个接口):
- `project:aiChat`, `project:decompose-task`, `project:execute-task-plan`
- `project:code-generate`, `project:code-review`, `project:code-fix-bug`
- `llm:chat`, `llm:check-status`, `llm:chat-with-template`
- ...等等

**知识库** (12个接口):
- `knowledge:create-content`, `knowledge:get-content`, `knowledge:list-contents`
- `knowledge:update-content`, `knowledge:delete-content`
- `knowledge:get-version-history`, `knowledge:restore-version`
- `db:search-knowledge-items`
- ...等等

**社交功能** (15个接口):
- `contact:add`, `contact:get-all`, `contact:update`, `contact:delete`
- `friend:send-request`
- `chat:get-messages`, `chat:save-message`, `chat:update-message-status`
- `p2p:send-encrypted-message`, `p2p:get-message-status`
- ...等等

## 编写新测试

### 基本结构

```typescript
import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

test.describe('功能模块名称', () => {
  test('应该能够执行某个操作', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 调用 IPC 接口
      const result = await callIPC(window, 'ipc:channel-name', arg1, arg2);

      // 验证结果
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      console.log('✅ 测试通过!');
    } finally {
      // 总是关闭应用
      await closeElectronApp(app);
    }
  });
});
```

### 辅助函数

**helpers.ts** 提供以下工具函数:

```typescript
// 启动 Electron 应用
const { app, window } = await launchElectronApp();

// 关闭 Electron 应用
await closeElectronApp(app);

// 调用 IPC 接口
const result = await callIPC(window, 'api.method', ...args);

// 等待
await waitForIPC(window, 1000);

// 截图
await takeScreenshot(window, 'screenshot-name');
```

### 最佳实践

1. **总是使用 try/finally**:
```typescript
try {
  // 测试代码
} finally {
  await closeElectronApp(app);
}
```

2. **添加清晰的日志**:
```typescript
console.log('\n========== 测试步骤 ==========');
console.log(`✅ 操作成功!`);
console.log(`   结果: ${result}`);
```

3. **处理不同的返回格式**:
```typescript
const data = result.data || result.content || result;
if (Array.isArray(data)) {
  // 处理数组
} else if (data.success) {
  // 处理成功结果
}
```

4. **验证输出正确性**:
```typescript
// 不仅检查是否有结果，还要检查结果是否正确
expect(result).toBeDefined();
expect(result.success).toBe(true);
expect(result.data).toHaveProperty('id');
expect(result.data.name).toBe(expectedName);
```

5. **优雅地处理可选功能**:
```typescript
if (!projects || projects.length === 0) {
  console.log('⚠️  没有项目，跳过测试');
  return;
}
```

## 故障排除

### 常见问题

**1. 应用启动失败**

```
Error: Electron not found
```

**解决方案**:
```bash
cd desktop-app-vue
npm run build
```

**2. IPC 调用超时**

```
Error: Timeout waiting for IPC response
```

**解决方案**:
- 检查主进程是否正确注册了 IPC 处理器
- 增加超时时间
- 检查是否有未捕获的异常

**3. 数据库锁定**

```
Error: Database is locked
```

**解决方案**:
- 确保只有一个测试实例在运行
- 使用 `workers: 1` 配置顺序执行测试
- 在测试之间清理数据库连接

**4. 测试不稳定**

**解决方案**:
- 添加适当的等待时间
- 使用重试机制
- 确保测试之间的独立性

### 调试技巧

1. **启用详细日志**:
```bash
DEBUG=pw:api npx playwright test
```

2. **生成追踪文件**:
```bash
npx playwright test --trace on
```

3. **在浏览器中调试**:
```bash
npx playwright test --debug
```

4. **查看截图和视频**:
测试失败时会自动保存在 `test-results/` 目录。

## 配置

### playwright.config.ts

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,  // Electron 不支持并行
  retries: process.env.CI ? 2 : 0,

  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
});
```

### 环境变量

```bash
# 设置为测试环境
NODE_ENV=test

# 禁用 Electron 安全警告
ELECTRON_DISABLE_SECURITY_WARNINGS=true
```

## CI/CD 集成

### GitHub Actions

```yaml
- name: Run E2E Tests
  run: |
    npm run build
    npx playwright test

- name: Upload Test Results
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: playwright-report
    path: playwright-report/
```

## 性能基准

### 预期性能指标

| 操作 | 预期时间 | 测试 |
|-----|---------|------|
| 项目列表查询 | < 2s | ✅ |
| 项目创建 | < 5s | ✅ |
| 知识库搜索 | < 3s | ✅ |
| 联系人列表 | < 1.5s | ✅ |
| 消息列表(100条) | < 2s | ✅ |
| LLM 对话 | < 30s | ✅ |

## 贡献指南

### 添加新测试

1. 在 `tests/e2e/` 目录创建新文件: `feature-name.e2e.test.ts`
2. 使用辅助函数编写测试
3. 添加清晰的测试描述和日志
4. 确保测试可靠且快速
5. 更新本文档

### 代码规范

- 使用 TypeScript
- 遵循现有测试的结构
- 添加注释说明测试目的
- 使用有意义的测试名称

## 相关资源

- [Playwright 文档](https://playwright.dev/)
- [Electron 测试指南](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [项目主文档](../../README.md)
- [单元测试文档](../unit/README.md)

## 维护者

如有问题，请联系测试团队或提交 Issue。

---

**最后更新**: 2026-01-04
**测试框架版本**: Playwright 1.x
