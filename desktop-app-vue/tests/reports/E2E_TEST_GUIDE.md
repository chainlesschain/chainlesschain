# 项目详情页 E2E 测试指南

## 概述

本文档说明项目详情页的E2E测试实现，包括测试覆盖范围、已发现问题和解决方案。

## 完成的工作

### 1. 添加测试ID（data-testid）

为提高测试可靠性，在以下组件中添加了 `data-testid` 属性：

#### ProjectDetailPage.vue

- `project-detail-wrapper` - 项目详情页包装器
- `project-detail-page` - 主页面
- `toolbar-breadcrumb` - 面包屑导航
- `back-to-projects-link` - 返回项目列表链接
- `file-manage-button` - 文件管理按钮
- `share-button` - 分享按钮
- `toggle-editor-button` - 编辑器面板切换按钮
- `git-actions-button` - Git操作按钮
- `git-actions-menu` - Git操作菜单
- `git-status-item` - Git状态菜单项
- `git-history-item` - Git历史菜单项
- `git-commit-item` - Git提交菜单项
- `git-push-item` - Git推送菜单项
- `git-pull-item` - Git拉取菜单项
- `save-button` - 保存按钮
- `close-button` - 关闭按钮
- `loading-container` - 加载状态容器
- `error-container` - 错误状态容器
- `content-container` - 主内容区
- `file-explorer-panel` - 文件树面板
- `file-explorer-header` - 文件树头部
- `file-tree-mode-switch` - 文件树模式切换
- `refresh-files-button` - 刷新文件按钮
- `file-tree-container` - 文件树容器

#### ChatPanel.vue

- `chat-panel` - 聊天面板
- `chat-header` - 聊天头部
- `context-mode-selector` - 上下文模式选择器
- `context-mode-project` - 项目模式按钮
- `context-mode-file` - 文件模式按钮
- `context-mode-global` - 全局模式按钮
- `messages-container` - 消息容器
- `chat-empty-state` - 空状态
- `messages-list` - 消息列表
- `message-loading` - 加载指示器
- `input-container` - 输入区域
- `chat-input` - 输入框
- `clear-conversation-button` - 清空对话按钮
- `chat-send-button` - 发送按钮
- `context-info` - 上下文信息提示

### 2. 创建测试文件

#### 综合测试（project-detail-comprehensive.e2e.test.ts）

覆盖项目详情页的所有功能模块：

- 基础加载和导航（3个测试）
- 文件树操作（3个测试）
- 文件编辑和保存（3个测试）
- 文件管理（3个测试）
- Git操作（2个测试）
- AI对话（3个测试）
- 任务规划（1个测试）
- 布局和面板调整（2个测试）
- 错误处理（3个测试）
- 分享功能（1个测试）
- 文件导出（1个测试）

**总计：25个测试用例**

#### 核心测试（project-detail-core.e2e.test.ts）

专注于最核心和最常用的功能：

- 完整流程测试（创建项目 → 创建文件 → 编辑 → 保存 → AI对话）
- 错误处理（加载不存在的项目）
- 文件操作（创建、选择、刷新）
- UI交互（按钮和切换功能）

**总计：4个测试用例**

#### 基础测试（project-detail-basic.e2e.test.ts）

用于调试和验证基本功能：

- 应用启动验证
- 项目创建验证
- 页面导航验证
- DOM元素检查

**总计：1个测试用例**

### 3. 创建测试辅助函数（project-detail-helpers.ts）

提供了21个辅助函数，简化测试编写：

#### 项目和文件管理

- `createAndOpenProject()` - 创建并打开项目
- `createTestFile()` - 创建测试文件
- `selectFileInTree()` - 在文件树中选择文件
- `refreshFileList()` - 刷新文件列表
- `toggleFileTreeMode()` - 切换文件树模式

#### 文件编辑

- `saveCurrentFile()` - 保存当前文件
- `hasUnsavedChanges()` - 检查是否有未保存的更改

#### AI对话

- `sendChatMessage()` - 发送聊天消息
- `waitForAIResponse()` - 等待AI响应
- `getChatMessages()` - 获取所有聊天消息
- `switchContextMode()` - 切换上下文模式
- `clearConversation()` - 清空对话历史

#### Git操作

- `performGitAction()` - 执行Git操作

#### UI交互

- `toggleEditorPanel()` - 切换编辑器面板
- `openFileManageModal()` - 打开文件管理对话框
- `openShareModal()` - 打开分享对话框
- `backToProjectList()` - 返回项目列表

#### 辅助工具

- `waitForProjectDetailLoad()` - 等待项目详情页加载完成

## 发现的问题

### 1. 登录页面拦截

**问题描述：**

- 应用启动时默认显示登录页面（`#/login`）
- 路由守卫阻止未登录用户访问项目详情页
- 即使创建了项目并尝试导航，页面仍停留在登录页

**测试输出：**

```
[Test] 当前URL: file:///.../index.html#/login
[Test] 目标URL: #/projects/4349aae3-ba6d-48d1-982d-17a07ee7ecf8
[Test] 导航后URL: file:///.../index.html#/login  <-- 未改变
```

**影响：**

- 所有项目详情页测试无法执行
- 需要先通过登录流程才能测试核心功能

**解决方案：**

#### 方案1：添加登录辅助函数（推荐）

在 `helpers.ts` 中添加：

```typescript
/**
 * 执行登录
 */
export async function login(
  window: Page,
  options: {
    username?: string;
    password?: string;
    skipLogin?: boolean; // 测试环境跳过登录
  } = {},
): Promise<void> {
  const currentUrl = await window.evaluate(() => window.location.hash);

  if (currentUrl.includes("/login")) {
    if (options.skipLogin) {
      // 通过IPC跳过登录（测试模式）
      await callIPC(window, "auth:skip-login-for-test");
    } else {
      // 填写登录表单
      await window.fill(
        '[data-testid="username-input"]',
        options.username || "testuser",
      );
      await window.fill(
        '[data-testid="password-input"]',
        options.password || "testpassword",
      );
      await window.click('[data-testid="login-button"]');

      // 等待登录完成
      await window.waitForTimeout(2000);
    }
  }
}
```

#### 方案2：在测试环境中禁用路由守卫

在 `src/main/index.js` 中添加测试模式检测：

```javascript
if (process.env.NODE_ENV === "test") {
  // 测试模式下自动登录
  global.testMode = true;
}
```

在路由配置中：

```javascript
router.beforeEach((to, from, next) => {
  if (global.testMode) {
    // 测试模式下跳过认证检查
    next();
    return;
  }

  // 正常认证逻辑...
});
```

#### 方案3：使用测试专用路由

添加测试专用的直接访问路由：

```javascript
// 仅测试环境可用
if (process.env.NODE_ENV === "test") {
  router.addRoute({
    path: "/test-direct-access/:projectId",
    name: "TestProjectDetail",
    component: ProjectDetailPage,
    props: true,
  });
}
```

### 2. 后端API依赖

**问题描述：**

- `project:create` IPC调用需要后端服务
- 测试环境可能没有运行后端服务

**解决方案：**
✅ 已修复 - 使用 `project:create-quick` 替代 `project:create`

`project:create-quick` 不依赖后端，直接创建本地项目。

### 3. 错误容器未显示

**问题描述：**

- 导航到不存在的项目时，错误容器 `[data-testid="error-container"]` 未显示
- 可能是因为路由守卫拦截导致页面根本没有加载

**解决方案：**
需要先解决登录问题后再验证。

## 运行测试

### 前置条件

1. 构建主进程：

```bash
cd desktop-app-vue
npm run build:main
```

2. 确保没有运行的Electron实例

### 运行所有测试

```bash
npx playwright test
```

### 运行特定测试文件

```bash
# 基础测试（当前可运行）
npx playwright test project-detail-basic.e2e.test.ts

# 核心测试（需要先解决登录问题）
npx playwright test project-detail-core.e2e.test.ts

# 综合测试（需要先解决登录问题）
npx playwright test project-detail-comprehensive.e2e.test.ts
```

### 调试测试

```bash
# 使用Playwright UI模式
npx playwright test --ui

# 显示浏览器窗口
npx playwright test --headed

# 生成trace
npx playwright test --trace on
```

### 查看测试报告

```bash
npx playwright show-report
```

### 查看trace

```bash
npx playwright show-trace test-results/xxx/trace.zip
```

## 测试覆盖范围

### ✅ 已覆盖（准备就绪）

1. **测试ID** - 所有关键元素已添加 data-testid
2. **辅助函数** - 21个辅助函数已实现
3. **测试用例** - 30个测试用例已编写
4. **错误处理** - 包含失败场景测试

### ⏳ 待解决（阻塞测试执行）

1. **登录流程** - 需要添加登录支持
2. **路由守卫** - 需要测试模式配置

### 🔄 待验证（解决登录后）

1. **错误页面显示**
2. **文件操作完整流程**
3. **AI对话功能**
4. **Git操作**

## 后续步骤

### 短期（必需）

1. **实现登录辅助函数**
   - 在 `helpers.ts` 中添加 `login()` 函数
   - 为登录页面添加测试ID
   - 添加测试模式的登录跳过机制

2. **更新测试文件**
   - 在所有测试开始前调用 `login()`
   - 验证登录成功后再执行测试

3. **运行并调试所有测试**
   - 修复发现的问题
   - 更新测试用例

### 中期（建议）

1. **扩展测试覆盖**
   - 文件上传功能
   - 拖拽文件
   - 键盘快捷键

2. **性能测试**
   - 大文件加载
   - 大量文件的文件树渲染
   - AI响应时间

3. **集成测试**
   - 与后端服务集成
   - 数据库操作验证
   - Git操作验证

### 长期（优化）

1. **CI/CD集成**
   - 自动运行测试
   - 测试报告生成
   - 失败通知

2. **视觉回归测试**
   - 截图对比
   - UI一致性检查

3. **测试数据管理**
   - 测试fixtures
   - 数据清理脚本

## 测试最佳实践

1. **使用data-testid而非class或id**
   - ✅ `[data-testid="save-button"]`
   - ❌ `.ant-btn-primary`

2. **等待元素出现后再操作**
   - 使用 `waitForSelector()` 而非固定时间
   - 设置合理的超时时间

3. **独立的测试用例**
   - 每个测试应该能独立运行
   - 不依赖其他测试的状态

4. **清理测试数据**
   - 测试后删除创建的项目和文件
   - 避免测试数据累积

5. **有意义的错误信息**
   - 使用 `console.log()` 记录关键步骤
   - 截图保存失败状态

## 示例：添加新测试

```typescript
import { test, expect } from "@playwright/test";
import { launchElectronApp, closeElectronApp, login } from "./helpers";
import {
  createAndOpenProject,
  sendChatMessage,
} from "./project-detail-helpers";

test("新功能测试", async () => {
  const { app, window } = await launchElectronApp();

  try {
    // 1. 登录
    await login(window, { skipLogin: true });

    // 2. 创建并打开项目
    const project = await createAndOpenProject(window, {
      name: "测试项目",
      project_type: "markdown",
    });

    // 3. 执行测试操作
    await sendChatMessage(window, "测试消息");

    // 4. 验证结果
    const messages = await window.textContent('[data-testid="messages-list"]');
    expect(messages).toContain("测试消息");
  } finally {
    await closeElectronApp(app);
  }
});
```

## 相关文档

- [Playwright文档](https://playwright.dev/)
- [Electron测试指南](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [项目详情页组件](../src/renderer/pages/projects/ProjectDetailPage.vue)
- [聊天面板组件](../src/renderer/components/projects/ChatPanel.vue)

## 贡献

如果发现问题或有改进建议，请：

1. 在测试失败时查看screenshot和trace
2. 更新相关测试用例
3. 提交Pull Request

## 总结

本次E2E测试实现为项目详情页提供了全面的测试覆盖：

- ✅ **30个测试用例**覆盖核心功能
- ✅ **40+个测试ID**确保元素可定位
- ✅ **21个辅助函数**简化测试编写
- ⏳ **登录流程**需要实现后才能运行测试

**下一步最重要的工作是实现登录辅助功能，解除测试阻塞。**
