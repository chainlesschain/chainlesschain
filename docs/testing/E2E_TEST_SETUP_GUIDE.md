# E2E测试环境配置指南

**日期**: 2026-01-03
**状态**: ✅ 配置完成
**框架**: Playwright + Electron

---

## 配置摘要

为IPC API创建了完整的E2E测试环境，使用Playwright测试框架在真实Electron环境中验证62个新增API。

### 已完成工作

| 组件 | 文件 | 状态 |
|------|------|------|
| Playwright配置 | playwright.config.ts | ✅ |
| E2E测试辅助工具 | tests/e2e/helpers.ts | ✅ |
| 完整E2E测试 | tests/e2e/ipc-api.e2e.test.ts | ✅ |
| 快速E2E测试 | tests/e2e/simple-api.e2e.test.ts | ✅ |

---

## 文件说明

### 1. playwright.config.ts

**位置**: `/playwright.config.ts`
**用途**: Playwright测试框架配置

**关键配置**:
```typescript
{
  testDir: './tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: ['html', 'json', 'list'],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  }
}
```

**特性**:
- ✅ 支持失败重试
- ✅ 自动截图和录像
- ✅ HTML报告生成
- ✅ CI/CD友好配置

### 2. tests/e2e/helpers.ts

**位置**: `/tests/e2e/helpers.ts`
**用途**: E2E测试辅助工具函数

**导出函数**:

```typescript
// 启动Electron应用
export async function launchElectronApp(): Promise<ElectronTestContext>

// 关闭Electron应用
export async function closeElectronApp(app: ElectronApplication): Promise<void>

// 调用IPC API
export async function callIPC<T>(
  window: Page,
  apiPath: string,
  ...args: any[]
): Promise<T>

// 等待IPC响应
export async function waitForIPC(window: Page, timeout?: number): Promise<void>

// 截图保存
export async function takeScreenshot(window: Page, name: string): Promise<void>
```

**使用示例**:
```typescript
const { app, window } = await launchElectronApp();
const result = await callIPC(window, 'system.getSystemInfo');
await closeElectronApp(app);
```

### 3. tests/e2e/ipc-api.e2e.test.ts

**位置**: `/tests/e2e/ipc-api.e2e.test.ts`
**用途**: 完整的IPC API E2E测试

**测试覆盖**:
- ✅ System API (3个测试)
- ✅ Git Sync API (1个测试)
- ✅ Notification API (2个测试)
- ✅ Knowledge API (2个测试)
- ✅ Social API (2个测试)
- ✅ Window Control (2个测试)

**总测试数**: 12个E2E测试

### 4. tests/e2e/simple-api.e2e.test.ts

**位置**: `/tests/e2e/simple-api.e2e.test.ts`
**用途**: 快速E2E验证测试

**测试覆盖**:
- ✅ System APIs (3个API)
- ✅ Git API (1个API)
- ✅ Notification API (1个API)

**特点**: 快速执行，适合冒烟测试

---

## 运行E2E测试

### 前置条件

1. **构建应用**:
```bash
cd desktop-app-vue
npm run build:main
```

2. **确认Playwright已安装**:
```bash
npm list @playwright/test
```

3. **安装Playwright浏览器** (如果首次运行):
```bash
npx playwright install
```

### 运行测试

#### 方法1: 运行所有E2E测试

```bash
# 运行所有E2E测试
npm run test:e2e

# 或直接使用playwright
npx playwright test
```

#### 方法2: 运行特定测试文件

```bash
# 运行快速测试
npx playwright test tests/e2e/simple-api.e2e.test.ts

# 运行完整测试
npx playwright test tests/e2e/ipc-api.e2e.test.ts
```

#### 方法3: 使用UI模式运行（推荐）

```bash
# 打开Playwright UI
npm run test:e2e:ui

# 或
npx playwright test --ui
```

#### 方法4: 调试模式

```bash
# 调试模式运行
npx playwright test --debug

# 针对特定测试
npx playwright test tests/e2e/simple-api.e2e.test.ts --debug
```

### 查看测试报告

```bash
# 生成HTML报告
npx playwright show-report

# 报告位置
# test-results/html/index.html
```

---

## 测试示例

### 示例1: 测试System API

```typescript
import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

test('should get system info', async () => {
  const { app, window } = await launchElectronApp();

  try {
    const result = await callIPC(window, 'system.getSystemInfo');

    expect(result.success).toBe(true);
    expect(result.platform).toBeDefined();
    expect(result.arch).toBeDefined();
  } finally {
    await closeElectronApp(app);
  }
});
```

### 示例2: 测试Git API

```typescript
test('should get git sync status', async () => {
  const { app, window } = await launchElectronApp();

  try {
    const result = await callIPC(window, 'git.getSyncStatus');

    expect(result).toBeDefined();
    expect(typeof result.enabled).toBe('boolean');
  } finally {
    await closeElectronApp(app);
  }
});
```

### 示例3: 测试Knowledge API

```typescript
test('should list knowledge contents', async () => {
  const { app, window } = await launchElectronApp();

  try {
    const result = await callIPC(window, 'knowledge.listContents', { limit: 5 });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.contents)).toBe(true);
  } finally {
    await closeElectronApp(app);
  }
});
```

---

## E2E测试覆盖计划

### 已实现 (12个测试)

#### System API (3个测试)
- ✅ getSystemInfo
- ✅ getPlatform
- ✅ getAppInfo

#### Git Sync API (1个测试)
- ✅ getSyncStatus

#### Notification API (2个测试)
- ✅ getUnreadCount
- ✅ getAll

#### Knowledge API (2个测试)
- ✅ getTags
- ✅ listContents

#### Social API (2个测试)
- ✅ getAllContacts
- ✅ getContactStatistics

#### Window Control (2个测试)
- ✅ getWindowState
- ✅ maximize/unmaximize toggle

### 待扩展 (50个API)

可以逐步添加以下API的E2E测试：

#### Knowledge API (15个)
- createContent
- updateContent
- deleteContent
- getContent
- getVersionHistory
- restoreVersion
- compareVersions
- purchaseContent
- subscribe
- unsubscribe
- getMyPurchases
- getMySubscriptions
- accessContent
- checkAccess
- getStatistics

#### System API (13个)
- minimize
- close
- restart
- quit
- setAlwaysOnTop
- getVersion
- getPath
- openExternal
- showItemInFolder
- selectDirectory
- selectFile
- getWindowState (已有)
- maximize (已有)

#### Social API (16个)
- addContact
- addContactFromQR
- getContact
- updateContact
- deleteContact
- searchContacts
- getFriends
- sendFriendRequest
- acceptFriendRequest
- rejectFriendRequest
- getPendingFriendRequests
- getFriendsByGroup
- removeFriend
- updateFriendNickname
- updateFriendGroup
- getFriendStatistics

#### Notification API (3个)
- markRead
- markAllRead
- sendDesktop

#### PDF API (4个)
- markdownToPDF
- htmlFileToPDF
- textFileToPDF
- batchConvert

#### Document API (1个)
- exportPPT

---

## CI/CD集成

### GitHub Actions示例

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: |
          cd desktop-app-vue
          npm run build:main

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: test-results/
          retention-days: 30
```

---

## 故障排除

### 问题1: Electron无法启动

**症状**: `Error: Electron failed to start`

**解决方案**:
```bash
# 1. 确认应用已构建
cd desktop-app-vue && npm run build:main

# 2. 检查dist目录存在
ls -la desktop-app-vue/dist/main/index.js

# 3. 尝试手动启动应用
npm run dev
```

### 问题2: IPC API未定义

**症状**: `API path not found: system.getSystemInfo`

**解决方案**:
```bash
# 1. 检查preload.js是否包含API
grep "getSystemInfo" desktop-app-vue/src/preload/index.js

# 2. 确认主进程注册了handler
grep "system:get-system-info" desktop-app-vue/src/main/system/system-ipc.js

# 3. 检查应用是否完全加载
# 在测试中添加等待逻辑
await window.waitForFunction(() => window.electronAPI !== undefined);
```

### 问题3: 测试超时

**症状**: `Test timeout of 30000ms exceeded`

**解决方案**:
```typescript
// 增加测试超时时间
test('long running test', async () => {
  test.setTimeout(60000); // 60秒
  // ...
});

// 或在playwright.config.ts中全局设置
timeout: 60000,
```

### 问题4: 截图/视频未生成

**解决方案**:
```typescript
// 确认配置正确
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},

// 手动截图
await window.screenshot({ path: 'debug.png' });
```

---

## 性能优化

### 1. 减少应用启动次数

```typescript
// 不推荐：每个测试都启动应用
test('test 1', async () => {
  const { app, window } = await launchElectronApp();
  // ...
  await closeElectronApp(app);
});

// 推荐：使用beforeAll和afterAll
test.describe('System API', () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
  });

  test('test 1', async () => {
    // 复用同一个应用实例
  });
});
```

### 2. 并行运行测试

```bash
# 使用多个worker
npx playwright test --workers=4

# 或在配置中设置
workers: 4,
```

### 3. 使用测试夹具

```typescript
// tests/e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { launchElectronApp } from './helpers';

export const test = base.extend({
  electronApp: async ({}, use) => {
    const { app, window } = await launchElectronApp();
    await use({ app, window });
    await app.close();
  },
});

// 使用
test('my test', async ({ electronApp }) => {
  const { window } = electronApp;
  // ...
});
```

---

## 最佳实践

### 1. 测试隔离

- ✅ 每个测试应该独立，不依赖其他测试
- ✅ 使用beforeEach清理状态
- ✅ 不要在测试间共享可变状态

### 2. 错误处理

```typescript
test('should handle errors gracefully', async () => {
  const { app, window } = await launchElectronApp();

  try {
    const result = await callIPC(window, 'system.getSystemInfo');
    expect(result.success).toBe(true);
  } catch (error) {
    await takeScreenshot(window, 'error-state');
    throw error;
  } finally {
    await closeElectronApp(app);
  }
});
```

### 3. 有意义的断言

```typescript
// 不推荐
expect(result).toBeTruthy();

// 推荐
expect(result).toHaveProperty('success', true);
expect(result.platform).toMatch(/darwin|win32|linux/);
```

### 4. 测试文档化

```typescript
test('should get system info including platform, arch, and version', async () => {
  // 清晰描述测试目的
  // ...
});
```

---

## 测试覆盖率目标

| API模块 | 总API数 | E2E测试数 | 覆盖率 | 状态 |
|---------|---------|-----------|--------|------|
| Knowledge | 17 | 2 | 12% | ⏳ 待扩展 |
| System | 16 | 3 | 19% | ⏳ 待扩展 |
| Social | 18 | 2 | 11% | ⏳ 待扩展 |
| Notification | 5 | 2 | 40% | ⏳ 待扩展 |
| PDF | 4 | 0 | 0% | ⏳ 待添加 |
| Document | 1 | 0 | 0% | ⏳ 待添加 |
| Git | 1 | 1 | 100% | ✅ 完成 |
| **总计** | **62** | **12** | **19%** | **⏳ 进行中** |

**目标**: 逐步提升至70%+ E2E覆盖率

---

## 总结

### 已完成 ✅

1. ✅ 创建Playwright配置文件
2. ✅ 编写E2E测试辅助工具
3. ✅ 实现12个E2E测试用例
4. ✅ 提供详细的使用指南

### 当前状态

- **E2E框架**: ✅ 完全配置
- **测试覆盖**: 19% (12/62 APIs)
- **文档**: ✅ 完整

### 下一步

1. ⏳ 构建应用 (`npm run build:main`)
2. ⏳ 运行E2E测试验证
3. ⏳ 逐步扩展测试覆盖至70%+
4. ⏳ 集成到CI/CD流程

---

**文档版本**: 1.0
**最后更新**: 2026-01-03
**维护者**: ChainlessChain Team
