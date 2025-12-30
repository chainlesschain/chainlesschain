/**
 * ChatSkillBridge 集成测试
 * 测试对话-技能-工具的完整链路
 */

const path = require('path');
const DatabaseManager = require('../database');
const ToolManager = require('./tool-manager');
const SkillManager = require('./skill-manager');
const SkillExecutor = require('./skill-executor');
const AISkillScheduler = require('./ai-skill-scheduler');
const ChatSkillBridge = require('./chat-skill-bridge');

// Mock FunctionCaller
class MockFunctionCaller {
  constructor() {
    this.toolManager = null;
  }

  setToolManager(toolManager) {
    this.toolManager = toolManager;
  }

  getAvailableTools() {
    // 返回模拟的工具列表
    return [
      {
        name: 'file_reader',
        description: '读取文件内容',
        category: 'file_operations',
        parameters: {
          path: { type: 'string', required: true }
        }
      },
      {
        name: 'file_writer',
        description: '写入文件内容',
        category: 'file_operations',
        parameters: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true }
        }
      },
      {
        name: 'file_deleter',
        description: '删除文件',
        category: 'file_operations',
        parameters: {
          path: { type: 'string', required: true }
        }
      }
    ];
  }

  async execute(toolName, parameters, context) {
    console.log(`[MockFunctionCaller] 执行工具: ${toolName}`);
    console.log('[MockFunctionCaller] 参数:', parameters);
    return { success: true, result: `Mocked result for ${toolName}` };
  }
}

// Mock LLM Manager
class MockLLMManager {
  async chat(prompt) {
    console.log('[MockLLM] 收到提示:', prompt.substring(0, 100) + '...');
    return JSON.stringify({
      action: 'create',
      target: 'document',
      entities: { filePath: 'notes.txt' },
      confidence: 0.9
    });
  }
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('ChatSkillBridge 集成测试');
  console.log('='.repeat(80));

  try {
    // 1. 初始化数据库
    console.log('\n[1] 初始化数据库...');
    const dbPath = path.join(__dirname, '../../../data/chainlesschain.db');
    console.log('数据库路径:', dbPath);

    // 确保数据库目录存在
    const fs = require('fs');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log('创建数据库目录:', dbDir);
    }

    const database = new DatabaseManager(dbPath);
    await database.initialize();
    console.log('✓ 数据库初始化完成');

    // 2. 初始化依赖
    console.log('\n[2] 初始化管理器...');
    const functionCaller = new MockFunctionCaller();
    const llmManager = new MockLLMManager();

    const toolManager = new ToolManager(database, functionCaller);
    const skillManager = new SkillManager(database, toolManager);

    await toolManager.initialize();
    await skillManager.initialize();

    functionCaller.setToolManager(toolManager);
    console.log('✓ 管理器初始化完成');

    // 3. 初始化桥接器组件
    console.log('\n[3] 初始化桥接器组件...');
    const skillExecutor = new SkillExecutor(skillManager, toolManager);
    const aiScheduler = new AISkillScheduler(skillManager, toolManager, skillExecutor, llmManager);
    const chatBridge = new ChatSkillBridge(skillManager, toolManager, skillExecutor, aiScheduler);
    console.log('✓ 桥接器初始化完成');

    // 4. 测试场景
    await runTestScenarios(chatBridge);

    console.log('\n' + '='.repeat(80));
    console.log('✓ 所有测试完成');
    console.log('='.repeat(80));

    database.close();
    process.exit(0);

  } catch (error) {
    console.error('\n✗ 测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

async function runTestScenarios(chatBridge) {
  console.log('\n[4] 运行测试场景...\n');

  // 测试场景1: 包含JSON操作块的响应
  await testScenario1(chatBridge);

  // 测试场景2: 只有描述没有JSON的响应
  await testScenario2(chatBridge);

  // 测试场景3: 不需要工具调用的普通响应
  await testScenario3(chatBridge);

  // 测试场景4: 多个文件操作
  await testScenario4(chatBridge);
}

/**
 * 测试场景1: 包含JSON操作块的响应（应该被拦截）
 */
async function testScenario1(chatBridge) {
  console.log('【测试场景1】包含JSON操作块的响应');
  console.log('-'.repeat(60));

  const userMessage = '帮我创建一个基本的文本文件';
  const aiResponse = `我会创建一个基本的文本文件。

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "notes.txt",
      "content": "这是一个示例文本文件\\n包含以下信息：项目说明、待办事项等信息",
      "language": "txt",
      "reason": "创建一个基本的文本文件以满足要求"
    }
  ]
}
\`\`\`
`;

  const result = await chatBridge.interceptAndProcess(userMessage, aiResponse, {
    projectId: 'test-project',
    projectPath: '/tmp/test-project'
  });

  console.log('结果:', JSON.stringify(result, null, 2));

  if (result.shouldIntercept) {
    console.log('✓ 场景1通过: 成功拦截并处理JSON操作块');
  } else {
    console.log('✗ 场景1失败: 未能拦截JSON操作块');
  }

  console.log('');
}

/**
 * 测试场景2: 只有描述没有JSON的响应
 */
async function testScenario2(chatBridge) {
  console.log('【测试场景2】只有文件操作描述的响应');
  console.log('-'.repeat(60));

  const userMessage = '创建一个README文件';
  const aiResponse = '好的，我会为您创建一个README.md文件，包含项目的基本信息和使用说明。';

  const result = await chatBridge.interceptAndProcess(userMessage, aiResponse, {
    projectId: 'test-project',
    projectPath: '/tmp/test-project'
  });

  console.log('结果:', JSON.stringify(result, null, 2));

  if (result.shouldIntercept) {
    console.log('✓ 场景2通过: 检测到文件操作意图');
  } else {
    console.log('- 场景2: 未检测到明确的工具调用（可能需要改进检测逻辑）');
  }

  console.log('');
}

/**
 * 测试场景3: 普通对话响应（不应该被拦截）
 */
async function testScenario3(chatBridge) {
  console.log('【测试场景3】普通对话响应');
  console.log('-'.repeat(60));

  const userMessage = '你好';
  const aiResponse = '你好！我是AI助手，有什么可以帮助您的吗？';

  const result = await chatBridge.interceptAndProcess(userMessage, aiResponse, {
    projectId: 'test-project',
    projectPath: '/tmp/test-project'
  });

  console.log('结果:', JSON.stringify(result, null, 2));

  if (!result.shouldIntercept) {
    console.log('✓ 场景3通过: 正确识别为普通对话，不拦截');
  } else {
    console.log('✗ 场景3失败: 误将普通对话识别为工具调用');
  }

  console.log('');
}

/**
 * 测试场景4: 多个文件操作
 */
async function testScenario4(chatBridge) {
  console.log('【测试场景4】多个文件操作');
  console.log('-'.repeat(60));

  const userMessage = '创建一个简单的Web项目';
  const aiResponse = `好的，我会为您创建一个简单的Web项目结构。

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "index.html",
      "content": "<!DOCTYPE html>\\n<html>\\n<head>\\n    <title>My Web Project</title>\\n</head>\\n<body>\\n    <h1>Hello World</h1>\\n</body>\\n</html>",
      "language": "html",
      "reason": "创建主页面"
    },
    {
      "type": "CREATE",
      "path": "style.css",
      "content": "body {\\n    font-family: Arial, sans-serif;\\n    margin: 0;\\n    padding: 20px;\\n}\\n\\nh1 {\\n    color: #333;\\n}",
      "language": "css",
      "reason": "创建样式文件"
    },
    {
      "type": "CREATE",
      "path": "script.js",
      "content": "console.log('Hello from script.js');\\n\\ndocument.addEventListener('DOMContentLoaded', () => {\\n    console.log('Page loaded');\\n});",
      "language": "javascript",
      "reason": "创建脚本文件"
    }
  ]
}
\`\`\`
`;

  const result = await chatBridge.interceptAndProcess(userMessage, aiResponse, {
    projectId: 'test-project',
    projectPath: '/tmp/test-project'
  });

  console.log('结果摘要:', {
    shouldIntercept: result.shouldIntercept,
    toolCallsCount: result.toolCalls?.length || 0,
    summary: result.summary
  });

  if (result.shouldIntercept && result.toolCalls && result.toolCalls.length === 3) {
    console.log('✓ 场景4通过: 成功提取3个文件操作');
  } else {
    console.log(`✗ 场景4失败: 期望3个工具调用，实际 ${result.toolCalls?.length || 0} 个`);
  }

  console.log('');
}

// 运行测试
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
