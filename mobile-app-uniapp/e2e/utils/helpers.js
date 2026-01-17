/**
 * E2E 测试工具函数
 * 提供常用的页面操作和断言辅助
 */

/**
 * 等待页面加载完成
 * @param {import('@playwright/test').Page} page
 */
export async function waitForPageLoad(page) {
  await page.waitForLoadState('networkidle');
  // uni-app 使用 Vue，等待 Vue 渲染完成
  await page.waitForTimeout(500);
}

/**
 * 等待 Toast 消息出现
 * @param {import('@playwright/test').Page} page
 * @param {string} text - Toast 文本内容
 * @param {number} timeout - 超时时间（毫秒）
 */
export async function waitForToast(page, text, timeout = 5000) {
  const toast = page.locator('.uni-toast, .uni-popup__wrapper').filter({ hasText: text });
  await toast.waitFor({ state: 'visible', timeout });
  return toast;
}

/**
 * 等待 Loading 消失
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout - 超时时间（毫秒）
 */
export async function waitForLoadingHidden(page, timeout = 10000) {
  const loading = page.locator('.uni-loading, .uni-mask');
  try {
    await loading.waitFor({ state: 'hidden', timeout });
  } catch {
    // loading 可能不存在，忽略错误
  }
}

/**
 * 点击 TabBar 项
 * @param {import('@playwright/test').Page} page
 * @param {string} tabName - Tab 名称（首页、项目、消息、知识、我的）
 */
export async function clickTabBar(page, tabName) {
  const tabItem = page.locator('.uni-tabbar__item').filter({ hasText: tabName });
  await tabItem.click();
  await waitForPageLoad(page);
}

/**
 * 导航到指定页面
 * @param {import('@playwright/test').Page} page
 * @param {string} path - 页面路径（如 /pages/login/login）
 */
export async function navigateTo(page, path) {
  const url = `/#${path}`;
  await page.goto(url);
  await waitForPageLoad(page);
}

/**
 * 模拟下拉刷新
 * @param {import('@playwright/test').Page} page
 */
export async function pullDownRefresh(page) {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const startX = viewport.width / 2;
  const startY = 100;
  const endY = 400;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 10 });
  await page.mouse.up();

  await waitForLoadingHidden(page);
}

/**
 * 滚动到底部（用于加载更多）
 * @param {import('@playwright/test').Page} page
 */
export async function scrollToBottom(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1000);
}

/**
 * 获取列表项数量
 * @param {import('@playwright/test').Page} page
 * @param {string} selector - 列表项选择器
 */
export async function getListItemCount(page, selector) {
  const items = page.locator(selector);
  return await items.count();
}

/**
 * 填写表单字段
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string>} fields - 字段名和值的映射
 */
export async function fillForm(page, fields) {
  for (const [name, value] of Object.entries(fields)) {
    const input = page.locator(`input[name="${name}"], textarea[name="${name}"]`);
    await input.fill(value);
  }
}

/**
 * 截图并保存
 * @param {import('@playwright/test').Page} page
 * @param {string} name - 截图名称
 */
export async function takeScreenshot(page, name) {
  await page.screenshot({
    path: `e2e-screenshots/${name}.png`,
    fullPage: true,
  });
}

/**
 * 模拟网络状态
 * @param {import('@playwright/test').Page} page
 * @param {'online' | 'offline' | 'slow-3g'} status - 网络状态
 */
export async function setNetworkStatus(page, status) {
  const context = page.context();
  switch (status) {
    case 'offline':
      await context.setOffline(true);
      break;
    case 'online':
      await context.setOffline(false);
      break;
    case 'slow-3g':
      // Playwright 不直接支持节流，但可以通过 CDP 实现
      break;
  }
}

/**
 * 清除本地存储
 * @param {import('@playwright/test').Page} page
 */
export async function clearStorage(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * 设置本地存储
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, any>} data - 存储数据
 */
export async function setStorage(page, data) {
  await page.evaluate((storageData) => {
    for (const [key, value] of Object.entries(storageData)) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }, data);
}

/**
 * 获取本地存储
 * @param {import('@playwright/test').Page} page
 * @param {string} key - 存储键名
 */
export async function getStorage(page, key) {
  return await page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, key);
}
