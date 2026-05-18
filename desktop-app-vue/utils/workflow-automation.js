/**
 * 工作流自动化脚本
 * 使用示例：演示如何使用技能工具系统
 */

const path = require('path');
const Database = require('./src/main/database.js');
const SkillManager = require('./src/main/skill-tool-system/skill-manager.js');
const ToolManager = require('./src/main/skill-tool-system/tool-manager.js');
const SkillExecutor = require('./src/main/skill-tool-system/skill-executor.js');
const ToolRunner = require('./src/main/skill-tool-system/tool-runner.js');
const AISkillScheduler = require('./src/main/skill-tool-system/ai-skill-scheduler.js');

class WorkflowAutomation {
  constructor() {
    this.db = null;
    this.skillManager = null;
    this.toolManager = null;
    this.skillExecutor = null;
    this.toolRunner = null;
    this.aiScheduler = null;
  }

  /**
   * 初始化系统
   */
  async initialize() {
    console.log('🚀 初始化工作流自动化系统...\n');

    // 初始化数据库
    this.db = new Database();
    await this.db.initialize();
    console.log('✅ 数据库初始化完成');

    // 初始化管理器（注意：ToolManager需要先初始化，SkillManager依赖它）
    this.toolManager = new ToolManager(this.db, null); // functionCaller可选
    this.toolRunner = new ToolRunner(this.toolManager);

    this.skillManager = new SkillManager(this.db, this.toolManager);

    // 初始化执行器
    this.skillExecutor = new SkillExecutor(this.skillManager, this.toolManager);

    // 初始化AI调度器（不使用LLM服务）
    this.aiScheduler = new AISkillScheduler(
      this.skillManager,
      this.toolManager,
      this.skillExecutor,
      null // LLM服务可选
    );

    console.log('✅ 所有组件初始化完成\n');
  }

  /**
   * 示例1: 基础技能执行
   */
  async example1_BasicSkillExecution() {
    console.log('📌 示例1: 基础技能执行\n');

    const result = await this.skillExecutor.executeSkill(
      'skill_code_development',
      {
        projectName: 'my-app',
        language: 'javascript'
      }
    );

    console.log('执行结果:', JSON.stringify(result, null, 2));
    console.log('\n---\n');
  }

  /**
   * 示例2: 直接执行工具
   */
  async example2_DirectToolExecution() {
    console.log('📌 示例2: 直接执行工具\n');

    // 生成HTML文件
    const htmlResult = await this.toolRunner.executeTool('html_generator', {
      title: '我的第一个网页',
      content: '<h1>欢迎！</h1><p>这是自动生成的网页。</p>',
      primaryColor: '#667eea'
    });

    console.log('HTML生成结果:', JSON.stringify(htmlResult, null, 2));

    // 如果成功，写入文件
    if (htmlResult.success) {
      const writeResult = await this.toolRunner.executeTool('file_writer', {
        filePath: './output/index.html',
        content: htmlResult.result.html,
        mode: 'overwrite'
      });

      console.log('文件写入结果:', JSON.stringify(writeResult, null, 2));
    }

    console.log('\n---\n');
  }

  /**
   * 示例3: 创建工作流
   */
  async example3_CreateWorkflow() {
    console.log('📌 示例3: 创建和执行工作流\n');

    // 定义工作流：创建一个完整的网站
    const workflow = await this.skillExecutor.createWorkflow({
      name: '创建网站工作流',
      skills: [
        {
          skillId: 'skill_project_management',
          params: {
            projectName: 'my-website',
            projectType: 'web'
          },
          options: { sequential: true }
        },
        {
          skillId: 'skill_web_development',
          params: {
            template: 'blog',
            responsive: true
          },
          options: { sequential: true }
        },
        {
          skillId: 'skill_code_development',
          params: {
            action: 'format',
            autoFormat: true
          },
          options: { sequential: true }
        }
      ]
    });

    console.log('工作流创建成功:', JSON.stringify(workflow, null, 2));

    // 执行工作流
    const workflowResult = await this.skillExecutor.executeWorkflow(workflow);
    console.log('工作流执行结果:', JSON.stringify(workflowResult, null, 2));

    console.log('\n---\n');
  }

  /**
   * 示例4: AI智能调度
   */
  async example4_AISmartScheduling() {
    console.log('📌 示例4: AI智能调度\n');

    // 用户输入自然语言，系统自动选择技能
    const userInputs = [
      '帮我创建一个博客网站',
      '读取README.md文件',
      '分析这个CSV数据文件',
      '生成一个项目报告文档'
    ];

    for (const input of userInputs) {
      console.log(`\n用户输入: "${input}"`);

      const result = await this.aiScheduler.smartSchedule(input, {
        userId: 'user123',
        sessionId: 'session456'
      });

      console.log('AI调度结果:');
      console.log(`  - 识别意图: ${result.intent.action} → ${result.intent.target}`);
      console.log(`  - 置信度: ${result.intent.confidence}`);
      console.log(`  - 选择技能: ${result.skill}`);
      console.log(`  - 推荐技能数: ${result.recommendations.length}`);

      if (result.recommendations.length > 0) {
        console.log('  - 其他推荐:');
        result.recommendations.slice(1, 4).forEach((rec, index) => {
          console.log(`    ${index + 1}. ${rec.name} (评分: ${rec.score.toFixed(2)})`);
        });
      }
    }

    console.log('\n---\n');
  }

  /**
   * 示例5: 批量处理任务
   */
  async example5_BatchProcessing() {
    console.log('📌 示例5: 批量处理任务\n');

    const tasks = [
      {
        skillId: 'skill_web_development',
        params: { template: 'landing-page' }
      },
      {
        skillId: 'skill_code_development',
        params: { language: 'javascript' }
      },
      {
        skillId: 'skill_data_analysis',
        params: { dataSource: 'user_stats.csv' }
      }
    ];

    const batchResult = await this.skillExecutor.executeBatch(tasks);

    console.log('批量执行结果:');
    console.log(`  - 总任务数: ${batchResult.total}`);
    console.log(`  - 成功: ${batchResult.successful}`);
    console.log(`  - 失败: ${batchResult.failed}`);

    console.log('\n---\n');
  }

  /**
   * 示例6: 执行统计和分析
   */
  async example6_StatisticsAndAnalytics() {
    console.log('📌 示例6: 执行统计和分析\n');

    // 技能执行统计
    const skillStats = this.skillExecutor.getExecutionStats();
    console.log('技能执行统计:', JSON.stringify(skillStats, null, 2));

    // AI推荐统计
    const recommendStats = this.aiScheduler.getRecommendationStats();
    console.log('\nAI推荐统计:', JSON.stringify(recommendStats, null, 2));

    // 获取执行历史
    const history = this.skillExecutor.getExecutionHistory(10);
    console.log(`\n最近 ${history.length} 次执行:`);
    history.forEach((record, index) => {
      console.log(`  ${index + 1}. ${record.skill} - ${record.success ? '✅' : '❌'} (${record.executionTime}ms)`);
    });

    console.log('\n---\n');
  }

  /**
   * 示例7: 自定义工具执行
   */
  async example7_CustomToolChain() {
    console.log('📌 示例7: 自定义工具链\n');

    // 创建一个自定义工具链：读取 → 处理 → 写入
    const toolChain = [
      {
        tool: 'file_reader',
        params: { filePath: './README.md' }
      },
      {
        tool: 'format_output',
        params: { format: 'json' }
      },
      {
        tool: 'file_writer',
        params: {
          filePath: './output/processed.json',
          mode: 'overwrite'
        }
      }
    ];

    let context = {};

    for (const step of toolChain) {
      console.log(`执行工具: ${step.tool}`);

      const result = await this.toolRunner.executeTool(
        step.tool,
        { ...context, ...step.params }
      );

      if (result.success) {
        context = { ...context, ...result.result };
        console.log(`  ✅ 成功 (${result.executionTime}ms)`);
      } else {
        console.log(`  ❌ 失败: ${result.error}`);
        break;
      }
    }

    console.log('\n最终上下文:', JSON.stringify(context, null, 2));
    console.log('\n---\n');
  }

  /**
   * 示例8: 错误处理和重试
   */
  async example8_ErrorHandlingAndRetry() {
    console.log('📌 示例8: 错误处理和重试机制\n');

    const maxRetries = 3;
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
      console.log(`尝试 ${retries + 1}/${maxRetries}...`);

      const result = await this.toolRunner.executeTool('file_reader', {
        filePath: './potentially-missing-file.txt'
      });

      if (result.success) {
        success = true;
        console.log('✅ 执行成功');
      } else {
        console.log(`❌ 执行失败: ${result.error}`);
        retries++;

        if (retries < maxRetries) {
          console.log('等待后重试...\n');
          await this.sleep(1000);
        }
      }
    }

    if (!success) {
      console.log('⚠️ 达到最大重试次数，执行失败');
    }

    console.log('\n---\n');
  }

  /**
   * 运行所有示例
   */
  async runAllExamples() {
    await this.initialize();

    console.log('🎯 开始运行所有示例...\n');
    console.log('='.repeat(60));
    console.log('\n');

    try {
      // await this.example1_BasicSkillExecution();
      await this.example2_DirectToolExecution();
      // await this.example3_CreateWorkflow();
      await this.example4_AISmartScheduling();
      // await this.example5_BatchProcessing();
      await this.example6_StatisticsAndAnalytics();
      // await this.example7_CustomToolChain();
      // await this.example8_ErrorHandlingAndRetry();

      console.log('='.repeat(60));
      console.log('\n✨ 所有示例运行完成！\n');

    } catch (error) {
      console.error('❌ 示例运行出错:', error);
    }
  }

  /**
   * 运行特定示例
   */
  async runExample(exampleNumber) {
    await this.initialize();

    const examples = {
      1: this.example1_BasicSkillExecution,
      2: this.example2_DirectToolExecution,
      3: this.example3_CreateWorkflow,
      4: this.example4_AISmartScheduling,
      5: this.example5_BatchProcessing,
      6: this.example6_StatisticsAndAnalytics,
      7: this.example7_CustomToolChain,
      8: this.example8_ErrorHandlingAndRetry
    };

    const example = examples[exampleNumber];
    if (example) {
      await example.call(this);
    } else {
      console.log(`❌ 示例 ${exampleNumber} 不存在`);
    }
  }

  /**
   * 辅助函数：延迟
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========== 命令行执行 ==========

if (require.main === module) {
  const automation = new WorkflowAutomation();

  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] === '--example') {
    const exampleNum = parseInt(args[1]);
    automation.runExample(exampleNum).catch(console.error);
  } else {
    automation.runAllExamples().catch(console.error);
  }
}

module.exports = WorkflowAutomation;
