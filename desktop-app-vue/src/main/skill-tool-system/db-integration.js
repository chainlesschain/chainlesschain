/**
 * 数据库集成脚本 - 将 additional-skills-v3 和 additional-tools-v3 插入数据库
 * 运行方式: node src/main/skill-tool-system/db-integration.js
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');

// 导入数据库管理器
const DatabaseManager = require('../database');

// 导入技能和工具定义
const additionalSkillsV3 = require('./additional-skills-v3');
const additionalToolsV3 = require('./additional-tools-v3');

class DatabaseIntegration {
  constructor() {
    this.db = null;
    this.insertedTools = new Map(); // name -> id 映射
    this.insertedSkills = new Map(); // id -> skill 映射
  }

  /**
   * 初始化数据库连接
   */
  async initialize() {
    try {
      console.log('[DB Integration] 初始化数据库连接...');

      // 使用自定义路径或默认路径
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
      console.log(`[DB Integration] 数据库路径: ${dbPath}`);

      this.db = new DatabaseManager(dbPath, {
        encryptionEnabled: false, // 开发环境不使用加密
      });

      await this.db.initialize();
      console.log('[DB Integration] 数据库连接成功');

      return true;
    } catch (error) {
      console.error('[DB Integration] 数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 插入工具到数据库
   */
  async insertTools() {
    try {
      console.log('\n[DB Integration] ===== 开始插入工具 =====');
      console.log(`[DB Integration] 待插入工具数量: ${additionalToolsV3.length}`);

      let inserted = 0;
      let skipped = 0;

      for (const tool of additionalToolsV3) {
        try {
          // 检查是否已存在
          const existing = await this.db.get(
            'SELECT id FROM tools WHERE id = ? OR name = ?',
            [tool.id, tool.name]
          );

          if (existing) {
            console.log(`[DB Integration] ⚠️  工具已存在，跳过: ${tool.name}`);
            this.insertedTools.set(tool.name, existing.id);
            skipped++;
            continue;
          }

          const now = Date.now();

          // 准备插入数据
          const sql = `
            INSERT INTO tools (
              id, name, display_name, description, tool_type, category,
              parameters_schema, return_schema, is_builtin, plugin_id,
              handler_path, enabled, deprecated, config, examples,
              doc_path, required_permissions, risk_level, usage_count,
              success_count, avg_execution_time, last_used_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const params = [
            tool.id,
            tool.name,
            tool.display_name || tool.name,
            tool.description || '',
            tool.tool_type || 'function',
            tool.category || 'general',
            '{}', // parameters_schema (暂时为空对象)
            '{}', // return_schema
            tool.is_builtin || 0,
            null, // plugin_id
            null, // handler_path
            tool.enabled !== undefined ? tool.enabled : 1,
            0, // deprecated
            tool.config || '{}',
            '[]', // examples
            tool.doc_path || null,
            '[]', // required_permissions
            1, // risk_level
            0, // usage_count
            0, // success_count
            0, // avg_execution_time
            null, // last_used_at
            now,
            now,
          ];

          await this.db.run(sql, params);

          this.insertedTools.set(tool.name, tool.id);
          inserted++;
          console.log(`[DB Integration] ✅ 工具插入成功: ${tool.name} (${tool.id})`);

        } catch (error) {
          console.error(`[DB Integration] ❌ 工具插入失败: ${tool.name}`, error.message);
        }
      }

      console.log(`\n[DB Integration] 工具插入完成: 成功 ${inserted} 个, 跳过 ${skipped} 个`);
      return { inserted, skipped };

    } catch (error) {
      console.error('[DB Integration] 插入工具失败:', error);
      throw error;
    }
  }

  /**
   * 插入技能到数据库
   */
  async insertSkills() {
    try {
      console.log('\n[DB Integration] ===== 开始插入技能 =====');
      console.log(`[DB Integration] 待插入技能数量: ${additionalSkillsV3.length}`);

      let inserted = 0;
      let skipped = 0;

      for (const skill of additionalSkillsV3) {
        try {
          // 检查是否已存在
          const existing = await this.db.get(
            'SELECT id FROM skills WHERE id = ?',
            [skill.id]
          );

          if (existing) {
            console.log(`[DB Integration] ⚠️  技能已存在，跳过: ${skill.name}`);
            this.insertedSkills.set(skill.id, skill);
            skipped++;
            continue;
          }

          const now = Date.now();

          // 准备插入数据
          const sql = `
            INSERT INTO skills (
              id, name, display_name, description, category, icon,
              enabled, is_builtin, plugin_id, config, tags, doc_path,
              usage_count, success_count, last_used_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const params = [
            skill.id,
            skill.name,
            skill.display_name || skill.name,
            skill.description || '',
            skill.category || 'general',
            skill.icon || null,
            skill.enabled !== undefined ? skill.enabled : 1,
            skill.is_builtin || 0,
            null, // plugin_id
            skill.config || '{}',
            skill.tags || '[]',
            skill.doc_path || null,
            0, // usage_count
            0, // success_count
            null, // last_used_at
            now,
            now,
          ];

          await this.db.run(sql, params);

          this.insertedSkills.set(skill.id, skill);
          inserted++;
          console.log(`[DB Integration] ✅ 技能插入成功: ${skill.name} (${skill.id})`);

        } catch (error) {
          console.error(`[DB Integration] ❌ 技能插入失败: ${skill.name}`, error.message);
        }
      }

      console.log(`\n[DB Integration] 技能插入完成: 成功 ${inserted} 个, 跳过 ${skipped} 个`);
      return { inserted, skipped };

    } catch (error) {
      console.error('[DB Integration] 插入技能失败:', error);
      throw error;
    }
  }

  /**
   * 创建技能-工具关联关系
   */
  async createSkillToolRelations() {
    try {
      console.log('\n[DB Integration] ===== 开始创建技能-工具关联 =====');

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const [skillId, skill] of this.insertedSkills) {
        if (!skill.tools || skill.tools.length === 0) {
          console.log(`[DB Integration] ⚠️  技能无关联工具，跳过: ${skill.name}`);
          continue;
        }

        console.log(`\n[DB Integration] 处理技能: ${skill.name}`);
        console.log(`[DB Integration] 需关联工具: ${skill.tools.join(', ')}`);

        for (let i = 0; i < skill.tools.length; i++) {
          const toolName = skill.tools[i];

          try {
            // 查找工具ID (先从 insertedTools 查找，再从数据库查找)
            let toolId = null;

            if (this.insertedTools.has(toolName)) {
              toolId = this.insertedTools.get(toolName);
            } else {
              // 从数据库查找
              const tool = await this.db.get('SELECT id FROM tools WHERE name = ?', [toolName]);
              if (tool) {
                toolId = tool.id;
              }
            }

            if (!toolId) {
              console.log(`[DB Integration] ⚠️  工具不存在，跳过关联: ${toolName}`);
              failed++;
              continue;
            }

            // 检查关联是否已存在
            const existing = await this.db.get(
              'SELECT id FROM skill_tools WHERE skill_id = ? AND tool_id = ?',
              [skillId, toolId]
            );

            if (existing) {
              console.log(`[DB Integration] ⚠️  关联已存在，跳过: ${skill.name} -> ${toolName}`);
              skipped++;
              continue;
            }

            // 创建关联
            const role = i === 0 ? 'primary' : 'secondary';
            const priority = skill.tools.length - i;

            await this.db.run(`
              INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [
              `st_${uuidv4()}`,
              skillId,
              toolId,
              role,
              priority,
              Date.now(),
            ]);

            created++;
            console.log(`[DB Integration] ✅ 关联创建成功: ${skill.name} -> ${toolName} (${role}, priority=${priority})`);

          } catch (error) {
            console.error(`[DB Integration] ❌ 创建关联失败: ${skill.name} -> ${toolName}`, error.message);
            failed++;
          }
        }
      }

      console.log(`\n[DB Integration] 关联创建完成: 成功 ${created} 个, 跳过 ${skipped} 个, 失败 ${failed} 个`);
      return { created, skipped, failed };

    } catch (error) {
      console.error('[DB Integration] 创建技能-工具关联失败:', error);
      throw error;
    }
  }

  /**
   * 验证数据插入结果
   */
  async verify() {
    try {
      console.log('\n[DB Integration] ===== 验证数据 =====');

      // 验证工具数量
      const toolCount = await this.db.get('SELECT COUNT(*) as count FROM tools WHERE is_builtin = 1');
      console.log(`[DB Integration] 数据库中的内置工具数量: ${toolCount.count}`);

      // 验证技能数量
      const skillCount = await this.db.get('SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1');
      console.log(`[DB Integration] 数据库中的内置技能数量: ${skillCount.count}`);

      // 验证关联数量
      const relationCount = await this.db.get('SELECT COUNT(*) as count FROM skill_tools');
      console.log(`[DB Integration] 数据库中的技能-工具关联数量: ${relationCount.count}`);

      // 列出所有插入的技能及其工具
      console.log('\n[DB Integration] 技能列表及其关联工具:');
      for (const [skillId, skill] of this.insertedSkills) {
        const tools = await this.db.all(`
          SELECT t.name, st.role, st.priority
          FROM tools t
          INNER JOIN skill_tools st ON t.id = st.tool_id
          WHERE st.skill_id = ?
          ORDER BY st.priority DESC
        `, [skillId]);

        console.log(`  - ${skill.name}: ${tools.map(t => `${t.name}(${t.role})`).join(', ') || '无工具'}`);
      }

      return true;
    } catch (error) {
      console.error('[DB Integration] 验证失败:', error);
      return false;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    try {
      if (this.db && this.db.db) {
        await this.db.db.close();
        console.log('\n[DB Integration] 数据库连接已关闭');
      }
    } catch (error) {
      console.error('[DB Integration] 关闭数据库失败:', error);
    }
  }

  /**
   * 执行完整的集成流程
   */
  async run() {
    try {
      console.log('========================================');
      console.log('  ChainlessChain 数据库集成脚本 V3');
      console.log('  插入技能和工具到数据库');
      console.log('========================================\n');

      // 1. 初始化数据库
      await this.initialize();

      // 2. 插入工具
      const toolsResult = await this.insertTools();

      // 3. 插入技能
      const skillsResult = await this.insertSkills();

      // 4. 创建关联
      const relationsResult = await this.createSkillToolRelations();

      // 5. 验证结果
      await this.verify();

      // 6. 汇总报告
      console.log('\n========================================');
      console.log('  集成完成汇总');
      console.log('========================================');
      console.log(`工具: 插入 ${toolsResult.inserted} 个, 跳过 ${toolsResult.skipped} 个`);
      console.log(`技能: 插入 ${skillsResult.inserted} 个, 跳过 ${skillsResult.skipped} 个`);
      console.log(`关联: 创建 ${relationsResult.created} 个, 跳过 ${relationsResult.skipped} 个, 失败 ${relationsResult.failed} 个`);
      console.log('========================================\n');

      return true;

    } catch (error) {
      console.error('\n[DB Integration] 集成失败:', error);
      return false;
    } finally {
      await this.close();
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const integration = new DatabaseIntegration();
  integration.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = DatabaseIntegration;
