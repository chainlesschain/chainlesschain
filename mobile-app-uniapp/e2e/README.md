# E2E 测试指南

本文档介绍如何在 ChainlessChain 移动端应用中运行和编写 E2E（端到端）测试。

## 技术栈

- **测试框架**: [Playwright](https://playwright.dev/) - 现代化的跨浏览器自动化测试框架
- **测试目标**: uni-app H5 模式（Web 版本）
- **支持设备**: Mobile Chrome (Pixel 5)、Mobile Safari (iPhone 12)、Desktop Chrome

## 快速开始

### 1. 安装依赖

```bash
cd mobile-app-uniapp
npm install
```

### 2. 安装 Playwright 浏览器

```bash
npm run test:e2e:install
```

### 3. 运行 E2E 测试

```bash
# 运行所有 E2E 测试（自动启动开发服务器）
npm run test:e2e

# 使用 UI 模式运行（推荐用于调试）
npm run test:e2e:ui

# 有头模式运行（可以看到浏览器操作）
npm run test:e2e:headed

# 调试模式
npm run test:e2e:debug

# 查看测试报告
npm run test:e2e:report
```

## 目录结构

```
mobile-app-uniapp/
├── e2e/                          # E2E 测试目录
│   ├── fixtures/                 # 测试数据
│   │   └── test-data.js          # 测试用的模拟数据
│   ├── utils/                    # 工具函数
│   │   └── helpers.js            # 常用操作辅助函数
│   ├── app.e2e.js               # 应用基础功能测试
│   ├── knowledge.e2e.js         # 知识库功能测试
│   ├── chat.e2e.js              # AI 聊天功能测试
│   ├── projects.e2e.js          # 项目管理功能测试
│   ├── auth.e2e.js              # 用户认证功能测试
│   ├── settings.e2e.js          # 设置功能测试
│   └── social.e2e.js            # 社交功能测试
├── playwright.config.js          # Playwright 配置文件
└── package.json                  # 包含 E2E 测试脚本
```

## 测试用例覆盖

### 应用基础功能 (`app.e2e.js`)
- 应用加载和首页显示
- TabBar 导航
- 页面返回操作
- 深度链接支持
- 响应式布局

### 知识库功能 (`knowledge.e2e.js`)
- 知识列表显示
- 下拉刷新
- 搜索功能
- 创建/编辑知识
- 知识详情查看
- 标签功能
- 文件夹管理

### AI 聊天功能 (`chat.e2e.js`)
- 聊天界面显示
- 消息输入和发送
- 消息列表排序
- 聊天历史保持
- 项目 AI 助手

### 项目管理功能 (`projects.e2e.js`)
- 项目列表显示
- 创建项目
- 项目详情
- 项目模板和市场

### 用户认证功能 (`auth.e2e.js`)
- 登录页面
- PIN 码设置和验证
- 生物识别设置
- 会话管理

### 设置功能 (`settings.e2e.js`)
- 我的页面
- 设置页面
- 主题和语言设置
- 数据备份
- 云同步设置
- 身份管理
- 设备配对

### 社交功能 (`social.e2e.js`)
- 好友列表
- 动态/帖子
- 消息中心
- 好友聊天

## 编写新测试

### 基本结构

```javascript
import { test, expect } from '@playwright/test';
import { waitForPageLoad, navigateTo, clearStorage } from './utils/helpers.js';
import { routes } from './fixtures/test-data.js';

test.describe('功能模块名称', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
  });

  test('测试用例描述', async ({ page }) => {
    await navigateTo(page, routes.targetPage);

    // 执行操作
    const element = page.locator('.target-element');
    await element.click();

    // 断言
    await expect(element).toBeVisible();
  });
});
```

### 常用辅助函数

```javascript
import {
  waitForPageLoad,     // 等待页面加载完成
  waitForToast,        // 等待 Toast 消息
  waitForLoadingHidden, // 等待 Loading 消失
  clickTabBar,         // 点击 TabBar
  navigateTo,          // 导航到指定页面
  pullDownRefresh,     // 下拉刷新
  scrollToBottom,      // 滚动到底部
  clearStorage,        // 清除本地存储
  setStorage,          // 设置本地存储
  getStorage,          // 获取本地存储
} from './utils/helpers.js';
```

### 测试数据

```javascript
import {
  testUser,           // 测试用户数据
  testKnowledge,      // 测试知识条目
  testProject,        // 测试项目数据
  testChatMessages,   // 测试聊天消息
  routes,             // 页面路径常量
  selectors,          // 选择器常量
} from './fixtures/test-data.js';
```

## 配置说明

### Playwright 配置 (`playwright.config.js`)

```javascript
{
  // 测试目录
  testDir: './e2e',

  // 测试文件匹配模式
  testMatch: '**/*.e2e.js',

  // 基础 URL
  use: {
    baseURL: 'http://localhost:8080',
  },

  // 开发服务器
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:8080',
  },
}
```

### 测试项目（设备模拟）

- **Mobile Chrome**: Pixel 5 设备模拟
- **Mobile Safari**: iPhone 12 设备模拟
- **Desktop Chrome**: 1280x720 视口

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd mobile-app-uniapp
          npm ci

      - name: Install Playwright browsers
        run: |
          cd mobile-app-uniapp
          npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: |
          cd mobile-app-uniapp
          npm run test:e2e

      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-report
          path: mobile-app-uniapp/e2e-report/
```

## 最佳实践

### 1. 使用 data-testid 属性

在组件中添加 `data-testid` 属性以便于定位：

```html
<button data-testid="submit-btn">提交</button>
```

```javascript
const button = page.getByTestId('submit-btn');
```

### 2. 等待元素状态

```javascript
// 等待可见
await expect(element).toBeVisible();

// 等待隐藏
await expect(element).toBeHidden();

// 等待有特定文本
await expect(element).toHaveText('预期文本');
```

### 3. 处理动态内容

```javascript
// 等待网络请求完成
await page.waitForLoadState('networkidle');

// 等待特定请求
await page.waitForResponse(resp =>
  resp.url().includes('/api/data') && resp.status() === 200
);
```

### 4. 截图和调试

```javascript
// 手动截图
await page.screenshot({ path: 'debug.png' });

// 暂停调试
await page.pause();
```

## 故障排除

### 测试超时

增加超时时间：

```javascript
test('长时间操作', async ({ page }) => {
  test.setTimeout(120000); // 2 分钟
  // ...
});
```

### 元素定位失败

使用 Playwright UI 模式查看页面结构：

```bash
npm run test:e2e:ui
```

### 开发服务器启动失败

手动启动开发服务器后运行测试：

```bash
# 终端 1
npm run dev:h5

# 终端 2
npx playwright test --headed
```

## 相关资源

- [Playwright 官方文档](https://playwright.dev/docs/intro)
- [uni-app 官方文档](https://uniapp.dcloud.io/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
