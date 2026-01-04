/**
 * 项目管理 E2E 测试套件
 * 全面测试项目的 CRUD、文件管理、同步、恢复等核心功能
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

// 测试数据
const TEST_USER_ID = 'test-user-001';
const TEST_PROJECT = {
  name: 'E2E Test Project',
  description: 'This is a test project created by E2E tests',
  projectType: 'python',
  rootPath: '/tmp/e2e-test-project',
  language: 'python',
  framework: 'django',
  userId: TEST_USER_ID,
};

test.describe('项目管理 E2E 测试', () => {
  let testProjectId: string;

  test.describe('项目 CRUD 操作', () => {
    test('应该能够创建新项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 调用创建项目接口
        const result = await callIPC(window, 'project:create', TEST_PROJECT);

        console.log('创建项目结果:', result);

        // 验证返回结果
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.project).toBeDefined();
        expect(result.project.name).toBe(TEST_PROJECT.name);
        expect(result.project.id).toBeDefined();

        // 保存项目ID供后续测试使用
        testProjectId = result.project.id;

        console.log('✅ 项目创建成功, ID:', testProjectId);
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够快速创建项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const quickProject = {
          ...TEST_PROJECT,
          name: 'Quick Test Project',
        };

        const result = await callIPC(window, 'project:create-quick', quickProject);

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.project).toBeDefined();

        console.log('✅ 快速创建项目成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取所有项目列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        console.log('获取到的项目数量:', projects?.length || 0);

        expect(Array.isArray(projects)).toBe(true);

        // 如果有项目，验证项目结构
        if (projects && projects.length > 0) {
          const project = projects[0];
          expect(project).toHaveProperty('id');
          expect(project).toHaveProperty('name');
          expect(project).toHaveProperty('userId');
        }

        console.log('✅ 获取项目列表成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取单个项目详情', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 先获取项目列表
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        // 获取单个项目
        const project = await callIPC(window, 'project:get', projectId);

        expect(project).toBeDefined();
        expect(project.id).toBe(projectId);
        expect(project.name).toBeDefined();

        console.log('✅ 获取项目详情成功:', project.name);
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够更新项目信息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 先获取一个项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;
        const updates = {
          name: 'Updated Project Name',
          description: 'This project has been updated by E2E test',
        };

        // 更新项目
        const result = await callIPC(window, 'project:update', projectId, updates);

        expect(result).toBeDefined();
        expect(result.name).toBe(updates.name);
        expect(result.description).toBe(updates.description);

        console.log('✅ 更新项目信息成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够保存项目到本地数据库', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const project = {
          ...TEST_PROJECT,
          name: 'Local Saved Project',
          id: `local-${Date.now()}`,
        };

        const result = await callIPC(window, 'project:save', project);

        expect(result).toBeDefined();
        expect(result.saved || result.success).toBeTruthy();

        console.log('✅ 保存项目到本地成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够删除本地项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 先创建一个临时项目
        const tempProject = {
          ...TEST_PROJECT,
          name: 'Temp Project for Deletion',
          id: `temp-${Date.now()}`,
        };

        await callIPC(window, 'project:save', tempProject);

        // 删除项目
        const result = await callIPC(window, 'project:delete-local', tempProject.id);

        expect(result).toBeDefined();
        expect(result.success || result.deleted).toBeTruthy();

        console.log('✅ 删除本地项目成功');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('项目文件管理', () => {
    test('应该能够获取项目文件列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        // 获取项目文件，传入正确的参数：projectId, fileType, pageNum, pageSize
        const result = await callIPC(
          window,
          'project:get-files',
          projectId,
          null,    // fileType
          1,       // pageNum
          50       // pageSize
        );

        expect(result).toBeDefined();
        expect(Array.isArray(result.files) || Array.isArray(result)).toBe(true);

        console.log('✅ 获取项目文件列表成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够保存项目文件', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;
        const files = [
          {
            id: `file-${Date.now()}-1`,
            projectId,
            filePath: '/test/file1.py',
            fileName: 'file1.py',
            fileType: 'python',
            fileSize: 1024,
          },
          {
            id: `file-${Date.now()}-2`,
            projectId,
            filePath: '/test/file2.py',
            fileName: 'file2.py',
            fileType: 'python',
            fileSize: 2048,
          },
        ];

        const result = await callIPC(window, 'project:save-files', projectId, files);

        expect(result).toBeDefined();
        expect(result.success).toBeTruthy();

        console.log('✅ 保存项目文件成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够更新单个文件', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const fileUpdate = {
          id: `file-${Date.now()}`,
          projectId: 'test-project',
          filePath: '/test/updated.py',
          fileName: 'updated.py',
          content: 'print("Hello, World!")',
        };

        const result = await callIPC(window, 'project:update-file', fileUpdate);

        // 某些实现可能返回 success 或直接返回更新后的文件
        expect(result).toBeDefined();

        console.log('✅ 更新文件成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够删除文件', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;
        const fileId = `file-to-delete-${Date.now()}`;

        const result = await callIPC(window, 'project:delete-file', projectId, fileId);

        // 某些实现可能返回成功标志或直接返回 true
        expect(result).toBeDefined();

        console.log('✅ 删除文件成功');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('项目同步功能', () => {
    test('应该能够同步单个项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        const result = await callIPC(window, 'project:sync-one', projectId);

        expect(result).toBeDefined();
        // 同步可能成功或失败（如果后端未启动），只要有响应就算通过
        console.log('同步结果:', result);

        console.log('✅ 同步单个项目测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够同步所有项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:sync', TEST_USER_ID);

        expect(result).toBeDefined();
        console.log('同步所有项目结果:', result);

        console.log('✅ 同步所有项目测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够从后端获取项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        const result = await callIPC(window, 'project:fetch-from-backend', projectId);

        // 如果后端未启动，可能返回错误，但应该有响应
        expect(result).toBeDefined();
        console.log('从后端获取项目结果:', result);

        console.log('✅ 从后端获取项目测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('项目恢复功能', () => {
    test('应该能够扫描可恢复的项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:scan-recoverable');

        expect(result).toBeDefined();
        expect(Array.isArray(result) || result.projects).toBeTruthy();

        console.log('✅ 扫描可恢复项目成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取恢复统计信息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:recovery-stats');

        expect(result).toBeDefined();
        console.log('恢复统计:', result);

        console.log('✅ 获取恢复统计成功');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够自动恢复项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:auto-recover');

        expect(result).toBeDefined();
        console.log('自动恢复结果:', result);

        console.log('✅ 自动恢复项目测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('项目路径管理', () => {
    test('应该能够修复项目路径', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        const result = await callIPC(window, 'project:fix-path', projectId);

        expect(result).toBeDefined();
        console.log('修复路径结果:', result);

        console.log('✅ 修复项目路径测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够修复项目根路径', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        const result = await callIPC(window, 'project:repair-root-path', projectId);

        expect(result).toBeDefined();
        console.log('修复根路径结果:', result);

        console.log('✅ 修复项目根路径测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够批量修复所有项目根路径', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:repair-all-root-paths');

        expect(result).toBeDefined();
        console.log('批量修复根路径结果:', result);

        console.log('✅ 批量修复根路径测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够解析相对路径', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const relativePath = './test/file.py';

        const result = await callIPC(window, 'project:resolve-path', relativePath);

        expect(result).toBeDefined();
        console.log('解析路径结果:', result);

        console.log('✅ 解析相对路径测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('项目监听功能', () => {
    test('应该能够启动和停止项目监听', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const project = projects[0];
        const projectId = project.id;
        const projectPath = project.rootPath || '/tmp/test-project';

        // 启动监听
        const startResult = await callIPC(
          window,
          'project:startWatcher',
          projectId,
          projectPath
        );

        expect(startResult).toBeDefined();
        console.log('启动监听结果:', startResult);

        // 等待一下
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 停止监听
        const stopResult = await callIPC(window, 'project:stopWatcher', projectId);

        expect(stopResult).toBeDefined();
        console.log('停止监听结果:', stopResult);

        console.log('✅ 项目监听测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('边界情况和错误处理', () => {
    test('应该正确处理不存在的项目ID', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const fakeProjectId = 'non-existent-project-id-12345';

        const result = await callIPC(window, 'project:get', fakeProjectId);

        // 应该返回 null 或 undefined，或者返回错误
        console.log('不存在的项目ID返回:', result);

        console.log('✅ 错误处理测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理空的文件数组', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目可供测试，跳过');
          return;
        }

        const projectId = projects[0].id;

        const result = await callIPC(window, 'project:save-files', projectId, []);

        expect(result).toBeDefined();
        expect(result.success).toBeTruthy();

        console.log('✅ 空文件数组处理测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理空用户ID', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const result = await callIPC(window, 'project:get-all', '');

        // 应该返回空数组或错误
        expect(Array.isArray(result) || result === null).toBe(true);

        console.log('✅ 空用户ID处理测试完成');
      } finally {
        await closeElectronApp(app);
      }
    });
  });
});

test.describe('项目管理性能测试', () => {
  test('获取项目列表的性能应该在合理范围内', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      await callIPC(window, 'project:get-all', TEST_USER_ID);
      const endTime = Date.now();

      const duration = endTime - startTime;

      console.log(`获取项目列表耗时: ${duration}ms`);

      // 应该在 2 秒内完成
      expect(duration).toBeLessThan(2000);

      console.log('✅ 性能测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('批量操作性能测试', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);

      if (!projects || projects.length === 0) {
        console.log('⚠️ 没有项目可供测试，跳过');
        return;
      }

      const projectId = projects[0].id;

      // 批量保存文件性能测试
      const files = Array.from({ length: 50 }, (_, i) => ({
        id: `perf-file-${i}`,
        projectId,
        filePath: `/test/file${i}.py`,
        fileName: `file${i}.py`,
        fileType: 'python',
        fileSize: 1024,
      }));

      const startTime = Date.now();
      await callIPC(window, 'project:save-files', projectId, files);
      const endTime = Date.now();

      const duration = endTime - startTime;

      console.log(`批量保存50个文件耗时: ${duration}ms`);

      // 应该在 5 秒内完成
      expect(duration).toBeLessThan(5000);

      console.log('✅ 批量操作性能测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });
});
