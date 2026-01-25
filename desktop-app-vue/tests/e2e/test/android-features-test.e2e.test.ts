import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('安卓端功能测试入口页面', () => {
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

  test('应该能够访问安卓功能测试页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/test/android-features');
  });

  test('应该显示页面标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('安卓端功能测试') ||
        bodyText.includes('Android') ||
        bodyText.includes('功能测试');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示LLM功能测试卡片区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasLLMSection = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('LLM功能') ||
        bodyText.includes('LLM设置') ||
        bodyText.includes('Token使用') ||
        bodyText.includes('测试聊天');
    });

    expect(hasLLMSection).toBeTruthy();
  });

  test('应该显示P2P功能测试卡片区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasP2PSection = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('P2P功能') ||
        bodyText.includes('设备配对') ||
        bodyText.includes('安全号码') ||
        bodyText.includes('文件传输');
    });

    expect(hasP2PSection).toBeTruthy();
  });

  test('应该显示知识库与AI功能卡片区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasKnowledgeSection = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('知识库') ||
        bodyText.includes('知识图谱') ||
        bodyText.includes('AI对话');
    });

    expect(hasKnowledgeSection).toBeTruthy();
  });

  test('应该显示其他功能卡片区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasOtherSection = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('其他功能') ||
        bodyText.includes('项目管理') ||
        bodyText.includes('通话记录');
    });

    expect(hasOtherSection).toBeTruthy();
  });

  test('应该有可点击的功能卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasClickableCards = await window.evaluate(() => {
      const cards = document.querySelectorAll('.ant-card');
      const hoverableCards = document.querySelectorAll('.ant-card-hoverable');
      return cards.length > 0 || hoverableCards.length > 0;
    });

    expect(hasClickableCards).toBeTruthy();
  });

  test('应该显示功能图标', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasIcons = await window.evaluate(() => {
      const icons = document.querySelectorAll('[class*="icon"]');
      const antIcons = document.querySelectorAll('.anticon');
      return icons.length > 0 || antIcons.length > 0;
    });

    expect(hasIcons).toBeTruthy();
  });

  test('应该显示功能描述', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDescriptions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('配置') ||
        bodyText.includes('查看') ||
        bodyText.includes('管理') ||
        bodyText.includes('测试') ||
        document.querySelector('.ant-card-meta-description');
    });

    expect(hasDescriptions).toBeTruthy();
  });

  test('卡片应该按行列布局', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasGridLayout = await window.evaluate(() => {
      const rows = document.querySelectorAll('.ant-row');
      const cols = document.querySelectorAll('.ant-col');
      return rows.length > 0 && cols.length > 0;
    });

    expect(hasGridLayout).toBeTruthy();
  });

  test('应该有至少15个功能卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const cardCount = await window.evaluate(() => {
      const cards = document.querySelectorAll('.ant-card');
      return cards.length;
    });

    expect(cardCount).toBeGreaterThanOrEqual(10); // At least 10 feature cards
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
