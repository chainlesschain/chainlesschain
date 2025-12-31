/**
 * E2E测试：全局设置向导完整流程
 * 使用Playwright测试Electron应用的UI交互
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testUserDataDir = path.join(os.tmpdir(), 'chainlesschain-e2e-test-' + Date.now());

test.describe('全局设置向导 E2E 测试', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // 创建临时用户数据目录
    if (!fs.existsSync(testUserDataDir)) {
      fs.mkdirSync(testUserDataDir, { recursive: true });
    }

    // 启动Electron应用
    electronApp = await electron.launch({
      args: [
        path.join(__dirname, '../../dist/main/index.js'),
        '--user-data-dir=' + testUserDataDir
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      }
    });

    // 获取第一个窗口
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    // 关闭应用
    await electronApp.close();

    // 清理测试数据
    if (fs.existsSync(testUserDataDir)) {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    }
  });

  test('首次启动应显示全局设置向导', async () => {
    // 等待向导对话框出现
    await window.waitForSelector('.ant-modal', { timeout: 10000 });

    // 验证标题
    const title = await window.locator('.ant-modal-title').textContent();
    expect(title).toContain('全局设置向导');

    // 验证步骤条
    const steps = await window.locator('.ant-steps-item').count();
    expect(steps).toBe(6); // 6个步骤
  });

  test('应完成6步向导流程', async () => {
    // 步骤0: 欢迎页面
    await expect(window.locator('text=欢迎使用 ChainlessChain')).toBeVisible();
    await window.click('button:has-text("下一步")');

    // 步骤1: 版本选择
    await window.waitForSelector('.edition-card', { timeout: 5000 });
    await window.click('.edition-card[data-edition="personal"]');
    await window.click('button:has-text("下一步")');

    // 步骤2: 项目路径
    await window.waitForSelector('input[placeholder*="项目文件"]', { timeout: 5000 });
    await window.fill('input[placeholder*="项目文件"]', 'C:\\test\\projects');
    await window.click('button:has-text("下一步")');

    // 步骤3: 数据库路径
    await window.waitForSelector('input[placeholder*="数据库"]', { timeout: 5000 });
    await window.fill('input[placeholder*="数据库"]', 'C:\\test\\db.sqlite');
    await window.click('button:has-text("下一步")');

    // 步骤4: LLM配置 (跳过)
    await window.waitForSelector('text=AI模型配置', { timeout: 5000 });
    await window.click('button:has-text("跳过")');
    await window.click('button:has-text("下一步")');

    // 步骤5: 完成页面
    await window.waitForSelector('text=配置摘要', { timeout: 5000 });
    await expect(window.locator('text=个人版')).toBeVisible();
    await window.click('button:has-text("完成设置")');

    // 等待向导关闭
    await window.waitForSelector('.ant-modal', { state: 'hidden', timeout: 10000 });
  });
});

test.describe('企业版服务器连接测试 E2E', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // 创建临时用户数据目录
    const tempDir = path.join(os.tmpdir(), 'chainlesschain-ent-test-' + Date.now());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 启动应用
    electronApp = await electron.launch({
      args: [
        path.join(__dirname, '../../dist/main/index.js'),
        '--user-data-dir=' + tempDir
      ]
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('应显示企业版连接测试按钮', async () => {
    // 等待向导打开
    await window.waitForSelector('.ant-modal', { timeout: 10000 });

    // 跳过欢迎页
    await window.click('button:has-text("下一步")');

    // 进入版本选择
    await window.waitForSelector('.edition-card', { timeout: 5000 });

    // 点击企业版卡片
    await window.click('.edition-card[data-edition="enterprise"]');

    // 等待企业版配置表单出现
    await window.waitForSelector('input[placeholder*="服务器地址"]', { timeout: 5000 });

    // 验证测试按钮存在
    await expect(window.locator('button:has-text("测试服务器连接")')).toBeVisible();
  });

  test('配置未完整时测试按钮应禁用', async () => {
    // 等待向导并进入企业版配置
    await window.waitForSelector('.ant-modal', { timeout: 10000 });
    await window.click('button:has-text("下一步")');
    await window.waitForSelector('.edition-card', { timeout: 5000 });
    await window.click('.edition-card[data-edition="enterprise"]');

    // 测试按钮应该禁用
    const testButton = window.locator('button:has-text("测试服务器连接")');
    await expect(testButton).toBeDisabled();
  });

  test('填写完整配置后测试按钮应启用', async () => {
    // 进入企业版配置
    await window.waitForSelector('.ant-modal', { timeout: 10000 });
    await window.click('button:has-text("下一步")');
    await window.waitForSelector('.edition-card', { timeout: 5000 });
    await window.click('.edition-card[data-edition="enterprise"]');

    // 填写完整配置
    await window.fill('input[placeholder*="服务器地址"]', 'https://test.com');
    await window.fill('input[placeholder*="租户ID"]', 'tenant-123');
    await window.fill('input[placeholder*="API密钥"]', 'api-key-456');

    // 测试按钮应该启用
    const testButton = window.locator('button:has-text("测试服务器连接")');
    await expect(testButton).not.toBeDisabled();
  });

  test('点击测试按钮应显示连接状态', async () => {
    // 进入企业版配置
    await window.waitForSelector('.ant-modal', { timeout: 10000 });
    await window.click('button:has-text("下一步")');
    await window.waitForSelector('.edition-card', { timeout: 5000 });
    await window.click('.edition-card[data-edition="enterprise"]');

    // 填写测试服务器配置（httpbin.org用于测试）
    await window.fill('input[placeholder*="服务器地址"]', 'https://httpbin.org');
    await window.fill('input[placeholder*="租户ID"]', 'test-tenant');
    await window.fill('input[placeholder*="API密钥"]', 'test-key');

    // 点击测试按钮
    await window.click('button:has-text("测试服务器连接")');

    // 等待测试完成 (显示成功或失败Alert)
    await window.waitForSelector('.ant-alert', { timeout: 15000 });

    // 验证Alert存在
    const alert = window.locator('.ant-alert');
    await expect(alert).toBeVisible();
  });
});

test.describe('配置导入导出 E2E', () => {
  let electronApp;
  let window;
  const tempDir = path.join(os.tmpdir(), 'chainlesschain-import-test-' + Date.now());

  test.beforeAll(async () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    electronApp = await electron.launch({
      args: [
        path.join(__dirname, '../../dist/main/index.js'),
        '--user-data-dir=' + tempDir
      ]
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('应显示导出配置按钮', async () => {
    // 等待向导打开
    await window.waitForSelector('.ant-modal', { timeout: 10000 });

    // 查找导出按钮
    const exportButton = window.locator('button:has-text("导出配置")');
    await expect(exportButton).toBeVisible();
  });

  test('应显示导入配置按钮', async () => {
    await window.waitForSelector('.ant-modal', { timeout: 10000 });

    const importButton = window.locator('button:has-text("导入配置")');
    await expect(importButton).toBeVisible();
  });
});

test.describe('路径选择器 E2E', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    const tempDir = path.join(os.tmpdir(), 'chainlesschain-path-test-' + Date.now());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    electronApp = await electron.launch({
      args: [
        path.join(__dirname, '../../dist/main/index.js'),
        '--user-data-dir=' + tempDir
      ]
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('应显示浏览按钮', async () => {
    // 进入项目路径步骤
    await window.waitForSelector('.ant-modal', { timeout: 10000 });
    await window.click('button:has-text("下一步")'); // 跳过欢迎
    await window.click('button:has-text("下一步")'); // 跳过版本选择

    // 验证浏览按钮存在
    const browseButton = window.locator('button:has-text("浏览")');
    await expect(browseButton).toBeVisible();
  });

  test('应允许手动输入路径', async () => {
    await window.waitForSelector('.ant-modal', { timeout: 10000 });
    await window.click('button:has-text("下一步")');
    await window.click('button:has-text("下一步")');

    // 手动输入路径
    const pathInput = window.locator('input[placeholder*="项目文件"]');
    await pathInput.fill('C:\\custom\\path');

    // 验证输入值
    const value = await pathInput.inputValue();
    expect(value).toBe('C:\\custom\\path');
  });
});

console.log('✅ E2E测试脚本已创建');
