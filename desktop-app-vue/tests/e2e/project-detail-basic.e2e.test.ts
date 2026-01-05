/**
 * E2E测试 - 项目详情页基础测试（简化版）
 * 用于调试和验证基本功能
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC, login } from './helpers';

test.describe('项目详情页 - 基础功能验证', () => {
  test('验证应用启动和基本UI', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] Step 1: 验证应用已启动');
      const url = await window.evaluate(() => window.location.href);
      console.log('[Test] 当前URL:', url);

      // 登录
      console.log('[Test] Step 1.5: 执行登录');
      await login(window);
      await window.waitForTimeout(1000);

      // 截图查看当前状态
      await window.screenshot({ path: 'test-results/00-app-started.png' });

      console.log('[Test] Step 2: 等待主页面加载');
      await window.waitForLoadState('domcontentloaded', { timeout: 10000 });

      // 检查body是否存在
      const body = await window.$('body');
      expect(body).toBeTruthy();

      await window.screenshot({ path: 'test-results/01-dom-loaded.png' });

      console.log('[Test] Step 3: 查找项目列表页面元素');
      // 尝试查找项目列表相关元素
      const projectsPage = await window.$('.projects-page, [class*="project"]');
      if (projectsPage) {
        console.log('[Test] ✓ 找到项目列表页面');
        await window.screenshot({ path: 'test-results/02-projects-page-found.png' });
      } else {
        console.log('[Test] ✗ 未找到项目列表页面，查看当前DOM');
        const htmlContent = await window.evaluate(() => document.body.innerHTML);
        console.log('[Test] Body HTML (first 500 chars):', htmlContent.substring(0, 500));
        await window.screenshot({ path: 'test-results/02-no-projects-page.png' });
      }

      console.log('[Test] Step 4: 创建测试项目（快速创建）');
      const project = await callIPC(window, 'project:create-quick', {
        name: '基础测试项目',
        description: '用于测试的项目',
        project_type: 'markdown',
      });

      console.log('[Test] 项目创建结果:', project);
      expect(project).toBeTruthy();
      expect(project.id).toBeTruthy();

      await window.screenshot({ path: 'test-results/03-project-created.png' });

      console.log('[Test] Step 5: 导航到项目详情页');
      console.log('[Test] 目标URL:', `#/projects/${project.id}`);

      await window.evaluate((projectId) => {
        console.log('[Page] Navigating to:', `#/projects/${projectId}`);
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      // 等待导航完成
      await window.waitForTimeout(3000);

      const newUrl = await window.evaluate(() => window.location.href);
      console.log('[Test] 导航后URL:', newUrl);

      await window.screenshot({ path: 'test-results/04-navigated-to-detail.png' });

      console.log('[Test] Step 6: 检查页面内容');
      const htmlAfterNav = await window.evaluate(() => document.body.innerHTML);
      console.log('[Test] Page HTML (first 1000 chars):', htmlAfterNav.substring(0, 1000));

      // 检查是否有data-testid属性的元素
      const testIdElements = await window.$$('[data-testid]');
      console.log(`[Test] 找到 ${testIdElements.length} 个带data-testid的元素`);

      for (const el of testIdElements.slice(0, 10)) {
        const testId = await el.getAttribute('data-testid');
        console.log(`[Test]   - [data-testid="${testId}"]`);
      }

      await window.screenshot({ path: 'test-results/05-detail-page-state.png' });

      console.log('[Test] ✅ 基础测试完成');
    } catch (error) {
      console.error('[Test] ❌ 测试失败:', error);
      await window.screenshot({ path: 'test-results/99-error.png' });
      throw error;
    } finally {
      await closeElectronApp(app);
    }
  });
});
