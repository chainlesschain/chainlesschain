/**
 * 模板执行测试脚本
 * 测试模板的技能和工具关联，以及执行流程
 *
 * 使用方法：
 * node test-template-execution.js
 */

const DatabaseManager = require('./database');
const path = require('./path');
const OfficeToolsHandler = require('./ai-engine/extended-tools-office');
const DataScienceToolsHandler = require('./ai-engine/extended-tools-datascience');
const ProjectToolsHandler = require('./ai-engine/extended-tools-project');

class TemplateExecutionTester {
  constructor() {
    this.db = null;
    this.officeTools = new OfficeToolsHandler();
    this.dataScienceTools = new DataScienceToolsHandler();
    this.projectTools = new ProjectToolsHandler();
  }

  async initialize() {
    console.log('='.repeat(70));
    console.log('模板执行测试工具');
    console.log('='.repeat(70));

    // 初始化数据库
    console.log('\n1. 初始化数据库...');
    this.db = new DatabaseManager();
    await this.db.initialize();
    console.log('   ✓ 数据库连接成功');
  }

  /**
   * 测试1：检查模板的技能和工具字段
   */
  async testTemplateFields() {
    console.log('\n' + '-'.repeat(70));
    console.log('测试1：检查模板字段');
    console.log('-'.repeat(70));

    try {
      const templates = this.db.prepare(`
        SELECT
          id,
          name,
          display_name,
          category,
          execution_engine,
          required_skills,
          required_tools
        FROM project_templates
        WHERE deleted = 0
        LIMIT 5
      `).all();

      console.log(`\n   查询到 ${templates.length} 个模板：\n`);

      templates.forEach((tpl, index) => {
        console.log(`   ${index + 1}. ${tpl.display_name} (${tpl.name})`);
        console.log(`      分类: ${tpl.category}`);
        console.log(`      执行引擎: ${tpl.execution_engine || '未设置'}`);

        try {
          const skills = JSON.parse(tpl.required_skills || '[]');
          const tools = JSON.parse(tpl.required_tools || '[]');
          console.log(`      所需技能 (${skills.length}个): ${skills.slice(0, 3).join(', ')}${skills.length > 3 ? '...' : ''}`);
          console.log(`      所需工具 (${tools.length}个): ${tools.slice(0, 3).join(', ')}${tools.length > 3 ? '...' : ''}`);
        } catch (error) {
          console.log(`      ⚠️  字段解析失败: ${error.message}`);
        }
        console.log();
      });

      // 统计
      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN required_skills != '[]' THEN 1 ELSE 0 END) as with_skills,
          SUM(CASE WHEN required_tools != '[]' THEN 1 ELSE 0 END) as with_tools,
          SUM(CASE WHEN execution_engine IS NOT NULL AND execution_engine != 'default' THEN 1 ELSE 0 END) as with_engine
        FROM project_templates
        WHERE deleted = 0
      `).get();

      console.log('   统计信息:');
      console.log(`   - 总模板数: ${stats.total}`);
      console.log(`   - 已配置技能: ${stats.with_skills} (${((stats.with_skills/stats.total)*100).toFixed(1)}%)`);
      console.log(`   - 已配置工具: ${stats.with_tools} (${((stats.with_tools/stats.total)*100).toFixed(1)}%)`);
      console.log(`   - 已配置执行引擎: ${stats.with_engine} (${((stats.with_engine/stats.total)*100).toFixed(1)}%)`);

      return { success: true, stats };
    } catch (error) {
      console.error('   ❌ 测试失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 测试2：模拟工具调用
   */
  async testToolExecution() {
    console.log('\n' + '-'.repeat(70));
    console.log('测试2：模拟工具调用');
    console.log('-'.repeat(70));

    const tests = [
      {
        name: 'Word文档生成器',
        tool: 'tool_word_generator',
        handler: this.officeTools,
        params: {
          title: '测试文档',
          content: '# 标题\n\n这是测试内容。\n\n## 子标题\n\n- 列表项1\n- 列表项2',
          outputPath: './test-output/test-document.docx',
          options: {}
        }
      },
      {
        name: 'Excel公式构建器',
        tool: 'tool_excel_formula_builder',
        handler: this.officeTools,
        params: {
          formulaType: 'SUM',
          range: 'A1:A10'
        }
      },
      {
        name: 'package.json构建器',
        tool: 'tool_package_json_builder',
        handler: this.projectTools,
        params: {
          projectPath: './test-output',
          config: {
            name: 'test-project',
            version: '1.0.0',
            description: '测试项目',
            main: 'index.js'
          }
        }
      }
    ];

    const results = [];

    for (const test of tests) {
      console.log(`\n   测试: ${test.name}`);

      try {
        const method = test.handler[test.tool];
        if (!method) {
          throw new Error(`工具方法 ${test.tool} 不存在`);
        }

        const result = await method.call(test.handler, test.params);

        if (result.success !== false) {
          console.log(`   ✓ 执行成功`);
          if (result.filePath) {
            console.log(`     输出文件: ${result.filePath}`);
          }
          if (result.formula) {
            console.log(`     生成公式: ${result.formula}`);
          }
        } else {
          console.log(`   ⚠️  执行完成但有警告`);
          if (result.error) {
            console.log(`     警告: ${result.error}`);
          }
        }

        results.push({
          name: test.name,
          success: true,
          result: result
        });
      } catch (error) {
        console.log(`   ❌ 执行失败: ${error.message}`);
        results.push({
          name: test.name,
          success: false,
          error: error.message
        });
      }
    }

    // 汇总
    const successCount = results.filter(r => r.success).length;
    console.log(`\n   执行结果: ${successCount}/${results.length} 成功`);

    return { success: true, results };
  }

  /**
   * 测试3：检查技能和工具的完整性
   */
  async testSkillToolIntegrity() {
    console.log('\n' + '-'.repeat(70));
    console.log('测试3：检查技能和工具完整性');
    console.log('-'.repeat(70));

    try {
      // 获取所有模板引用的技能
      const templates = this.db.prepare(`
        SELECT id, name, required_skills, required_tools
        FROM project_templates
        WHERE deleted = 0
      `).all();

      const allSkills = new Set();
      const allTools = new Set();
      const issues = [];

      templates.forEach(tpl => {
        try {
          const skills = JSON.parse(tpl.required_skills || '[]');
          const tools = JSON.parse(tpl.required_tools || '[]');

          skills.forEach(s => allSkills.add(s));
          tools.forEach(t => allTools.add(t));

          // 检查是否有空的关联
          if (skills.length === 0 && tools.length === 0) {
            issues.push({
              template: tpl.name,
              issue: '未配置任何技能和工具'
            });
          }
        } catch (error) {
          issues.push({
            template: tpl.name,
            issue: `JSON解析失败: ${error.message}`
          });
        }
      });

      console.log(`\n   引用的技能总数: ${allSkills.size}`);
      console.log(`   前10个技能: ${Array.from(allSkills).slice(0, 10).join(', ')}`);

      console.log(`\n   引用的工具总数: ${allTools.size}`);
      console.log(`   前10个工具: ${Array.from(allTools).slice(0, 10).join(', ')}`);

      if (issues.length > 0) {
        console.log(`\n   ⚠️  发现 ${issues.length} 个问题:`);
        issues.slice(0, 5).forEach((issue, index) => {
          console.log(`   ${index + 1}. ${issue.template}: ${issue.issue}`);
        });
        if (issues.length > 5) {
          console.log(`   ... 还有 ${issues.length - 5} 个问题`);
        }
      } else {
        console.log(`\n   ✓ 所有模板都已配置技能和工具`);
      }

      return {
        success: true,
        skillCount: allSkills.size,
        toolCount: allTools.size,
        issues: issues
      };
    } catch (error) {
      console.error('   ❌ 测试失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    await this.initialize();

    const results = {
      test1: await this.testTemplateFields(),
      test2: await this.testToolExecution(),
      test3: await this.testSkillToolIntegrity()
    };

    // 总结
    console.log('\n' + '='.repeat(70));
    console.log('测试总结');
    console.log('='.repeat(70));

    const allSuccess = Object.values(results).every(r => r.success);

    if (allSuccess) {
      console.log('\n✅ 所有测试通过！');
    } else {
      console.log('\n⚠️  部分测试失败');
      Object.entries(results).forEach(([name, result]) => {
        console.log(`   ${name}: ${result.success ? '✓' : '✗'}`);
      });
    }

    console.log('\n建议:');
    if (results.test1.stats && results.test1.stats.with_skills < results.test1.stats.total) {
      console.log('   - 运行模板更新脚本以为所有模板添加技能和工具');
      console.log('     cd desktop-app-vue/src/main/templates');
      console.log('     node add-skills-tools-to-templates.js');
    }

    if (results.test2.results) {
      const failedTools = results.test2.results.filter(r => !r.success);
      if (failedTools.length > 0) {
        console.log('   - 检查失败的工具实现，可能需要安装依赖：');
        console.log('     npm install docx exceljs pptxgenjs');
      }
    }

    console.log('\n' + '='.repeat(70));

    // 清理
    if (this.db && this.db.close) {
      this.db.close();
    }

    return results;
  }
}

// 运行测试
if (require.main === module) {
  const tester = new TemplateExecutionTester();
  tester.runAllTests().catch(error => {
    console.error('\n执行失败:', error);
    process.exit(1);
  });
}

module.exports = TemplateExecutionTester;
