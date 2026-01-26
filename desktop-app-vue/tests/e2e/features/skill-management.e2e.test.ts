/**
 * 技能管理 E2E 测试
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('技能管理功能', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // 启动 Electron 应用
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    // 获取主窗口
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('应该能够打开技能管理页面', async () => {
    // 等待应用加载
    await window.waitForTimeout(2000);

    // 导航到技能管理页面
    await window.click('text=技能管理');

    // 验证页面标题
    const title = await window.textContent('h1');
    expect(title).toContain('技能管理');
  });

  test('应该显示技能列表', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 验证技能卡片存在
    const skillCards = await window.$$('.skill-card');
    expect(skillCards.length).toBeGreaterThan(0);
  });

  test('应该能够搜索技能', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 输入搜索关键词
    await window.fill('input[placeholder*="搜索"]', '代码');
    await window.waitForTimeout(500);

    // 验证搜索结果
    const results = await window.$$('.skill-card');
    expect(results.length).toBeGreaterThan(0);

    // 清空搜索
    await window.fill('input[placeholder*="搜索"]', '');
  });

  test('应该能够筛选技能分类', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 选择分类筛选
    await window.click('[placeholder="分类筛选"]');
    await window.click('text=代码开发');
    await window.waitForTimeout(500);

    // 验证筛选结果
    const codeSkills = await window.$$('.skill-card');
    expect(codeSkills.length).toBeGreaterThan(0);
  });

  test('应该能够查看技能详情', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 点击第一个技能的详情按钮
    await window.click('.skill-card button:has-text("详情")');
    await window.waitForTimeout(500);

    // 验证抽屉打开
    const drawer = await window.$('.ant-drawer');
    expect(drawer).toBeTruthy();

    // 关闭抽屉
    await window.press('Escape');
  });

  test('应该能够打开技能编辑器', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 点击创建技能按钮
    await window.click('button:has-text("创建技能")');
    await window.waitForTimeout(500);

    // 验证模态框打开
    const modal = await window.$('.ant-modal');
    expect(modal).toBeTruthy();

    // 关闭模态框
    await window.press('Escape');
  });

  test('应该能够查看统计分析', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 点击统计分析按钮
    await window.click('button:has-text("统计分析")');
    await window.waitForTimeout(1000);

    // 验证统计图表显示
    const statsModal = await window.$('.ant-modal:has-text("统计分析")');
    expect(statsModal).toBeTruthy();

    // 关闭模态框
    await window.press('Escape');
  });

  test('应该能够查看依赖关系图', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 点击依赖关系图按钮
    await window.click('button:has-text("依赖关系图")');
    await window.waitForTimeout(1500);

    // 验证关系图显示
    const graphModal = await window.$('.ant-modal:has-text("依赖关系图")');
    expect(graphModal).toBeTruthy();

    // 关闭模态框
    await window.press('Escape');
  });

  test('应该能够启用/禁用技能', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 获取第一个技能的开关状态
    const switchBtn = await window.$('.skill-card .ant-switch');
    const isChecked = await switchBtn?.getAttribute('class');
    const wasEnabled = isChecked?.includes('ant-switch-checked');

    // 切换开关
    await switchBtn?.click();
    await window.waitForTimeout(500);

    // 验证状态改变（通过消息提示）
    const message = await window.$('.ant-message');
    expect(message).toBeTruthy();
  });

  test('应该显示正确的统计信息', async () => {
    await window.click('text=技能管理');
    await window.waitForTimeout(1000);

    // 获取页面头部的统计信息
    const totalCount = await window.textContent('.ant-statistic:has-text("总技能数") .ant-statistic-content');
    const enabledCount = await window.textContent('.ant-statistic:has-text("已启用") .ant-statistic-content');

    // 验证统计数字
    expect(parseInt(totalCount || '0')).toBeGreaterThan(0);
    expect(parseInt(enabledCount || '0')).toBeGreaterThan(0);
  });
});
