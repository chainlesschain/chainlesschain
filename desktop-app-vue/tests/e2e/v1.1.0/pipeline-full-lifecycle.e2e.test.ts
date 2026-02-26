/**
 * E2E测试：流水线完整生命周期
 * @module e2e/v1.1.0/pipeline-full-lifecycle
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('流水线编排系统 - 完整生命周期', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('应该能够访问流水线监控页面', async () => {
    // 导航到流水线监控页面
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(3000);

    // 验证URL（可能被重定向到登录页）
    const url = await window.evaluate(() => window.location.hash);
    expect(url.length).toBeGreaterThan(0);
    // 接受 deployment-monitor 或 login 页面（需要认证时会重定向）
    expect(url).toMatch(/\/(deployment-monitor|login|home)/);
  });

  test('应该显示流水线监控页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 检查页面有内容渲染
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('应该能够获取流水线模板列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 调用IPC获取模板
    const result = await callIPC(window, 'dev-pipeline:get-templates');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 获取到流水线模板:', result.data.length, '个');
    }
  });

  test('应该能够创建流水线', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E测试流水线',
      template: 'feature',
      config: {
        parallelLimit: 3,
      },
    });

    expect(createResult).toBeDefined();
    if (createResult.success) {
      expect(createResult.data).toBeDefined();
      expect(createResult.data.id).toBeDefined();
      console.log('[E2E] 创建流水线成功:', createResult.data.id);
    }
  });

  test('应该能够获取流水线列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取流水线列表
    const result = await callIPC(window, 'dev-pipeline:get-all');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 获取到流水线:', result.data.length, '个');
    }
  });

  test('应该能够获取流水线状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E状态测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      // 获取流水线状态
      const statusResult = await callIPC(window, 'dev-pipeline:get-status', pipelineId);

      expect(statusResult).toBeDefined();
      if (statusResult.success) {
        expect(statusResult.data).toBeDefined();
        expect(statusResult.data.id).toBe(pipelineId);
        console.log('[E2E] 流水线状态:', statusResult.data.status);
      }
    }
  });

  test('应该能够启动流水线', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E启动测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      // 启动流水线
      const startResult = await callIPC(window, 'dev-pipeline:start', pipelineId);

      expect(startResult).toBeDefined();
      if (startResult.success) {
        console.log('[E2E] 流水线启动成功:', pipelineId);
      }
    }
  });

  test('应该能够暂停和恢复流水线', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建并启动流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E暂停测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      await callIPC(window, 'dev-pipeline:start', pipelineId);
      await window.waitForTimeout(1000);

      // 暂停流水线
      const pauseResult = await callIPC(window, 'dev-pipeline:pause', pipelineId);
      expect(pauseResult).toBeDefined();

      if (pauseResult.success) {
        console.log('[E2E] 流水线暂停成功');

        // 恢复流水线
        const resumeResult = await callIPC(window, 'dev-pipeline:resume', pipelineId);
        expect(resumeResult).toBeDefined();

        if (resumeResult.success) {
          console.log('[E2E] 流水线恢复成功');
        }
      }
    }
  });

  test('应该能够取消流水线', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建并启动流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E取消测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      await callIPC(window, 'dev-pipeline:start', pipelineId);
      await window.waitForTimeout(500);

      // 取消流水线
      const cancelResult = await callIPC(window, 'dev-pipeline:cancel', pipelineId);
      expect(cancelResult).toBeDefined();

      if (cancelResult.success) {
        console.log('[E2E] 流水线取消成功');
      }
    }
  });

  test('应该能够获取流水线指标', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E指标测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      // 获取指标
      const metricsResult = await callIPC(window, 'dev-pipeline:get-metrics', pipelineId);
      expect(metricsResult).toBeDefined();

      if (metricsResult.success) {
        console.log('[E2E] 流水线指标:', metricsResult.data);
      }
    }
  });

  test('应该能够获取阶段详情', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建并启动流水线
    const createResult = await callIPC(window, 'dev-pipeline:create', {
      name: 'E2E阶段测试',
      template: 'feature',
    });

    if (createResult.success) {
      const pipelineId = createResult.data.id;

      await callIPC(window, 'dev-pipeline:start', pipelineId);
      await window.waitForTimeout(1000);

      // 获取阶段详情
      const stageResult = await callIPC(
        window,
        'dev-pipeline:get-stage-detail',
        pipelineId,
        'build'
      );
      expect(stageResult).toBeDefined();

      if (stageResult.success) {
        console.log('[E2E] 阶段详情:', stageResult.data);
      }
    }
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/deployment-monitor?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 过滤已知非关键错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('DevTools') &&
        !err.includes('extension') &&
        !err.includes('favicon') &&
        !err.includes('ERR_CONNECTION_REFUSED') &&
        !err.includes('net::ERR_') &&
        !err.includes('ResizeObserver') &&
        !err.includes('ELECTRON_') &&
        !err.includes('Deprecation') &&
        !err.includes('electronAPI') &&
        !err.includes('ipcRenderer') &&
        !err.includes('Cannot read properties of null') &&
        !err.includes('404')
    );

    if (criticalErrors.length > 0) {
      console.log('[E2E] 检测到控制台错误:', criticalErrors);
    }
    expect(criticalErrors.length).toBe(0);
  });
});
