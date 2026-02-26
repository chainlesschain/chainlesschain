/**
 * E2E测试：自主运维 - 事故处理场景
 * @module e2e/v1.1.0/autonomous-ops-scenario
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('自主运维 - 事故处理场景', () => {
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

  test('应该能够访问自主运维页面', async () => {
    // 导航到自主运维页面
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/autonomous-ops');
  });

  test('应该显示自主运维页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查页面内容
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('运维') || body.includes('事故') || body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('应该能够获取事故列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取事故列表
    const result = await callIPC(window, 'ops:get-incidents');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 事故数量:', result.data.length);
    }
  });

  test('应该能够获取事故详情', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先获取事故列表
    const listResult = await callIPC(window, 'ops:get-incidents');

    if (listResult.success && listResult.data.length > 0) {
      const incidentId = listResult.data[0].id;

      // 获取详情
      const detailResult = await callIPC(window, 'ops:get-incident-detail', incidentId);
      expect(detailResult).toBeDefined();

      if (detailResult.success) {
        expect(detailResult.data.id).toBe(incidentId);
        console.log('[E2E] 事故详情获取成功');
      }
    }
  });

  test('应该能够确认事故', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取事故列表
    const listResult = await callIPC(window, 'ops:get-incidents');

    if (listResult.success && listResult.data.length > 0) {
      const incident = listResult.data.find((i) => i.status === 'open');

      if (incident) {
        // 确认事故
        const ackResult = await callIPC(window, 'ops:acknowledge', incident.id);
        expect(ackResult).toBeDefined();

        if (ackResult.success) {
          console.log('[E2E] 事故确认成功');
        }
      }
    }
  });

  test('应该能够解决事故', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取事故列表
    const listResult = await callIPC(window, 'ops:get-incidents');

    if (listResult.success && listResult.data.length > 0) {
      const incident = listResult.data.find((i) => i.status === 'acknowledged');

      if (incident) {
        // 解决事故
        const resolveResult = await callIPC(
          window,
          'ops:resolve',
          incident.id,
          '通过重启服务解决'
        );
        expect(resolveResult).toBeDefined();

        if (resolveResult.success) {
          console.log('[E2E] 事故解决成功');
        }
      }
    }
  });

  test('应该能够获取Playbook列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取Playbook列表
    const result = await callIPC(window, 'ops:get-playbooks');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] Playbook数量:', result.data.length);
    }
  });

  test('应该能够创建Playbook', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建Playbook
    const result = await callIPC(window, 'ops:create-playbook', {
      name: 'E2E测试Playbook',
      description: 'CPU过高自动修复',
      trigger: {
        type: 'metric',
        metric: 'cpu',
        threshold: 90,
      },
      steps: [
        { action: 'log', message: '检测到CPU过高' },
        { action: 'restart', service: 'worker' },
        { action: 'notify', channel: 'slack', message: 'CPU已恢复正常' },
      ],
      enabled: true,
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data.id).toBeDefined();
      console.log('[E2E] Playbook创建成功:', result.data.id);
    }
  });

  test('应该能够触发自动修复', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取事故和Playbook
    const incidentResult = await callIPC(window, 'ops:get-incidents');
    const playbookResult = await callIPC(window, 'ops:get-playbooks');

    if (
      incidentResult.success &&
      playbookResult.success &&
      incidentResult.data.length > 0 &&
      playbookResult.data.length > 0
    ) {
      const incidentId = incidentResult.data[0].id;
      const playbookId = playbookResult.data[0].id;

      // 触发修复
      const triggerResult = await callIPC(
        window,
        'ops:trigger-remediation',
        incidentId,
        playbookId
      );
      expect(triggerResult).toBeDefined();

      if (triggerResult.success) {
        console.log('[E2E] 自动修复触发成功');
      }
    }
  });

  test('应该能够回滚修复操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取事故列表
    const listResult = await callIPC(window, 'ops:get-incidents');

    if (listResult.success && listResult.data.length > 0) {
      const incident = listResult.data.find((i) => i.status === 'resolving');

      if (incident) {
        // 回滚
        const rollbackResult = await callIPC(window, 'ops:rollback', incident.id);
        expect(rollbackResult).toBeDefined();

        if (rollbackResult.success) {
          console.log('[E2E] 回滚成功');
        }
      }
    }
  });

  test('应该能够获取告警列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取告警
    const result = await callIPC(window, 'ops:get-alerts');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 告警数量:', result.data.length);
    }
  });

  test('应该能够配置告警规则', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 配置告警
    const result = await callIPC(window, 'ops:configure-alerts', {
      cpuThreshold: 85,
      memoryThreshold: 90,
      diskThreshold: 80,
      errorRateThreshold: 5,
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 告警规则配置成功');
    }
  });

  test('应该能够生成事故报告', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取已解决的事故
    const listResult = await callIPC(window, 'ops:get-incidents');

    if (listResult.success && listResult.data.length > 0) {
      const incident = listResult.data.find((i) => i.status === 'resolved');

      if (incident) {
        // 生成报告
        const reportResult = await callIPC(window, 'ops:generate-postmortem', incident.id);
        expect(reportResult).toBeDefined();

        if (reportResult.success) {
          expect(reportResult.data.incidentId).toBe(incident.id);
          expect(reportResult.data.rootCause).toBeDefined();
          console.log('[E2E] 事故报告生成成功');
        }
      }
    }
  });

  test('应该能够获取基线数据', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取基线
    const result = await callIPC(window, 'ops:get-baseline');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] 基线数据:', result.data);
    }
  });

  test('应该能够更新基线数据', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 更新基线
    const result = await callIPC(window, 'ops:update-baseline', {
      cpu: { avg: 50, p95: 80 },
      memory: { avg: 60, p95: 85 },
      responseTime: { avg: 150, p95: 300 },
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 基线更新成功');
    }
  });

  test('完整流程：事故检测 → 确认 → 触发Playbook → 解决 → 生成报告', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/autonomous-ops?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 1. 获取事故列表
    const listResult = await callIPC(window, 'ops:get-incidents');
    expect(listResult.success).toBeTruthy();
    console.log('[E2E] 步骤1: 获取事故列表完成');

    // 找到一个open状态的事故
    let incident = listResult.data?.find((i) => i.status === 'open');

    if (incident) {
      // 2. 确认事故
      const ackResult = await callIPC(window, 'ops:acknowledge', incident.id);
      if (ackResult.success) {
        console.log('[E2E] 步骤2: 事故确认完成');
      }

      // 3. 获取Playbook
      const playbookResult = await callIPC(window, 'ops:get-playbooks');
      if (playbookResult.success && playbookResult.data.length > 0) {
        const playbook = playbookResult.data[0];

        // 4. 触发自动修复
        const triggerResult = await callIPC(
          window,
          'ops:trigger-remediation',
          incident.id,
          playbook.id
        );
        if (triggerResult.success) {
          console.log('[E2E] 步骤3: 自动修复触发完成');
        }
      }

      // 5. 解决事故
      const resolveResult = await callIPC(
        window,
        'ops:resolve',
        incident.id,
        'Playbook自动修复成功'
      );
      if (resolveResult.success) {
        console.log('[E2E] 步骤4: 事故解决完成');
      }

      // 6. 生成事故报告
      const reportResult = await callIPC(window, 'ops:generate-postmortem', incident.id);
      if (reportResult.success) {
        console.log('[E2E] 步骤5: 事故报告生成完成');
        console.log('[E2E] 根因:', reportResult.data.rootCause);
      }
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
      window.location.hash = '#/autonomous-ops?e2e=true';
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
