# 新增菜单项 E2E 测试文档

## 概述

本目录包含 ChainlessChain v0.26.2 新增菜单项的端到端（E2E）测试。

**修改日期**: 2026-01-26
**版本**: v0.26.2
**测试框架**: Playwright

## 背景

在 v0.26.2 版本中，虽然后端功能已经完整实现，但许多关键功能未暴露到用户界面菜单中，导致用户无法通过UI访问这些功能。

本次菜单集成工作解决了这个问题，新增了 **14 个菜单项**，涵盖：

### 1. 监控与诊断功能 (6项)

| 菜单项 | 路由 | 功能描述 |
|--------|------|----------|
| LLM性能监控 | `/llm/performance` | Token使用、成本分析、性能监控 |
| 错误监控 | `/error/monitor` | AI驱动的错误诊断与自动修复 |
| 会话管理 | `/sessions` | 智能会话上下文管理，自动压缩30-40% |
| 内存仪表板 | `/memory` | Memory Bank系统状态监控 |
| 标签管理 | `/tags` | 标签系统管理 |
| 数据库性能监控 | `/database/performance` | SQLite性能监控与优化 |

### 2. MCP和AI配置 (2项)

| 菜单项 | 路由 | 功能描述 |
|--------|------|----------|
| MCP服务器 | `/settings?tab=mcp` | Model Context Protocol服务器配置 |
| Token使用统计 | `/settings?tab=token-usage` | Token使用详细统计 |

### 3. P2P高级功能 (6项)

| 菜单项 | 路由 | 功能描述 |
|--------|------|----------|
| 设备配对 | `/p2p/device-pairing` | 设备间安全配对 |
| 设备管理 | `/p2p/device-management` | 已配对设备管理 |
| 文件传输 | `/p2p/file-transfer` | P2P文件传输 |
| 安全号码验证 | `/p2p/safety-numbers` | Signal协议安全验证 |
| 会话指纹 | `/p2p/session-fingerprint` | 加密会话指纹验证 |
| 消息队列 | `/p2p/message-queue` | P2P消息队列管理 |

## 测试文件结构

```
tests/e2e/menu/
├── new-menu-items.e2e.test.ts   # 主测试文件
├── run-menu-tests.sh            # Linux/macOS运行脚本
├── run-menu-tests.bat           # Windows运行脚本
└── README.md                    # 本文档
```

## 测试覆盖

### 测试用例总览

| 测试分组 | 测试用例数 | 描述 |
|----------|-----------|------|
| 监控与诊断 | 6 | 验证6个监控诊断页面可访问 |
| MCP和AI配置 | 2 | 验证MCP和Token统计页面 |
| P2P高级功能 | 6 | 验证6个P2P功能页面 |
| 菜单集成完整性 | 1 | 验证所有菜单项已注册 |
| **总计** | **15** | - |

### 每个测试用例验证内容

1. ✅ 菜单项在侧边栏可见
2. ✅ 菜单项可点击
3. ✅ 点击后正确导航到目标页面
4. ✅ URL哈希正确
5. ✅ 页面基本元素已加载
6. ✅ 截图保存（用于回归测试）

## 如何运行测试

### 前提条件

1. **已安装依赖**:
   ```bash
   cd desktop-app-vue
   npm install
   ```

2. **主进程已构建**:
   ```bash
   npm run build:main
   ```

3. **Playwright已配置**:
   ```bash
   npx playwright install
   ```

### 运行方式

#### 方式 1: 使用运行脚本（推荐）

**Windows**:
```batch
cd desktop-app-vue\tests\e2e\menu
run-menu-tests.bat
```

**Linux/macOS**:
```bash
cd desktop-app-vue/tests/e2e/menu
chmod +x run-menu-tests.sh
./run-menu-tests.sh
```

#### 方式 2: 直接使用 Playwright

```bash
cd desktop-app-vue

# 运行所有菜单测试（有界面模式）
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts --headed

# 无界面模式（更快）
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts

# 运行特定测试分组
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts -g "监控与诊断"
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts -g "P2P高级功能"
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts -g "MCP和AI配置"

# 调试模式
npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts --debug
```

### 查看测试报告

```bash
# 生成HTML报告
npx playwright show-report

# 查看测试截图
ls -la test-results/
```

## 测试环境

- **操作系统**: Windows 10/11, macOS, Linux
- **Node.js**: >=18.0.0
- **Electron**: 39.2.6
- **Playwright**: 最新版
- **测试模式**:
  - `NODE_ENV=test`
  - `MOCK_HARDWARE=true` (模拟U-Key等硬件)
  - `MOCK_LLM=true` (模拟LLM服务)

## 预期结果

### 成功场景

```
✅ 新增菜单项 - 监控与诊断
  ✓ 应该能够访问LLM性能监控页面 (3.2s)
  ✓ 应该能够访问错误监控页面 (2.8s)
  ✓ 应该能够访问会话管理页面 (2.5s)
  ✓ 应该能够访问内存仪表板页面 (2.6s)
  ✓ 应该能够访问标签管理页面 (2.4s)
  ✓ 应该能够访问数据库性能监控页面 (2.7s)

✅ 新增菜单项 - MCP和AI配置
  ✓ 应该能够访问MCP服务器配置页面 (2.3s)
  ✓ 应该能够访问Token使用统计页面 (2.2s)

✅ 新增菜单项 - P2P高级功能
  ✓ 应该能够访问设备配对页面 (2.9s)
  ✓ 应该能够访问设备管理页面 (2.6s)
  ✓ 应该能够访问文件传输页面 (2.7s)
  ✓ 应该能够访问安全号码验证页面 (2.5s)
  ✓ 应该能够访问会话指纹页面 (2.4s)
  ✓ 应该能够访问消息队列页面 (2.8s)

✅ 菜单集成完整性测试
  ✓ 所有新增菜单项应该在菜单配置中正确注册 (1.5s)

15 passed (45.2s)
```

## 常见问题

### Q1: 测试启动失败

**问题**: `Error: Cannot find module 'concurrently'`

**解决**:
```bash
cd desktop-app-vue
npm install
```

### Q2: 菜单项未找到

**问题**: 测试报告显示某些菜单项未找到

**可能原因**:
1. DOM未完全加载 → 增加等待时间
2. 菜单折叠状态 → 检查菜单是否需要展开
3. 权限问题 → 确认用户已登录

**解决**:
```typescript
// 增加等待时间
await window.waitForTimeout(2000);

// 强制展开菜单
const menu = await window.$('text=系统设置');
await menu?.click();
```

### Q3: 截图保存位置

测试截图保存在:
```
desktop-app-vue/test-results/
  ├── llm-performance-page.png
  ├── error-monitor-page.png
  ├── session-manager-page.png
  └── ...
```

## 维护指南

### 添加新菜单项测试

1. 在 `menuConfig` 中添加新菜单项配置
2. 在 `MainLayout.vue` 中添加菜单模板
3. 在本测试文件中添加对应测试用例:

```typescript
test('应该能够访问新功能页面', async () => {
  const { app, window } = await launchElectronApp();

  try {
    await login(window);
    await window.waitForTimeout(1000);

    // 展开对应菜单
    const menu = await window.$('text=菜单分组名');
    await menu?.click();

    // 点击新菜单项
    const menuItem = await window.$('text=新功能名称');
    await menuItem?.click();
    await window.waitForTimeout(2000);

    // 验证导航
    const currentHash = await window.evaluate(() => window.location.hash);
    expect(currentHash).toContain('expected-route');

    // 验证页面元素
    const page = await window.$('.page-selector');
    expect(page).toBeTruthy();

    await takeScreenshot(window, 'new-feature-page');
  } finally {
    await closeElectronApp(app);
  }
});
```

### 更新测试超时

如果应用启动较慢，修改 `helpers/common.ts`:

```typescript
// 增加启动超时
timeout: 180000, // 3分钟
```

## 相关文档

- [主项目README](../../../../README.md)
- [E2E测试指南](../README.md)
- [菜单设计文档](../../../../docs/design/menu-structure.md)
- [v0.26.2更新日志](../../../../CHANGELOG.md)

## 联系与反馈

如果测试失败或有疑问：

1. 检查 [已知问题](#常见问题)
2. 查看测试日志和截图
3. 在GitHub提交Issue
4. 联系开发团队

---

**最后更新**: 2026-01-26
**维护者**: ChainlessChain Team
**测试状态**: ✅ 15/15 通过
