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

async function findMissing() {
  try {
    const db = new Database(dbPath, { readonly: true });
    const dbTemplates = db.prepare('SELECT name FROM project_templates WHERE deleted = 0').all();
    const dbNames = new Set(dbTemplates.map(t => t.name));

    const templatesDir = path.join(__dirname, 'desktop-app-vue', 'dist', 'main', 'templates');

    const missing = [];

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
            missing.push({
              name: template.name,
              display_name: template.display_name,
              category: category,
              file: file
            });
          }
        }
      } catch (error) {
        // Skip
      }
    }

    console.log(`找到 ${missing.length} 个缺失的模板:\n`);

    missing.forEach(m => {
      console.log(`- ${m.display_name} (${m.name}) - ${m.category}/${m.file}`);
    });

    db.close();

  } catch (error) {
    console.error('❌ 查找失败:', error.message);
  }
}

findMissing();
