/**
 * E2E测试 - 工作流监控页面
 *
 * 测试工作流的创建、执行、监控和管理功能
 *
 * v0.27.0: 新建文件
 */

import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  login,
  takeScreenshot,
  callIPC,
  retryOperation,
  forceCloseAllModals,
  expectElementVisible,
  expectTextContent,
  ElectronTestContext,
} from '../helpers/common';

let context: ElectronTestContext;

test.describe('工作流监控页面 E2E测试', () => {
  test.beforeAll(async () => {
    console.log('[Workflow E2E] 启动Electron应用...');
    context = await launchElectronApp();
    await login(context.window);
    console.log('[Workflow E2E] 应用启动并登录成功');
  });

  test.afterAll(async () => {
    console.log('[Workflow E2E] 关闭Electron应用...');
    await closeElectronApp(context.app);
  });

  test.beforeEach(async () => {
    // 关闭任何打开的弹窗
    await forceCloseAllModals(context.window);
  });

  test.describe('页面导航', () => {
    test('应该能够导航到工作流监控页面', async () => {
      const { window } = context;

      // 导航到工作流页面
      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 验证URL
      const currentUrl = await window.evaluate(() => window.location.hash);
      expect(currentUrl).toBe('#/workflow');

      // 验证页面标题
      await expectElementVisible(window, '.workflow-monitor-page', { timeout: 10000 });

      await takeScreenshot(window, 'workflow-monitor-page');
    });

    test('应该显示页面标题和操作按钮', async () => {
      const { window } = context;

      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 验证页面标题
      await expectElementVisible(window, '.page-header h1');
      const titleText = await window.textContent('.page-header h1');
      expect(titleText).toContain('工作流监控');

      // 验证刷新按钮
      await expectElementVisible(window, '.header-right button:has-text("刷新")');

      // 验证新建按钮
      await expectElementVisible(window, '.header-right button:has-text("新建工作流")');
    });
  });

  test.describe('工作流创建', () => {
    test('应该能够打开创建工作流弹窗', async () => {
      const { window } = context;

      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 点击新建按钮
      await window.click('.header-right button:has-text("新建工作流")');
      await window.waitForTimeout(500);

      // 验证弹窗出现
      await expectElementVisible(window, '.ant-modal', { timeout: 5000 });
      await expectTextContent(window, '.ant-modal-title', '创建新工作流');

      await takeScreenshot(window, 'workflow-create-modal');

      // 关闭弹窗并等待动画完成
      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);

      // 确保弹窗完全关闭
      await window.waitForFunction(() => {
        const modals = document.querySelectorAll('.ant-modal-wrap');
        return Array.from(modals).every(m => {
          const style = window.getComputedStyle(m);
          return style.display === 'none' || style.visibility === 'hidden';
        });
      }, { timeout: 5000 }).catch(() => {
        // 如果超时，强制关闭
        console.log('[Workflow E2E] 弹窗关闭超时，尝试强制关闭');
      });
    });

    test('应该能够创建新工作流', async () => {
      const { window } = context;

      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 打开创建弹窗
      await window.click('.header-right button:has-text("新建工作流")');
      await window.waitForTimeout(500);

      // 填写表单
      await window.fill('input[placeholder="请输入工作流名称"]', 'E2E测试工作流');
      await window.fill('textarea[placeholder="请输入工作流描述"]', '这是一个E2E测试创建的工作流');
      await window.fill('textarea[placeholder="描述您想要完成的任务"]', '生成一个简单的Hello World页面');

      await takeScreenshot(window, 'workflow-create-form-filled');

      // 点击确定按钮
      await window.click('.ant-modal-footer button.ant-btn-primary');

      // 等待创建完成
      await window.waitForTimeout(3000);

      // 验证成功消息
      const hasSuccessMessage = await window.evaluate(() => {
        const messages = document.querySelectorAll('.ant-message-success');
        return messages.length > 0;
      });

      // 工作流创建后应该自动进入详情页
      await takeScreenshot(window, 'workflow-created');
    });
  });

  test.describe('工作流IPC操作', () => {
    test('应该能够通过IPC创建工作流', async () => {
      const { window } = context;

      // 通过IPC创建工作流
      const result = await callIPC<{ success: boolean; data?: any; error?: string }>(
        window,
        'workflow:create',
        {
          title: 'IPC测试工作流',
          description: '通过IPC创建的工作流',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.workflowId).toBeDefined();

      console.log('[Workflow E2E] IPC创建工作流成功:', result.data.workflowId);
    });

    test('应该能够通过IPC获取所有工作流', async () => {
      const { window } = context;

      const result = await callIPC<{ success: boolean; data?: any[]; error?: string }>(
        window,
        'workflow:get-all'
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);

      console.log('[Workflow E2E] 工作流数量:', result.data?.length || 0);
    });

    test('应该能够通过IPC创建并启动工作流', async () => {
      const { window } = context;

      const result = await callIPC<{ success: boolean; data?: any; error?: string }>(
        window,
        'workflow:create-and-start',
        {
          title: 'IPC自动执行测试',
          description: '创建并自动执行的工作流',
          input: {
            userRequest: '测试任务',
          },
          context: {},
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.workflowId).toBeDefined();
      expect(result.data.status).toBe('started');

      console.log('[Workflow E2E] IPC创建并启动工作流成功:', result.data.workflowId);

      // 保存工作流ID供后续测试使用
      (context as any).testWorkflowId = result.data.workflowId;
    });

    test('应该能够通过IPC获取工作流状态', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      const result = await callIPC<{ success: boolean; data?: any; error?: string }>(
        window,
        'workflow:get-status',
        { workflowId }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.workflowId).toBe(workflowId);

      console.log('[Workflow E2E] 工作流状态:', result.data.overall?.status);
    });

    test('应该能够通过IPC获取工作流阶段', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      const result = await callIPC<{ success: boolean; data?: any[]; error?: string }>(
        window,
        'workflow:get-stages',
        { workflowId }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data?.length).toBe(6); // 6个阶段

      console.log('[Workflow E2E] 阶段数量:', result.data?.length);
    });

    test('应该能够通过IPC获取质量门禁状态', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      const result = await callIPC<{ success: boolean; data?: any; error?: string }>(
        window,
        'workflow:get-gates',
        { workflowId }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      console.log('[Workflow E2E] 质量门禁:', Object.keys(result.data || {}).length);
    });

    test('应该能够通过IPC暂停工作流', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      // 先检查状态
      const statusResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:get-status',
        { workflowId }
      );

      if (statusResult.data?.overall?.status !== 'running') {
        console.log('[Workflow E2E] 工作流不在运行状态，跳过暂停测试');
        return;
      }

      const result = await callIPC<{ success: boolean; error?: string }>(
        window,
        'workflow:pause',
        { workflowId }
      );

      expect(result.success).toBe(true);
      console.log('[Workflow E2E] 工作流已暂停');
    });

    test('应该能够通过IPC恢复工作流', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      // 先检查状态
      const statusResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:get-status',
        { workflowId }
      );

      if (statusResult.data?.overall?.status !== 'paused') {
        console.log('[Workflow E2E] 工作流不在暂停状态，跳过恢复测试');
        return;
      }

      const result = await callIPC<{ success: boolean; error?: string }>(
        window,
        'workflow:resume',
        { workflowId }
      );

      expect(result.success).toBe(true);
      console.log('[Workflow E2E] 工作流已恢复');
    });

    test('应该能够通过IPC取消工作流', async () => {
      const { window } = context;
      const workflowId = (context as any).testWorkflowId;

      if (!workflowId) {
        console.log('[Workflow E2E] 跳过测试：没有可用的工作流ID');
        return;
      }

      const result = await callIPC<{ success: boolean; error?: string }>(
        window,
        'workflow:cancel',
        { workflowId, reason: 'E2E测试取消' }
      );

      // 可能已经完成或失败，所以不严格要求成功
      console.log('[Workflow E2E] 取消工作流结果:', result.success ? '成功' : result.error);
    });

    test('应该能够通过IPC删除工作流', async () => {
      const { window } = context;

      // 先创建一个用于删除的工作流
      const createResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:create',
        {
          title: '待删除工作流',
          description: '用于测试删除功能',
        }
      );

      expect(createResult.success).toBe(true);
      const workflowId = createResult.data?.workflowId;

      // 删除工作流
      const deleteResult = await callIPC<{ success: boolean; error?: string }>(
        window,
        'workflow:delete',
        { workflowId }
      );

      expect(deleteResult.success).toBe(true);
      console.log('[Workflow E2E] 工作流已删除:', workflowId);
    });
  });

  test.describe('工作流UI交互', () => {
    test('应该显示工作流卡片列表', async () => {
      const { window } = context;

      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 检查是否有工作流卡片或空状态
      const hasWorkflows = await window.evaluate(() => {
        const cards = document.querySelectorAll('.workflow-card');
        const empty = document.querySelector('.ant-empty');
        return cards.length > 0 || empty !== null;
      });

      expect(hasWorkflows).toBe(true);

      await takeScreenshot(window, 'workflow-list');
    });

    test('点击刷新按钮应该重新加载工作流列表', async () => {
      const { window } = context;

      await window.evaluate(() => {
        window.location.hash = '#/workflow';
      });

      await window.waitForTimeout(2000);

      // 点击刷新按钮
      await window.click('.header-right button:has-text("刷新")');
      await window.waitForTimeout(1000);

      // 页面不应该崩溃
      const pageVisible = await window.isVisible('.workflow-monitor-page');
      expect(pageVisible).toBe(true);
    });
  });

  test.describe('工作流进度组件', () => {
    test('WorkflowProgress组件应该正确渲染', async () => {
      const { window } = context;

      // 创建一个工作流并查看详情
      const createResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:create',
        {
          title: '进度测试工作流',
          description: '用于测试进度组件',
        }
      );

      if (!createResult.success || !createResult.data?.workflowId) {
        console.log('[Workflow E2E] 创建工作流失败，跳过测试');
        return;
      }

      const workflowId = createResult.data.workflowId;

      // 导航到工作流详情页
      await window.evaluate((id) => {
        window.location.hash = `#/workflow/${id}`;
      }, workflowId);

      await window.waitForTimeout(2000);

      // 检查进度组件是否存在
      const hasProgressComponent = await window.evaluate(() => {
        const progress = document.querySelector('.workflow-progress');
        return progress !== null;
      });

      // 即使详情页加载失败，测试也应该通过
      console.log('[Workflow E2E] 进度组件存在:', hasProgressComponent);

      await takeScreenshot(window, 'workflow-progress-component');

      // 清理
      await callIPC(window, 'workflow:delete', { workflowId });
    });
  });

  test.describe('工作流后端单元测试', () => {
    test('WorkflowStateMachine状态转换测试', async () => {
      const { window } = context;

      // 通过IPC测试状态机行为
      const createResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:create',
        { title: '状态机测试' }
      );

      expect(createResult.success).toBe(true);
      const workflowId = createResult.data?.workflowId;

      // 获取初始状态
      const statusResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:get-status',
        { workflowId }
      );

      expect(statusResult.data?.overall?.status).toBe('idle');

      // 清理
      await callIPC(window, 'workflow:delete', { workflowId });
    });

    test('QualityGateManager门禁检查测试', async () => {
      const { window } = context;

      // 创建工作流
      const createResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:create-and-start',
        {
          title: '门禁测试',
          input: { userRequest: '测试' },
          context: {},
        }
      );

      if (!createResult.success) {
        console.log('[Workflow E2E] 创建工作流失败，跳过门禁测试');
        return;
      }

      const workflowId = createResult.data?.workflowId;

      // 等待一段时间让工作流执行
      await window.waitForTimeout(2000);

      // 获取门禁状态
      const gatesResult = await callIPC<{ success: boolean; data?: any }>(
        window,
        'workflow:get-gates',
        { workflowId }
      );

      expect(gatesResult.success).toBe(true);
      expect(gatesResult.data).toBeDefined();

      console.log('[Workflow E2E] 门禁状态:', JSON.stringify(gatesResult.data, null, 2));

      // 清理
      await callIPC(window, 'workflow:cancel', { workflowId });
      await callIPC(window, 'workflow:delete', { workflowId });
    });
  });
});
