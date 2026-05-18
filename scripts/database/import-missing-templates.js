const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

// 分类目录列表
const CATEGORIES = [
  'writing', 'ppt', 'excel', 'web', 'code-project', 'data-science',
  'marketing', 'marketing-pro', 'design', 'video', 'music', 'photography',
  'social-media', 'podcast', 'education', 'learning', 'career', 'resume',
  'finance', 'legal', 'research', 'productivity', 'time-management',
  'travel', 'lifestyle', 'health', 'cooking', 'creative-writing',
  'gaming', 'tech-docs', 'ecommerce'
];

async function importMissingTemplates() {
  try {
    console.log('=== 导入缺失的模板 ===\n');

    // 打开数据库
    const db = new Database(dbPath);

    // 统计
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates');

    // 准备插入语句
    const insertStmt = db.prepare(`
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
    `);

    // 遍历所有分类
    for (const category of CATEGORIES) {
      const categoryDir = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) continue;

        for (const file of jsonFiles) {
          const templatePath = path.join(categoryDir, file);

          try {
            // 读取模板文件
            const content = await fs.readFile(templatePath, 'utf-8');
            const template = JSON.parse(content);

            // 检查是否已存在
            const existing = db.prepare('SELECT id FROM project_templates WHERE name = ? AND deleted = 0').get(template.name);

            if (existing) {
              skipped++;
              continue;
            }

            // 准备数据
            const id = template.id || uuidv4();
            const now = Date.now();

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
            insertStmt.run(
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

            console.log(`✅ 已导入: ${template.display_name || template.name} (${category})`);
            imported++;

          } catch (error) {
            console.error(`❌ 导入失败: ${file} - ${error.message}`);
            failed++;
          }
        }

      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`⚠️  读取分类 ${category} 失败:`, error.message);
        }
      }
    }

    // 验证结果
    console.log('\n=== 导入统计 ===');
    console.log(`新增: ${imported} 个`);
    console.log(`跳过: ${skipped} 个`);
    console.log(`失败: ${failed} 个\n`);

    const finalCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0').get();
    console.log(`数据库中模板总数: ${finalCount.count}\n`);

    db.close();

    console.log('✅ 模板导入完成!\n');

  } catch (error) {
    console.error('❌ 导入失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importMissingTemplates();
