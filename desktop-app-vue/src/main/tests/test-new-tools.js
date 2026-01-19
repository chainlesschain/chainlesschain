/**
 * 测试新添加的工具功能
 * 验证 Office、数据科学和项目初始化工具
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const fs = require('fs').promises;
const FunctionCaller = require('./ai-engine/function-caller');

class NewToolsTester {
  constructor() {
    this.functionCaller = new FunctionCaller();
    this.outputDir = path.join(__dirname, '../../../test-output');
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async initialize() {
    logger.info('='.repeat(70));
    logger.info('新工具功能测试');
    logger.info('='.repeat(70));
    logger.info('\n1. 初始化测试环境...\n');

    // 创建输出目录
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      logger.info(`   ✓ 输出目录: ${this.outputDir}\n`);
    } catch (error) {
      logger.info(`   ⚠️  创建目录失败: ${error.message}\n`);
    }

    // 注册内置工具
    try {
      await this.functionCaller.registerBuiltInTools();
      logger.info('   ✓ 工具注册成功\n');
    } catch (error) {
      logger.info(`   ✗ 工具注册失败: ${error.message}\n`);
      throw error;
    }
  }

  async testTool(toolName, params, description) {
    this.results.total++;
    logger.info(`\n测试 ${this.results.total}: ${description}`);
    logger.info('-'.repeat(70));

    try {
      const result = await this.functionCaller.call(toolName, params);

      logger.info('✅ 测试通过');
      logger.info('结果:', JSON.stringify(result, null, 2).substring(0, 200));

      this.results.passed++;
      this.results.tests.push({
        name: toolName,
        description,
        status: 'passed',
        result
      });

      return result;
    } catch (error) {
      logger.info('❌ 测试失败');
      logger.info('错误:', error.message);

      this.results.failed++;
      this.results.tests.push({
        name: toolName,
        description,
        status: 'failed',
        error: error.message
      });

      return null;
    }
  }

  async runOfficeToolsTests() {
    logger.info('\n' + '='.repeat(70));
    logger.info('Office 工具测试');
    logger.info('='.repeat(70));

    // 测试 Word 生成器
    await this.testTool(
      'tool_word_generator',
      {
        title: 'ChainlessChain 项目测试文档',
        content: '# 概述\n\n这是一个测试文档。\n\n## 功能\n\n- AI集成\n- 模板系统\n- 工具管理',
        outputPath: path.join(this.outputDir, 'test-word.docx'),
        options: {
          fontSize: 12,
          lineSpacing: 1.5
        }
      },
      'Word文档生成器 - 创建测试文档'
    );

    // 测试 Excel 生成器
    await this.testTool(
      'tool_excel_generator',
      {
        sheets: [
          {
            name: '工具清单',
            headers: ['工具名称', '分类', '状态'],
            data: [
              ['word_generator', 'Office', '已实现'],
              ['excel_generator', 'Office', '已实现'],
              ['data_preprocessor', '数据科学', '已实现']
            ]
          }
        ],
        outputPath: path.join(this.outputDir, 'test-excel.xlsx'),
        options: {
          autoFilter: true,
          freeze: { row: 1, column: 0 }
        }
      },
      'Excel生成器 - 创建工具清单'
    );

    // 测试 PPT 生成器
    await this.testTool(
      'tool_ppt_generator',
      {
        slides: [
          {
            layout: 'title',
            title: 'ChainlessChain 系统架构',
            content: '个人移动AI管理系统'
          },
          {
            layout: 'titleAndContent',
            title: '系统概述',
            content: '• 模板管理\n• 技能系统\n• 工具集成'
          },
          {
            layout: 'titleAndContent',
            title: '核心功能',
            content: '• 知识库管理\n• AI对话\n• 项目创建'
          }
        ],
        outputPath: path.join(this.outputDir, 'test-ppt.pptx'),
        theme: 'default',
        options: {
          author: 'ChainlessChain',
          slideSize: 'LAYOUT_16x9'
        }
      },
      'PPT生成器 - 创建演示文稿'
    );
  }

  async runProjectToolsTests() {
    logger.info('\n' + '='.repeat(70));
    logger.info('项目初始化工具测试');
    logger.info('='.repeat(70));

    // 测试 NPM 项目初始化
    const projectPath = path.join(this.outputDir, 'test-npm-project');
    await this.testTool(
      'tool_npm_project_setup',
      {
        projectName: 'test-project',
        projectPath: projectPath,
        template: 'basic',
        packageManager: 'npm'
      },
      'NPM项目初始化 - 创建基础项目'
    );

    // 测试 Python 项目初始化
    const pythonProjectPath = path.join(this.outputDir, 'test-python-project');
    await this.testTool(
      'tool_python_project_setup',
      {
        projectName: 'test-ml-project',
        projectPath: pythonProjectPath,
        template: 'ml',
        pythonVersion: '3.9'
      },
      'Python项目初始化 - 创建ML项目'
    );
  }

  async runDataScienceToolsTests() {
    logger.info('\n' + '='.repeat(70));
    logger.info('数据科学工具测试（模拟）');
    logger.info('='.repeat(70));

    logger.info('\n⚠️  数据科学工具需要Python环境，跳过实际测试');
    logger.info('   这些工具在有Python环境时可以正常工作：');
    logger.info('   - tool_data_preprocessor: 数据预处理');
    logger.info('   - tool_ml_model_trainer: 模型训练');
    logger.info('   - tool_data_visualizer: 数据可视化');
    logger.info('   - tool_feature_engineer: 特征工程');
  }

  async printSummary() {
    logger.info('\n' + '='.repeat(70));
    logger.info('测试总结');
    logger.info('='.repeat(70));

    logger.info(`\n总测试数: ${this.results.total}`);
    logger.info(`通过: ${this.results.passed} ✅`);
    logger.info(`失败: ${this.results.failed} ❌`);
    logger.info(`成功率: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);

    logger.info('\n详细结果:');
    this.results.tests.forEach((test, index) => {
      const icon = test.status === 'passed' ? '✅' : '❌';
      logger.info(`${index + 1}. ${icon} ${test.description}`);
      if (test.status === 'failed') {
        logger.info(`   错误: ${test.error}`);
      }
    });

    logger.info('\n输出文件位置:');
    logger.info(`   ${this.outputDir}`);

    logger.info('\n' + '='.repeat(70));

    // 检查生成的文件
    try {
      const files = await fs.readdir(this.outputDir);
      logger.info('\n生成的文件:');
      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          logger.info(`   - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        } else if (stats.isDirectory()) {
          logger.info(`   - ${file}/ (目录)`);
        }
      }
    } catch (error) {
      logger.info('\n未能列出生成的文件:', error.message);
    }

    logger.info('\n' + '='.repeat(70));
  }

  async run() {
    try {
      await this.initialize();
      await this.runOfficeToolsTests();
      await this.runProjectToolsTests();
      await this.runDataScienceToolsTests();
      await this.printSummary();

      return this.results.failed === 0;
    } catch (error) {
      logger.error('\n❌ 测试过程出错:', error);
      logger.error(error.stack);
      return false;
    }
  }
}

// 运行测试
if (require.main === module) {
  const tester = new NewToolsTester();
  tester.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('测试失败:', error);
      process.exit(1);
    });
}

module.exports = NewToolsTester;
