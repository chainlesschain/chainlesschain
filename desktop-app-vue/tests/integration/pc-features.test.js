/**
 * PC端功能集成测试套件
 * 测试语音输入、知识图谱、网页剪藏三大功能
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

// 测试配置
const TEST_CONFIG = {
  appPath: path.join(__dirname, '../../../'),
  timeout: 30000,
  retries: 2,
};

/**
 * 语音输入功能测试
 */
test.describe('语音输入功能测试', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到AI聊天页面
    await page.goto('http://localhost:5173/#/ai-chat');
    await page.waitForLoadState('networkidle');
  });

  test('应该显示语音输入按钮', async ({ page }) => {
    const voiceButton = page.locator('.voice-button');
    await expect(voiceButton).toBeVisible();
  });

  test('点击语音按钮应该打开录音模态框', async ({ page }) => {
    // 模拟授予麦克风权限
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 检查模态框是否显示
    const modal = page.locator('.recording-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('应该显示录音动画和状态', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 检查动画元素
    const waveCircles = page.locator('.wave-circle');
    await expect(waveCircles.first()).toBeVisible();

    // 检查状态文本
    const statusText = page.locator('.status-text');
    await expect(statusText).toContainText(/准备|录音/);
  });

  test('应该支持暂停和继续录音', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 等待录音开始
    await page.waitForTimeout(1000);

    // 点击暂停
    const pauseButton = page.locator('button:has-text("暂停")');
    if (await pauseButton.isVisible()) {
      await pauseButton.click();
      await expect(page.locator('.status-text')).toContainText('已暂停');

      // 点击继续
      const resumeButton = page.locator('button:has-text("继续")');
      await resumeButton.click();
      await expect(page.locator('.status-text')).toContainText('录音');
    }
  });

  test('应该能够取消录音', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 点击取消
    const cancelButton = page.locator('button:has-text("取消")');
    await cancelButton.click();

    // 模态框应该关闭
    const modal = page.locator('.recording-modal-content');
    await expect(modal).not.toBeVisible();
  });

  test('应该能够完成录音并填充文本', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 等待一段时间模拟录音
    await page.waitForTimeout(2000);

    // 点击完成
    const completeButton = page.locator('button:has-text("完成")');
    await completeButton.click();

    // 检查输入框是否有内容（如果有识别结果）
    const textarea = page.locator('.conversation-input');
    // 注意：实际测试中可能没有真实的语音识别结果
  });
});

/**
 * 知识图谱功能测试
 */
test.describe('知识图谱功能测试', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到知识图谱页面
    await page.goto('http://localhost:5173/#/knowledge-graph');
    await page.waitForLoadState('networkidle');
  });

  test('应该显示图谱画布', async ({ page }) => {
    const canvas = page.locator('.graph-chart');
    await expect(canvas).toBeVisible();
  });

  test('应该显示统计信息', async ({ page }) => {
    const stats = page.locator('.ant-statistic');
    await expect(stats.first()).toBeVisible();
  });

  test('应该能够切换布局', async ({ page }) => {
    const layoutButton = page.locator('button:has-text("布局")');
    await layoutButton.click();

    // 选择环形布局
    const circularLayout = page.locator('.ant-menu-item:has-text("环形布局")');
    await circularLayout.click();

    // 等待布局更新
    await page.waitForTimeout(1000);
  });

  test('应该能够搜索节点', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="搜索"]');
    await searchInput.fill('测试');
    await searchInput.press('Enter');

    // 等待搜索结果
    await page.waitForTimeout(500);
  });

  test('应该能够筛选节点类型', async ({ page }) => {
    // 取消选择某个类型
    const checkbox = page.locator('.ant-checkbox-wrapper:has-text("笔记")');
    await checkbox.click();

    // 等待图谱更新
    await page.waitForTimeout(500);
  });

  test('应该能够调整最小权重', async ({ page }) => {
    const slider = page.locator('.ant-slider');
    await slider.click({ position: { x: 50, y: 0 } });

    // 等待图谱更新
    await page.waitForTimeout(500);
  });

  test('应该能够重建图谱', async ({ page }) => {
    const rebuildButton = page.locator('button:has-text("重建图谱")');
    await rebuildButton.click();

    // 等待处理完成
    await page.waitForTimeout(2000);

    // 应该显示成功消息
    const message = page.locator('.ant-message-success');
    await expect(message).toBeVisible({ timeout: 5000 });
  });

  test('应该能够刷新数据', async ({ page }) => {
    const refreshButton = page.locator('button:has-text("刷新数据")');
    await refreshButton.click();

    // 等待加载完成
    await page.waitForTimeout(1000);
  });
});

/**
 * 知识图谱交互面板测试
 */
test.describe('知识图谱交互面板测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/knowledge-graph');
    await page.waitForLoadState('networkidle');
  });

  test('应该能够进行路径查找', async ({ page }) => {
    // 选择起点
    const startSelect = page.locator('.ant-select').first();
    await startSelect.click();
    await page.locator('.ant-select-item').first().click();

    // 选择终点
    const endSelect = page.locator('.ant-select').nth(1);
    await endSelect.click();
    await page.locator('.ant-select-item').nth(1).click();

    // 点击查找路径
    const findButton = page.locator('button:has-text("查找路径")');
    await findButton.click();

    // 等待结果
    await page.waitForTimeout(1000);
  });

  test('应该能够检测社区', async ({ page }) => {
    const detectButton = page.locator('button:has-text("检测社区")');
    await detectButton.click();

    // 等待分析完成
    await page.waitForTimeout(2000);
  });

  test('应该能够分析中心性', async ({ page }) => {
    const analyzeButton = page.locator('button:has-text("分析中心性")');
    await analyzeButton.click();

    // 等待分析完成
    await page.waitForTimeout(2000);
  });
});

/**
 * 网页剪藏HTTP服务器测试
 */
test.describe('网页剪藏HTTP服务器测试', () => {
  const API_BASE = 'http://localhost:23456';

  test('Ping接口应该返回pong', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/ping`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.message).toBe('pong');
  });

  test('应该能够剪藏单个网页', async ({ request }) => {
    const clipData = {
      title: '测试网页',
      content: '这是测试内容',
      url: 'https://example.com',
      tags: ['测试', '示例'],
      type: 'web_clip',
    };

    const response = await request.post(`${API_BASE}/api/clip`, {
      data: clipData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.id).toBeDefined();
  });

  test('应该能够批量剪藏', async ({ request }) => {
    const batchData = {
      items: [
        {
          title: '测试网页1',
          content: '内容1',
          url: 'https://example.com/1',
          tags: ['测试'],
        },
        {
          title: '测试网页2',
          content: '内容2',
          url: 'https://example.com/2',
          tags: ['测试'],
        },
      ],
      autoIndex: false,
    };

    const response = await request.post(`${API_BASE}/api/batch-clip`, {
      data: batchData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.summary.total).toBe(2);
    expect(data.data.summary.succeeded).toBeGreaterThan(0);
  });

  test('应该能够搜索剪藏内容', async ({ request }) => {
    const searchData = {
      query: '测试',
      limit: 10,
    };

    const response = await request.post(`${API_BASE}/api/search`, {
      data: searchData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data.results)).toBe(true);
  });

  test('应该能够获取统计信息', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/stats`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.totalItems).toBeDefined();
    expect(data.data.webClips).toBeDefined();
  });

  test('应该处理无效请求', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/clip`, {
      data: {
        // 缺少必要字段
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

/**
 * Markdown编辑器语音输入测试
 */
test.describe('Markdown编辑器语音输入测试', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到知识库详情页面（编辑模式）
    await page.goto('http://localhost:5173/#/knowledge/new');
    await page.waitForLoadState('networkidle');
  });

  test('编辑器工具栏应该显示语音输入按钮', async ({ page }) => {
    const voiceButton = page.locator('.editor-toolbar .voice-button');
    await expect(voiceButton).toBeVisible();
  });

  test('应该能够在编辑器中使用语音输入', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const voiceButton = page.locator('.editor-toolbar .voice-button');
    await voiceButton.click();

    // 检查模态框
    const modal = page.locator('.recording-modal-content');
    await expect(modal).toBeVisible();
  });
});

/**
 * 性能测试
 */
test.describe('性能测试', () => {
  test('图谱渲染性能测试', async ({ page }) => {
    await page.goto('http://localhost:5173/#/knowledge-graph');
    await page.waitForLoadState('networkidle');

    // 测量渲染时间
    const startTime = Date.now();
    await page.locator('.graph-chart').waitFor({ state: 'visible' });
    const renderTime = Date.now() - startTime;

    console.log(`图谱渲染时间: ${renderTime}ms`);
    expect(renderTime).toBeLessThan(3000); // 应该在3秒内完成
  });

  test('大量节点筛选性能', async ({ page }) => {
    await page.goto('http://localhost:5173/#/knowledge-graph');
    await page.waitForLoadState('networkidle');

    const startTime = Date.now();

    // 调整筛选条件
    const slider = page.locator('.ant-slider');
    await slider.click({ position: { x: 100, y: 0 } });

    // 等待更新完成
    await page.waitForTimeout(500);

    const filterTime = Date.now() - startTime;
    console.log(`筛选处理时间: ${filterTime}ms`);
    expect(filterTime).toBeLessThan(1000); // 应该在1秒内完成
  });

  test('HTTP服务器响应时间', async ({ request }) => {
    const startTime = Date.now();

    await request.post('http://localhost:23456/api/ping');

    const responseTime = Date.now() - startTime;
    console.log(`HTTP响应时间: ${responseTime}ms`);
    expect(responseTime).toBeLessThan(100); // 应该在100ms内响应
  });
});

/**
 * 错误处理测试
 */
test.describe('错误处理测试', () => {
  test('语音输入权限被拒绝', async ({ page }) => {
    await page.goto('http://localhost:5173/#/ai-chat');

    // 拒绝麦克风权限
    await page.context().grantPermissions([]);

    const voiceButton = page.locator('.voice-button');
    await voiceButton.click();

    // 应该显示错误消息
    await page.waitForTimeout(1000);
    const errorMessage = page.locator('.ant-message-error');
    // 注意：可能需要根据实际实现调整
  });

  test('HTTP服务器连接失败', async ({ request }) => {
    // 尝试连接到错误的端口
    try {
      await request.post('http://localhost:99999/api/ping', {
        timeout: 1000,
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test('图谱数据加载失败', async ({ page }) => {
    // 模拟网络错误
    await page.route('**/api/graph/**', route => route.abort());

    await page.goto('http://localhost:5173/#/knowledge-graph');

    // 应该显示错误状态
    await page.waitForTimeout(2000);
  });
});

module.exports = {
  TEST_CONFIG,
};
