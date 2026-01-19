/**
 * 导入模板到数据库
 * 从JSON文件批量导入模板到project_templates表
 *
 * 使用方法：
 * node import-templates-to-db.js
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const DatabaseManager = require('../database');

// 数据库路径（使用绝对路径）
const dbPath = path.join(__dirname, '../../../../data/chainlesschain.db');

// 分类目录列表
const CATEGORIES = [
  'writing', 'ppt', 'excel', 'web', 'code-project', 'data-science',
  'marketing', 'marketing-pro', 'design', 'video', 'music', 'photography',
  'social-media', 'podcast', 'education', 'learning', 'career', 'resume',
  'finance', 'legal', 'research', 'productivity', 'time-management',
  'travel', 'lifestyle', 'health', 'cooking', 'creative-writing',
  'gaming', 'tech-docs', 'ecommerce'
];

class TemplateImporter {
  constructor() {
    this.db = null;
    this.stats = {
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0
    };
  }

  async initialize() {
    console.log('='.repeat(70));
    console.log('模板导入工具');
    console.log('='.repeat(70));
    console.log('\n数据库路径:', dbPath);

    this.db = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await this.db.initialize();
    console.log('✓ 数据库连接成功\n');
  }

  /**
   * 导入单个模板
   */
  async importTemplate(templatePath, category) {
    try {
      // 读取模板文件
      const content = await fs.readFile(templatePath, 'utf-8');
      const template = JSON.parse(content);

      // 检查是否已存在（通过name判断）
      const existing = this.db.prepare(
        'SELECT id FROM project_templates WHERE name = ? AND deleted = 0'
      ).get(template.name);

      if (existing) {
        console.log(`⏭️  跳过（已存在）: ${template.name}`);
        this.stats.skipped++;
        return;
      }

      // 准备数据
      const id = template.id || uuidv4();
      const now = Date.now(); // Unix timestamp in milliseconds

      // 确保JSON字段为字符串
      const variablesSchema = typeof template.variables_schema === 'string'
        ? template.variables_schema
        : JSON.stringify(template.variables_schema || {});

      const fileStructure = typeof template.file_structure === 'string'
        ? template.file_structure
        : JSON.stringify(template.file_structure || {});

      const defaultFiles = typeof template.default_files === 'string'
        ? template.default_files
        : JSON.stringify(template.default_files || []);

      const tags = typeof template.tags === 'string'
        ? template.tags
        : JSON.stringify(template.tags || []);

      const requiredSkills = typeof template.required_skills === 'string'
        ? template.required_skills
        : JSON.stringify(template.required_skills || []);

      const requiredTools = typeof template.required_tools === 'string'
        ? template.required_tools
        : JSON.stringify(template.required_tools || []);

      // 插入数据库
      this.db.prepare(`
        INSERT INTO project_templates (
          id, name, display_name, description, icon, cover_image,
          category, subcategory, tags, project_type,
          prompt_template, variables_schema, file_structure, default_files,
          is_builtin, author, version, usage_count, rating, rating_count,
          created_at, updated_at, sync_status, deleted,
          required_skills, required_tools, execution_engine
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
      `).run(
        id,
        template.name,
        template.display_name || template.name,
        template.description || '',
        template.icon || 'file-text',
        template.cover_image || null,
        template.category || category,
        template.subcategory || null,
        tags,
        template.project_type || 'general',
        template.prompt_template || '',
        variablesSchema,
        fileStructure,
        defaultFiles,
        template.is_builtin !== undefined ? (template.is_builtin ? 1 : 0) : 1,
        template.author || 'System',
        template.version || '1.0.0',
        template.usage_count || 0,
        template.rating || 0.0,
        template.rating_count || 0,
        template.created_at ? (typeof template.created_at === 'number' ? template.created_at : Date.parse(template.created_at)) : now,
        template.updated_at ? (typeof template.updated_at === 'number' ? template.updated_at : Date.parse(template.updated_at)) : now,
        template.sync_status || 'synced',
        0, // deleted = 0
        requiredSkills,
        requiredTools,
        template.execution_engine || 'default'
      );

      console.log(`✅ 已导入: ${template.display_name || template.name}`);
      this.stats.imported++;

    } catch (error) {
      console.error(`❌ 导入失败: ${path.basename(templatePath)}`);
      console.error(`   错误: ${error.message}`);
      this.stats.failed++;
    }
  }

  /**
   * 扫描并导入所有模板
   */
  async importAll() {
    const templatesDir = __dirname;

    for (const category of CATEGORIES) {
      const categoryDir = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {continue;}

        console.log(`\n📂 分类: ${category} (${jsonFiles.length} 个模板)`);

        for (const file of jsonFiles) {
          const templatePath = path.join(categoryDir, file);
          this.stats.total++;
          await this.importTemplate(templatePath, category);
        }

      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`⚠️  读取分类 ${category} 失败:`, error.message);
        }
      }
    }
  }

  /**
   * 显示统计信息
   */
  showStats() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 导入统计:');
    console.log('='.repeat(70));
    console.log(`   - 总计: ${this.stats.total} 个`);
    console.log(`   - 已导入: ${this.stats.imported} 个`);
    console.log(`   - 已跳过: ${this.stats.skipped} 个`);
    console.log(`   - 失败: ${this.stats.failed} 个`);
    console.log('='.repeat(70));

    if (this.stats.imported > 0) {
      console.log('\n✅ 导入完成！');
      console.log('\n下一步:');
      console.log('   1. 重启应用查看模板');
      console.log('   2. 运行测试验证: node test-template-execution.js');
    }
  }

  /**
   * 清理
   */
  cleanup() {
    if (this.db && this.db.close) {
      this.db.close();
      console.log('\n数据库连接已关闭');
    }
  }

  /**
   * 运行导入
   */
  async run() {
    try {
      await this.initialize();
      await this.importAll();
      this.showStats();
    } catch (error) {
      console.error('\n❌ 导入过程出错:', error.message);
      console.error(error.stack);
      process.exit(1);
    } finally {
      this.cleanup();
    }
  }
}

// 运行
if (require.main === module) {
  const importer = new TemplateImporter();
  importer.run().catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  });
}

module.exports = TemplateImporter;
