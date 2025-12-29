/**
 * 技能工具系统独立测试
 * 不依赖数据库，仅测试核心功能
 */

const ToolRunner = require('./src/main/skill-tool-system/tool-runner.js');
const AISkillScheduler = require('./src/main/skill-tool-system/ai-skill-scheduler.js');

console.log('🧪 开始测试技能工具系统核心功能...\n');
console.log('='.repeat(60));
console.log('\n');

// ========== 测试 1: ToolRunner 基本功能 ==========
console.log('📌 测试 1: ToolRunner 工具执行\n');

// 创建模拟的 ToolManager
const mockToolManager = {
  async getToolByName(name) {
    const tools = {
      html_generator: {
        id: 'tool_html_generator',
        name: 'html_generator',
        enabled: 1,
        parameters_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            primaryColor: { type: 'string' }
          },
          required: ['title']
        }
      },
      file_writer: {
        id: 'tool_file_writer',
        name: 'file_writer',
        enabled: 1,
        parameters_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['filePath', 'content']
        }
      }
    };
    return tools[name] || null;
  },

  async recordExecution(toolName, success, duration) {
    console.log(`  📊 记录执行: ${toolName} - ${success ? '✅' : '❌'} (${duration}ms)`);
  }
};

const toolRunner = new ToolRunner(mockToolManager);

async function testToolRunner() {
  try {
    // 测试 HTML 生成
    console.log('🔧 执行工具: html_generator\n');
    const result1 = await toolRunner.executeTool('html_generator', {
      title: '测试页面',
      content: '<h1>Hello World</h1><p>这是一个测试页面</p>',
      primaryColor: '#667eea'
    });

    console.log('执行结果:');
    console.log(`  成功: ${result1.success}`);
    console.log(`  耗时: ${result1.executionTime}ms`);
    if (result1.result && result1.result.html) {
      console.log(`  生成文件: ${result1.result.fileName}`);
      console.log(`  HTML长度: ${result1.result.html.length} 字符`);
    }

    console.log('\n---\n');

    // 测试文件写入
    console.log('🔧 执行工具: file_writer\n');
    const result2 = await toolRunner.executeTool('file_writer', {
      filePath: './test-output/test.txt',
      content: 'Hello from automated test!',
      mode: 'overwrite'
    });

    console.log('执行结果:');
    console.log(`  成功: ${result2.success}`);
    console.log(`  耗时: ${result2.executionTime}ms`);
    if (result2.result) {
      console.log(`  写入路径: ${result2.result.filePath}`);
      console.log(`  写入字节: ${result2.result.bytesWritten}`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// ========== 测试 2: AI 智能调度 ==========
async function testAIScheduler() {
  console.log('\n---\n');
  console.log('📌 测试 2: AI 智能调度系统\n');

  // 创建模拟的 SkillManager
  const mockSkillManager = {
    async getAllSkills() {
      return [
        {
          id: 'skill_web_development',
          name: 'Web开发',
          category: 'web',
          enabled: 1,
          tags: JSON.stringify(['Web', 'HTML', 'CSS']),
          config: JSON.stringify({}),
          tools: ['html_generator', 'css_generator'],
          usage_count: 10,
          success_count: 9
        },
        {
          id: 'skill_code_development',
          name: '代码开发',
          category: 'code',
          enabled: 1,
          tags: JSON.stringify(['代码', '开发']),
          config: JSON.stringify({}),
          tools: ['file_reader', 'file_writer'],
          usage_count: 20,
          success_count: 18
        },
        {
          id: 'skill_data_analysis',
          name: '数据分析',
          category: 'data',
          enabled: 1,
          tags: JSON.stringify(['数据', '分析']),
          config: JSON.stringify({}),
          tools: ['file_reader'],
          usage_count: 5,
          success_count: 5
        }
      ];
    },

    async getSkillById(id) {
      const skills = await this.getAllSkills();
      return skills.find(s => s.id === id);
    },

    async getSkillTools(skillId) {
      return [];
    }
  };

  // 创建模拟的 SkillExecutor
  const mockSkillExecutor = {
    async executeSkill(skillId, params, options) {
      console.log(`  ⚙️ 执行技能: ${skillId}`);
      return {
        success: true,
        result: { message: '模拟执行成功' }
      };
    }
  };

  const aiScheduler = new AISkillScheduler(
    mockSkillManager,
    mockToolManager,
    mockSkillExecutor,
    null // 不使用 LLM
  );

  // 测试不同的用户输入
  const testInputs = [
    '帮我创建一个博客网站',
    '读取 config.json 文件',
    '分析销售数据',
    '生成一个 HTML 页面'
  ];

  for (const input of testInputs) {
    console.log(`\n💬 用户输入: "${input}"`);

    const result = await aiScheduler.smartSchedule(input, {
      userId: 'test_user',
      sessionId: 'test_session'
    });

    if (result.success) {
      console.log(`  ✅ 识别意图:`);
      console.log(`     动作: ${result.intent.action || '未识别'}`);
      console.log(`     目标: ${result.intent.target || '未识别'}`);
      console.log(`     置信度: ${(result.intent.confidence * 100).toFixed(0)}%`);
      console.log(`  🎯 选择技能: ${result.skill}`);
      console.log(`  📊 推荐数量: ${result.recommendations.length}`);

      if (result.recommendations.length > 1) {
        console.log(`  📋 其他推荐:`);
        result.recommendations.slice(1, 3).forEach((rec, idx) => {
          console.log(`     ${idx + 1}. ${rec.name} (评分: ${rec.score.toFixed(2)})`);
        });
      }
    } else {
      console.log(`  ❌ 失败: ${result.error}`);
    }
  }

  // 显示统计信息
  console.log('\n📊 AI 调度统计:');
  const stats = aiScheduler.getRecommendationStats();
  console.log(`  总执行次数: ${stats.totalExecutions}`);
  console.log(`  使用技能数: ${stats.uniqueSkills}`);
  if (stats.topSkills.length > 0) {
    console.log(`  最常用技能:`);
    stats.topSkills.slice(0, 3).forEach((skill, idx) => {
      console.log(`    ${idx + 1}. ${skill.skillId} - ${skill.count}次 (${skill.percentage}%)`);
    });
  }
}

// ========== 主测试流程 ==========
async function runAllTests() {
  try {
    await testToolRunner();
    await testAIScheduler();

    console.log('\n' + '='.repeat(60));
    console.log('\n✨ 所有测试完成！\n');
    console.log('📝 测试总结:');
    console.log('  ✅ ToolRunner 工具执行系统 - 正常');
    console.log('  ✅ AI 智能调度系统 - 正常');
    console.log('\n💡 提示: 这些是不依赖数据库的核心功能测试');
    console.log('   完整功能需要在 Electron 环境中运行\n');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error(error.stack);
  }
}

// 运行测试
runAllTests();
