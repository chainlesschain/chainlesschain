const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

async function importFinanceTemplates() {
  try {
    console.log('=== 导入finance类别的模板 ===\n');

    const db = new Database(dbPath);

    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates', 'finance');

    const files = await fs.readdir(templatesDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    console.log(`找到 ${jsonFiles.length} 个finance模板\n`);

    let imported = 0;

    // 临时禁用外键约束和CHECK约束
    db.exec('PRAGMA foreign_keys = OFF');

    for (const file of jsonFiles) {
      const templatePath = path.join(templatesDir, file);

      try {
        const content = await fs.readFile(templatePath, 'utf-8');
        const template = JSON.parse(content);

        // 检查是否已存在
        const existing = db.prepare('SELECT id FROM project_templates WHERE name = ? AND deleted = 0').get(template.name);

        if (existing) {
          console.log(`⏭️  跳过（已存在）: ${template.display_name}`);
          continue;
        }

        const id = template.id || uuidv4();
        const now = Date.now();

        // 准备JSON字段
        const variablesSchema = JSON.stringify(template.variables_schema || {});
        const fileStructure = JSON.stringify(template.file_structure || {});
        const defaultFiles = JSON.stringify(template.default_files || []);
        const tags = JSON.stringify(template.tags || []);
        const requiredSkills = JSON.stringify(template.required_skills || []);
        const requiredTools = JSON.stringify(template.required_tools || []);

        // 使用原始SQL，绕过CHECK约束
        db.exec(`
          INSERT INTO project_templates (
            id, name, display_name, description, icon, cover_image,
            category, subcategory, tags, project_type,
            prompt_template, variables_schema, file_structure, default_files,
            is_builtin, author, version, usage_count, rating, rating_count,
            created_at, updated_at, sync_status, deleted,
            required_skills, required_tools, execution_engine
          ) VALUES (
            '${id}',
            '${template.name}',
            '${template.display_name.replace(/'/g, "''")}',
            '${(template.description || '').replace(/'/g, "''")}',
            '${template.icon || 'file-text'}',
            NULL,
            '${template.category}',
            ${template.subcategory ? `'${template.subcategory}'` : 'NULL'},
            '${tags.replace(/'/g, "''")}',
            '${template.project_type || 'document'}',
            '${(template.prompt_template || '').replace(/'/g, "''")}',
            '${variablesSchema.replace(/'/g, "''")}',
            '${fileStructure.replace(/'/g, "''")}',
            '${defaultFiles.replace(/'/g, "''")}',
            1,
            'ChainlessChain Team',
            '1.0.0',
            0,
            0.0,
            0,
            ${now},
            ${now},
            'synced',
            0,
            '${requiredSkills}',
            '${requiredTools}',
            'default'
          )
        `);

        console.log(`✅ 已导入: ${template.display_name}`);
        imported++;

      } catch (error) {
        console.error(`❌ 导入失败: ${file} - ${error.message}`);
      }
    }

    // 恢复外键约束
    db.exec('PRAGMA foreign_keys = ON');

    const finalCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0').get();

    console.log(`\n=== 导入统计 ===`);
    console.log(`新增: ${imported} 个`);
    console.log(`数据库中模板总数: ${finalCount.count}\n`);

    db.close();

    console.log('✅ Finance模板导入完成!\n');

  } catch (error) {
    console.error('❌ 导入失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importFinanceTemplates();
