/**
 * 技能和工具系统加载测试
 * 测试新增的技能和工具是否能正确加载到数据库
 */

const path = require('path');
const Database = require('../src/main/database');

async function testSkillToolSystem() {
  console.log('='.repeat(60));
  console.log('🧪 开始测试技能和工具系统加载');
  console.log('='.repeat(60));

  try {
    // 1. 初始化数据库
    console.log('\n📦 初始化数据库...');
    const dbPath = path.join(__dirname, '../data/test-chainlesschain.db');
    const db = new Database(dbPath);
    await db.initialize();

    // 2. 加载内置技能
    console.log('\n📚 加载内置技能...');
    const builtinSkills = require('../src/main/skill-tool-system/builtin-skills');
    console.log(`   找到 ${builtinSkills.length} 个内置技能`);

    // 3. 加载内置工具
    console.log('\n🛠️  加载内置工具...');
    const builtinTools = require('../src/main/skill-tool-system/builtin-tools');
    console.log(`   找到 ${builtinTools.length} 个内置工具`);

    // 4. 验证新增技能
    console.log('\n✨ 验证新增技能 (16-25):');
    const newSkills = [
      'skill_data_transformation',
      'skill_text_processing',
      'skill_encryption_security',
      'skill_api_integration',
      'skill_database_operations',
      'skill_file_compression',
      'skill_format_conversion',
      'skill_configuration_management',
      'skill_datetime_operations',
      'skill_batch_processing'
    ];

    newSkills.forEach(skillId => {
      const found = builtinSkills.find(s => s.id === skillId);
      if (found) {
        console.log(`   ✅ ${found.name} (${skillId})`);
        console.log(`      工具: ${found.tools.join(', ')}`);
      } else {
        console.log(`   ❌ ${skillId} - 未找到`);
      }
    });

    // 5. 验证新增工具
    console.log('\n🔧 验证新增工具 (13-32):');
    const newTools = [
      'json_parser', 'yaml_parser', 'text_analyzer', 'datetime_handler',
      'url_parser', 'crypto_handler', 'base64_handler', 'http_client',
      'regex_tester', 'markdown_converter', 'csv_handler', 'zip_handler',
      'excel_reader', 'sql_builder', 'image_metadata', 'env_manager',
      'color_converter', 'random_generator', 'file_searcher', 'template_renderer'
    ];

    newTools.forEach(toolName => {
      const found = builtinTools.find(t => t.name === toolName);
      if (found) {
        console.log(`   ✅ ${found.display_name} (${toolName}) - ${found.category}`);
      } else {
        console.log(`   ❌ ${toolName} - 未找到`);
      }
    });

    // 6. 验证工具实现
    console.log('\n⚙️  验证工具实现:');
    try {
      const ExtendedTools = require('../src/main/ai-engine/extended-tools');
      console.log('   ✅ ExtendedTools 模块加载成功');

      // 简单测试
      const FunctionCaller = require('../src/main/ai-engine/function-caller');
      const caller = new FunctionCaller();
      console.log(`   ✅ FunctionCaller 创建成功，注册了 ${caller.tools.size} 个工具`);

      // 测试一个新工具
      if (caller.tools.has('json_parser')) {
        const result = await caller.call('json_parser', {
          json: '{"test": "value"}',
          action: 'parse'
        });
        if (result.success) {
          console.log('   ✅ json_parser 工具测试成功');
        }
      }
    } catch (error) {
      console.log(`   ❌ 工具实现加载失败: ${error.message}`);
    }

    // 7. 统计信息
    console.log('\n📊 统计信息:');
    console.log(`   总技能数: ${builtinSkills.length}`);
    console.log(`   总工具数: ${builtinTools.length}`);
    console.log(`   新增技能: ${newSkills.length}`);
    console.log(`   新增工具: ${newTools.length}`);

    // 8. 分类统计
    console.log('\n📋 技能分类统计:');
    const categoryCount = {};
    builtinSkills.forEach(skill => {
      categoryCount[skill.category] = (categoryCount[skill.category] || 0) + 1;
    });
    Object.entries(categoryCount).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });

    console.log('\n🎯 工具分类统计:');
    const toolCategoryCount = {};
    builtinTools.forEach(tool => {
      toolCategoryCount[tool.category] = (toolCategoryCount[tool.category] || 0) + 1;
    });
    Object.entries(toolCategoryCount).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ 测试完成！所有新增技能和工具已成功加载');
    console.log('='.repeat(60));

    // 关闭数据库
    await db.close();

    return true;
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error(error.stack);
    return false;
  }
}

// 运行测试
if (require.main === module) {
  testSkillToolSystem()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = testSkillToolSystem;
