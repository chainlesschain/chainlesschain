/**
 * E2E测试 - 代码执行流程
 *
 * 注意：这些测试需要实际的UI元素和功能实现
 * 当前标记为跳过，待UI实现后启用
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login } from './helpers';

test.describe.skip('代码执行流程', () => {
  test('应该能够创建并执行Python文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      // 1. 打开或创建项目
      await window.click('[data-testid="new-project-btn"]');
      await window.waitForSelector('[data-testid="project-form"]', { timeout: 5000 });
      await window.fill('[data-testid="project-name"]', 'Python测试项目');
      await window.selectOption('[data-testid="project-type"]', 'python');
      await window.click('[data-testid="create-project-btn"]');

      // 2. 等待项目打开
      await window.waitForSelector('[data-testid="project-detail"]', { timeout: 5000 });

      // 3. 创建新文件
      await window.click('[data-testid="new-file-btn"]');
      await window.fill('[data-testid="file-name"]', 'test.py');
      await window.click('[data-testid="create-file-btn"]');

      // 4. 等待编辑器加载
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 5. 输入Python代码
      const code = 'print("Hello from E2E test!")';
      await window.fill('[data-testid="code-editor"]', code);

      // 6. 点击运行按钮
      await window.click('[data-testid="run-code-btn"]');

      // 7. 等待执行完成
      await window.waitForSelector('text="执行成功"', { timeout: 5000 });

      // 8. 验证输出
      const output = await window.textContent('[data-testid="code-output"]');
      expect(output).toContain('Hello from E2E test!');

      // 9. 验证执行状态
      const status = await window.textContent('[data-testid="execution-status"]');
      expect(status).toContain('成功');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该显示代码执行错误', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入有错误的代码
      const badCode = 'print(undefined_variable)';
      await window.fill('[data-testid="code-editor"]', badCode);

      // 运行代码
      await window.click('[data-testid="run-code-btn"]');

      // 等待错误显示
      await window.waitForSelector('[data-testid="execution-error"]', { timeout: 5000 });

      // 验证错误信息
      const error = await window.textContent('[data-testid="execution-error"]');
      expect(error).toContain('NameError');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够停止正在运行的代码', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入长时间运行的代码
      const longCode = `
import time
for i in range(100):
    print(i)
    time.sleep(0.1)
      `;
      await window.fill('[data-testid="code-editor"]', longCode);

      // 运行代码
      await window.click('[data-testid="run-code-btn"]');

      // 等待一会儿
      await window.waitForTimeout(1000);

      // 点击停止按钮
      await window.click('[data-testid="stop-code-btn"]');

      // 验证停止状态
      await window.waitForSelector('text="已停止"', { timeout: 5000 });

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该显示代码执行进度', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入有进度输出的代码
      const code = `
for i in range(10):
    print(f"Progress: {i+1}/10")
      `;
      await window.fill('[data-testid="code-editor"]', code);

      // 运行代码
      await window.click('[data-testid="run-code-btn"]');

      // 等待进度显示
      await window.waitForSelector('[data-testid="execution-progress"]', { timeout: 5000 });

      // 验证进度条存在
      const progress = await window.$('[data-testid="execution-progress"]');
      expect(progress).toBeTruthy();

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe.skip('代码安全检查', () => {
  test('应该警告危险操作', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入危险代码
      const dangerousCode = 'import os; os.system("rm -rf /")';
      await window.fill('[data-testid="code-editor"]', dangerousCode);

      // 尝试运行
      await window.click('[data-testid="run-code-btn"]');

      // 应该显示警告
      await window.waitForSelector('[data-testid="security-warning"]', { timeout: 5000 });

      const warning = await window.textContent('[data-testid="security-warning"]');
      expect(warning).toContain('危险');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该允许用户强制执行危险代码', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入危险代码
      const dangerousCode = 'import os; os.system("echo test")';
      await window.fill('[data-testid="code-editor"]', dangerousCode);

      // 运行代码
      await window.click('[data-testid="run-code-btn"]');

      // 等待警告
      await window.waitForSelector('[data-testid="security-warning"]', { timeout: 5000 });

      // 点击强制执行
      await window.click('[data-testid="force-execute-btn"]');

      // 验证执行
      await window.waitForSelector('[data-testid="code-output"]', { timeout: 5000 });

    } finally {
      await closeElectronApp(app);
    }
  });
});
