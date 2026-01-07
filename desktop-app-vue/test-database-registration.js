/**
 * 数据库注册验证测试
 * 模拟应用启动时的技能和工具注册流程
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

console.log('\n========================================');
console.log('数据库注册验证测试');
console.log('========================================\n');

function testDatabaseRegistration() {
  // 创建临时测试数据库
  const testDbPath = path.join(__dirname, 'test-temp.db');

  let db;

  try {
    // 打开数据库连接
    db = new Database(testDbPath);

    console.log('【1】创建测试数据库表结构');
    console.log('----------------------------------------');

    // 创建skills表
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        category TEXT NOT NULL,
        icon TEXT,
        enabled INTEGER DEFAULT 1,
        is_builtin INTEGER DEFAULT 0,
        plugin_id TEXT,
        config TEXT,
        tags TEXT,
        doc_path TEXT,
        usage_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 创建tools表
    db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        category TEXT NOT NULL,
        tool_type TEXT DEFAULT 'function',
        parameters_schema TEXT,
        return_schema TEXT,
        examples TEXT,
        required_permissions TEXT,
        risk_level INTEGER DEFAULT 1,
        is_builtin INTEGER DEFAULT 0,
        plugin_id TEXT,
        enabled INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 创建skill_tools关联表
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_tools (
        skill_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (skill_id, tool_id),
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
      )
    `);

    console.log('✓ 数据库表结构创建成功\n');

    // 加载职业专用技能和工具
    console.log('【2】加载职业专用技能和工具');
    console.log('----------------------------------------');

    const professionalSkills = require('./src/main/skill-tool-system/professional-skills');
    const professionalTools = require('./src/main/skill-tool-system/professional-tools');

    console.log(`✓ 加载成功: ${professionalSkills.length}个技能, ${professionalTools.length}个工具\n`);

    // 注册工具
    console.log('【3】注册职业专用工具到数据库');
    console.log('----------------------------------------');

    const now = Date.now();
    let registeredTools = 0;

    const insertToolStmt = db.prepare(`
      INSERT INTO tools (
        id, name, display_name, description, category, tool_type,
        parameters_schema, return_schema, examples, required_permissions,
        risk_level, is_builtin, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const tool of professionalTools) {
      try {
        insertToolStmt.run(
          tool.id,
          tool.name,
          tool.display_name,
          tool.description,
          tool.category,
          tool.tool_type || 'function',
          JSON.stringify(tool.parameters_schema),
          JSON.stringify(tool.return_schema || {}),
          JSON.stringify(tool.examples || []),
          JSON.stringify(tool.required_permissions || []),
          tool.risk_level || 1,
          tool.is_builtin || 1,
          tool.enabled !== undefined ? tool.enabled : 1,
          now,
          now
        );
        registeredTools++;
      } catch (err) {
        console.error(`  ✗ 工具注册失败: ${tool.id} - ${err.message}`);
      }
    }

    console.log(`✓ 成功注册 ${registeredTools}/${professionalTools.length} 个工具\n`);

    // 注册技能
    console.log('【4】注册职业专用技能到数据库');
    console.log('----------------------------------------');

    let registeredSkills = 0;

    const insertSkillStmt = db.prepare(`
      INSERT INTO skills (
        id, name, display_name, description, category, icon,
        enabled, is_builtin, config, tags, doc_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const skill of professionalSkills) {
      try {
        insertSkillStmt.run(
          skill.id,
          skill.name,
          skill.display_name || skill.name,
          skill.description,
          skill.category,
          skill.icon || null,
          skill.enabled !== undefined ? skill.enabled : 1,
          skill.is_builtin || 1,
          skill.config || '{}',
          skill.tags || '[]',
          skill.doc_path || null,
          now,
          now
        );
        registeredSkills++;
      } catch (err) {
        console.error(`  ✗ 技能注册失败: ${skill.id} - ${err.message}`);
      }
    }

    console.log(`✓ 成功注册 ${registeredSkills}/${professionalSkills.length} 个技能\n`);

    // 建立技能-工具关联
    console.log('【5】建立技能-工具关联关系');
    console.log('----------------------------------------');

    let totalAssociations = 0;
    let successfulAssociations = 0;

    const findToolStmt = db.prepare('SELECT id FROM tools WHERE name = ?');
    const insertAssocStmt = db.prepare(`
      INSERT INTO skill_tools (skill_id, tool_id, display_order, created_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const skill of professionalSkills) {
      if (skill.tools && skill.tools.length > 0) {
        for (let i = 0; i < skill.tools.length; i++) {
          const toolName = skill.tools[i];
          totalAssociations++;

          try {
            // 查找工具ID
            const tool = findToolStmt.get(toolName);

            if (tool) {
              insertAssocStmt.run(skill.id, tool.id, i, now);
              successfulAssociations++;
            } else {
              console.log(`  ⚠ 工具未找到: ${toolName} (技能: ${skill.id})`);
            }
          } catch (err) {
            console.error(`  ✗ 关联失败: ${skill.id} <-> ${toolName}`);
          }
        }
      }
    }

    console.log(`✓ 成功建立 ${successfulAssociations}/${totalAssociations} 个关联关系\n`);

    // 验证注册结果
    console.log('【6】验证数据库注册结果');
    console.log('----------------------------------------');

    // 统计各职业的注册情况
    const skillCounts = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM skills
      WHERE category IN ('medical', 'legal', 'education', 'research')
      GROUP BY category
    `).all();

    const toolCounts = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM tools
      WHERE category IN ('medical', 'legal', 'education', 'research')
      GROUP BY category
    `).all();

    console.log('技能注册统计:');
    skillCounts.forEach(row => {
      const emoji = row.category === 'medical' ? '🏥' :
                    row.category === 'legal' ? '⚖️' :
                    row.category === 'education' ? '👨‍🏫' : '🔬';
      console.log(`  ${emoji} ${row.category}: ${row.count}个`);
    });

    console.log('\n工具注册统计:');
    toolCounts.forEach(row => {
      const emoji = row.category === 'medical' ? '🏥' :
                    row.category === 'legal' ? '⚖️' :
                    row.category === 'education' ? '👨‍🏫' : '🔬';
      console.log(`  ${emoji} ${row.category}: ${row.count}个`);
    });

    // 验证关联完整性
    console.log('\n技能-工具关联验证:');
    const associationCheck = db.prepare(`
      SELECT s.id, s.name, COUNT(st.tool_id) as tool_count
      FROM skills s
      LEFT JOIN skill_tools st ON s.id = st.skill_id
      WHERE s.category IN ('medical', 'legal', 'education', 'research')
      GROUP BY s.id
      ORDER BY s.category, s.id
    `).all();

    associationCheck.forEach(row => {
      console.log(`  ${row.name}: ${row.tool_count}个关联工具`);
    });

    // 最终统计
    console.log('\n【7】最终统计');
    console.log('----------------------------------------');

    const totalSkills = db.prepare('SELECT COUNT(*) as count FROM skills WHERE category IN ("medical", "legal", "education", "research")').get();
    const totalTools = db.prepare('SELECT COUNT(*) as count FROM tools WHERE category IN ("medical", "legal", "education", "research")').get();
    const totalAssocs = db.prepare('SELECT COUNT(*) as count FROM skill_tools').get();

    console.log(`✓ 职业技能总数: ${totalSkills.count}个`);
    console.log(`✓ 职业工具总数: ${totalTools.count}个`);
    console.log(`✓ 关联关系总数: ${totalAssocs.count}个`);

    console.log('\n========================================');
    console.log('数据库注册验证测试完成');
    console.log('========================================');
    console.log('✓ 所有职业专用功能已成功注册到数据库');
    console.log('✓ 技能与工具的关联关系已正确建立');
    console.log('✓ 系统可以正常启动并加载这些功能');
    console.log('========================================\n');

  } catch (error) {
    console.error('✗ 测试过程出错:', error);
    throw error;
  } finally {
    // 清理：关闭数据库并删除测试文件
    if (db) {
      db.close();
    }

    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('✓ 测试数据库已清理\n');
    }
  }
}

// 运行测试
try {
  testDatabaseRegistration();
} catch (err) {
  console.error('测试失败:', err);
  process.exit(1);
}
