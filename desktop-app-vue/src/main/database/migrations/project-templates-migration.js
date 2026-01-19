/**
 * 数据库迁移脚本
 * 为project_templates表添加新字段
 *
 * 使用方法：
 * node database-migration.js
 */

const { logger, createLogger } = require('../../utils/logger.js');
const DatabaseManager = require("../../database");
const path = require("path");

// 设置数据库路径（用于独立运行）
const dbPath = path.join(__dirname, "../../../../data/chainlesschain.db");

async function runMigration() {
  logger.info("=".repeat(60));
  logger.info("开始数据库迁移...");
  logger.info("=".repeat(60));
  logger.info("数据库文件路径:", dbPath);

  const db = new DatabaseManager(dbPath, { encryptionEnabled: false });

  try {
    // 初始化数据库连接
    logger.info("\n1. 初始化数据库连接...");
    await db.initialize();
    logger.info("   ✓ 数据库连接成功");

    // 检查当前schema
    logger.info("\n2. 检查当前schema...");
    const currentColumns = db
      .prepare(
        `
      SELECT name FROM pragma_table_info('project_templates')
    `,
      )
      .all();

    const existingColumns = currentColumns.map((col) => col.name);
    logger.info("   当前字段:", existingColumns.join(", "));

    // 检查是否需要迁移
    const newColumns = [
      "required_skills",
      "required_tools",
      "execution_engine",
    ];
    const missingColumns = newColumns.filter(
      (col) => !existingColumns.includes(col),
    );

    if (missingColumns.length === 0) {
      logger.info("\n   ⚠️  所有新字段已存在，无需迁移");
      logger.info("   - required_skills: 已存在");
      logger.info("   - required_tools: 已存在");
      logger.info("   - execution_engine: 已存在");
      return;
    }

    logger.info("\n   需要添加的字段:", missingColumns.join(", "));

    // 开始事务
    logger.info("\n3. 开始执行迁移...");
    db.prepare("BEGIN TRANSACTION").run();

    try {
      // 添加新字段
      if (missingColumns.includes("required_skills")) {
        logger.info("   - 添加 required_skills 字段...");
        db.prepare(
          `
          ALTER TABLE project_templates
          ADD COLUMN required_skills TEXT DEFAULT '[]'
        `,
        ).run();
        logger.info("     ✓ required_skills 字段已添加");
      }

      if (missingColumns.includes("required_tools")) {
        logger.info("   - 添加 required_tools 字段...");
        db.prepare(
          `
          ALTER TABLE project_templates
          ADD COLUMN required_tools TEXT DEFAULT '[]'
        `,
        ).run();
        logger.info("     ✓ required_tools 字段已添加");
      }

      if (missingColumns.includes("execution_engine")) {
        logger.info("   - 添加 execution_engine 字段...");
        db.prepare(
          `
          ALTER TABLE project_templates
          ADD COLUMN execution_engine TEXT DEFAULT 'default'
        `,
        ).run();
        logger.info("     ✓ execution_engine 字段已添加");
      }

      // 创建索引
      logger.info("\n4. 创建索引...");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_project_templates_execution_engine
        ON project_templates(execution_engine)
      `);
      logger.info("   ✓ 索引已创建");

      // 提交事务
      db.prepare("COMMIT").run();
      logger.info("\n5. 提交事务...");
      logger.info("   ✓ 迁移成功提交");

      // 保存数据库
      if (db.saveToFile) {
        db.saveToFile();
        logger.info("   ✓ 数据库已保存");
      }

      // 验证迁移结果
      logger.info("\n6. 验证迁移结果...");
      const updatedColumns = db
        .prepare(
          `
        SELECT name, type, [notnull], dflt_value
        FROM pragma_table_info('project_templates')
        WHERE name IN ('required_skills', 'required_tools', 'execution_engine')
      `,
        )
        .all();

      logger.info("\n   新增字段详情:");
      updatedColumns.forEach((col) => {
        logger.info(`   - ${col.name}:`);
        logger.info(`     类型: ${col.type}`);
        logger.info(`     默认值: ${col.dflt_value}`);
        logger.info(`     非空: ${col.notnull ? "是" : "否"}`);
      });

      // 统计现有模板数量
      const templateCount = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0
      `,
        )
        .get();

      logger.info(`\n   现有模板数量: ${templateCount.count} 个`);

      logger.info("\n" + "=".repeat(60));
      logger.info("✅ 数据库迁移完成！");
      logger.info("=".repeat(60));

      logger.info("\n下一步操作:");
      logger.info("1. 运行模板更新脚本以添加技能和工具关联");
      logger.info("   cd desktop-app-vue/src/main/templates");
      logger.info("   node add-skills-tools-to-templates.js");
      logger.info("");
      logger.info("2. 重启应用以加载新的schema");
      logger.info("");
    } catch (error) {
      // 回滚事务
      db.prepare("ROLLBACK").run();
      logger.error("\n   ❌ 迁移失败，已回滚");
      throw error;
    }
  } catch (error) {
    logger.error("\n" + "=".repeat(60));
    logger.error("❌ 数据库迁移失败:", error.message);
    logger.error("=".repeat(60));
    logger.error("\n错误详情:");
    logger.error(error.stack);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    if (db && db.close) {
      db.close();
      logger.info("\n数据库连接已关闭");
    }
  }
}

// 运行迁移
if (require.main === module) {
  runMigration().catch((error) => {
    logger.error("执行失败:", error);
    process.exit(1);
  });
}

module.exports = { runMigration };
