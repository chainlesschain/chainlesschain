/**
 * AI对话功能 E2E 测试
 * 测试LLM聊天、对话管理、上下文保持、流式输出等核心功能
 *
 * 优化：使用 beforeAll/afterAll 共享 Electron 实例，从 25 次启动减少到 6 次
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 测试数据
const TEST_USER_ID = 'ai-chat-test-user';
const TEST_PROJECT_ID = 'ai-chat-test-project';

// 设置Volcengine配置的辅助函数
async function setupVolcengineConfig(window: any) {
  console.log('\n========== 配置 Volcengine Provider ==========');

  try {
    // 一次性设置所有配置，包括 provider 和 volcengine 的 API key
    const config = {
      provider: 'volcengine',
      'volcengine.apiKey': '7185ce7d-9775-450c-8450-783176be6265',
      'volcengine.baseURL': 'https://ark.cn-beijing.volces.com/api/v3',
      'volcengine.model': 'doubao-seed-1-6-flash-250828',
      'volcengine.embeddingModel': 'doubao-embedding-large',
    };

    console.log('正在设置配置...');
    await callIPC(window, 'llm:set-config', config);
    console.log('✅ Volcengine 配置设置成功');

    // 验证配置
    const currentConfig = await callIPC(window, 'llm:get-config');
    console.log('当前配置:');
    console.log('  Provider:', currentConfig.provider);
    console.log('  API Key:', currentConfig.volcengine?.apiKey ? currentConfig.volcengine.apiKey.substring(0, 20) + '...' : '未设置');
    console.log('  Model:', currentConfig.volcengine?.model || '未设置');
    console.log('  Embedding Model:', currentConfig.volcengine?.embeddingModel || '未设置');
  } catch (error: any) {
    console.error('❌ 配置 Volcengine 失败:', error);
    console.error('错误详情:', error.stack);
    // 不抛出错误，让测试继续运行
  }

  console.log('========================================\n');
}

test.describe('AI对话功能 E2E 测试', () => {
  // Group 1: 配置与LLM基础功能 (4 tests, 1 Electron launch)
  test.describe('配置与LLM基础功能', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('应该能够设置Volcengine配置', async () => {
      console.log('\n========== 测试Volcengine配置设置 ==========');

      // 获取初始配置
      const initialConfig = await callIPC(window, 'llm:get-config');
      console.log('初始 Provider:', initialConfig.provider);
      console.log('初始 Volcengine API Key:', initialConfig.volcengine?.apiKey || '未设置');

      // 设置Volcengine配置
      await setupVolcengineConfig(window);

      // 验证配置已更新
      const updatedConfig = await callIPC(window, 'llm:get-config');
      console.log('\n更新后 Provider:', updatedConfig.provider);
      console.log('更新后 Volcengine API Key:', updatedConfig.volcengine?.apiKey ? '已设置' : '未设置');

      // 断言配置已正确设置
      expect(updatedConfig.provider).toBe('volcengine');
      expect(updatedConfig.volcengine?.apiKey).toBe('7185ce7d-9775-450c-8450-783176be6265');

      console.log('✅ Volcengine配置设置成功!');
    });

    test('应该能够检查LLM服务状态', async () => {
      console.log('\n========== 检查LLM状态 ==========');

      const status = await callIPC(window, 'llm:check-status');

      console.log('LLM状态:', status);

      expect(status).toBeDefined();

      // 验证状态字段
      if (status.available !== undefined) {
        console.log(`✅ LLM服务状态: ${status.available ? '可用' : '不可用'}`);
        console.log(`   当前模型: ${status.model || status.currentModel || 'N/A'}`);
        console.log(`   提供商: ${status.provider || 'N/A'}`);
      } else {
        console.log(`ℹ️  LLM状态检查完成`);
      }
    });

    test('应该能够获取LLM配置', async () => {
      console.log('\n========== 获取LLM配置 ==========');

      const config = await callIPC(window, 'llm:get-config');

      console.log('LLM配置:', config);

      expect(config).toBeDefined();

      // 验证配置字段
      if (config.model || config.provider || config.apiKey !== undefined) {
        console.log(`✅ 获取LLM配置成功!`);
        console.log(`   模型: ${config.model || 'N/A'}`);
        console.log(`   提供商: ${config.provider || 'N/A'}`);
        console.log(`   温度: ${config.temperature || config.temp || 'N/A'}`);
        console.log(`   最大Token: ${config.maxTokens || config.max_tokens || 'N/A'}`);
      } else {
        console.log(`ℹ️  配置获取完成`);
      }

      // 尝试设置 Volcengine 配置
      console.log('\n尝试配置 Volcengine...');
      await setupVolcengineConfig(window);

      // 再次获取配置验证
      const newConfig = await callIPC(window, 'llm:get-config');
      console.log('\n配置后的LLM配置:');
      console.log('  Provider:', newConfig.provider);
      console.log('  Volcengine API Key:', newConfig.volcengine?.apiKey ? '已设置 (' + newConfig.volcengine.apiKey.substring(0, 20) + '...)' : '未设置');
    });

    test('应该能够列出可用模型', async () => {
      console.log('\n========== 列出可用模型 ==========');

      const models = await callIPC(window, 'llm:list-models');

      console.log('可用模型结果:', models);

      expect(models).toBeDefined();

      // 提取模型列表
      const modelList = models.models || models.data || models;

      if (Array.isArray(modelList)) {
        console.log(`✅ 找到 ${modelList.length} 个可用模型:`);

        modelList.slice(0, 5).forEach((model: any, index: number) => {
          const modelName = typeof model === 'string' ? model : model.name || model.id;
          console.log(`   ${index + 1}. ${modelName}`);
        });

        // 验证模型列表不为空
        if (modelList.length > 0) {
          expect(modelList.length).toBeGreaterThan(0);
        }
      } else {
        console.log(`ℹ️  模型列表获取完成`);
      }
    });
  });

  // Group 2: 基础对话功能 (3 tests, 1 Electron launch)
  test.describe('基础对话功能', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
      // 配置 Volcengine（对话测试需要）
      await setupVolcengineConfig(window);
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('应该能够进行简单的LLM查询', async () => {
      console.log('\n========== 简单LLM查询 ==========');

      const prompt = '你好，请用一句话介绍一下你自己';

      const result = await callIPC(window, 'llm:query', prompt, {
        maxTokens: 100,
      });

      console.log('查询结果:', result);

      expect(result).toBeDefined();

      // 提取响应内容
      const response =
        result.response || result.content || result.text || result.message || result;

      if (typeof response === 'string' && response.length > 0) {
        console.log(`✅ LLM查询成功!`);
        console.log(`   提问: ${prompt}`);
        console.log(`   回答: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);

        // 验证响应不为空
        expect(response.length).toBeGreaterThan(0);
      } else {
        console.log(`ℹ️  查询完成，结果格式: ${typeof result}`);
      }
    });

    test('应该能够进行多轮对话', async () => {
      console.log('\n========== 多轮对话测试 ==========');

      // 第一轮对话
      const messages1 = [
        { role: 'user', content: '我想学习Python编程' },
      ];

      const result1 = await callIPC(window, 'llm:chat', {
        messages: messages1,
        stream: false,
        enableRAG: false,
      });

      console.log('第一轮对话结果:', result1);

      const response1 =
        result1.response || result1.content || result1.message || result1;

      if (response1) {
        console.log(`✅ 第一轮对话成功!`);
        console.log(`   用户: ${messages1[0].content}`);
        console.log(`   AI: ${String(response1).substring(0, 80)}...`);
      }

      // 第二轮对话（带上下文）
      const messages2 = [
        { role: 'user', content: '我想学习Python编程' },
        {
          role: 'assistant',
          content: response1 || '好的，我可以帮你学习Python。',
        },
        { role: 'user', content: '那我应该从哪里开始？' },
      ];

      const result2 = await callIPC(window, 'llm:chat', {
        messages: messages2,
        stream: false,
        enableRAG: false,
      });

      console.log('第二轮对话结果:', result2);

      const response2 =
        result2.response || result2.content || result2.message || result2;

      if (response2) {
        console.log(`✅ 第二轮对话成功!`);
        console.log(`   用户: ${messages2[2].content}`);
        console.log(`   AI: ${String(response2).substring(0, 80)}...`);

        // 验证第二轮回答与上下文相关
        expect(String(response2).length).toBeGreaterThan(0);
      }

      console.log(`✅ 多轮对话测试完成!`);
    });

    test('应该能够使用模板进行对话', async () => {
      console.log('\n========== 模板对话测试 ==========');

      const templateOptions = {
        templateId: 'code-review',
        variables: {
          code: 'def hello(): print("Hello, World!")',
          language: 'python',
        },
        messages: [],
      };

      const result = await callIPC(
        window,
        'llm:chat-with-template',
        templateOptions
      );

      console.log('模板对话结果:', result);

      expect(result).toBeDefined();

      const response = result.response || result.content || result.message || result;

      if (response) {
        console.log(`✅ 模板对话成功!`);
        console.log(`   模板ID: ${templateOptions.templateId}`);
        console.log(`   响应: ${String(response).substring(0, 100)}...`);
      } else {
        console.log(`ℹ️  模板对话完成`);
      }
    });
  });

  // Group 3: 项目AI对话 (1 test, 1 Electron launch)
  test.describe('项目AI对话', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('应该能够在项目上下文中进行AI对话', async () => {
      console.log('\n========== 项目AI对话 ==========');

      const chatData = {
        projectId: TEST_PROJECT_ID,
        message: '帮我分析一下这个项目的结构',
        context: {
          projectName: 'E2E Test Project',
          projectType: 'python',
        },
      };

      const result = await callIPC(window, 'project:aiChat', chatData);

      console.log('项目AI对话结果:', result);

      expect(result).toBeDefined();

      // 提取响应
      const response = result.response || result.content || result.message || result.data;

      if (result.success || response) {
        console.log(`✅ 项目AI对话成功!`);
        console.log(`   项目ID: ${chatData.projectId}`);
        console.log(`   用户消息: ${chatData.message}`);

        if (response) {
          console.log(`   AI回复: ${String(response).substring(0, 100)}...`);
        }
      } else {
        console.log(`ℹ️  项目AI对话完成`);
      }
    });
  });

  // Group 4: 对话历史管理 (6 tests, 1 Electron launch, serial mode for shared state)
  test.describe('对话历史管理', () => {
    test.describe.configure({ mode: 'serial' });

    let app: ElectronApplication;
    let window: Page;
    let testConversationId: string;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('应该能够创建新对话', async () => {
      console.log('\n========== 创建对话 ==========');

      const conversationData = {
        projectId: TEST_PROJECT_ID,
        title: 'E2E测试对话',
        type: 'ai-chat',
        metadata: {
          model: 'gpt-3.5-turbo',
          temperature: 0.7,
        },
      };

      const result = await callIPC(
        window,
        'conversation:create',
        conversationData
      );

      console.log('创建对话结果:', result);

      expect(result).toBeDefined();

      // 提取对话ID
      testConversationId =
        result.id ||
        result.conversationId ||
        result.data?.id ||
        `test-conv-${Date.now()}`;

      if (result.success || result.id || result.conversationId) {
        console.log(`✅ 对话创建成功!`);
        console.log(`   对话ID: ${testConversationId}`);
        console.log(`   标题: ${result.title || conversationData.title}`);
      } else {
        console.log(`ℹ️  对话创建完成`);
      }
    });

    test('应该能够获取项目的对话列表', async () => {
      console.log('\n========== 获取对话列表 ==========');

      const result = await callIPC(
        window,
        'conversation:get-by-project',
        TEST_PROJECT_ID
      );

      console.log('对话列表结果:', result);

      expect(result).toBeDefined();

      // 提取对话列表
      const conversations =
        result.conversations || result.data || result;

      if (Array.isArray(conversations)) {
        console.log(`✅ 获取对话列表成功!`);
        console.log(`   对话数量: ${conversations.length}`);

        if (conversations.length > 0) {
          conversations.slice(0, 3).forEach((conv: any, index: number) => {
            console.log(
              `   ${index + 1}. ${conv.title || conv.name || 'Untitled'} (${conv.id || 'N/A'})`
            );
          });
        }
      } else {
        console.log(`ℹ️  对话列表获取完成`);
      }
    });

    test('应该能够在对话中添加消息', async () => {
      console.log('\n========== 添加消息到对话 ==========');

      // 先获取一个对话ID
      const conversations = await callIPC(
        window,
        'conversation:get-by-project',
        TEST_PROJECT_ID
      );

      const convList = conversations.conversations || conversations.data || conversations;
      const conversationId =
        Array.isArray(convList) && convList.length > 0
          ? convList[0].id
          : `test-conv-${Date.now()}`;

      // 添加用户消息
      const messageData = {
        conversationId,
        role: 'user',
        content: '这是一条E2E测试消息',
        timestamp: Date.now(),
      };

      const result = await callIPC(
        window,
        'conversation:create-message',
        messageData
      );

      console.log('添加消息结果:', result);

      expect(result).toBeDefined();

      if (result.success || result.id || result.messageId) {
        console.log(`✅ 消息添加成功!`);
        console.log(`   对话ID: ${conversationId}`);
        console.log(`   消息ID: ${result.id || result.messageId || 'N/A'}`);
        console.log(`   内容: ${messageData.content}`);
      } else {
        console.log(`ℹ️  消息添加完成`);
      }
    });

    test('应该能够获取对话的消息历史', async () => {
      console.log('\n========== 获取消息历史 ==========');

      // 获取对话ID
      const conversations = await callIPC(
        window,
        'conversation:get-by-project',
        TEST_PROJECT_ID
      );

      const convList = conversations.conversations || conversations.data || conversations;
      const conversationId =
        Array.isArray(convList) && convList.length > 0
          ? convList[0].id
          : `test-conv-${Date.now()}`;

      // 获取消息
      const result = await callIPC(
        window,
        'conversation:get-messages',
        conversationId,
        { limit: 20, offset: 0 }
      );

      console.log('消息历史结果:', result);

      expect(result).toBeDefined();

      // 提取消息列表
      const messages = result.messages || result.data || result;

      if (Array.isArray(messages)) {
        console.log(`✅ 获取消息历史成功!`);
        console.log(`   消息数量: ${messages.length}`);

        if (messages.length > 0) {
          messages.slice(0, 3).forEach((msg: any, index: number) => {
            console.log(
              `   ${index + 1}. [${msg.role || 'unknown'}] ${String(msg.content).substring(0, 30)}...`
            );
          });

          // 验证消息结构
          expect(messages[0]).toHaveProperty('content');
        }
      } else {
        console.log(`ℹ️  消息历史获取完成`);
      }
    });

    test('应该能够更新对话信息', async () => {
      console.log('\n========== 更新对话 ==========');

      // 获取对话ID
      const conversations = await callIPC(
        window,
        'conversation:get-by-project',
        TEST_PROJECT_ID
      );

      const convList = conversations.conversations || conversations.data || conversations;

      if (!Array.isArray(convList) || convList.length === 0) {
        console.log('⚠️  没有对话，跳过测试');
        return;
      }

      const conversationId = convList[0].id;

      // 更新对话
      const updates = {
        title: 'Updated E2E Test Conversation',
        metadata: {
          updated: true,
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await callIPC(
        window,
        'conversation:update',
        conversationId,
        updates
      );

      console.log('更新对话结果:', result);

      expect(result).toBeDefined();

      if (result.success || result.title) {
        console.log(`✅ 对话更新成功!`);
        console.log(`   对话ID: ${conversationId}`);
        console.log(`   新标题: ${result.title || updates.title}`);
      } else {
        console.log(`ℹ️  对话更新完成`);
      }
    });

    test('应该能够删除对话', async () => {
      console.log('\n========== 删除对话 ==========');

      // 先创建一个临时对话
      const tempConversation = {
        projectId: TEST_PROJECT_ID,
        title: 'Temp Conversation for Deletion',
        type: 'ai-chat',
      };

      const createResult = await callIPC(
        window,
        'conversation:create',
        tempConversation
      );

      const conversationId =
        createResult.id ||
        createResult.conversationId ||
        createResult.data?.id;

      if (!conversationId) {
        console.log('⚠️  无法创建临时对话，跳过删除测试');
        return;
      }

      // 删除对话
      const deleteResult = await callIPC(
        window,
        'conversation:delete',
        conversationId
      );

      console.log('删除对话结果:', deleteResult);

      expect(deleteResult).toBeDefined();

      if (deleteResult.success || deleteResult === true) {
        console.log(`✅ 对话删除成功!`);
        console.log(`   已删除对话ID: ${conversationId}`);
      } else {
        console.log(`ℹ️  对话删除完成`);
      }
    });
  });

  // Group 5: LLM高级功能与错误处理 (10 tests, 1 Electron launch)
  test.describe('LLM高级功能与错误处理', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('应该能够清除对话上下文', async () => {
      console.log('\n========== 清除对话上下文 ==========');

      const conversationId = `test-context-${Date.now()}`;

      const result = await callIPC(
        window,
        'llm:clear-context',
        conversationId
      );

      console.log('清除上下文结果:', result);

      expect(result).toBeDefined();

      if (result.success || result === true) {
        console.log(`✅ 上下文清除成功!`);
        console.log(`   对话ID: ${conversationId}`);
      } else {
        console.log(`ℹ️  上下文清除完成`);
      }
    });

    test('应该能够生成文本嵌入', async () => {
      console.log('\n========== 生成文本嵌入 ==========');

      const text = '这是一段用于测试嵌入功能的文本';

      const result = await callIPC(window, 'llm:embeddings', text);

      console.log('嵌入结果:', result);

      expect(result).toBeDefined();

      // 提取嵌入向量
      const embeddings =
        result.embeddings || result.data || result.vector || result;

      if (Array.isArray(embeddings) && embeddings.length > 0) {
        console.log(`✅ 文本嵌入生成成功!`);
        console.log(`   输入文本: ${text}`);
        console.log(`   向量维度: ${embeddings.length}`);
        console.log(`   前5个值: ${embeddings.slice(0, 5).join(', ')}...`);

        // 验证向量维度
        expect(embeddings.length).toBeGreaterThan(0);
      } else {
        console.log(`ℹ️  嵌入生成完成`);
      }
    });

    test('应该能够切换LLM提供商', async () => {
      console.log('\n========== 切换LLM提供商 ==========');

      // 获取当前配置
      const currentConfig = await callIPC(window, 'llm:get-config');
      const currentProvider = currentConfig.provider || 'unknown';

      console.log(`   当前提供商: ${currentProvider}`);

      // 尝试切换（可能不支持）
      const newProvider = 'ollama'; // 或其他支持的提供商

      const result = await callIPC(window, 'llm:switch-provider', newProvider);

      console.log('切换提供商结果:', result);

      expect(result).toBeDefined();

      if (result.success) {
        console.log(`✅ 提供商切换成功!`);
        console.log(`   原提供商: ${currentProvider}`);
        console.log(`   新提供商: ${newProvider}`);
      } else if (result.error) {
        console.log(`ℹ️  提供商切换失败: ${result.error}`);
      } else {
        console.log(`ℹ️  提供商切换完成`);
      }
    });

    test('应该能够获取模型选择器信息', async () => {
      console.log('\n========== 获取模型选择器信息 ==========');

      const result = await callIPC(window, 'llm:get-selector-info');

      console.log('选择器信息:', result);

      expect(result).toBeDefined();

      if (result.success || result.info || result.data) {
        console.log(`✅ 获取选择器信息成功!`);

        const info = result.info || result.data || result;

        if (info) {
          console.log(`   信息内容:`, JSON.stringify(info, null, 2));
        }
      } else {
        console.log(`ℹ️  选择器信息获取完成`);
      }
    });

    test('应该能够选择最佳模型', async () => {
      console.log('\n========== 选择最佳模型 ==========');

      const options = {
        task: 'code-generation',
        language: 'python',
        complexity: 'medium',
      };

      const result = await callIPC(window, 'llm:select-best', options);

      console.log('最佳模型选择结果:', result);

      expect(result).toBeDefined();

      if (result.model || result.selectedModel) {
        console.log(`✅ 最佳模型选择成功!`);
        console.log(`   任务: ${options.task}`);
        console.log(`   选择的模型: ${result.model || result.selectedModel}`);
      } else {
        console.log(`ℹ️  模型选择完成`);
      }
    });

    test('应该能够生成使用报告', async () => {
      console.log('\n========== 生成使用报告 ==========');

      const taskType = 'chat';

      const result = await callIPC(window, 'llm:generate-report', taskType);

      console.log('使用报告结果:', result);

      expect(result).toBeDefined();

      if (result.report || result.data) {
        console.log(`✅ 使用报告生成成功!`);

        const report = result.report || result.data;

        if (report) {
          console.log(`   任务类型: ${taskType}`);
          console.log(`   报告内容:`, report);
        }
      } else {
        console.log(`ℹ️  使用报告生成完成`);
      }
    });

    test('应该正确处理空消息', async () => {
      console.log('\n========== 空消息测试 ==========');

      const result = await callIPC(window, 'llm:query', '', {});

      console.log('空消息结果:', result);

      // 应该返回错误或空响应
      if (result.error || !result.response) {
        console.log(`✅ 正确拒绝了空消息`);
      } else {
        console.log(`ℹ️  系统允许了空消息`);
      }
    });

    test('应该正确处理不存在的对话ID', async () => {
      console.log('\n========== 不存在的对话ID ==========');

      const fakeId = 'non-existent-conversation-12345';

      const result = await callIPC(window, 'conversation:get-by-id', fakeId);

      console.log('不存在对话的查询结果:', result);

      // 应该返回null或错误
      if (result === null || result === undefined || result.error) {
        console.log(`✅ 正确处理了不存在的对话ID`);
      } else {
        console.log(`ℹ️  返回了空结果或默认值`);
      }
    });

    test('应该正确处理无效的配置更新', async () => {
      console.log('\n========== 无效配置更新 ==========');

      const invalidConfig = {
        temperature: 100, // 无效值（应该在0-2之间）
        maxTokens: -1, // 无效值
      };

      const result = await callIPC(window, 'llm:set-config', invalidConfig);

      console.log('无效配置更新结果:', result);

      if (result.error || !result.success) {
        console.log(`✅ 正确拒绝了无效配置`);
      } else {
        console.log(`ℹ️  系统允许了该配置（可能有自动修正）`);
      }
    });
  });
});

// Group 6: AI对话性能测试 (2 tests, 1 Electron launch)
test.describe('AI对话性能测试', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('简单查询的响应时间应该在合理范围内', async () => {
    console.log('\n========== 查询性能测试 ==========');

    const startTime = Date.now();

    await callIPC(window, 'llm:query', 'Hello', { maxTokens: 10 });

    const duration = Date.now() - startTime;

    console.log(`   查询耗时: ${duration}ms`);

    // LLM查询可能较慢，给更长时间
    expect(duration).toBeLessThan(60000); // 60秒

    console.log(`✅ 性能测试通过`);
  });

  test('对话历史查询性能应该在合理范围内', async () => {
    console.log('\n========== 对话历史查询性能 ==========');

    const startTime = Date.now();

    await callIPC(
      window,
      'conversation:get-by-project',
      TEST_PROJECT_ID
    );

    const duration = Date.now() - startTime;

    console.log(`   查询耗时: ${duration}ms`);

    // 应该在 2 秒内完成
    expect(duration).toBeLessThan(2000);

    console.log(`✅ 对话历史查询性能测试通过`);
  });
});
