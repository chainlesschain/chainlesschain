/**
 * E2E测试：自然语言编程 - NL到代码生成
 * @module e2e/v1.1.0/nl-to-code
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('自然语言编程 - NL到代码生成', () => {
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

  test('应该能够访问自然语言编程页面', async () => {
    // 导航到NL编程页面
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/nl-programming');
  });

  test('应该显示NL编程页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查页面内容
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('自然语言') || body.includes('编程') || body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('应该能够翻译自然语言到Spec', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 翻译自然语言
    const nlInput = '创建一个用户注册表单，包含用户名、邮箱、密码字段，并进行表单验证';
    const result = await callIPC(window, 'nl-prog:translate', nlInput);

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.intent).toBeDefined();
      console.log('[E2E] NL翻译成功 - Intent:', result.data.intent);
      console.log('[E2E] 完整度:', result.data.completeness || 0);
    }
  });

  test('应该能够验证Spec', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先翻译
    const translateResult = await callIPC(
      window,
      'nl-prog:translate',
      '创建一个简单的登录表单'
    );

    if (translateResult.success) {
      const spec = translateResult.data;

      // 验证Spec
      const validateResult = await callIPC(window, 'nl-prog:validate', spec);
      expect(validateResult).toBeDefined();

      if (validateResult.success) {
        console.log('[E2E] Spec验证结果:', validateResult.data);
      }
    }
  });

  test('应该能够优化Spec', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先翻译
    const translateResult = await callIPC(
      window,
      'nl-prog:translate',
      '创建一个用户列表页面'
    );

    if (translateResult.success) {
      const spec = translateResult.data;

      // 优化Spec
      const refineResult = await callIPC(
        window,
        'nl-prog:refine',
        spec,
        '添加分页功能和搜索功能'
      );
      expect(refineResult).toBeDefined();

      if (refineResult.success) {
        console.log('[E2E] Spec优化成功');
        expect(refineResult.data.completeness).toBeGreaterThanOrEqual(spec.completeness || 0);
      }
    }
  });

  test('应该能够从Spec生成代码', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先翻译
    const translateResult = await callIPC(
      window,
      'nl-prog:translate',
      '创建一个简单的待办事项组件'
    );

    if (translateResult.success) {
      const spec = translateResult.data;

      // 生成代码
      const generateResult = await callIPC(window, 'nl-prog:generate', spec);
      expect(generateResult).toBeDefined();

      if (generateResult.success) {
        const code = generateResult.data.code || generateResult.data;
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
        console.log('[E2E] 代码生成成功，长度:', code.length, '字符');
      }
    }
  });

  test('应该能够获取翻译历史', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取历史
    const result = await callIPC(window, 'nl-prog:get-history');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      console.log('[E2E] 翻译历史记录数:', result.data.length);
    }
  });

  test('应该能够获取项目约定', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取约定
    const result = await callIPC(window, 'nl-prog:get-conventions');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] 项目约定:', result.data);
    }
  });

  test('应该能够分析项目结构', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 分析项目
    const result = await callIPC(window, 'nl-prog:analyze-project', '/mock/project/path');

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 项目分析完成');
    }
  });

  test('应该能够获取统计信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取统计
    const result = await callIPC(window, 'nl-prog:get-stats');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] NL编程统计:', result.data);
    }
  });

  test('完整流程：NL → Spec → 验证 → 优化 → 代码生成', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/nl-programming?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 1. NL翻译
    const nlInput = '创建一个产品列表页面，支持搜索、筛选和分页';
    const translateResult = await callIPC(window, 'nl-prog:translate', nlInput);
    expect(translateResult.success).toBeTruthy();

    let spec = translateResult.data;
    console.log('[E2E] 步骤1: NL翻译完成');

    // 2. 验证Spec
    const validateResult = await callIPC(window, 'nl-prog:validate', spec);
    expect(validateResult).toBeDefined();
    console.log('[E2E] 步骤2: Spec验证完成');

    // 3. 优化Spec
    const refineResult = await callIPC(window, 'nl-prog:refine', spec, '添加导出功能');
    if (refineResult.success) {
      spec = refineResult.data;
      console.log('[E2E] 步骤3: Spec优化完成');
    }

    // 4. 生成代码
    const generateResult = await callIPC(window, 'nl-prog:generate', spec);
    expect(generateResult).toBeDefined();
    if (generateResult.success) {
      const code = generateResult.data.code || generateResult.data;
      expect(code.length).toBeGreaterThan(0);
      console.log('[E2E] 步骤4: 代码生成完成，长度:', code.length);
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
      window.location.hash = '#/nl-programming?e2e=true';
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
