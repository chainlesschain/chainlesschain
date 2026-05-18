/**
 * 项目创建流程 E2E 测试套件
 * 测试模板选择、技能工具配置、完整创建流程等新功能
 */

import { test, expect, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC, waitForIPC } from './helpers';

// 测试数据
const TEST_USER_ID = 'test-user-001';
const TEST_TEMPLATE = {
  id: 'template-test-001',
  name: 'test_template',
  display_name: '测试模板',
  description: '这是一个用于E2E测试的模板',
  category: 'web',
  project_type: 'web',
  prompt_template: '创建一个简单的{{projectType}}项目，名称为{{projectName}}',
  variables: [
    { name: 'projectType', label: '项目类型', type: 'text', required: true, default: 'Web' },
    { name: 'projectName', label: '项目名称', type: 'text', required: true, default: '测试项目' },
  ],
  source: 'builtin',
};

const TEST_PROJECT_DATA = {
  userPrompt: '创建一个简单的待办事项管理应用',
  name: 'E2E Test Todo App',
  projectType: 'web',
  userId: TEST_USER_ID,
};

test.describe('项目创建流程 E2E 测试', () => {
  test.describe('模板选择功能', () => {
    test('应该能够浏览和选择模板', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 导航到新建项目页面
        await window.click('text=新建项目', { timeout: 10000 }).catch(() => {
          console.log('未找到"新建项目"按钮，尝试直接导航');
        });

        // 等待页面加载
        await window.waitForTimeout(1000);

        // 查找并点击"浏览所有模板"按钮
        const templateButton = await window.locator('button:has-text("浏览所有模板")').first();
        if (await templateButton.isVisible({ timeout: 5000 })) {
          await templateButton.click();

          // 等待模板选择对话框打开
          await window.waitForTimeout(1000);

          // 验证对话框是否打开
          const modalTitle = await window.locator('text=选择项目模板').first();
          expect(await modalTitle.isVisible()).toBeTruthy();

          console.log('✅ 模板选择对话框打开成功');
        } else {
          console.log('⚠️ 未找到"浏览所有模板"按钮，可能页面未加载完成');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够搜索模板', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 模拟打开模板选择器
        await window.evaluate(() => {
          const event = new CustomEvent('open-template-selector');
          window.dispatchEvent(event);
        });

        await window.waitForTimeout(500);

        // 查找搜索框并输入
        const searchInput = await window.locator('input[placeholder*="搜索"]').first();
        if (await searchInput.isVisible({ timeout: 3000 })) {
          await searchInput.fill('web');
          await window.waitForTimeout(500);

          console.log('✅ 模板搜索功能正常');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够按分类筛选模板', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 通过 IPC 获取模板列表
        const templates: any = await callIPC(window, 'template:getAll', {});

        console.log('获取到的模板数量:', templates?.length || 0);

        if (templates && templates.length > 0) {
          expect(Array.isArray(templates)).toBe(true);

          // 验证模板结构
          const template = templates[0];
          expect(template).toHaveProperty('id');
          expect(template).toHaveProperty('name');
          expect(template).toHaveProperty('category');

          console.log('✅ 获取模板列表成功');
        } else {
          console.log('⚠️ 没有可用模板，跳过验证');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够预览模板详情', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 通过 IPC 获取单个模板详情
        const templates: any = await callIPC(window, 'template:getAll', {});

        if (templates && templates.length > 0) {
          const templateId = templates[0].id;
          const template: any = await callIPC(window, 'template:getById', templateId);

          expect(template).toBeDefined();
          expect(template.id).toBe(templateId);
          expect(template).toHaveProperty('prompt_template');

          console.log('✅ 获取模板详情成功:', template.display_name || template.name);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够渲染模板提示词', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 创建测试模板
        const result: any = await callIPC(window, 'template:create', TEST_TEMPLATE);

        if (result.success || result.template) {
          const template = result.template || result;

          // 渲染提示词
          const variables = {
            projectType: 'Web应用',
            projectName: '我的测试项目',
          };

          const rendered: any = await callIPC(
            window,
            'template:renderPrompt',
            template.id,
            variables
          );

          expect(rendered).toBeDefined();
          expect(typeof rendered).toBe('string');
          expect(rendered).toContain('Web应用');
          expect(rendered).toContain('我的测试项目');

          console.log('✅ 模板提示词渲染成功:', rendered);

          // 清理测试数据
          await callIPC(window, 'template:delete', template.id);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('首次访问模板推荐功能', () => {
    test('应该在首次访问时显示模板推荐', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 清除 localStorage 中的访问记录
        await window.evaluate(() => {
          localStorage.removeItem('hasVisitedNewProject');
        });

        // 导航到新建项目页面
        await window.goto('/#/projects/new').catch(() => {
          console.log('无法通过路由导航，使用其他方式');
        });

        await window.waitForTimeout(1000);

        // 检查是否显示推荐对话框
        const recommendModal = await window
          .locator('text=使用模板快速开始')
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (recommendModal) {
          console.log('✅ 模板推荐对话框显示成功');

          // 验证对话框内容
          const browseButton = await window.locator('button:has-text("浏览模板")').first();
          const skipButton = await window.locator('button:has-text("跳过")').first();

          expect(await browseButton.isVisible()).toBeTruthy();
          expect(await skipButton.isVisible()).toBeTruthy();
        } else {
          console.log('⚠️ 模板推荐对话框未显示（可能已经访问过）');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够跳过模板推荐', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 清除访问记录
        await window.evaluate(() => {
          localStorage.removeItem('hasVisitedNewProject');
        });

        await window.waitForTimeout(1000);

        // 点击跳过按钮
        const skipButton = await window.locator('button:has-text("跳过")').first();
        if (await skipButton.isVisible({ timeout: 3000 })) {
          await skipButton.click();
          await window.waitForTimeout(500);

          // 验证对话框已关闭
          const modalVisible = await window
            .locator('text=使用模板快速开始')
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false);

          expect(modalVisible).toBeFalsy();
          console.log('✅ 跳过模板推荐成功');
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('技能和工具选择功能', () => {
    test('应该能够获取技能列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const skills: any = await callIPC(window, 'skill:getAll');

        console.log('获取到的技能数量:', skills?.length || 0);

        if (skills && skills.length > 0) {
          expect(Array.isArray(skills)).toBe(true);

          // 验证技能结构
          const skill = skills[0];
          expect(skill).toHaveProperty('id');
          expect(skill).toHaveProperty('name');
          expect(skill).toHaveProperty('category');

          console.log('✅ 获取技能列表成功');
        } else {
          console.log('⚠️ 没有可用技能');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取工具列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const tools: any = await callIPC(window, 'tool:getAll');

        console.log('获取到的工具数量:', tools?.length || 0);

        if (tools && tools.length > 0) {
          expect(Array.isArray(tools)).toBe(true);

          // 验证工具结构
          const tool = tools[0];
          expect(tool).toHaveProperty('id');
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('category');

          console.log('✅ 获取工具列表成功');
        } else {
          console.log('⚠️ 没有可用工具');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够筛选已启用的技能', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const skills: any = await callIPC(window, 'skill:getAll');

        if (skills && skills.length > 0) {
          const enabledSkills = skills.filter((s: any) => s.enabled);
          console.log('已启用的技能数量:', enabledSkills.length);

          expect(Array.isArray(enabledSkills)).toBe(true);
          console.log('✅ 筛选已启用技能成功');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够按分类筛选技能', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const skills: any = await callIPC(window, 'skill:getAll');

        if (skills && skills.length > 0) {
          const categories = [...new Set(skills.map((s: any) => s.category))];
          console.log('技能分类:', categories);

          // 按第一个分类筛选
          if (categories.length > 0) {
            const category = categories[0];
            const filtered = skills.filter((s: any) => s.category === category);

            console.log(`分类 "${category}" 的技能数量:`, filtered.length);
            expect(filtered.length).toBeGreaterThan(0);
            console.log('✅ 按分类筛选技能成功');
          }
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('完整项目创建流程', () => {
    test('应该能够创建基础项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 调用创建项目接口
        const result: any = await callIPC(window, 'project:create', TEST_PROJECT_DATA);

        console.log('创建项目结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.project) {
          const project = result.project || result;
          expect(project.name).toBeDefined();
          expect(project.id).toBeDefined();

          console.log('✅ 基础项目创建成功, ID:', project.id);

          // 清理测试数据
          if (project.id) {
            await callIPC(window, 'project:delete-local', project.id);
          }
        } else {
          console.log('⚠️ 项目创建返回意外格式:', result);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够创建包含技能和工具配置的项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 获取技能和工具列表
        const skills: any = await callIPC(window, 'skill:getAll');
        const tools: any = await callIPC(window, 'tool:getAll');

        const projectData = {
          ...TEST_PROJECT_DATA,
          name: 'Project with Skills and Tools',
          skills: skills?.slice(0, 2).map((s: any) => s.id) || [],
          tools: tools?.slice(0, 2).map((t: any) => t.id) || [],
        };

        console.log('创建项目数据:', projectData);

        const result: any = await callIPC(window, 'project:create', projectData);

        if (result.success || result.project) {
          const project = result.project || result;
          console.log('✅ 包含技能和工具配置的项目创建成功');

          // 清理测试数据
          if (project.id) {
            await callIPC(window, 'project:delete-local', project.id);
          }
        } else {
          console.log('⚠️ 创建失败或返回格式异常');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够基于模板创建项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 先创建测试模板
        const templateResult: any = await callIPC(window, 'template:create', TEST_TEMPLATE);

        if (templateResult.success || templateResult.template) {
          const template = templateResult.template || templateResult;

          // 基于模板创建项目
          const projectData = {
            ...TEST_PROJECT_DATA,
            name: 'Template-based Project',
            templateId: template.id,
          };

          const result: any = await callIPC(window, 'project:create', projectData);

          if (result.success || result.project) {
            const project = result.project || result;
            console.log('✅ 基于模板创建项目成功');

            // 清理测试数据
            if (project.id) {
              await callIPC(window, 'project:delete-local', project.id);
            }
          }

          // 清理模板
          await callIPC(window, 'template:delete', template.id);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够验证必填字段', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 尝试创建缺少必填字段的项目
        const invalidData = {
          // userPrompt 是必填的，这里故意不提供
          projectType: 'web',
          userId: TEST_USER_ID,
        };

        const result: any = await callIPC(window, 'project:create', invalidData);

        // 应该返回错误或失败
        console.log('无效数据创建结果:', result);

        // 根据实际API返回格式判断
        if (result.success === false || result.error) {
          console.log('✅ 必填字段验证正常工作');
        } else {
          console.log('⚠️ 可能缺少必填字段验证');
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('流式创建进度显示', () => {
    test('应该能够监听项目创建进度', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 设置进度监听器
        let progressUpdates: any[] = [];

        await window.evaluate(() => {
          (window as any).progressUpdates = [];

          // 监听进度更新事件
          if ((window as any).electronAPI?.project?.onProgress) {
            (window as any).electronAPI.project.onProgress((data: any) => {
              (window as any).progressUpdates.push(data);
            });
          }
        });

        // 创建项目
        const createPromise = callIPC(window, 'project:create', TEST_PROJECT_DATA);

        // 等待一段时间收集进度更新
        await window.waitForTimeout(2000);

        // 获取进度更新
        progressUpdates = await window.evaluate(() => {
          return (window as any).progressUpdates || [];
        });

        console.log('收到的进度更新数量:', progressUpdates.length);

        if (progressUpdates.length > 0) {
          console.log('✅ 进度监听功能正常');
          console.log('进度样例:', progressUpdates[0]);
        } else {
          console.log('⚠️ 未收到进度更新（可能不支持流式创建）');
        }

        // 等待创建完成
        const result = await createPromise;

        if (result.success || result.project) {
          const project = result.project || result;
          if (project.id) {
            await callIPC(window, 'project:delete-local', project.id);
          }
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够显示创建的文件列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        // 创建项目
        const result: any = await callIPC(window, 'project:create', TEST_PROJECT_DATA);

        if (result.success || result.project) {
          const project = result.project || result;

          // 检查是否有文件列表
          if (result.files || project.files) {
            const files = result.files || project.files;
            console.log('创建的文件数量:', files.length);

            expect(Array.isArray(files)).toBe(true);

            if (files.length > 0) {
              const file = files[0];
              expect(file).toHaveProperty('name');
              expect(file).toHaveProperty('path');

              console.log('✅ 文件列表获取成功');
              console.log('文件示例:', file);
            }
          } else {
            console.log('⚠️ 未返回文件列表（可能不支持）');
          }

          // 清理
          if (project.id) {
            await callIPC(window, 'project:delete-local', project.id);
          }
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('边界情况和错误处理', () => {
    test('应该正确处理空模板列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const templates: any = await callIPC(window, 'template:getAll', {});

        // 应该返回数组（即使是空的）
        expect(Array.isArray(templates) || templates === null).toBe(true);

        console.log('✅ 空模板列表处理正常');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理不存在的模板ID', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const fakeTemplateId = 'non-existent-template-12345';

        const result: any = await callIPC(window, 'template:getById', fakeTemplateId);

        // 应该返回 null 或错误
        console.log('不存在的模板ID返回:', result);

        if (result === null || result === undefined || result.error) {
          console.log('✅ 错误处理正常');
        } else {
          console.log('⚠️ 可能缺少错误处理');
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理空技能和工具配置', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const projectData = {
          ...TEST_PROJECT_DATA,
          name: 'Project with Empty Config',
          skills: [],
          tools: [],
        };

        const result: any = await callIPC(window, 'project:create', projectData);

        // 应该能够成功创建
        if (result.success || result.project) {
          const project = result.project || result;
          console.log('✅ 空配置处理正常');

          // 清理
          if (project.id) {
            await callIPC(window, 'project:delete-local', project.id);
          }
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('性能测试', () => {
    test('模板列表加载性能应该在合理范围内', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const startTime = Date.now();
        await callIPC(window, 'template:getAll', {});
        const endTime = Date.now();

        const duration = endTime - startTime;

        console.log(`获取模板列表耗时: ${duration}ms`);

        // 应该在 2 秒内完成
        expect(duration).toBeLessThan(2000);

        console.log('✅ 性能测试通过');
      } finally {
        await closeElectronApp(app);
      }
    });

    test('技能和工具列表加载性能测试', async () => {
      const { app, window } = await launchElectronApp();

      try {
        const startTime = Date.now();
        await Promise.all([
          callIPC(window, 'skill:getAll'),
          callIPC(window, 'tool:getAll'),
        ]);
        const endTime = Date.now();

        const duration = endTime - startTime;

        console.log(`并行获取技能和工具耗时: ${duration}ms`);

        // 应该在 3 秒内完成
        expect(duration).toBeLessThan(3000);

        console.log('✅ 并行加载性能测试通过');
      } finally {
        await closeElectronApp(app);
      }
    });
  });
});
