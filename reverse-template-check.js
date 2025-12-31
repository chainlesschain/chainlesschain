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

async function reverseCheck() {
  try {
    const db = new Database(dbPath, { readonly: true });
    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates');

    // 收集所有JSON文件中的模板名称
    const jsonTemplateNames = new Set();

    for (const category of CATEGORIES) {
      const categoryDir = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const templatePath = path.join(categoryDir, file);
          const content = await fs.readFile(templatePath, 'utf-8');
          const template = JSON.parse(content);
          jsonTemplateNames.add(template.name);
        }
      } catch (error) {
        // Skip
      }
    }

    console.log('=== 反向检查：数据库中哪些模板不在JSON文件中 ===\n');
    console.log(`JSON文件中的模板: ${jsonTemplateNames.size} 个\n`);

    // 获取数据库中的所有模板
    const dbTemplates = db.prepare('SELECT id, name, display_name, category FROM project_templates WHERE deleted = 0 ORDER BY category, name').all();

    console.log(`数据库中的模板: ${dbTemplates.length} 个\n`);

    const notInJson = dbTemplates.filter(t => !jsonTemplateNames.has(t.name));

    if (notInJson.length > 0) {
      console.log(`⚠️  数据库中但不在JSON文件中的模板 (${notInJson.length} 个):\n`);
      notInJson.forEach(t => {
        console.log(`- ${t.display_name}`);
        console.log(`  name: ${t.name}`);
        console.log(`  category: ${t.category}`);
        console.log(`  id: ${t.id}\n`);
      });
    } else {
      console.log('✅ 数据库中的所有模板都有对应的JSON文件!\n');
    }

    // 统计差异
    console.log('=== 总结 ===');
    console.log(`JSON文件数量: ${jsonTemplateNames.size}`);
    console.log(`数据库记录数: ${dbTemplates.length}`);
    console.log(`差异: ${Math.abs(jsonTemplateNames.size - dbTemplates.length)}\n`);

    if (jsonTemplateNames.size === dbTemplates.length) {
      console.log('✅ 数量完全匹配!\n');
    }

    db.close();

  } catch (error) {
    console.error('❌ 检查失败:', error.message);
    console.error(error.stack);
  }
}

reverseCheck();
