/**
 * 强制创建数据库并加载所有模板
 * 使用 sql.js（非加密）直接创建数据库文件
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

async function forceCreateDatabase() {
  console.log('=== 强制创建数据库并加载模板 ===\n');

  try {
    // 1. 初始化 sql.js
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    // 2. 创建新数据库
    console.log('创建新数据库...');
    const db = new SQL.Database();

    // 3. 创建 project_templates 表
    console.log('创建 project_templates 表...');
    db.run(`
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        cover_image TEXT,
        category TEXT NOT NULL CHECK(category IN ('writing', 'ppt', 'excel', 'web', 'design', 'podcast', 'resume', 'research', 'marketing', 'education', 'lifestyle', 'travel', 'other')),
        subcategory TEXT,
        tags TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('document', 'presentation', 'spreadsheet', 'code', 'design', 'audio', 'video', 'other')),
        prompt_template TEXT,
        variables_schema TEXT,
        file_structure TEXT,
        default_files TEXT,
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending',
        deleted INTEGER DEFAULT 0
      )
    `);

    // 4. 从 JSON 文件加载模板
    console.log('\n开始加载模板...\n');

    const templatesDir = path.join(__dirname, 'src/main/templates');
    const categories = [
      'writing', 'ppt', 'excel', 'web', 'design', 'podcast',
      'resume', 'research', 'marketing', 'education', 'lifestyle', 'travel'
    ];

    let loadedCount = 0;
    let errorCount = 0;

    for (const category of categories) {
      const categoryPath = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryPath);

        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const filePath = path.join(categoryPath, file);
              const content = await fs.readFile(filePath, 'utf8');
              const templateData = JSON.parse(content);

              // 验证模板数据
              if (!templateData.id || !templateData.name || !templateData.display_name) {
                console.warn(`⚠️  跳过 ${category}/${file}: 缺少必要字段`);
                continue;
              }

              if (!templateData.prompt_template) {
                console.warn(`⚠️  警告 ${category}/${file}: 缺少 prompt_template，将使用空字符串`);
              }

              const now = Date.now();

              // 插入模板
              const stmt = db.prepare(`
                INSERT OR REPLACE INTO project_templates (
                  id, name, display_name, description, icon, cover_image,
                  category, subcategory, tags,
                  project_type, prompt_template, variables_schema, file_structure, default_files,
                  is_builtin, author, version, usage_count, rating, rating_count,
                  created_at, updated_at, sync_status, deleted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);

              stmt.run([
                templateData.id,
                templateData.name,
                templateData.display_name,
                templateData.description || '',
                templateData.icon || '',
                templateData.cover_image || '',
                templateData.category,
                templateData.subcategory || '',
                JSON.stringify(templateData.tags || []),
                templateData.project_type,
                templateData.prompt_template || '',
                JSON.stringify(templateData.variables_schema || []),
                JSON.stringify(templateData.file_structure || {}),
                JSON.stringify(templateData.default_files || []),
                templateData.is_builtin ? 1 : 0,
                templateData.author || '',
                templateData.version || '1.0.0',
                templateData.usage_count || 0,
                templateData.rating || 0,
                templateData.rating_count || 0,
                now,
                now,
                'synced',
                0
              ]);
              stmt.free();

              console.log(`✓ 加载: ${templateData.display_name} (${templateData.id})`);
              loadedCount++;

            } catch (err) {
              console.error(`❌ 处理失败 ${category}/${file}:`, err.message);
              errorCount++;
            }
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`❌ 读取目录失败 ${category}:`, err.message);
        }
      }
    }

    // 5. 保存数据库到文件
    console.log('\n保存数据库文件...');
    const dbPath = path.join(
      'C:',
      'code',
      'chainlesschain',
      'data',
      'chainlesschain.db'
    );

    // 确保目录存在
    const dbDir = path.dirname(dbPath);
    if (!fsSync.existsSync(dbDir)) {
      fsSync.mkdirSync(dbDir, { recursive: true });
      console.log(`创建目录: ${dbDir}`);
    }

    // 导出并写入文件
    const data = db.export();
    const buffer = Buffer.from(data);
    fsSync.writeFileSync(dbPath, buffer);

    console.log(`✓ 数据库已保存: ${dbPath}`);

    // 6. 验证
    console.log('\n验证数据库...');
    const buffer2 = fsSync.readFileSync(dbPath);
    const db2 = new SQL.Database(buffer2);

    const verifyStmt = db2.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as empty
      FROM project_templates
      WHERE deleted = 0
    `);
    const stats = verifyStmt.getAsObject();
    verifyStmt.free();

    // 检查特定模板
    const checkStmt = db2.prepare(`
      SELECT id, display_name, LENGTH(prompt_template) as len
      FROM project_templates
      WHERE id = 'tpl_lifestyle_wellness_002'
    `);
    const wellness = checkStmt.getAsObject();
    checkStmt.free();

    db2.close();
    db.close();

    // 7. 输出结果
    console.log('\n=== 完成 ===');
    console.log(`✓ 成功加载 ${loadedCount} 个模板`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} 个模板加载失败`);
    }
    console.log(`\n数据库统计:`);
    console.log(`  - 总模板数: ${stats.total}`);
    console.log(`  - 缺失 prompt_template: ${stats.empty}`);

    if (wellness && wellness.id) {
      console.log(`\n特定模板检查 (tpl_lifestyle_wellness_002):`);
      console.log(`  - 名称: ${wellness.display_name}`);
      console.log(`  - prompt_template 长度: ${wellness.len} 字符`);
      if (wellness.len > 0) {
        console.log(`  - ✅ prompt_template 正常`);
      } else {
        console.log(`  - ❌ prompt_template 为空`);
      }
    }

    console.log('\n🎉 数据库创建完成！请重启应用。');

  } catch (error) {
    console.error('\n❌ 创建数据库失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
forceCreateDatabase().catch(error => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
