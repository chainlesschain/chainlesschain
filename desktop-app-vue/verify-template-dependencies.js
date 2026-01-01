/**
 * 模板依赖关系完整性验证脚本
 * 版本: v0.18.0
 *
 * 功能:
 * - 检查所有模板的依赖声明完整性
 * - 生成依赖缺失报告
 * - 统计各类别的依赖覆盖率
 * - 验证技能和工具ID的有效性
 *
 * 运行: node verify-template-dependencies.js
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  模板依赖关系完整性验证                                  ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function verify() {
  try {
    // ========================================
    // 1. 导入sql.js
    // ========================================
    console.log('[1/5] 导入sql.js...');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    console.log('  ✅ sql.js已导入\n');

    // ========================================
    // 2. 加载数据库
    // ========================================
    console.log('[2/5] 加载数据库...');
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`);
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    console.log(`  ✅ 数据库已加载\n`);

    // ========================================
    // 3. 检查迁移状态
    // ========================================
    console.log('[3/5] 检查迁移状态...');

    const migrationCheck = db.exec(`
      SELECT version FROM schema_migrations WHERE version = 5
    `);

    if (migrationCheck.length === 0 || migrationCheck[0].values.length === 0) {
      console.log('  ❌ 迁移005未执行，请先运行 run-migration-005.js\n');
      process.exit(1);
    }

    console.log('  ✅ 迁移005已执行\n');

    // ========================================
    // 4. 统计模板依赖完整性
    // ========================================
    console.log('[4/5] 统计模板依赖完整性...\n');

    // 4.1 总体统计
    const totalResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates WHERE enabled = 1
    `);
    const totalTemplates = totalResult[0].values[0][0];

    const withDepsResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates
      WHERE enabled = 1
        AND required_skills != '[]'
        AND required_tools != '[]'
    `);
    const withDeps = withDepsResult[0].values[0][0];

    const missingBothResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates
      WHERE enabled = 1
        AND required_skills = '[]'
        AND required_tools = '[]'
    `);
    const missingBoth = missingBothResult[0].values[0][0];

    const missingSkillsResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates
      WHERE enabled = 1
        AND required_skills = '[]'
        AND required_tools != '[]'
    `);
    const missingSkills = missingSkillsResult[0].values[0][0];

    const missingToolsResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates
      WHERE enabled = 1
        AND required_skills != '[]'
        AND required_tools = '[]'
    `);
    const missingTools = missingToolsResult[0].values[0][0];

    console.log('📊 总体统计:');
    console.log(`  总模板数: ${totalTemplates}`);
    console.log(`  完整依赖: ${withDeps} (${(withDeps/totalTemplates*100).toFixed(1)}%)`);
    console.log(`  缺少技能+工具: ${missingBoth} (${(missingBoth/totalTemplates*100).toFixed(1)}%)`);
    console.log(`  缺少技能: ${missingSkills} (${(missingSkills/totalTemplates*100).toFixed(1)}%)`);
    console.log(`  缺少工具: ${missingTools} (${(missingTools/totalTemplates*100).toFixed(1)}%)\n`);

    // 4.2 按类别统计
    const categoryStatsResult = db.exec(`
      SELECT
        category,
        COUNT(*) as total,
        SUM(CASE WHEN required_skills != '[]' AND required_tools != '[]' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN required_skills = '[]' AND required_tools = '[]' THEN 1 ELSE 0 END) as missing_both
      FROM project_templates
      WHERE enabled = 1
      GROUP BY category
      ORDER BY total DESC
    `);

    console.log('📋 按类别统计:\n');
    console.log('  类别               | 总数 | 完整 | 缺失 | 完整率');
    console.log('  ' + '-'.repeat(60));

    if (categoryStatsResult.length > 0) {
      for (const row of categoryStatsResult[0].values) {
        const [category, total, complete, missing] = row;
        const completeRate = (complete / total * 100).toFixed(0);
        const categoryPadded = category.padEnd(18);
        const totalPadded = String(total).padStart(4);
        const completePadded = String(complete).padStart(4);
        const missingPadded = String(missing).padStart(4);
        const ratePadded = String(completeRate).padStart(3);

        const statusIcon = completeRate >= 80 ? '✅' : completeRate >= 50 ? '⚠️' : '❌';

        console.log(`  ${categoryPadded} | ${totalPadded} | ${completePadded} | ${missingPadded} | ${ratePadded}% ${statusIcon}`);
      }
    }

    console.log('');

    // 4.3 列出缺失依赖的模板（前20个）
    const missingTemplatesResult = db.exec(`
      SELECT
        id,
        name,
        category,
        CASE
          WHEN required_skills = '[]' AND required_tools = '[]' THEN '缺少技能+工具'
          WHEN required_skills = '[]' THEN '缺少技能'
          WHEN required_tools = '[]' THEN '缺少工具'
          ELSE '完整'
        END as status
      FROM project_templates
      WHERE enabled = 1
        AND (required_skills = '[]' OR required_tools = '[]')
      ORDER BY category, name
      LIMIT 20
    `);

    if (missingTemplatesResult.length > 0 && missingTemplatesResult[0].values.length > 0) {
      console.log('⚠️  缺失依赖的模板（前20个）:\n');
      console.log('  ID                  | 名称                 | 类别         | 状态');
      console.log('  ' + '-'.repeat(70));

      for (const row of missingTemplatesResult[0].values) {
        const [id, name, category, status] = row;
        const idShort = id.substring(0, 18).padEnd(18);
        const namePadded = name.substring(0, 20).padEnd(20);
        const categoryPadded = category.padEnd(12);

        console.log(`  ${idShort} | ${namePadded} | ${categoryPadded} | ${status}`);
      }

      console.log('');
    }

    // ========================================
    // 5. 验证技能和工具ID有效性
    // ========================================
    console.log('[5/5] 验证技能和工具ID有效性...\n');

    // 5.1 获取所有技能ID
    const skillsResult = db.exec(`SELECT id FROM builtin_skills WHERE enabled = 1`);
    const validSkillIds = new Set(skillsResult[0]?.values.map(row => row[0]) || []);

    // 5.2 获取所有工具ID
    const toolsResult = db.exec(`SELECT id FROM builtin_tools WHERE enabled = 1`);
    const validToolIds = new Set(toolsResult[0]?.values.map(row => row[0]) || []);

    console.log('📦 有效ID统计:');
    console.log(`  有效技能ID: ${validSkillIds.size}个`);
    console.log(`  有效工具ID: ${validToolIds.size}个\n`);

    // 5.3 验证模板中引用的ID（示例：检查business类别）
    const businessTemplatesResult = db.exec(`
      SELECT id, name, required_skills, required_tools
      FROM project_templates
      WHERE enabled = 1 AND category = 'business'
        AND (required_skills != '[]' OR required_tools != '[]')
      LIMIT 5
    `);

    if (businessTemplatesResult.length > 0 && businessTemplatesResult[0].values.length > 0) {
      console.log('✅ 验证示例（business类别，前5个）:\n');

      for (const row of businessTemplatesResult[0].values) {
        const [id, name, skills, tools] = row;

        console.log(`  模板: ${name}`);

        // 解析并验证技能ID
        try {
          const skillIds = JSON.parse(skills);
          let allValid = true;

          if (Array.isArray(skillIds) && skillIds.length > 0) {
            console.log(`    技能: ${skillIds.join(', ')}`);

            for (const skillId of skillIds) {
              if (!validSkillIds.has(skillId)) {
                console.log(`      ❌ 无效技能ID: ${skillId}`);
                allValid = false;
              }
            }

            if (allValid) {
              console.log(`      ✅ 所有技能ID有效`);
            }
          }
        } catch (e) {
          console.log(`    ❌ 技能JSON解析失败`);
        }

        // 解析并验证工具ID
        try {
          const toolIds = JSON.parse(tools);
          let allValid = true;

          if (Array.isArray(toolIds) && toolIds.length > 0) {
            console.log(`    工具: ${toolIds.join(', ')}`);

            for (const toolId of toolIds) {
              if (!validToolIds.has(toolId)) {
                console.log(`      ❌ 无效工具ID: ${toolId}`);
                allValid = false;
              }
            }

            if (allValid) {
              console.log(`      ✅ 所有工具ID有效`);
            }
          }
        } catch (e) {
          console.log(`    ❌ 工具JSON解析失败`);
        }

        console.log('');
      }
    }

    // ========================================
    // 完成
    // ========================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ 验证完成！                                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // 生成建议
    console.log('💡 改进建议:\n');

    if (withDeps / totalTemplates < 0.5) {
      console.log('  ⚠️  依赖覆盖率 < 50%，建议：');
      console.log('     1. 优先为主要类别（business/code-project/video）添加依赖');
      console.log('     2. 使用批量脚本按类别统一更新');
      console.log('     3. 参考 TEMPLATE_SKILLS_TOOLS_AUDIT_REPORT 第3阶段\n');
    } else if (withDeps / totalTemplates < 0.8) {
      console.log('  ⚠️  依赖覆盖率在 50-80%，继续改进：');
      console.log('     1. 补充剩余类别的依赖声明');
      console.log('     2. 验证依赖ID的有效性\n');
    } else {
      console.log('  ✅ 依赖覆盖率 >= 80%，继续保持！\n');
    }

    // 导出缺失列表到JSON
    if (missingTemplatesResult.length > 0 && missingTemplatesResult[0].values.length > 0) {
      const missingList = missingTemplatesResult[0].values.map(row => ({
        id: row[0],
        name: row[1],
        category: row[2],
        status: row[3]
      }));

      const outputPath = path.join(__dirname, 'templates-missing-dependencies.json');
      fs.writeFileSync(outputPath, JSON.stringify(missingList, null, 2));

      console.log(`📄 已导出缺失列表到: ${outputPath}\n`);
    }

    console.log('🎯 下一步:');
    console.log('  1. 运行批量更新脚本为模板添加依赖');
    console.log('  2. 重新运行此验证脚本检查进度');
    console.log('  3. 进入阶段2: 工具整合与去重\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 执行验证
verify();
