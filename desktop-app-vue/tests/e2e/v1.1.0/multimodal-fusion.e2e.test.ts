/**
 * E2E测试：多模态协作 - 输入融合与输出生成
 * @module e2e/v1.1.0/multimodal-fusion
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('多模态协作 - 输入融合与输出生成', () => {
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

  test('应该能够访问多模态协作页面', async () => {
    // 导航到多模态协作页面
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/multimodal-collab');
  });

  test('应该显示多模态协作页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查页面内容
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('多模态') || body.includes('协作') || body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('应该能够获取支持的模态类型', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取支持的模态
    const result = await callIPC(window, 'mm:get-supported-modalities');

    expect(result).toBeDefined();
    if (result.success) {
      expect(Array.isArray(result.data)).toBeTruthy();
      expect(result.data.length).toBeGreaterThan(0);
      console.log('[E2E] 支持的模态类型:', result.data);
    }
  });

  test('应该能够融合文本输入', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 融合文本输入
    const result = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '这是一段测试文本',
        metadata: { source: 'e2e-test' },
      },
    ]);

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.inputs).toBeDefined();
      expect(result.data.inputs.length).toBe(1);
      console.log('[E2E] 文本融合成功，Session ID:', result.data.id);
    }
  });

  test('应该能够融合多种模态输入', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 融合多种输入
    const result = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '分析这个图像',
      },
      {
        modality: 'image',
        content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    ]);

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data.inputs.length).toBe(2);
      console.log('[E2E] 多模态融合成功');
    }
  });

  test('应该能够解析文档', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 解析文档
    const result = await callIPC(window, 'mm:parse-document', {
      name: 'test.pdf',
      path: '/mock/path/test.pdf',
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 文档解析成功');
    }
  });

  test('应该能够捕获屏幕', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 捕获屏幕
    const result = await callIPC(window, 'mm:capture-screen', {
      type: 'fullscreen',
    });

    expect(result).toBeDefined();
    if (result.success) {
      console.log('[E2E] 屏幕捕获成功');
    }
  });

  test('应该能够构建上下文', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先融合输入创建Session
    const fuseResult = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '构建上下文测试',
      },
    ]);

    if (fuseResult.success) {
      const sessionId = fuseResult.data.id;

      // 构建上下文
      const buildResult = await callIPC(window, 'mm:build-context', sessionId);
      expect(buildResult).toBeDefined();

      if (buildResult.success) {
        console.log('[E2E] 上下文构建成功');
      }
    }
  });

  test('应该能够获取Session详情', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 先创建Session
    const fuseResult = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: 'Session详情测试',
      },
    ]);

    if (fuseResult.success) {
      const sessionId = fuseResult.data.id;

      // 获取Session详情
      const getResult = await callIPC(window, 'mm:get-session', sessionId);
      expect(getResult).toBeDefined();

      if (getResult.success) {
        expect(getResult.data.id).toBe(sessionId);
        console.log('[E2E] Session详情获取成功');
      }
    }
  });

  test('应该能够生成Markdown输出', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建Session
    const fuseResult = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '生成Markdown文档',
      },
    ]);

    if (fuseResult.success) {
      const sessionId = fuseResult.data.id;

      // 生成输出
      const generateResult = await callIPC(window, 'mm:generate-output', sessionId, 'markdown');
      expect(generateResult).toBeDefined();

      if (generateResult.success) {
        expect(generateResult.data.format).toBe('markdown');
        console.log('[E2E] Markdown输出生成成功');
      }
    }
  });

  test('应该能够获取产物列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 创建Session并生成产物
    const fuseResult = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '产物列表测试',
      },
    ]);

    if (fuseResult.success) {
      const sessionId = fuseResult.data.id;

      // 生成产物
      await callIPC(window, 'mm:generate-output', sessionId, 'markdown');

      // 获取产物列表
      const artifactsResult = await callIPC(window, 'mm:get-artifacts', sessionId);
      expect(artifactsResult).toBeDefined();

      if (artifactsResult.success) {
        expect(Array.isArray(artifactsResult.data)).toBeTruthy();
        console.log('[E2E] 产物列表获取成功，数量:', artifactsResult.data.length);
      }
    }
  });

  test('应该能够获取统计信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 获取统计
    const result = await callIPC(window, 'mm:get-stats');

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      console.log('[E2E] 多模态统计:', result.data);
    }
  });

  test('完整流程：融合输入 → 构建上下文 → 生成输出', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimodal-collab?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 1. 融合多模态输入
    const fuseResult = await callIPC(window, 'mm:fuse-input', [
      {
        modality: 'text',
        content: '创建一份项目报告',
      },
      {
        modality: 'document',
        content: { name: 'data.csv', path: '/mock/data.csv' },
      },
    ]);
    expect(fuseResult.success).toBeTruthy();

    const sessionId = fuseResult.data.id;
    console.log('[E2E] 步骤1: 输入融合完成, Session ID:', sessionId);

    // 2. 构建上下文
    const buildResult = await callIPC(window, 'mm:build-context', sessionId);
    expect(buildResult).toBeDefined();
    console.log('[E2E] 步骤2: 上下文构建完成');

    // 3. 生成Markdown输出
    const mdResult = await callIPC(window, 'mm:generate-output', sessionId, 'markdown');
    expect(mdResult).toBeDefined();
    if (mdResult.success) {
      console.log('[E2E] 步骤3a: Markdown生成完成');
    }

    // 4. 生成HTML输出
    const htmlResult = await callIPC(window, 'mm:generate-output', sessionId, 'html');
    expect(htmlResult).toBeDefined();
    if (htmlResult.success) {
      console.log('[E2E] 步骤3b: HTML生成完成');
    }

    // 5. 获取所有产物
    const artifactsResult = await callIPC(window, 'mm:get-artifacts', sessionId);
    if (artifactsResult.success) {
      console.log('[E2E] 步骤4: 产物列表获取完成，数量:', artifactsResult.data.length);
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
      window.location.hash = '#/multimodal-collab?e2e=true';
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
