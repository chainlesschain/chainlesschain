const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

async function importBuiltinData() {
  try {
    console.log('=== 开始导入所有内置技能和工具数据 ===\n');

    // 打开数据库
    const db = new Database(dbPath);

    // 1. 加载技能定义
    console.log('1. 加载技能定义...');
    const builtinSkillsPath = path.join(__dirname, 'desktop-app-vue', 'src', 'main', 'skill-tool-system', 'builtin-skills.js');
    const builtinSkills = require(builtinSkillsPath);
    console.log(`   ✓ 加载了 ${builtinSkills.length} 个技能定义\n`);

    // 2. 加载工具定义
    console.log('2. 加载工具定义...');
    const builtinToolsPath = path.join(__dirname, 'desktop-app-vue', 'src', 'main', 'skill-tool-system', 'builtin-tools.js');
    const builtinTools = require(builtinToolsPath);
    console.log(`   ✓ 加载了 ${builtinTools.length} 个工具定义\n`);

    // 3. 导入工具（先导入工具，因为技能依赖工具）
    console.log('3. 导入工具到数据库...');
    let toolsAdded = 0;
    let toolsSkipped = 0;

    const insertToolStmt = db.prepare(`
      INSERT INTO tools (
        id, name, display_name, description,
        tool_type, category,
        parameters_schema, return_schema,
        is_builtin, enabled,
        config, examples,
        required_permissions, risk_level,
        usage_count, success_count,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        0, 0,
        ?, ?
      )
    `);

    for (const tool of builtinTools) {
      // 检查是否已存在
      const exists = db.prepare('SELECT id FROM tools WHERE id = ?').get(tool.id);

      if (exists) {
        toolsSkipped++;
        continue;
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        insertToolStmt.run(
          tool.id,
          tool.name,
          tool.display_name || tool.name,
          tool.description || '',
          tool.tool_type || 'function',
          tool.category || 'utility',
          JSON.stringify(tool.parameters_schema || {}),
          JSON.stringify(tool.return_schema || {}),
          tool.is_builtin !== undefined ? tool.is_builtin : 1,
          tool.enabled !== undefined ? tool.enabled : 1,
          JSON.stringify(tool.config || {}),
          JSON.stringify(tool.examples || []),
          JSON.stringify(tool.required_permissions || []),
          tool.risk_level || 1,
          now,
          now
        );
        toolsAdded++;
      } catch (err) {
        console.error(`   ⚠️  导入工具失败 ${tool.id}:`, err.message);
      }
    }

    console.log(`   ✓ 新增工具: ${toolsAdded} 个`);
    console.log(`   - 跳过已存在: ${toolsSkipped} 个\n`);

    // 4. 导入技能
    console.log('4. 导入技能到数据库...');
    let skillsAdded = 0;
    let skillsSkipped = 0;

    const insertSkillStmt = db.prepare(`
      INSERT INTO skills (
        id, name, display_name, description,
        category, icon,
        enabled, is_builtin,
        config, tags, doc_path,
        usage_count, success_count,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        0, 0,
        ?, ?
      )
    `);

    for (const skill of builtinSkills) {
      // 检查是否已存在
      const exists = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);

      if (exists) {
        skillsSkipped++;
        continue;
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        insertSkillStmt.run(
          skill.id,
          skill.name,
          skill.display_name || skill.name,
          skill.description || '',
          skill.category || 'general',
          skill.icon || 'tool',
          skill.enabled !== undefined ? skill.enabled : 1,
          skill.is_builtin !== undefined ? skill.is_builtin : 1,
          skill.config || '{}',
          skill.tags || '[]',
          skill.doc_path || '',
          now,
          now
        );
        skillsAdded++;
      } catch (err) {
        console.error(`   ⚠️  导入技能失败 ${skill.id}:`, err.message);
      }
    }

    console.log(`   ✓ 新增技能: ${skillsAdded} 个`);
    console.log(`   - 跳过已存在: ${skillsSkipped} 个\n`);

    // 5. 建立技能-工具关联
    console.log('5. 建立技能-工具关联...');
    let relationsAdded = 0;

    const insertRelationStmt = db.prepare(`
      INSERT OR IGNORE INTO skill_tools (
        id, skill_id, tool_id, role, priority, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const skill of builtinSkills) {
      if (!skill.tools || skill.tools.length === 0) {
        continue;
      }

      for (let i = 0; i < skill.tools.length; i++) {
        const toolName = skill.tools[i];

        // 查找工具ID
        const tool = db.prepare('SELECT id FROM tools WHERE name = ?').get(toolName);

        if (tool) {
          try {
            const relationId = `${skill.id}_${tool.id}`;
            const role = i === 0 ? 'primary' : 'secondary';
            const priority = skill.tools.length - i;
            const now = Math.floor(Date.now() / 1000);

            insertRelationStmt.run(
              relationId,
              skill.id,
              tool.id,
              role,
              priority,
              now
            );
            relationsAdded++;
          } catch (err) {
            // Ignore duplicate errors
          }
        }
      }
    }

    console.log(`   ✓ 新增关联: ${relationsAdded} 个\n`);

    // 6. 验证结果
    console.log('6. 验证导入结果...');
    const finalSkillCount = db.prepare('SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1').get();
    const finalToolCount = db.prepare('SELECT COUNT(*) as count FROM tools WHERE is_builtin = 1').get();
    const finalRelationCount = db.prepare('SELECT COUNT(*) as count FROM skill_tools').get();

    console.log(`   内置技能总数: ${finalSkillCount.count}`);
    console.log(`   内置工具总数: ${finalToolCount.count}`);
    console.log(`   技能-工具关联总数: ${finalRelationCount.count}\n`);

    db.close();

    console.log('✅ 所有内置数据导入完成!\n');

  } catch (error) {
    console.error('❌ 导入失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importBuiltinData();
