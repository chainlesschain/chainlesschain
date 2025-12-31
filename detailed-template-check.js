const fs = require('fs').promises;
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

const CATEGORIES = [
  'writing', 'ppt', 'excel', 'web', 'code-project', 'data-science',
  'marketing', 'marketing-pro', 'design', 'video', 'music', 'photography',
  'social-media', 'podcast', 'education', 'learning', 'career', 'resume',
  'finance', 'legal', 'research', 'productivity', 'time-management',
  'travel', 'lifestyle', 'health', 'cooking', 'creative-writing',
  'gaming', 'tech-docs', 'ecommerce'
];

async function detailedCheck() {
  try {
    const db = new Database(dbPath, { readonly: true });

    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates');

    // 获取数据库中的所有模板
    const dbTemplates = db.prepare('SELECT name, display_name, category FROM project_templates WHERE deleted = 0').all();
    const dbByName = new Map(dbTemplates.map(t => [t.name, t]));
    const dbByDisplayName = new Map(dbTemplates.map(t => [t.display_name, t]));

    console.log('=== 详细模板检查 ===\n');
    console.log(`数据库中的模板: ${dbTemplates.length} 个\n`);

    let totalJsonFiles = 0;
    let missingByName = [];
    let missingByDisplayName = [];

    for (const category of CATEGORIES) {
      const categoryDir = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const templatePath = path.join(categoryDir, file);
          const content = await fs.readFile(templatePath, 'utf-8');
          const template = JSON.parse(content);

          totalJsonFiles++;

          const foundByName = dbByName.has(template.name);
          const foundByDisplayName = dbByDisplayName.has(template.display_name);

          if (!foundByName && !foundByDisplayName) {
            missingByName.push({
              name: template.name,
              display_name: template.display_name,
              category: category,
              file: file
            });
          } else if (!foundByName && foundByDisplayName) {
            console.log(`⚠️  名称不匹配:`);
            console.log(`   JSON: name="${template.name}", display_name="${template.display_name}"`);
            console.log(`   DB:   name="${dbByDisplayName.get(template.display_name).name}", display_name="${template.display_name}"`);
            console.log('');
          }
        }
      } catch (error) {
        // Skip
      }
    }

    console.log(`JSON文件总数: ${totalJsonFiles}\n`);

    if (missingByName.length > 0) {
      console.log(`缺失的模板 (${missingByName.length} 个):\n`);
      missingByName.forEach(m => {
        console.log(`- ${m.display_name}`);
        console.log(`  name: ${m.name}`);
        console.log(`  category: ${m.category}`);
        console.log(`  file: ${m.file}\n`);
      });
    } else {
      console.log('✅ 所有JSON文件中的模板都在数据库中!\n');
    }

    // 检查是否有重复
    console.log('检查数据库中的重复记录...\n');
    const duplicates = db.prepare(`
      SELECT name, COUNT(*) as count
      FROM project_templates
      WHERE deleted = 0
      GROUP BY name
      HAVING count > 1
    `).all();

    if (duplicates.length > 0) {
      console.log(`⚠️  发现 ${duplicates.length} 个重复的name:\n`);
      duplicates.forEach(d => {
        console.log(`- ${d.name}: ${d.count} 次`);
      });
    } else {
      console.log('✅ 没有重复的name\n');
    }

    const duplicateDisplayNames = db.prepare(`
      SELECT display_name, COUNT(*) as count
      FROM project_templates
      WHERE deleted = 0
      GROUP BY display_name
      HAVING count > 1
    `).all();

    if (duplicateDisplayNames.length > 0) {
      console.log(`⚠️  发现 ${duplicateDisplayNames.length} 个重复的display_name:\n`);
      duplicateDisplayNames.forEach(d => {
        console.log(`- ${d.display_name}: ${d.count} 次`);
        const records = db.prepare('SELECT id, name, category FROM project_templates WHERE display_name = ? AND deleted = 0').all(d.display_name);
        records.forEach(r => {
          console.log(`    id: ${r.id}, name: ${r.name}, category: ${r.category}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ 没有重复的display_name\n');
    }

    db.close();

  } catch (error) {
    console.error('❌ 检查失败:', error.message);
    console.error(error.stack);
  }
}

detailedCheck();
