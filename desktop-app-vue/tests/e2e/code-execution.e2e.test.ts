/**
 * E2E测试 - 代码执行流程
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, waitForElement, waitForText } from './helpers';

test.describe('代码执行流程', () => {
  test('应该能够创建并执行Python文件', async () => {
    const { app, page } = await launchApp();

    try {
      // 1. 打开或创建项目
      await page.click('[data-testid="new-project-btn"]');
      await waitForElement(page, '[data-testid="project-form"]');
      await page.fill('[data-testid="project-name"]', 'Python测试项目');
      await page.selectOption('[data-testid="project-type"]', 'python');
      await page.click('[data-testid="create-project-btn"]');

      // 2. 等待项目打开
      await waitForElement(page, '[data-testid="project-detail"]');

      // 3. 创建新文件
      await page.click('[data-testid="new-file-btn"]');
      await page.fill('[data-testid="file-name"]', 'test.py');
      await page.click('[data-testid="create-file-btn"]');

      // 4. 等待编辑器加载
      await waitForElement(page, '[data-testid="code-editor"]');

      // 5. 输入Python代码
      const code = 'print("Hello from E2E test!")';
      await page.fill('[data-testid="code-editor"]', code);

      // 6. 点击运行按钮
      await page.click('[data-testid="run-code-btn"]');

      // 7. 等待执行完成
      await waitForText(page, '执行成功');

      // 8. 验证输出
      const output = await page.textContent('[data-testid="code-output"]');
      expect(output).toContain('Hello from E2E test!');

      // 9. 验证执行状态
      const status = await page.textContent('[data-testid="execution-status"]');
      expect(status).toContain('成功');

    } finally {
      await closeApp(app);
    }
  });

  test('应该显示代码执行错误', async () => {
    const { app, page } = await launchApp();

    try {
      // 打开项目和文件
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入有语法错误的代码
      const badCode = 'print("missing quote';
      await page.fill('[data-testid="code-editor"]', badCode);

      // 运行代码
      await page.click('[data-testid="run-code-btn"]');

      // 等待执行失败
      await waitForText(page, '执行失败');

      // 验证错误信息
      const errorOutput = await page.textContent('[data-testid="error-output"]');
      expect(errorOutput).toContain('SyntaxError');

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够停止正在运行的代码', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入长时间运行的代码
      const longCode = `
import time
for i in range(100):
    print(f"Iteration {i}")
    time.sleep(1)
      `;
      await page.fill('[data-testid="code-editor"]', longCode);

      // 运行代码
      await page.click('[data-testid="run-code-btn"]');

      // 等待执行开始
      await waitForText(page, '执行中');

      // 点击停止按钮
      await page.click('[data-testid="stop-code-btn"]');

      // 验证执行已停止
      await waitForText(page, '已停止');

    } finally {
      await closeApp(app);
    }
  });

  test('应该显示代码执行进度', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入带输出的代码
      const code = `
for i in range(5):
    print(f"Step {i}")
      `;
      await page.fill('[data-testid="code-editor"]', code);

      // 运行代码
      await page.click('[data-testid="run-code-btn"]');

      // 验证进度显示
      await waitForElement(page, '[data-testid="execution-progress"]');

      // 等待完成
      await waitForText(page, '执行成功');

      // 验证输出包含所有步骤
      const output = await page.textContent('[data-testid="code-output"]');
      expect(output).toContain('Step 0');
      expect(output).toContain('Step 4');

    } finally {
      await closeApp(app);
    }
  });
});

test.describe('代码安全检查', () => {
  test('应该警告危险操作', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入包含危险操作的代码
      const dangerousCode = `
import os
os.system("rm -rf /")
      `;
      await page.fill('[data-testid="code-editor"]', dangerousCode);

      // 点击安全检查按钮
      await page.click('[data-testid="safety-check-btn"]');

      // 应该显示安全警告
      await waitForText(page, '检测到潜在危险操作');

      // 验证警告内容
      const warning = await page.textContent('[data-testid="safety-warning"]');
      expect(warning).toContain('os.system');

    } finally {
      await closeApp(app);
    }
  });

  test('应该允许用户强制执行危险代码', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入危险代码
      const dangerousCode = 'import subprocess\nsubprocess.call(["ls"])';
      await page.fill('[data-testid="code-editor"]', dangerousCode);

      // 运行代码(会被阻止)
      await page.click('[data-testid="run-code-btn"]');

      // 显示警告对话框
      await waitForElement(page, '[data-testid="danger-warning-dialog"]');

      // 选择强制执行
      await page.check('[data-testid="force-execute-checkbox"]');
      await page.click('[data-testid="confirm-execute-btn"]');

      // 代码应该执行
      await waitForText(page, '执行完成');

    } finally {
      await closeApp(app);
    }
  });
});
