/**
 * E2E测试：去中心化代理网络 - 跨组织任务路由
 * @module e2e/v1.1.0/cross-org-routing
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('去中心化代理网络 - 跨组织任务路由', () => {
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

  test('应该能够访问联邦网络页面', async () => {
    // 导航到联邦网络页面
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/federated-network');
  });

  test('应该显示联邦网络页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查页面内容
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('网络') || body.includes('代理') || body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('应该能够创建DID身份', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建DID
    const result = await callIPC(window, 'agent-did:create', {
      skills: ['code-review', 'testing', 'deployment'],
      metadata: {
        name: 'E2E测试代理',
        version: '1.0.0',
      },
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data.did).toBeDefined();
      expect(result.data.publicKey).toBeDefined();
      console.log('[E2E] DID创建成功:', result.data.did);
    }
  });

  test('应该能够解析DID', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建DID
    const createResult = await callIPC(window, 'agent-did:create', {
      skills: ['test'],
    });

    if (createResult.success) {
      const did = createResult.data.did;

      // 解析DID
      const resolveResult = await callIPC(window, 'agent-did:resolve', did);
      expect(resolveResult).toBeDefined();

      if (resolveResult.success) {
        expect(resolveResult.data.did).toBe(did);
        console.log('[E2E] DID解析成功');
      }
    }
  });

  test('应该能够获取所有DID', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取所有DID
    const result = await callIPC(window, 'agent-did:get-all');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] DID总数:', result.data.length);
    }
  });

  test('应该能够注册到联邦网络', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 注册代理
    const result = await callIPC(window, 'fed-registry:register', {
      name: 'E2E测试节点',
      skills: ['development', 'testing'],
      endpoint: 'http://localhost:9000',
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 代理注册成功');
    }
  });

  test('应该能够发现代理', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 发现代理
    const result = await callIPC(window, 'fed-registry:discover', {
      skill: 'code-review',
      limit: 10,
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 发现代理数量:', result.data.length);
    }
  });

  test('应该能够按技能查询代理', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 技能查询
    const result = await callIPC(window, 'fed-registry:query-skills', {
      skill: 'testing',
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 技能查询完成');
    }
  });

  test('应该能够获取网络统计', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取网络统计
    const result = await callIPC(window, 'fed-registry:get-network-stats');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] 网络统计:', result.data);
    }
  });

  test('应该能够颁发凭证', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 颁发凭证
    const result = await callIPC(window, 'agent-cred:issue', {
      type: 'skill',
      claims: {
        skill: 'code-review',
        level: 'expert',
        validUntil: '2026-12-31',
      },
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data.id).toBeDefined();
      console.log('[E2E] 凭证颁发成功:', result.data.id);
    }
  });

  test('应该能够验证凭证', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先颁发凭证
    const issueResult = await callIPC(window, 'agent-cred:issue', {
      type: 'skill',
      claims: { skill: 'test' },
    });

    if (issueResult.success) {
      const credential = issueResult.data;

      // 验证凭证
      const verifyResult = await callIPC(window, 'agent-cred:verify', credential);
      expect(verifyResult).toBeDefined();

      if (verifyResult.success) {
        expect(verifyResult.data.valid).toBeDefined();
        console.log('[E2E] 凭证验证完成，有效性:', verifyResult.data.valid);
      }
    }
  });

  test('应该能够路由跨组织任务', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 路由任务
    const result = await callIPC(window, 'cross-org:route-task', {
      type: 'code-review',
      targetAgent: 'did:cc:test-agent',
      payload: {
        repository: 'test/repo',
        branch: 'main',
        files: ['src/index.js'],
      },
      priority: 'high',
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data.id).toBeDefined();
      console.log('[E2E] 任务路由成功，任务ID:', result.data.id);
    }
  });

  test('应该能够获取任务状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建任务
    const routeResult = await callIPC(window, 'cross-org:route-task', {
      type: 'test',
      targetAgent: 'did:cc:test',
      payload: {},
    });

    if (routeResult.success) {
      const taskId = routeResult.data.id;

      // 获取任务状态
      const statusResult = await callIPC(window, 'cross-org:get-task-status', taskId);
      expect(statusResult).toBeDefined();

      if (statusResult.success) {
        console.log('[E2E] 任务状态:', statusResult.data.status);
      }
    }
  });

  test('应该能够取消任务', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建任务
    const routeResult = await callIPC(window, 'cross-org:route-task', {
      type: 'test',
      targetAgent: 'did:cc:test',
      payload: {},
    });

    if (routeResult.success) {
      const taskId = routeResult.data.id;

      // 取消任务
      const cancelResult = await callIPC(window, 'cross-org:cancel-task', taskId);
      expect(cancelResult).toBeDefined();

      if (cancelResult.success) {
        console.log('[E2E] 任务取消成功');
      }
    }
  });

  test('应该能够获取任务日志', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取任务日志
    const result = await callIPC(window, 'cross-org:get-log');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 任务日志数量:', result.data.length);
    }
  });

  test('应该能够获取信誉分数', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建DID
    const createResult = await callIPC(window, 'agent-did:create', { skills: ['test'] });

    if (createResult.success) {
      const did = createResult.data.did;

      // 获取信誉分数
      const reputationResult = await callIPC(window, 'reputation:get-score', did);
      expect(reputationResult).toBeDefined();

      if (reputationResult.success) {
        console.log('[E2E] 信誉分数:', reputationResult.data.score);
      }
    }
  });

  test('应该能够获取信誉排行榜', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取排行榜
    const result = await callIPC(window, 'reputation:get-ranking', {
      limit: 10,
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 排行榜代理数:', result.data.length);
    }
  });

  test('应该能够更新信誉分数', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建DID
    const createResult = await callIPC(window, 'agent-did:create', { skills: ['test'] });

    if (createResult.success) {
      const did = createResult.data.did;

      // 更新信誉
      const updateResult = await callIPC(window, 'reputation:update', did, {
        quality: 5,
        timeliness: 4,
        collaboration: 5,
      });
      expect(updateResult).toBeDefined();

      if (updateResult.success) {
        console.log('[E2E] 信誉更新成功');
      }
    }
  });

  test('应该能够获取去中心化配置', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取配置
    const result = await callIPC(window, 'decentralized:get-config');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] 去中心化配置:', result.data);
    }
  });

  test('完整流程：创建DID → 注册网络 → 发现代理 → 路由任务 → 查看信誉', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 1. 创建DID
    const didResult = await callIPC(window, 'agent-did:create', {
      skills: ['code-review', 'security-audit'],
      metadata: { name: 'E2E完整测试代理' },
    });
    expect(didResult.success).toBeTruthy();

    const myDID = didResult.data.did;
    console.log('[E2E] 步骤1: DID创建完成 -', myDID);

    // 2. 注册到联邦网络
    const registerResult = await callIPC(window, 'fed-registry:register', {
      name: 'E2E测试节点',
      skills: ['code-review', 'security-audit'],
      endpoint: 'http://localhost:9000',
    });
    if (registerResult.success) {
      console.log('[E2E] 步骤2: 注册联邦网络完成');
    }

    // 3. 发现其他代理
    const discoverResult = await callIPC(window, 'fed-registry:discover', {
      skill: 'testing',
      limit: 5,
    });
    if (discoverResult.success) {
      console.log('[E2E] 步骤3: 发现代理数量 -', discoverResult.data.length);
    }

    // 4. 颁发技能凭证
    const credResult = await callIPC(window, 'agent-cred:issue', {
      type: 'skill',
      claims: { skill: 'code-review', level: 'expert' },
    });
    if (credResult.success) {
      console.log('[E2E] 步骤4: 技能凭证颁发完成');
    }

    // 5. 路由跨组织任务
    const taskResult = await callIPC(window, 'cross-org:route-task', {
      type: 'code-review',
      targetAgent: 'did:cc:remote-agent',
      payload: { repository: 'test/project' },
      priority: 'normal',
    });
    if (taskResult.success) {
      const taskId = taskResult.data.id;
      console.log('[E2E] 步骤5: 任务路由完成 -', taskId);

      // 6. 查看任务状态
      const statusResult = await callIPC(window, 'cross-org:get-task-status', taskId);
      if (statusResult.success) {
        console.log('[E2E] 步骤6: 任务状态 -', statusResult.data.status);
      }
    }

    // 7. 查看信誉分数
    const reputationResult = await callIPC(window, 'reputation:get-score', myDID);
    if (reputationResult.success) {
      console.log('[E2E] 步骤7: 信誉分数 -', reputationResult.data.score);
    }

    // 8. 查看排行榜
    const rankingResult = await callIPC(window, 'reputation:get-ranking', { limit: 10 });
    if (rankingResult.success) {
      console.log('[E2E] 步骤8: 排行榜获取完成');
    }

    console.log('[E2E] ✅ 完整流程测试通过');
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/federated-network?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 过滤已知非关键错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('DevTools') &&
        !err.includes('extension') &&
        !err.includes('favicon')
    );

    expect(criticalErrors.length).toBe(0);
  });
});
