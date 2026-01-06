/**
 * E2E测试 - Word文档预览功能
 * 测试 Word 文档预览是否能正常工作，没有 DOMParser/Node 错误
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';

test.describe('Word文档预览', () => {
  test('应该能够预览Word文档而不出现DOMParser错误', async () => {
    // 启动 Electron 应用
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    try {
      // 获取主窗口
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      console.log('[E2E] 应用已启动');

      // 等待应用完全加载
      await window.waitForTimeout(3000);

      // 查找项目ID（使用已知有Word文档的项目）
      const projectId = '2d201efc-dbc3-4500-ad87-b87964ac8ebd';
      const wordFilePath = path.join(
        '/Users/mac/Documents/code2/chainlesschain/data/projects',
        projectId,
        '项目总结报告.docx'
      );

      // 验证测试文件存在
      if (!fs.existsSync(wordFilePath)) {
        throw new Error(`测试 Word 文件不存在: ${wordFilePath}`);
      }

      console.log('[E2E] 测试Word文件路径:', wordFilePath);

      // 监听控制台错误
      const consoleErrors: string[] = [];
      window.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // 尝试通过 IPC 调用预览接口
      const result = await window.evaluate(async (filePath) => {
        try {
          // @ts-ignore
          const previewResult = await window.electronAPI.file.previewOffice(filePath, 'word');
          return {
            success: true,
            hasHtml: !!previewResult.data?.html,
            htmlLength: previewResult.data?.html?.length || 0,
            error: previewResult.error,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      }, wordFilePath);

      console.log('[E2E] Word预览结果:', result);

      // 验证结果
      expect(result.success).toBeTruthy();
      expect(result.hasHtml).toBeTruthy();
      expect(result.htmlLength).toBeGreaterThan(0);

      // 验证没有 DOMParser 或 Node 相关错误
      const hasParserError = consoleErrors.some(
        (err) => err.includes('DOMParser') || err.includes('Node is not defined')
      );
      expect(hasParserError).toBeFalsy();

      console.log('[E2E] ✅ Word预览测试通过');

      // 等待一下确保没有延迟的错误
      await window.waitForTimeout(2000);

      // 再次检查是否有新的错误
      const finalErrors = consoleErrors.filter(
        (err) => err.includes('DOMParser') || err.includes('Node is not defined')
      );
      expect(finalErrors.length).toBe(0);

    } finally {
      // 关闭应用
      await electronApp.close();
      console.log('[E2E] 应用已关闭');
    }
  });

  test('应该能够处理多个Word文档预览请求', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.waitForTimeout(3000);

      const wordFilePath = path.join(
        '/Users/mac/Documents/code2/chainlesschain/data/projects',
        '2d201efc-dbc3-4500-ad87-b87964ac8ebd',
        '项目总结报告.docx'
      );

      if (!fs.existsSync(wordFilePath)) {
        console.log('[E2E] 跳过测试：测试文件不存在');
        return;
      }

      // 连续发起3次预览请求
      const results = await window.evaluate(async (filePath) => {
        const promises = [];
        for (let i = 0; i < 3; i++) {
          // @ts-ignore
          promises.push(window.electronAPI.file.previewOffice(filePath, 'word'));
        }
        const responses = await Promise.all(promises);
        return responses.map((r) => ({
          success: r.success,
          hasData: !!r.data?.html,
        }));
      }, wordFilePath);

      console.log('[E2E] 多次预览结果:', results);

      // 验证所有请求都成功
      results.forEach((result, index) => {
        expect(result.success).toBeTruthy();
        expect(result.hasData).toBeTruthy();
        console.log(`[E2E] ✅ 请求 ${index + 1} 成功`);
      });

      console.log('[E2E] ✅ 多次预览测试通过');

    } finally {
      await electronApp.close();
    }
  });
});
