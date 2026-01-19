/**
 * 同步文件系统中的模板到数据库
 * 更新 required_skills, required_tools, execution_engine 字段
 */

const fs = require('fs').promises;
const path = require('path');
const DatabaseManager = require('./database');

class TemplateSynchronizer {
  constructor() {
    this.templatesDir = path.join(__dirname, 'templates');
    const dbPath = path.join(__dirname, '../../../data/chainlesschain.db');
    this.db = new DatabaseManager(dbPath, { encryptionEnabled: false });
    this.stats = {
      total: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };
  }

  async initialize() {
    console.log('='.repeat(70));
    console.log('同步模板到数据库');
    console.log('='.repeat(70));
    console.log('\n1. 初始化数据库...');

    await this.db.initialize();
    console.log('   ✓ 数据库连接成功\n');
  }

  async syncTemplate(filePath, templateName) {
    try {
      // 读取模板文件
      const content = await fs.readFile(filePath, 'utf-8');
      const template = JSON.parse(content);

      // 检查数据库中是否存在
      const existing = this.db.prepare(
        'SELECT id, required_skills, required_tools, execution_engine FROM project_templates WHERE name = ? AND deleted = 0'
      ).get(template.name);

      if (!existing) {
        console.log(`   ⚠️  数据库中不存在: ${templateName}`);
        this.stats.skipped++;
        return;
      }

      // 准备更新数据
      const newSkills = JSON.stringify(template.required_skills || []);
      const newTools = JSON.stringify(template.required_tools || []);
      const newEngine = template.execution_engine || 'default';

      // 检查是否需要更新
      const needsUpdate =
        existing.required_skills !== newSkills ||
        existing.required_tools !== newTools ||
        existing.execution_engine !== newEngine;

      if (!needsUpdate) {
        this.stats.skipped++;
        return;
      }

      // 更新数据库
      this.db.prepare(`
        UPDATE project_templates
        SET required_skills = ?,
            required_tools = ?,
            execution_engine = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        newSkills,
        newTools,
        newEngine,
        Date.now(),
        existing.id
      );

      console.log(`   ✅ 已更新: ${templateName}`);
      console.log(`      - 技能: ${template.required_skills?.length || 0} 个`);
      console.log(`      - 工具: ${template.required_tools?.length || 0} 个`);
      console.log(`      - 执行引擎: ${newEngine}`);

      this.stats.updated++;
    } catch (error) {
      console.log(`   ✗ 失败: ${templateName} - ${error.message}`);
      this.stats.failed++;
    }
  }

  async scanAndSync() {
    console.log('2. 开始扫描和同步模板...\n');

    const categories = await fs.readdir(this.templatesDir);

    for (const category of categories) {
      const categoryPath = path.join(this.templatesDir, category);
      const stat = await fs.stat(categoryPath);

      if (!stat.isDirectory()) {continue;}

      console.log(`\n📂 处理分类: ${category}`);

      const files = await fs.readdir(categoryPath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(categoryPath, file);
        this.stats.total++;
        await this.syncTemplate(filePath, `${category}/${file}`);
      }
    }
  }

  async printReport() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 同步统计:');
    console.log(`   - 总计: ${this.stats.total} 个模板`);
    console.log(`   - 已更新: ${this.stats.updated} 个`);
    console.log(`   - 已跳过: ${this.stats.skipped} 个`);
    console.log(`   - 失败: ${this.stats.failed} 个`);
    console.log('='.repeat(70));

    // 打印数据库最新统计
    const dbStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN required_skills != '[]' THEN 1 ELSE 0 END) as with_skills,
        SUM(CASE WHEN required_tools != '[]' THEN 1 ELSE 0 END) as with_tools,
        SUM(CASE WHEN execution_engine != 'default' THEN 1 ELSE 0 END) as with_engine
      FROM project_templates WHERE deleted = 0
    `).get();

    console.log('\n数据库最新统计:');
    console.log(`   - 总模板数: ${dbStats.total}`);
    console.log(`   - 已配置技能: ${dbStats.with_skills} (${(dbStats.with_skills/dbStats.total*100).toFixed(1)}%)`);
    console.log(`   - 已配置工具: ${dbStats.with_tools} (${(dbStats.with_tools/dbStats.total*100).toFixed(1)}%)`);
    console.log(`   - 已配置执行引擎: ${dbStats.with_engine} (${(dbStats.with_engine/dbStats.total*100).toFixed(1)}%)`);
    console.log('='.repeat(70));
  }

  async run() {
    try {
      await this.initialize();
      await this.scanAndSync();
      await this.printReport();
    } catch (error) {
      console.error('\n❌ 同步失败:', error);
      throw error;
    } finally {
      if (this.db) {
        this.db.close();
        console.log('\n数据库连接已关闭');
      }
    }
  }
}

// 运行同步
if (require.main === module) {
  const synchronizer = new TemplateSynchronizer();
  synchronizer.run().catch(error => {
    console.error('同步过程出错:', error);
    process.exit(1);
  });
}

module.exports = TemplateSynchronizer;
