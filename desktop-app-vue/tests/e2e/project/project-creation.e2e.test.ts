/**
 * E2E测试 - 项目创建流程
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, waitForElement, fillForm, waitForText } from '../helpers/common';

test.describe('项目创建流程', () => {
  test('应该能够创建新项目', async () => {
    const { app, page } = await launchApp();

    try {
      // 1. 等待应用加载完成
      await waitForElement(page, '[data-testid="app-loaded"]');

      // 2. 点击"新建项目"按钮
      await page.click('[data-testid="new-project-btn"]');

      // 3. 等待项目创建表单出现
      await waitForElement(page, '[data-testid="project-form"]');

      // 4. 填写项目信息
      await fillForm(page, {
        '[data-testid="project-name"]': 'E2E测试项目',
        '[data-testid="project-desc"]': '这是一个E2E测试创建的项目',
      });

      // 5. 选择项目类型
      await page.selectOption('[data-testid="project-type"]', 'python');

      // 6. 点击创建按钮
      await page.click('[data-testid="create-project-btn"]');

      // 7. 等待项目创建成功
      await waitForText(page, '项目创建成功');

      // 8. 验证项目出现在列表中
      const projectCard = await page.$('[data-testid="project-card"]');
      expect(projectCard).toBeTruthy();

      // 9. 验证项目名称
      const projectName = await page.textContent('[data-testid="project-name"]');
      expect(projectName).toContain('E2E测试项目');

    } finally {
      await closeApp(app);
    }
  });

  test('应该验证必填字段', async () => {
    const { app, page } = await launchApp();

    try {
      // 1. 打开项目创建表单
      await page.click('[data-testid="new-project-btn"]');
      await waitForElement(page, '[data-testid="project-form"]');

      // 2. 不填写任何信息,直接点击创建
      await page.click('[data-testid="create-project-btn"]');

      // 3. 应该显示验证错误
      await waitForText(page, '请输入项目名称');

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够取消项目创建', async () => {
    const { app, page } = await launchApp();

    try {
      // 1. 打开项目创建表单
      await page.click('[data-testid="new-project-btn"]');
      await waitForElement(page, '[data-testid="project-form"]');

      // 2. 填写部分信息
      await page.fill('[data-testid="project-name"]', '临时项目');

      // 3. 点击取消按钮
      await page.click('[data-testid="cancel-btn"]');

      // 4. 表单应该关闭
      const form = await page.$('[data-testid="project-form"]');
      expect(form).toBeNull();

    } finally {
      await closeApp(app);
    }
  });
});

test.describe('项目管理', () => {
  test('应该能够打开已存在的项目', async () => {
    const { app, page } = await launchApp();

    try {
      // 假设已有项目存在
      await waitForElement(page, '[data-testid="project-card"]');

      // 点击项目卡片
      await page.click('[data-testid="project-card"]');

      // 等待项目详情页加载
      await waitForElement(page, '[data-testid="project-detail"]');

      // 验证文件树显示
      const fileTree = await page.$('[data-testid="file-tree"]');
      expect(fileTree).toBeTruthy();

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够编辑项目信息', async () => {
    const { app, page } = await launchApp();

    try {
      // 打开项目
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="project-detail"]');

      // 点击编辑按钮
      await page.click('[data-testid="edit-project-btn"]');

      // 修改项目描述
      await page.fill('[data-testid="project-desc"]', '更新后的项目描述');

      // 保存修改
      await page.click('[data-testid="save-btn"]');

      // 验证保存成功
      await waitForText(page, '保存成功');

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够删除项目', async () => {
    const { app, page } = await launchApp();

    try {
      // 在项目卡片上右键
      await page.click('[data-testid="project-card"]', { button: 'right' });

      // 点击删除选项
      await page.click('[data-testid="delete-project-menu"]');

      // 确认删除
      await page.click('[data-testid="confirm-delete-btn"]');

      // 验证项目已删除
      await waitForText(page, '项目已删除');

      // 项目卡片应该消失
      const projectCard = await page.$('[data-testid="project-card"]');
      expect(projectCard).toBeNull();

    } finally {
      await closeApp(app);
    }
  });
});
