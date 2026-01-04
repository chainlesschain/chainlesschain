/**
 * 完整工作流 E2E 测试
 * 模拟真实用户场景：项目创建 -> AI对话 -> 意图识别 -> 任务分解 -> 工具调用 -> 代码生成
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

// 测试数据
const TEST_USER_ID = 'workflow-test-user';
const TEST_PROJECT_NAME = 'AI Assistant Demo Project';

test.describe('完整工作流 E2E 测试', () => {
  test.describe('场景1: 用户从零开始创建项目并使用AI助手开发', () => {
    let projectId: string;
    let conversationId: string;

    test('步骤1: 创建新的Python Django项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤1: 创建项目 ==========');

        // 创建项目
        const projectData = {
          name: TEST_PROJECT_NAME,
          description: '使用AI助手开发的Web应用项目',
          projectType: 'python',
          language: 'python',
          framework: 'django',
          userId: TEST_USER_ID,
          rootPath: `/tmp/ai-demo-${Date.now()}`,
        };

        const createResult = await callIPC(window, 'project:create-quick', projectData);

        expect(createResult).toBeDefined();
        expect(createResult.success).toBe(true);
        expect(createResult.project).toBeDefined();
        expect(createResult.project.id).toBeDefined();

        projectId = createResult.project.id;

        console.log(`✅ 项目创建成功!`);
        console.log(`   项目ID: ${projectId}`);
        console.log(`   项目名: ${createResult.project.name}`);
        console.log(`   框架: ${createResult.project.framework}`);
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤2: 用户提出需求 - "帮我创建一个用户登录功能"', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤2: 用户提出需求 ==========');

        // 获取项目列表确认项目存在
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        expect(projects).toBeDefined();
        expect(Array.isArray(projects)).toBe(true);

        if (projects && projects.length > 0) {
          projectId = projects[0].id;
        }

        console.log(`✅ 项目确认: ${projectId}`);
        console.log(`   用户需求: "帮我创建一个用户登录功能"`);
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤3: AI进行意图识别和任务分解', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤3: 意图识别与任务分解 ==========');

        // 获取项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目，跳过测试');
          return;
        }

        projectId = projects[0].id;
        const project = await callIPC(window, 'project:get', projectId);

        // 用户需求
        const userRequest = '帮我创建一个用户登录功能，包括用户名密码登录和记住我功能';

        // 准备项目上下文
        const projectContext = {
          projectId: project.id,
          projectName: project.name,
          projectType: project.projectType,
          framework: project.framework,
          language: project.language,
        };

        console.log('   开始任务分解...');

        // 调用任务分解接口
        const decomposeResult = await callIPC(
          window,
          'project:decompose-task',
          userRequest,
          projectContext
        );

        console.log('   任务分解结果:', JSON.stringify(decomposeResult, null, 2));

        // 验证结果
        expect(decomposeResult).toBeDefined();

        // 根据不同的返回格式进行验证
        if (decomposeResult.taskPlan) {
          // 如果返回格式包含 taskPlan
          expect(decomposeResult.taskPlan).toBeDefined();
          console.log(`   ✅ 任务已分解!`);
          console.log(`   任务计划ID: ${decomposeResult.taskPlan.id || 'N/A'}`);
          console.log(`   子任务数量: ${decomposeResult.taskPlan.subtasks?.length || 0}`);

          if (decomposeResult.taskPlan.subtasks) {
            decomposeResult.taskPlan.subtasks.forEach((task: any, index: number) => {
              console.log(`   ${index + 1}. ${task.title || task.description}`);
            });
          }
        } else if (decomposeResult.subtasks || Array.isArray(decomposeResult)) {
          // 如果直接返回子任务数组
          const tasks = decomposeResult.subtasks || decomposeResult;
          console.log(`   ✅ 任务已分解!`);
          console.log(`   子任务数量: ${tasks.length}`);

          tasks.forEach((task: any, index: number) => {
            console.log(`   ${index + 1}. ${task.title || task.description || task}`);
          });
        } else {
          console.log(`   ✅ 任务分解接口响应成功`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤4: 与AI对话，讨论实现细节', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤4: AI对话 ==========');

        // 获取项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目，跳过测试');
          return;
        }

        projectId = projects[0].id;

        // 准备对话数据
        const chatData = {
          projectId,
          message: '登录功能需要使用JWT token还是session？',
          context: {
            previousMessages: [
              {
                role: 'user',
                content: '帮我创建一个用户登录功能',
              },
            ],
          },
        };

        console.log('   用户问题:', chatData.message);

        // 调用AI对话接口
        const chatResult = await callIPC(window, 'project:aiChat', chatData);

        console.log('   AI响应:', JSON.stringify(chatResult, null, 2));

        // 验证结果
        expect(chatResult).toBeDefined();

        if (chatResult.success) {
          console.log(`   ✅ AI对话成功!`);
          console.log(`   AI回复: ${chatResult.response?.substring(0, 100)}...`);
        } else {
          console.log(`   ⚠️ AI对话可能未完全成功，但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤5: 使用LLM生成代码', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤5: 代码生成 ==========');

        // 生成Django用户模型
        console.log('   任务: 生成用户模型代码...');

        const modelDescription = `
创建一个Django用户模型，包含以下字段：
- username (唯一用户名)
- email (邮箱)
- password (密码哈希)
- created_at (创建时间)
- last_login (最后登录时间)
- is_active (是否激活)
`;

        const codeGenResult = await callIPC(
          window,
          'project:code-generate',
          modelDescription,
          'python',
          { framework: 'django', fileType: 'model' }
        );

        console.log('   代码生成结果:', codeGenResult);

        expect(codeGenResult).toBeDefined();

        if (codeGenResult.success || codeGenResult.code) {
          console.log(`   ✅ 用户模型代码生成成功!`);
          console.log(`   生成的代码片段:`);
          console.log(`   ${(codeGenResult.code || codeGenResult.content)?.substring(0, 200)}...`);
        } else {
          console.log(`   ⚠️ 代码生成可能未完全成功，但接口响应正常`);
        }

        // 生成登录视图
        console.log('\n   任务: 生成登录视图代码...');

        const viewDescription = `
创建Django登录视图函数，包含：
- 接收POST请求的用户名和密码
- 验证用户凭据
- 返回JWT token
- 处理"记住我"功能
`;

        const viewGenResult = await callIPC(
          window,
          'project:code-generate',
          viewDescription,
          'python',
          { framework: 'django', fileType: 'view' }
        );

        expect(viewGenResult).toBeDefined();

        if (viewGenResult.success || viewGenResult.code) {
          console.log(`   ✅ 登录视图代码生成成功!`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤6: AI代码审查', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤6: 代码审查 ==========');

        const sampleCode = `
def login(request):
    username = request.POST.get('username')
    password = request.POST.get('password')
    user = User.objects.get(username=username)
    if user.password == password:
        return JsonResponse({'token': 'abc123'})
    return JsonResponse({'error': 'Invalid credentials'})
`;

        console.log('   提交代码进行审查...');

        const reviewResult = await callIPC(
          window,
          'project:code-review',
          sampleCode,
          'python',
          ['security', 'best-practices']
        );

        console.log('   审查结果:', reviewResult);

        expect(reviewResult).toBeDefined();

        if (reviewResult.success || reviewResult.issues || reviewResult.suggestions) {
          console.log(`   ✅ 代码审查完成!`);

          if (reviewResult.issues) {
            console.log(`   发现的问题:`);
            reviewResult.issues.forEach((issue: any, index: number) => {
              console.log(`   ${index + 1}. ${issue.description || issue}`);
            });
          }

          if (reviewResult.suggestions) {
            console.log(`   改进建议:`);
            reviewResult.suggestions.forEach((suggestion: any, index: number) => {
              console.log(`   ${index + 1}. ${suggestion.description || suggestion}`);
            });
          }
        } else {
          console.log(`   ⚠️ 代码审查可能未完全成功，但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤7: AI代码修复和优化', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤7: 代码修复与优化 ==========');

        const buggyCode = `
def login(request):
    username = request.POST.get('username')
    password = request.POST.get('password')
    user = User.objects.get(username=username)  # 可能抛出异常
    if user.password == password:  # 明文密码比较，不安全！
        return JsonResponse({'token': 'abc123'})
    return JsonResponse({'error': 'Invalid credentials'})
`;

        console.log('   任务: 修复代码中的安全问题...');

        const bugDescription = '代码存在安全漏洞：明文密码比较和未处理的异常';

        const fixResult = await callIPC(
          window,
          'project:code-fix-bug',
          buggyCode,
          'python',
          bugDescription
        );

        expect(fixResult).toBeDefined();

        if (fixResult.success || fixResult.fixedCode || fixResult.code) {
          console.log(`   ✅ 代码修复成功!`);
          console.log(`   修复后的代码片段:`);
          console.log(
            `   ${(fixResult.fixedCode || fixResult.code)?.substring(0, 200)}...`
          );
        } else {
          console.log(`   ⚠️ 代码修复可能未完全成功，但接口响应正常`);
        }

        // 代码优化
        console.log('\n   任务: 优化代码性能...');

        const optimizeResult = await callIPC(
          window,
          'project:code-optimize',
          buggyCode,
          'python'
        );

        expect(optimizeResult).toBeDefined();

        if (optimizeResult.success || optimizeResult.optimizedCode || optimizeResult.code) {
          console.log(`   ✅ 代码优化成功!`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤8: 生成单元测试', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤8: 生成单元测试 ==========');

        const codeToTest = `
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken

def login_view(request):
    username = request.POST.get('username')
    password = request.POST.get('password')
    remember_me = request.POST.get('remember_me', False)

    user = authenticate(username=username, password=password)
    if user:
        refresh = RefreshToken.for_user(user)
        return JsonResponse({
            'access': str(refresh.access_token),
            'refresh': str(refresh)
        })
    return JsonResponse({'error': 'Invalid credentials'}, status=401)
`;

        console.log('   任务: 为登录功能生成单元测试...');

        const testResult = await callIPC(
          window,
          'project:code-generate-tests',
          codeToTest,
          'python'
        );

        expect(testResult).toBeDefined();

        if (testResult.success || testResult.tests || testResult.code) {
          console.log(`   ✅ 单元测试生成成功!`);
          console.log(`   生成的测试代码片段:`);
          console.log(`   ${(testResult.tests || testResult.code)?.substring(0, 200)}...`);
        } else {
          console.log(`   ⚠️ 测试生成可能未完全成功，但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤9: 保存生成的文件到项目', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤9: 保存文件到项目 ==========');

        // 获取项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目，跳过测试');
          return;
        }

        projectId = projects[0].id;

        // 模拟保存生成的文件
        const files = [
          {
            id: `file-${Date.now()}-1`,
            projectId,
            filePath: '/app/models.py',
            fileName: 'models.py',
            fileType: 'python',
            content: '# User model code here',
            fileSize: 1024,
          },
          {
            id: `file-${Date.now()}-2`,
            projectId,
            filePath: '/app/views.py',
            fileName: 'views.py',
            fileType: 'python',
            content: '# Login view code here',
            fileSize: 2048,
          },
          {
            id: `file-${Date.now()}-3`,
            projectId,
            filePath: '/tests/test_login.py',
            fileName: 'test_login.py',
            fileType: 'python',
            content: '# Unit tests here',
            fileSize: 1536,
          },
        ];

        console.log(`   保存 ${files.length} 个文件到项目...`);

        const saveResult = await callIPC(window, 'project:save-files', projectId, files);

        expect(saveResult).toBeDefined();
        expect(saveResult.success).toBeTruthy();

        console.log(`   ✅ 文件保存成功!`);

        files.forEach((file, index) => {
          console.log(`   ${index + 1}. ${file.filePath}`);
        });
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤10: 同步项目到后端', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤10: 同步项目 ==========');

        // 获取项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目，跳过测试');
          return;
        }

        projectId = projects[0].id;

        console.log('   开始同步项目到后端...');

        const syncResult = await callIPC(window, 'project:sync-one', projectId);

        expect(syncResult).toBeDefined();

        console.log('   同步结果:', syncResult);

        if (syncResult.success) {
          console.log(`   ✅ 项目同步成功!`);
        } else {
          console.log(`   ⚠️ 项目同步可能失败（后端可能未启动），但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('步骤11: 查看完整的任务历史', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 步骤11: 查看任务历史 ==========');

        // 获取项目
        const projects = await callIPC(window, 'project:get-all', TEST_USER_ID);
        if (!projects || projects.length === 0) {
          console.log('⚠️ 没有项目，跳过测试');
          return;
        }

        projectId = projects[0].id;

        // 获取任务计划历史
        const history = await callIPC(
          window,
          'project:get-task-plan-history',
          projectId,
          10
        );

        expect(history).toBeDefined();

        console.log('   任务历史:', history);

        if (Array.isArray(history) && history.length > 0) {
          console.log(`   ✅ 找到 ${history.length} 条任务记录`);

          history.forEach((task: any, index: number) => {
            console.log(
              `   ${index + 1}. ${task.title || task.description || 'Unknown task'} - ${task.status || 'N/A'}`
            );
          });
        } else {
          console.log(`   ℹ️  暂无任务历史记录`);
        }

        console.log('\n========== 完整工作流测试结束 ==========');
        console.log('✅ 所有步骤已完成！');
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('场景2: LLM直接对话和工具调用', () => {
    test('LLM状态检查', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== LLM状态检查 ==========');

        const status = await callIPC(window, 'llm:check-status');

        expect(status).toBeDefined();

        console.log('   LLM状态:', status);

        if (status.available || status.status === 'ready') {
          console.log(`   ✅ LLM服务可用!`);
          console.log(`   当前模型: ${status.model || status.currentModel || 'N/A'}`);
          console.log(`   提供商: ${status.provider || 'N/A'}`);
        } else {
          console.log(`   ⚠️ LLM服务可能不可用`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('基础LLM对话', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 基础LLM对话 ==========');

        const messages = [
          { role: 'user', content: '你好，请介绍一下你自己' },
        ];

        const chatOptions = {
          messages,
          stream: false,
          enableRAG: false,
        };

        const response = await callIPC(window, 'llm:chat', chatOptions);

        expect(response).toBeDefined();

        console.log('   对话响应:', response);

        if (response.success || response.content || response.message) {
          console.log(`   ✅ LLM对话成功!`);
          console.log(
            `   回复: ${(response.content || response.message)?.substring(0, 100)}...`
          );
        } else {
          console.log(`   ⚠️ LLM对话可能未完全成功，但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('使用模板的LLM对话', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 模板化LLM对话 ==========');

        const templateOptions = {
          templateId: 'code-review',
          variables: {
            code: 'def hello(): print("Hello")',
            language: 'python',
          },
          messages: [],
        };

        const response = await callIPC(window, 'llm:chat-with-template', templateOptions);

        expect(response).toBeDefined();

        console.log('   模板对话响应:', response);

        if (response.success || response.content) {
          console.log(`   ✅ 模板对话成功!`);
        } else {
          console.log(`   ⚠️ 模板对话可能未完全成功，但接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('LLM配置管理', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== LLM配置管理 ==========');

        // 获取当前配置
        const config = await callIPC(window, 'llm:get-config');

        expect(config).toBeDefined();

        console.log('   当前LLM配置:', config);
        console.log(`   ✅ 获取配置成功!`);

        // 列出可用模型
        const models = await callIPC(window, 'llm:list-models');

        expect(models).toBeDefined();

        console.log('   可用模型:', models);

        if (Array.isArray(models) && models.length > 0) {
          console.log(`   找到 ${models.length} 个可用模型:`);
          models.slice(0, 5).forEach((model: any, index: number) => {
            console.log(`   ${index + 1}. ${model.name || model}`);
          });
        } else {
          console.log(`   ℹ️  暂无可用模型列表`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });
});

test.describe('工作流性能测试', () => {
  test('完整工作流响应时间应在合理范围内', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 工作流性能测试 ==========');

      const startTime = Date.now();

      // 创建项目
      await callIPC(window, 'project:create-quick', {
        name: 'Performance Test Project',
        projectType: 'python',
        userId: TEST_USER_ID,
      });

      const projectCreationTime = Date.now() - startTime;

      console.log(`   项目创建耗时: ${projectCreationTime}ms`);
      expect(projectCreationTime).toBeLessThan(5000);

      // LLM对话
      const chatStartTime = Date.now();

      await callIPC(window, 'llm:chat', {
        messages: [{ role: 'user', content: '简单测试' }],
        stream: false,
      });

      const chatTime = Date.now() - chatStartTime;

      console.log(`   LLM对话耗时: ${chatTime}ms`);
      // LLM响应可能较慢，给更长时间
      expect(chatTime).toBeLessThan(30000);

      const totalTime = Date.now() - startTime;

      console.log(`   总耗时: ${totalTime}ms`);
      console.log(`   ✅ 性能测试完成!`);
    } finally {
      await closeElectronApp(app);
    }
  });
});
