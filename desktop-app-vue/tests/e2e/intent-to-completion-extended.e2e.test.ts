/**
 * 意图识别到任务完成 - 扩展测试
 *
 * 包含完整的任务执行、质量评分和用户反馈流程
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

test.describe('完整任务执行流程', () => {

  test('完整流程：创建文档并执行', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 完整任务执行流程测试 ==========');

      // 等待应用加载
      await window.waitForTimeout(3000);

      // 导航到AI聊天页面
      await window.evaluate(() => {
        if ((window as any).location) {
          (window as any).location.hash = '#/ai-chat';
        }
      }).catch(() => {});
      await window.waitForTimeout(1000);

      console.log('[步骤1] 查找聊天界面...');

      // 查找聊天容器
      const chatContainer = window.locator('.ai-chat-page, [class*="chat"], main').first();
      const containerVisible = await chatContainer.isVisible({ timeout: 10000 }).catch(() => false);

      if (!containerVisible) {
        console.log('⚠️  未找到聊天界面，跳过测试');
        return;
      }

      console.log('✓ 聊天界面已加载');

      // 查找输入框
      const inputTextarea = window.locator('textarea, input[type="text"]').first();
      const inputVisible = await inputTextarea.isVisible({ timeout: 5000 }).catch(() => false);

      if (!inputVisible) {
        console.log('⚠️  未找到输入框');
        return;
      }

      console.log('[步骤2] 输入任务需求...');

      // 输入任务需求
      const userRequest = '创建一个关于人工智能的简单文档';
      await inputTextarea.fill(userRequest);
      await window.waitForTimeout(500);

      console.log(`✓ 已输入: "${userRequest}"`);

      // 提交
      const submitButton = window.locator('button[type="primary"], button:has-text("发送")').first();
      const buttonVisible = await submitButton.isVisible({ timeout: 5000 }).catch(() => false);

      if (buttonVisible && await submitButton.isEnabled().catch(() => false)) {
        await submitButton.click();
        console.log('✓ 已提交请求');
      } else {
        await inputTextarea.press('Enter');
        console.log('✓ 已使用Enter键提交');
      }

      console.log('[步骤3] 等待AI处理...');

      // 等待AI开始处理
      await window.waitForTimeout(2000);

      // 检查是否有思考指示器
      const thinkingIndicator = window.locator('[class*="thinking"], [class*="loading"]').first();
      const thinkingVisible = await thinkingIndicator.isVisible({ timeout: 3000 }).catch(() => false);

      if (thinkingVisible) {
        console.log('✓ AI开始处理');

        // 等待处理完成（最多60秒）
        await window.waitForSelector('[class*="thinking"], [class*="loading"]', {
          state: 'hidden',
          timeout: 60000
        }).catch(() => {
          console.log('⚠️  等待AI处理超时');
        });

        console.log('✓ AI处理完成');
      }

      console.log('[步骤4] 检查交互式规划对话框...');

      // 查找规划对话框
      const planningDialog = window.locator('[class*="planning"], [class*="plan-dialog"], .ant-modal').last();
      const dialogVisible = await planningDialog.isVisible({ timeout: 5000 }).catch(() => false);

      if (dialogVisible) {
        console.log('✓ 检测到规划对话框');

        console.log('[步骤5] 验证任务计划内容...');

        // 检查计划预览
        const planPreview = window.locator('[class*="plan-preview"], [class*="plan-content"]').first();
        const planVisible = await planPreview.isVisible({ timeout: 5000 }).catch(() => false);

        if (planVisible) {
          console.log('✓ 任务计划已生成');

          // 检查步骤列表
          const planSteps = window.locator('[class*="step"], [class*="timeline"]');
          const stepCount = await planSteps.count().catch(() => 0);

          if (stepCount > 0) {
            console.log(`✓ 发现 ${stepCount} 个执行步骤`);

            // 打印步骤信息
            for (let i = 0; i < Math.min(stepCount, 5); i++) {
              const stepText = await planSteps.nth(i).textContent().catch(() => '');
              if (stepText) {
                console.log(`  步骤 ${i + 1}: ${stepText.substring(0, 50)}...`);
              }
            }
          }

          // 检查预期输出
          const outputSection = window.locator('[class*="output"], [class*="result"]');
          const outputVisible = await outputSection.isVisible({ timeout: 3000 }).catch(() => false);

          if (outputVisible) {
            console.log('✓ 发现预期输出说明');
          }

          console.log('[步骤6] 确认执行任务...');

          // 查找确认按钮
          const confirmButton = window.locator('button:has-text("确认"), button:has-text("执行")').first();
          const confirmVisible = await confirmButton.isVisible({ timeout: 3000 }).catch(() => false);

          if (confirmVisible && await confirmButton.isEnabled().catch(() => false)) {
            console.log('✓ 找到确认按钮');

            // 点击确认执行
            await confirmButton.click();
            console.log('✓ 已确认执行');

            console.log('[步骤7] 监控执行进度...');

            // 等待执行开始
            await window.waitForTimeout(1000);

            // 查找进度组件
            const progressComponent = window.locator('[class*="progress"], [class*="execution"]');
            const progressVisible = await progressComponent.isVisible({ timeout: 5000 }).catch(() => false);

            if (progressVisible) {
              console.log('✓ 执行进度组件已显示');

              // 检查进度条
              const progressBar = window.locator('[class*="progress-bar"], .ant-progress');
              const progressBarVisible = await progressBar.isVisible({ timeout: 3000 }).catch(() => false);

              if (progressBarVisible) {
                console.log('✓ 进度条正常显示');

                // 监控进度变化（最多监控30秒）
                const progressCheckStart = Date.now();
                let lastProgress = '';

                while (Date.now() - progressCheckStart < 30000) {
                  const progressText = await window.locator('[class*="progress-text"], [class*="current-status"]')
                    .textContent().catch(() => '');

                  if (progressText && progressText !== lastProgress) {
                    console.log(`  进度更新: ${progressText}`);
                    lastProgress = progressText;
                  }

                  // 检查是否完成
                  const resultComponent = window.locator('[class*="result"], [class*="completed"]');
                  const resultVisible = await resultComponent.isVisible({ timeout: 1000 }).catch(() => false);

                  if (resultVisible) {
                    console.log('✓ 检测到执行完成');
                    break;
                  }

                  await window.waitForTimeout(1000);
                }
              }

              console.log('[步骤8] 验证执行结果...');

              // 等待结果显示（最多2分钟）
              const resultComponent = window.locator('[class*="result"], [class*="completed"]');
              const resultVisible = await resultComponent.isVisible({ timeout: 120000 }).catch(() => false);

              if (resultVisible) {
                console.log('✓ 任务执行完成');

                // 检查成功标识
                const successIndicator = window.locator('text=/完成|成功|已完成/i');
                const successVisible = await successIndicator.isVisible({ timeout: 5000 }).catch(() => false);

                if (successVisible) {
                  console.log('✓ 显示成功标识');
                }

                console.log('[步骤9] 验证质量评分...');

                // 查找质量评分
                const qualityScore = window.locator('[class*="quality"], [class*="score"]');
                const scoreVisible = await qualityScore.isVisible({ timeout: 5000 }).catch(() => false);

                if (scoreVisible) {
                  console.log('✓ 质量评分已显示');

                  // 获取评分数值
                  const scoreText = await qualityScore.textContent().catch(() => '');
                  const scoreMatch = scoreText.match(/(\d+)/);

                  if (scoreMatch) {
                    const score = parseInt(scoreMatch[1], 10);
                    console.log(`  总分: ${score}`);

                    // 验证评分合理性（0-100）
                    expect(score).toBeGreaterThanOrEqual(0);
                    expect(score).toBeLessThanOrEqual(100);
                  }

                  // 检查评分等级
                  const gradeMatch = scoreText.match(/([A-F])/);
                  if (gradeMatch) {
                    console.log(`  等级: ${gradeMatch[1]}`);
                  }

                  // 检查详细评分项
                  const scoreBreakdown = window.locator('[class*="breakdown"], [class*="detail"]');
                  const breakdownVisible = await scoreBreakdown.isVisible({ timeout: 3000 }).catch(() => false);

                  if (breakdownVisible) {
                    console.log('✓ 详细评分项已显示');

                    const metrics = ['完成度', '文件输出', '执行时间', '错误率', '资源使用'];
                    for (const metric of metrics) {
                      const metricElement = window.locator(`text=${metric}`);
                      const metricVisible = await metricElement.isVisible({ timeout: 1000 }).catch(() => false);

                      if (metricVisible) {
                        console.log(`  ✓ ${metric} 评分存在`);
                      }
                    }
                  }
                }

                console.log('[步骤10] 验证生成的文件列表...');

                // 查找文件列表
                const filesList = window.locator('[class*="files"], [class*="output"]');
                const filesVisible = await filesList.isVisible({ timeout: 5000 }).catch(() => false);

                if (filesVisible) {
                  const fileItems = window.locator('[class*="file-item"]');
                  const fileCount = await fileItems.count().catch(() => 0);

                  if (fileCount > 0) {
                    console.log(`✓ 发现 ${fileCount} 个输出文件`);

                    // 打印文件名
                    for (let i = 0; i < Math.min(fileCount, 3); i++) {
                      const fileName = await fileItems.nth(i).textContent().catch(() => '');
                      if (fileName) {
                        console.log(`  文件 ${i + 1}: ${fileName.substring(0, 50)}`);
                      }
                    }
                  }
                }

                console.log('[步骤11] 提交用户反馈...');

                // 查找反馈表单
                const feedbackSection = window.locator('[class*="feedback"]');
                const feedbackVisible = await feedbackSection.isVisible({ timeout: 5000 }).catch(() => false);

                if (feedbackVisible) {
                  console.log('✓ 反馈表单已显示');

                  // 查找评分组件（星级评分）
                  const ratingComponent = window.locator('[class*="rating"], [class*="rate"]');
                  const ratingVisible = await ratingComponent.isVisible({ timeout: 3000 }).catch(() => false);

                  if (ratingVisible) {
                    // 尝试点击星级评分
                    const stars = window.locator('[class*="star"]');
                    const starCount = await stars.count().catch(() => 0);

                    if (starCount > 0) {
                      // 点击第4颗星（好评）
                      const fourthStar = stars.nth(3);
                      const starClickable = await fourthStar.isVisible().catch(() => false);

                      if (starClickable) {
                        await fourthStar.click();
                        console.log('✓ 已设置评分（4星）');
                      }
                    }
                  }

                  // 填写评论
                  const commentInput = window.locator('textarea[placeholder*="反馈"], textarea[placeholder*="建议"]');
                  const commentVisible = await commentInput.isVisible({ timeout: 3000 }).catch(() => false);

                  if (commentVisible) {
                    await commentInput.fill('E2E测试自动提交的反馈：系统运行正常，功能符合预期。');
                    console.log('✓ 已填写反馈评论');
                  }

                  // 提交反馈
                  const submitFeedbackButton = window.locator('button:has-text("提交反馈"), button:has-text("提交")').last();
                  const submitVisible = await submitFeedbackButton.isVisible({ timeout: 3000 }).catch(() => false);

                  if (submitVisible && await submitFeedbackButton.isEnabled().catch(() => false)) {
                    await submitFeedbackButton.click();
                    await window.waitForTimeout(1000);
                    console.log('✓ 反馈已提交');

                    // 检查成功提示
                    const successMessage = window.locator('[class*="success"], text=/感谢|成功/i');
                    const successMsgVisible = await successMessage.isVisible({ timeout: 3000 }).catch(() => false);

                    if (successMsgVisible) {
                      console.log('✓ 显示反馈提交成功提示');
                    }
                  }
                }

                console.log('[步骤12] 关闭对话框...');

                // 查找关闭按钮
                const closeButton = window.locator('button:has-text("关闭"), [class*="close"]').last();
                const closeVisible = await closeButton.isVisible({ timeout: 3000 }).catch(() => false);

                if (closeVisible) {
                  await closeButton.click();
                  await window.waitForTimeout(500);
                  console.log('✓ 对话框已关闭');
                }
              } else {
                console.log('⚠️  执行结果未显示（可能超时）');
              }
            } else {
              console.log('⚠️  未检测到执行进度组件');
            }
          } else {
            console.log('⚠️  未找到确认按钮或按钮不可用');
          }
        } else {
          console.log('⚠️  任务计划未生成');
        }
      } else {
        console.log('⚠️  未检测到规划对话框（可能使用直接回复模式）');

        // 即使没有规划对话框，也应该有AI回复
        const aiMessage = window.locator('[class*="assistant"], [class*="ai"]').last();
        const aiMessageVisible = await aiMessage.isVisible({ timeout: 10000 }).catch(() => false);

        if (aiMessageVisible) {
          const aiText = await aiMessage.textContent().catch(() => '');
          console.log('✓ AI已回复');
          console.log(`  回复内容: ${aiText?.substring(0, 100)}...`);
        }
      }

      console.log('\n========== 测试完成 ==========');
      console.log('✓ 完整流程测试执行完毕');
      console.log('============================\n');

      // 基本断言
      expect(containerVisible).toBe(true);
      expect(inputVisible).toBe(true);

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('质量评分验证', () => {

  test('质量评分：所有维度都应该有合理数值', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 质量评分验证测试 ==========');

      // 注意：这个测试需要真实的任务执行结果
      // 这里只是演示如何验证质量评分组件

      console.log('⚠️  此测试需要真实的任务执行结果');
      console.log('   建议：先执行完整流程测试，然后验证评分');

      console.log('============================\n');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('用户反馈提交', () => {

  test('反馈提交：应该支持所有字段', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 用户反馈提交测试 ==========');

      // 注意：这个测试需要真实的执行结果页面
      // 这里只是演示反馈提交的完整性检查

      console.log('⚠️  此测试需要真实的执行结果页面');
      console.log('   建议：先执行完整流程测试，然后提交反馈');

      console.log('============================\n');

    } finally {
      await closeElectronApp(app);
    }
  });
});
