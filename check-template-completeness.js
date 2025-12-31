const fs = require('fs').promises;
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

// 分类目录列表（从import-templates-to-db.js复制）
const CATEGORIES = [
  'writing', 'ppt', 'excel', 'web', 'code-project', 'data-science',
  'marketing', 'marketing-pro', 'design', 'video', 'music', 'photography',
  'social-media', 'podcast', 'education', 'learning', 'career', 'resume',
  'finance', 'legal', 'research', 'productivity', 'time-management',
  'travel', 'lifestyle', 'health', 'cooking', 'creative-writing',
  'gaming', 'tech-docs', 'ecommerce'
];

async function checkTemplates() {
  try {
    console.log('=== 检查模板数据完整性 ===\n');

    // 1. 统计JSON文件数量
    console.log('1. 扫描模板JSON文件...');
    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates');

    let totalJsonFiles = 0;
    const filesByCategory = {};

    for (const category of CATEGORIES) {
      const categoryDir = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length > 0) {
          filesByCategory[category] = jsonFiles.length;
          totalJsonFiles += jsonFiles.length;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`   ⚠️  读取分类 ${category} 失败:`, error.message);
        }
      }
    }

    console.log(`   ✓ 找到 ${totalJsonFiles} 个模板JSON文件\n`);

    console.log('   按分类统计:');
    Object.entries(filesByCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      console.log(`     ${cat}: ${count}个`);
    });

    // 2. 统计数据库中的模板
    console.log('\n2. 检查数据库中的模板...');
    const db = new Database(dbPath, { readonly: true });

    const dbCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0').get();
    const builtinCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE is_builtin = 1 AND deleted = 0').get();

    console.log(`   ✓ 数据库中有 ${dbCount.count} 个模板 (内置: ${builtinCount.count})\n`);

    // 按分类统计数据库中的模板
    const dbByCategory = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM project_templates
      WHERE deleted = 0
      GROUP BY category
      ORDER BY count DESC
    `).all();

    console.log('   数据库中按分类统计:');
    dbByCategory.forEach(row => {
      console.log(`     ${row.category}: ${row.count}个`);
    });

    // 3. 对比差异
    console.log('\n3. 对比差异...');
    console.log(`   JSON文件: ${totalJsonFiles} 个`);
    console.log(`   数据库中: ${dbCount.count} 个`);
    console.log(`   缺失: ${totalJsonFiles - dbCount.count} 个\n`);

    // 4. 检查分类
    console.log('4. 检查项目分类 (project_categories)...');
    const categoryCount = db.prepare('SELECT COUNT(*) as count FROM project_categories WHERE deleted = 0').get();
    console.log(`   ✓ 数据库中有 ${categoryCount.count} 个分类\n`);

    // 检查是否有is_builtin字段
    const tableInfo = db.prepare('PRAGMA table_info(project_categories)').all();
    const hasBuiltinField = tableInfo.some(col => col.name === 'is_builtin');

    console.log(`   project_categories 表是否有 is_builtin 字段: ${hasBuiltinField ? '是' : '否'}`);

    // 5. 列出缺失的模板
    if (totalJsonFiles > dbCount.count) {
      console.log('\n5. 查找缺失的模板...');

      const dbTemplates = db.prepare('SELECT name FROM project_templates WHERE deleted = 0').all();
      const dbNames = new Set(dbTemplates.map(t => t.name));

      let missingCount = 0;
      for (const category of CATEGORIES) {
        const categoryDir = path.join(templatesDir, category);

        try {
          const files = await fs.readdir(categoryDir);
          const jsonFiles = files.filter(f => f.endsWith('.json'));

          for (const file of jsonFiles) {
            const templatePath = path.join(categoryDir, file);
            const content = await fs.readFile(templatePath, 'utf-8');
            const template = JSON.parse(content);

            if (!dbNames.has(template.name)) {
              if (missingCount < 10) {
                console.log(`   ⚠️  缺失: ${template.name} (${category})`);
              }
              missingCount++;
            }
          }
        } catch (error) {
          // Skip
        }
      }

      if (missingCount > 10) {
        console.log(`   ... 以及其他 ${missingCount - 10} 个缺失的模板`);
      }
    }

    db.close();

    console.log('\n=== 检查完成 ===\n');

  } catch (error) {
    console.error('❌ 检查失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkTemplates();
