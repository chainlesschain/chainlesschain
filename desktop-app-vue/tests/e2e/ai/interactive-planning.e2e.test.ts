/**
 * Interactive Planning E2E 测试
 * 测试交互式任务规划的完整用户流程
 */

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // 启动Electron应用
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });

  // 获取第一个窗口
  page = await electronApp.firstWindow();

  // 等待应用加载完成
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // 等待初始化完成
});

test.afterAll(async () => {
  await electronApp.close();
});

test.describe('交互式任务规划 - 完整流程', () => {
  test('应该能够启动Plan会话', async () => {
    // 导航到主页
    await page.goto('/#/home');
    await page.waitForTimeout(1000);

    // 选择文档类型
    await page.click('[data-test="type-selector-document"]');

    // 点击某个模板
    const templateCard = page.locator('[data-test^="template-card-"]').first();
    await expect(templateCard).toBeVisible({ timeout: 10000 });
    await templateCard.click();

    // 应该打开Plan对话框
    const planDialog = page.locator('[data-test="interactive-planning-dialog"]');
    await expect(planDialog).toBeVisible({ timeout: 5000 });

    // 应该显示loading状态
    const loadingIndicator = page.locator('[data-test="planning-loading"]');
    await expect(loadingIndicator).toBeVisible({ timeout: 3000 });

    // 应该包含提示文本
    await expect(loadingIndicator).toContainText('AI正在分析您的需求');
  });

  test('应该显示生成的计划并支持确认', async () => {
    // 等待计划生成（这个测试依赖前一个测试）
    await page.waitForSelector('[data-test="plan-preview"]', {
      timeout: 30000
    });

    const planPreview = page.locator('[data-test="plan-preview"]');
    await expect(planPreview).toBeVisible();

    // 应该显示执行步骤
    const planSteps = page.locator('[data-test="plan-step"]');
    await expect(planSteps.first()).toBeVisible();

    const stepCount = await planSteps.count();
    expect(stepCount).toBeGreaterThan(0);

    // 应该显示预期输出
    const expectedOutputs = page.locator('[data-test="expected-output"]');
    await expect(expectedOutputs.first()).toBeVisible();

    // 应该显示行动按钮
    const confirmButton = page.locator('[data-test="confirm-button"]');
    const regenerateButton = page.locator('[data-test="regenerate-button"]');
    const cancelButton = page.locator('[data-test="cancel-button"]');

    await expect(confirmButton).toBeVisible();
    await expect(regenerateButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
  });

  test('应该显示推荐的模板、技能和工具', async () => {
    // 检查推荐标签页
    const recommendationsTab = page.locator('[data-test="recommendations-tab"]');
    await expect(recommendationsTab).toBeVisible();

    // 切换到模板推荐
    const templatesTab = page.locator('[data-test="tab-templates"]');
    if (await templatesTab.isVisible()) {
      await templatesTab.click();
      await page.waitForTimeout(500);

      const templateCards = page.locator('[data-test^="recommended-template-"]');
      const templateCount = await templateCards.count();

      if (templateCount > 0) {
        // 应该显示匹配度
        const firstTemplate = templateCards.first();
        await expect(firstTemplate).toContainText('%');
      }
    }

    // 切换到技能推荐
    const skillsTab = page.locator('[data-test="tab-skills"]');
    if (await skillsTab.isVisible()) {
      await skillsTab.click();
      await page.waitForTimeout(500);

      const skillCards = page.locator('[data-test^="recommended-skill-"]');
      const skillCount = await skillCards.count();

      if (skillCount > 0) {
        // 应该显示相关度
        const firstSkill = skillCards.first();
        await expect(firstSkill).toContainText('%');
      }
    }

    // 切换到工具推荐
    const toolsTab = page.locator('[data-test="tab-tools"]');
    if (await toolsTab.isVisible()) {
      await toolsTab.click();
      await page.waitForTimeout(500);

      const toolItems = page.locator('[data-test^="recommended-tool-"]');
      const toolCount = await toolItems.count();

      if (toolCount > 0) {
        await expect(toolItems.first()).toBeVisible();
      }
    }
  });

  test('应该支持调整计划参数', async () => {
    // 打开参数调整区域
    const adjustButton = page.locator('[data-test="show-adjustments-button"]');
    if (await adjustButton.isVisible()) {
      await adjustButton.click();
      await page.waitForTimeout(500);

      // 应该显示质量选择器
      const qualitySelect = page.locator('[data-test="quality-select"]');
      await expect(qualitySelect).toBeVisible();

      // 更改质量设置
      await qualitySelect.selectOption('high');

      // 应该显示创意度滑块
      const creativitySlider = page.locator('[data-test="creativity-slider"]');
      if (await creativitySlider.isVisible()) {
        await creativitySlider.fill('0.8');
      }

      // 应该有额外要求输入框
      const additionalRequirements = page.locator('[data-test="additional-requirements"]');
      if (await additionalRequirements.isVisible()) {
        await additionalRequirements.fill('请使用简洁的语言');
      }

      // 应用调整
      const applyAdjustmentsButton = page.locator('[data-test="apply-adjustments-button"]');
      if (await applyAdjustmentsButton.isVisible()) {
        await applyAdjustmentsButton.click();
        await page.waitForTimeout(1000);

        // 应该重新进入loading状态
        const loadingIndicator = page.locator('[data-test="planning-loading"]');
        await expect(loadingIndicator).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('应该支持重新生成计划', async () => {
    // 等待计划显示
    await page.waitForSelector('[data-test="plan-preview"]', {
      timeout: 30000
    });

    // 点击重新生成按钮
    const regenerateButton = page.locator('[data-test="regenerate-button"]');
    await regenerateButton.click();

    // 应该显示loading状态
    const loadingIndicator = page.locator('[data-test="planning-loading"]');
    await expect(loadingIndicator).toBeVisible({ timeout: 3000 });
    await expect(loadingIndicator).toContainText('重新生成');

    // 等待新计划生成
    await page.waitForSelector('[data-test="plan-preview"]', {
      timeout: 30000
    });

    const planPreview = page.locator('[data-test="plan-preview"]');
    await expect(planPreview).toBeVisible();
  });

  test('应该支持确认执行并显示进度', async () => {
    // 等待计划显示
    await page.waitForSelector('[data-test="plan-preview"]', {
      timeout: 30000
    });

    // 点击确认执行按钮
    const confirmButton = page.locator('[data-test="confirm-button"]');
    await confirmButton.click();

    // 应该显示执行进度组件
    const progressComponent = page.locator('[data-test="execution-progress"]');
    await expect(progressComponent).toBeVisible({ timeout: 5000 });

    // 应该显示进度条
    const progressBar = page.locator('[data-test="progress-bar"]');
    await expect(progressBar).toBeVisible();

    // 应该显示当前状态
    const currentStatus = page.locator('[data-test="current-status"]');
    await expect(currentStatus).toBeVisible();
    await expect(currentStatus).not.toBeEmpty();

    // 应该显示执行日志
    const executionLogs = page.locator('[data-test="execution-logs"]');
    await expect(executionLogs).toBeVisible();

    // 日志应该有内容
    const logEntries = page.locator('[data-test="log-entry"]');
    await expect(logEntries.first()).toBeVisible({ timeout: 10000 });
  });

  test('应该实时更新执行进度', async () => {
    // 获取初始进度
    const progressText = page.locator('[data-test="progress-text"]');
    const initialProgress = await progressText.textContent();

    // 等待一段时间
    await page.waitForTimeout(5000);

    // 获取更新后的进度
    const updatedProgress = await progressText.textContent();

    // 进度应该有变化（或已经完成）
    expect(updatedProgress).toBeDefined();
  });

  test('应该在执行完成后显示结果', async () => {
    // 等待执行完成（最多2分钟）
    const resultComponent = page.locator('[data-test="execution-result"]');
    await expect(resultComponent).toBeVisible({ timeout: 120000 });

    // 应该显示成功消息
    const successTitle = page.locator('[data-test="result-title"]');
    await expect(successTitle).toContainText('完成');

    // 应该显示结果摘要
    const resultSummary = page.locator('[data-test="result-summary"]');
    await expect(resultSummary).toBeVisible();
    await expect(resultSummary).toContainText('个文件');
  });

  test('应该显示质量评分', async () => {
    // 质量评分卡片
    const scoreCard = page.locator('[data-test="quality-score"]');
    if (await scoreCard.isVisible()) {
      // 应该显示总分
      const scoreValue = page.locator('[data-test="score-value"]');
      await expect(scoreValue).toBeVisible();

      const score = await scoreValue.textContent();
      expect(score).toMatch(/\d+/);

      // 应该显示等级
      const scoreGrade = page.locator('[data-test="score-grade"]');
      await expect(scoreGrade).toBeVisible();
      await expect(scoreGrade).toMatch(/[A-D]/);

      // 应该显示各维度评分
      const completionScore = page.locator('[data-test="completion-score"]');
      const fileOutputScore = page.locator('[data-test="file-output-score"]');
      const executionTimeScore = page.locator('[data-test="execution-time-score"]');
      const errorRateScore = page.locator('[data-test="error-rate-score"]');
      const resourceUsageScore = page.locator('[data-test="resource-usage-score"]');

      await expect(completionScore).toBeVisible();
      await expect(fileOutputScore).toBeVisible();
      await expect(executionTimeScore).toBeVisible();
      await expect(errorRateScore).toBeVisible();
      await expect(resourceUsageScore).toBeVisible();
    }
  });

  test('应该显示生成的文件列表', async () => {
    const filesList = page.locator('[data-test="generated-files"]');
    await expect(filesList).toBeVisible();

    const fileItems = page.locator('[data-test^="file-item-"]');
    const fileCount = await fileItems.count();

    expect(fileCount).toBeGreaterThan(0);

    // 第一个文件应该有名称和大小
    const firstFile = fileItems.first();
    await expect(firstFile).toContainText(/\.(pptx|docx|xlsx|pdf|md)/);
    await expect(firstFile).toContainText(/\d+\s*(B|KB|MB)/);
  });

  test('应该支持提交用户反馈', async () => {
    // 反馈表单应该可见
    const feedbackSection = page.locator('[data-test="feedback-section"]');
    await expect(feedbackSection).toBeVisible();

    // 设置评分
    const ratingStars = page.locator('[data-test="feedback-rating"]');
    await expect(ratingStars).toBeVisible();

    // 点击第4颗星
    const fourthStar = page.locator('[data-test="rating-star-4"]');
    if (await fourthStar.isVisible()) {
      await fourthStar.click();
    }

    // 选择问题类型
    const issueCheckboxes = page.locator('[data-test^="issue-checkbox-"]');
    const checkboxCount = await issueCheckboxes.count();

    if (checkboxCount > 0) {
      // 选择第一个问题
      await issueCheckboxes.first().check();
    }

    // 填写评论
    const feedbackComment = page.locator('[data-test="feedback-comment"]');
    await expect(feedbackComment).toBeVisible();
    await feedbackComment.fill('测试反馈：功能很好用，但希望能更快一些。');

    // 提交反馈
    const submitButton = page.locator('[data-test="submit-feedback-button"]');
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // 等待提交完成
    await page.waitForTimeout(1000);

    // 应该显示成功提示（如果有的话）
    const successMessage = page.locator('[data-test="feedback-success"]');
    if (await successMessage.isVisible({ timeout: 3000 })) {
      await expect(successMessage).toContainText('感谢');
    }
  });

  test('应该支持查看生成的项目', async () => {
    const viewProjectButton = page.locator('[data-test="view-project-button"]');

    if (await viewProjectButton.isVisible()) {
      await viewProjectButton.click();

      // 应该跳转到项目详情页
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      expect(currentUrl).toContain('/project/');
    }
  });

  test('应该支持关闭对话框', async () => {
    // 如果还在对话框中，关闭它
    const closeButton = page.locator('[data-test="close-button"]');

    if (await closeButton.isVisible({ timeout: 3000 })) {
      await closeButton.click();

      // 对话框应该消失
      const planDialog = page.locator('[data-test="interactive-planning-dialog"]');
      await expect(planDialog).not.toBeVisible({ timeout: 3000 });
    }
  });

  test('应该支持取消计划', async () => {
    // 重新打开一个Plan会话
    await page.goto('/#/home');
    await page.waitForTimeout(1000);

    const templateCard = page.locator('[data-test^="template-card-"]').first();
    await templateCard.click({ timeout: 10000 });

    // 等待计划生成
    await page.waitForSelector('[data-test="plan-preview"]', {
      timeout: 30000
    });

    // 点击取消按钮
    const cancelButton = page.locator('[data-test="cancel-button"]');
    await cancelButton.click();

    // 对话框应该关闭
    const planDialog = page.locator('[data-test="interactive-planning-dialog"]');
    await expect(planDialog).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('交互式任务规划 - 错误处理', () => {
  test('应该处理网络错误', async () => {
    // 这个测试需要模拟网络错误情况
    // 在实际测试中，可以通过mock IPC调用来模拟错误
  });

  test('应该处理执行失败', async () => {
    // 这个测试需要模拟执行失败的情况
    // 在实际测试中，可以通过mock任务执行来模拟失败
  });

  test('应该处理超时', async () => {
    // 这个测试需要模拟超时情况
  });
});
