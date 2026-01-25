/**
 * Debug测试 - 文件创建和文件树刷新
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login, callIPC } from '../../helpers/common';
import { createAndOpenProject, waitForProjectDetailLoad } from './project-detail-helpers';

test.describe('Debug: 文件创建和文件树', () => {
  test('创建文件并验证文件树更新', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 登录
      console.log('[Debug] 步骤1: 登录');
      await login(window);
      await window.waitForTimeout(1000);

      // 创建项目
      console.log('[Debug] 步骤2: 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Debug测试项目',
        description: '用于debug文件创建',
        project_type: 'markdown',
      });

      console.log('[Debug] 项目ID:', project.id);
      console.log('[Debug] 项目根路径:', project.root_path);

      // 等待项目详情页加载
      await waitForProjectDetailLoad(window);

      // 获取初始文件列表
      console.log('[Debug] 步骤3: 获取初始文件列表');
      const initialFiles = await callIPC(window, 'project:get-files', project.id);
      console.log('[Debug] 初始文件数:', initialFiles.length);
      initialFiles.forEach((f: any) => console.log(`  - ${f.file_name}`));

      // 创建物理文件
      console.log('[Debug] 步骤4: 创建物理文件');
      const createResult = await callIPC(window, 'file:createFile', {
        projectId: project.id,
        filePath: 'debug-test.md',
        content: '# Debug测试\n\n这是一个debug测试文件。',
      });
      console.log('[Debug] 文件创建结果:', createResult);

      // 等待一会儿
      await window.waitForTimeout(500);

      // 再次获取文件列表
      console.log('[Debug] 步骤5: 再次获取文件列表');
      const afterCreateFiles = await callIPC(window, 'project:get-files', project.id);
      console.log('[Debug] 创建后文件数:', afterCreateFiles.length);
      afterCreateFiles.forEach((f: any) => console.log(`  - ${f.file_name}`));

      // 检查新文件是否在列表中
      const newFile = afterCreateFiles.find((f: any) => f.file_name === 'debug-test.md');
      if (newFile) {
        console.log('[Debug] ✅ 新文件已找到:', newFile);
      } else {
        console.log('[Debug] ❌ 新文件未找到！');
      }

      // 验证
      expect(afterCreateFiles.length).toBeGreaterThan(initialFiles.length);
      expect(newFile).toBeTruthy();

      console.log('[Debug] ✅ 测试通过！');
    } catch (error) {
      console.error('[Debug] ❌ 测试失败:', error);
      throw error;
    } finally {
      await closeElectronApp(app);
    }
  });
});
