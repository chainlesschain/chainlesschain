const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

async function fixCategoryConstraint() {
  try {
    console.log('=== 修复project_templates的category约束 ===\n');

    const db = new Database(dbPath);

    // 1. 备份原表数据
    console.log('1. 备份原表数据...');
    const templates = db.prepare('SELECT * FROM project_templates').all();
    console.log(`   ✓ 备份了 ${templates.length} 条记录\n`);

    // 2. 删除原表
    console.log('2. 删除原表...');
    db.exec('DROP TABLE IF EXISTS project_templates');
    console.log('   ✓ 原表已删除\n');

    // 3. 创建新表（包含所有分类）
    console.log('3. 创建新表（扩展category约束）...');
    db.exec(`
      CREATE TABLE project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        cover_image TEXT,
        category TEXT NOT NULL CHECK(category IN (
          'writing', 'ppt', 'excel', 'web', 'design', 'podcast', 'resume',
          'research', 'marketing', 'education', 'lifestyle', 'travel', 'video',
          'social-media', 'creative-writing', 'code-project', 'data-science',
          'tech-docs', 'ecommerce', 'marketing-pro', 'legal', 'learning',
          'health', 'productivity', 'time-management', 'finance', 'cooking',
          'photography', 'music', 'gaming', 'career'
        )),
        subcategory TEXT,
        tags TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet')),
        prompt_template TEXT,
        variables_schema TEXT,
        file_structure TEXT,
        default_files TEXT,
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0.0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        required_skills TEXT,
        required_tools TEXT,
        execution_engine TEXT DEFAULT 'default',
        UNIQUE(name)
      )
    `);
    console.log('   ✓ 新表创建成功\n');

    // 4. 恢复数据
    console.log('4. 恢复备份数据...');
    const insertStmt = db.prepare(`
      INSERT INTO project_templates (
        id, name, display_name, description, icon, cover_image,
        category, subcategory, tags, project_type,
        prompt_template, variables_schema, file_structure, default_files,
        is_builtin, author, version, usage_count, rating, rating_count,
        created_at, updated_at, sync_status, synced_at, device_id, deleted,
        required_skills, required_tools, execution_engine
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    let restored = 0;
    for (const template of templates) {
      insertStmt.run(
        template.id,
        template.name,
        template.display_name,
        template.description,
        template.icon,
        template.cover_image,
        template.category,
        template.subcategory,
        template.tags,
        template.project_type,
        template.prompt_template,
        template.variables_schema,
        template.file_structure,
        template.default_files,
        template.is_builtin,
        template.author,
        template.version,
        template.usage_count,
        template.rating,
        template.rating_count,
        template.created_at,
        template.updated_at,
        template.sync_status,
        template.synced_at,
        template.device_id,
        template.deleted,
        template.required_skills || '[]',
        template.required_tools || '[]',
        template.execution_engine || 'default'
      );
      restored++;
    }
    console.log(`   ✓ 恢复了 ${restored} 条记录\n`);

    // 5. 重新创建索引
    console.log('5. 重新创建索引...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category);
      CREATE INDEX IF NOT EXISTS idx_templates_name ON project_templates(name);
      CREATE INDEX IF NOT EXISTS idx_templates_builtin ON project_templates(is_builtin);
      CREATE INDEX IF NOT EXISTS idx_templates_deleted ON project_templates(deleted);
    `);
    console.log('   ✓ 索引创建成功\n');

    // 验证
    const finalCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0').get();
    console.log(`数据库中模板总数: ${finalCount.count}\n`);

    db.close();

    console.log('✅ Category约束修复完成!\n');
    console.log('现在可以导入finance、cooking等分类的模板了。\n');

  } catch (error) {
    console.error('❌ 修复失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixCategoryConstraint();
