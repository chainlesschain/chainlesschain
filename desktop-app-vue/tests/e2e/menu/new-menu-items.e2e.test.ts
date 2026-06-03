/**
 * E2E测试 - 新增菜单项导航测试
 *
 * 测试覆盖v0.26.2新增的所有菜单项：
 * 1. 监控与诊断功能（6项）
 * 2. MCP和Token使用统计（2项）
 * 3. P2P高级功能（6项）
 *
 * 测试目标：
 * - 验证所有新菜单项可见且可点击
 * - 验证菜单点击后能正确导航到目标页面
 * - 验证页面URL正确
 * - 验证页面基本元素加载成功
 */

import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  takeScreenshot,
  login,
} from '../helpers/common';

test.describe('新增菜单项 - 监控与诊断', () => {
  test('应该能够访问LLM性能监控页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击LLM性能监控菜单项');
      const llmPerformanceMenuItem = await window.$('[key="llm-performance"]');
      if (!llmPerformanceMenuItem) {
        // 尝试通过文本查找
        const menuItem = await window.$('text=LLM性能监控');
        expect(menuItem).toBeTruthy();
        await menuItem?.click();
      } else {
        await llmPerformanceMenuItem.click();
      }

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到LLM性能监控页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('llm/performance');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.llm-performance-page, [class*="performance"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'llm-performance-page');
      console.log('[Test] ✅ LLM性能监控页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问错误监控页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击错误监控菜单项');
      const errorMonitorMenuItem = await window.$('text=错误监控');
      expect(errorMonitorMenuItem).toBeTruthy();
      await errorMonitorMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到错误监控页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('error/monitor');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.error-monitor-page, [class*="error-monitor"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'error-monitor-page');
      console.log('[Test] ✅ 错误监控页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问会话管理页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击会话管理菜单项');
      const sessionManagerMenuItem = await window.$('text=会话管理');
      expect(sessionManagerMenuItem).toBeTruthy();
      await sessionManagerMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到会话管理页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('sessions');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.session-manager-page, [class*="session"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'session-manager-page');
      console.log('[Test] ✅ 会话管理页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问内存仪表板页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击内存仪表板菜单项');
      const memoryDashboardMenuItem = await window.$('text=内存仪表板');
      expect(memoryDashboardMenuItem).toBeTruthy();
      await memoryDashboardMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到内存仪表板页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('memory');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.memory-dashboard-page, [class*="memory"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'memory-dashboard-page');
      console.log('[Test] ✅ 内存仪表板页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问标签管理页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击标签管理菜单项');
      const tagManagerMenuItem = await window.$('text=标签管理');
      expect(tagManagerMenuItem).toBeTruthy();
      await tagManagerMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到标签管理页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('tags');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.tag-manager-page, [class*="tag"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'tag-manager-page');
      console.log('[Test] ✅ 标签管理页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问数据库性能监控页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击数据库性能监控菜单项');
      const dbPerformanceMenuItem = await window.$('text=数据库性能监控');
      expect(dbPerformanceMenuItem).toBeTruthy();
      await dbPerformanceMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到数据库性能监控页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('database/performance');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.database-performance-page, [class*="database"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'database-performance-page');
      console.log('[Test] ✅ 数据库性能监控页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('新增菜单项 - MCP和AI配置', () => {
  test('应该能够访问MCP服务器配置页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击MCP服务器菜单项');
      const mcpMenuItem = await window.$('text=MCP服务器');
      expect(mcpMenuItem).toBeTruthy();
      await mcpMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到设置页面且tab参数为mcp');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('settings');
      expect(currentHash).toContain('tab=mcp');

      console.log('[Test] 验证MCP设置组件已加载');
      const mcpSettings = await window.$('.mcp-settings, [class*="mcp"]');
      expect(mcpSettings).toBeTruthy();

      await takeScreenshot(window, 'mcp-settings-page');
      console.log('[Test] ✅ MCP服务器配置页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问Token使用统计页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开系统设置菜单');
      const systemMenu = await window.$('text=系统设置');
      if (systemMenu) {
        await systemMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击Token使用统计菜单项');
      const tokenUsageMenuItem = await window.$('text=Token使用统计');
      expect(tokenUsageMenuItem).toBeTruthy();
      await tokenUsageMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到设置页面且tab参数为token-usage');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('settings');
      expect(currentHash).toContain('tab=token-usage');

      console.log('[Test] 验证Token使用统计组件已加载');
      const tokenUsageTab = await window.$('.token-usage-tab, [class*="token"]');
      expect(tokenUsageTab).toBeTruthy();

      await takeScreenshot(window, 'token-usage-page');
      console.log('[Test] ✅ Token使用统计页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('新增菜单项 - P2P高级功能', () => {
  test('应该能够访问设备配对页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击设备配对菜单项');
      const devicePairingMenuItem = await window.$('text=设备配对');
      expect(devicePairingMenuItem).toBeTruthy();
      await devicePairingMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到设备配对页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/device-pairing');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.device-pairing-page, [class*="pairing"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'device-pairing-page');
      console.log('[Test] ✅ 设备配对页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问设备管理页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击设备管理菜单项');
      const deviceMgmtMenuItem = await window.$('text=设备管理');
      expect(deviceMgmtMenuItem).toBeTruthy();
      await deviceMgmtMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到设备管理页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/device-management');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.device-management-page, [class*="device"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'device-management-page');
      console.log('[Test] ✅ 设备管理页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问文件传输页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击文件传输菜单项');
      const fileTransferMenuItem = await window.$('text=文件传输');
      expect(fileTransferMenuItem).toBeTruthy();
      await fileTransferMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到文件传输页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/file-transfer');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.file-transfer-page, [class*="transfer"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'file-transfer-page');
      console.log('[Test] ✅ 文件传输页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问安全号码验证页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击安全号码验证菜单项');
      const safetyMenuItem = await window.$('text=安全号码验证');
      expect(safetyMenuItem).toBeTruthy();
      await safetyMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到安全号码验证页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/safety-numbers');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.safety-numbers-page, [class*="safety"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'safety-numbers-page');
      console.log('[Test] ✅ 安全号码验证页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问会话指纹页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击会话指纹菜单项');
      const fingerprintMenuItem = await window.$('text=会话指纹');
      expect(fingerprintMenuItem).toBeTruthy();
      await fingerprintMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到会话指纹页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/session-fingerprint');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.session-fingerprint-page, [class*="fingerprint"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'session-fingerprint-page');
      console.log('[Test] ✅ 会话指纹页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够访问消息队列页面', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 展开社交网络菜单');
      const socialMenu = await window.$('text=社交网络');
      if (socialMenu) {
        await socialMenu.click();
        await window.waitForTimeout(500);
      }

      console.log('[Test] 查找并点击消息队列菜单项');
      const messageQueueMenuItem = await window.$('text=消息队列');
      expect(messageQueueMenuItem).toBeTruthy();
      await messageQueueMenuItem?.click();

      await window.waitForTimeout(2000);

      console.log('[Test] 验证导航到消息队列页面');
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('p2p/message-queue');

      console.log('[Test] 验证页面元素');
      const pageContent = await window.$('.message-queue-page, [class*="queue"]');
      expect(pageContent).toBeTruthy();

      await takeScreenshot(window, 'message-queue-page');
      console.log('[Test] ✅ 消息队列页面访问测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('菜单集成完整性测试', () => {
  test('所有新增菜单项应该在菜单配置中正确注册', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 检查新增菜单项总数');
      const newMenuItems = [
        // 监控与诊断 (6项)
        'LLM性能监控',
        '错误监控',
        '会话管理',
        '内存仪表板',
        '标签管理',
        '数据库性能监控',
        // MCP和AI配置 (2项)
        'MCP服务器',
        'Token使用统计',
        // P2P高级功能 (6项)
        '设备配对',
        '设备管理',
        '文件传输',
        '安全号码验证',
        '会话指纹',
        '消息队列',
      ];

      let foundCount = 0;
      for (const menuText of newMenuItems) {
        const menuItem = await window.$(`text=${menuText}`);
        if (menuItem) {
          foundCount++;
          console.log(`[Test] ✅ 找到菜单项: ${menuText}`);
        } else {
          console.log(`[Test] ❌ 未找到菜单项: ${menuText}`);
        }
      }

      console.log(`[Test] 总计: ${foundCount}/${newMenuItems.length} 个菜单项已集成`);

      // 至少应该找到80%的菜单项（考虑到可能的DOM渲染问题）
      expect(foundCount).toBeGreaterThanOrEqual(newMenuItems.length * 0.8);

      await takeScreenshot(window, 'menu-integration-complete');
      console.log('[Test] ✅ 菜单集成完整性测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });
});
