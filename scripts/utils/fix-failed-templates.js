/**
 * 修复失败的模板JSON文件
 * 1. 修复JSON格式错误
 * 2. 修复分类约束问题
 */

const fs = require('fs').promises;
const path = require('path');

// 允许的分类列表（来自数据库CHECK约束）
const ALLOWED_CATEGORIES = [
  'writing', 'ppt', 'excel', 'web', 'design', 'podcast', 'resume', 'research',
  'marketing', 'education', 'lifestyle', 'travel', 'video', 'social-media',
  'creative-writing', 'code-project', 'data-science', 'tech-docs', 'ecommerce',
  'marketing-pro', 'legal', 'learning', 'health', 'productivity'
];

// 分类映射（将不允许的分类映射到允许的分类）
const CATEGORY_MAPPING = {
  'cooking': 'lifestyle',       // 烹饪 -> 生活方式
  'gaming': 'creative-writing', // 游戏 -> 创意写作
  'music': 'creative-writing',  // 音乐 -> 创意写作
  'photography': 'design',      // 摄影 -> 设计
  'career': 'productivity',     // 职业 -> 效率
  'finance': 'productivity',    // 金融 -> 效率
  'time-management': 'productivity' // 时间管理 -> 效率
};

// 已知的JSON格式错误文件
const JSON_ERROR_FILES = [
  'code-project/python-project.json',
  'creative-writing/short-story.json',
  'ecommerce/product-detail-page.json',
  'travel/cultural-immersion-trip.json'
];

class TemplateFixer {
  constructor() {
    this.stats = {
      total: 0,
      fixed: 0,
      categoryFixed: 0,
      jsonFixed: 0,
      failed: 0
    };
  }

  /**
   * 修复JSON格式错误
   */
  async fixJsonFormat(filePath) {
    try {
      let content = await fs.readFile(filePath, 'utf-8');

      // 尝试解析JSON
      try {
        JSON.parse(content);
        return { success: true, fixed: false, message: 'JSON格式正确' };
      } catch (error) {
        console.log(`\n🔧 修复JSON格式: ${path.basename(filePath)}`);
        console.log(`   错误位置: ${error.message}`);

        // 常见的JSON错误修复
        let originalContent = content;

        // 1. 修复尾部逗号
        content = content.replace(/,(\s*[}\]])/g, '$1');

        // 2. 修复转义字符错误
        content = content.replace(/\\(?!["\\/bfnrt])/g, '\\\\');

        // 3. 修复未转义的引号
        // 这个比较复杂，需要小心处理

        // 4. 修复多余的逗号
        content = content.replace(/,\s*,/g, ',');

        // 再次尝试解析
        try {
          const parsed = JSON.parse(content);

          // 如果成功，格式化并写回
          const formatted = JSON.stringify(parsed, null, 2);
          await fs.writeFile(filePath, formatted, 'utf-8');

          console.log(`   ✅ 已修复并格式化`);
          this.stats.jsonFixed++;
          return { success: true, fixed: true, message: '已修复JSON格式' };
        } catch (e) {
          console.log(`   ❌ 自动修复失败: ${e.message}`);
          console.log(`   📝 请手动检查文件`);
          return { success: false, fixed: false, error: e.message };
        }
      }
    } catch (error) {
      return { success: false, fixed: false, error: error.message };
    }
  }

  /**
   * 修复分类约束问题
   */
  async fixCategory(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const template = JSON.parse(content);

      if (!template.category) {
        console.log(`\n⚠️  ${path.basename(filePath)} 缺少category字段`);
        return { success: false, fixed: false };
      }

      const currentCategory = template.category;

      // 检查分类是否允许
      if (!ALLOWED_CATEGORIES.includes(currentCategory)) {
        const newCategory = CATEGORY_MAPPING[currentCategory];

        if (newCategory) {
          console.log(`\n🔄 修复分类: ${path.basename(filePath)}`);
          console.log(`   ${currentCategory} -> ${newCategory}`);

          template.category = newCategory;

          // 保存修改
          const formatted = JSON.stringify(template, null, 2);
          await fs.writeFile(filePath, formatted, 'utf-8');

          console.log(`   ✅ 分类已更新`);
          this.stats.categoryFixed++;
          return { success: true, fixed: true, oldCategory: currentCategory, newCategory };
        } else {
          console.log(`\n❌ ${path.basename(filePath)}: 未找到分类映射 (${currentCategory})`);
          return { success: false, fixed: false, category: currentCategory };
        }
      }

      return { success: true, fixed: false, message: '分类正确' };
    } catch (error) {
      return { success: false, fixed: false, error: error.message };
    }
  }

  /**
   * 扫描并修复所有模板
   */
  async fixAll() {
    console.log('='.repeat(70));
    console.log('模板修复工具');
    console.log('='.repeat(70));

    const templatesDir = path.join(__dirname, 'desktop-app-vue/src/main/templates');

    // 1. 先修复已知的JSON格式错误文件
    console.log('\n📝 第一步：修复JSON格式错误...\n');

    for (const relativePath of JSON_ERROR_FILES) {
      const filePath = path.join(templatesDir, relativePath);
      this.stats.total++;

      try {
        await fs.access(filePath);
        const result = await this.fixJsonFormat(filePath);
        if (result.fixed) {
          this.stats.fixed++;
        } else if (!result.success) {
          this.stats.failed++;
        }
      } catch (error) {
        console.log(`   ⚠️  文件不存在: ${relativePath}`);
      }
    }

    // 2. 扫描并修复所有分类问题
    console.log('\n\n🔄 第二步：修复分类约束问题...\n');

    const categories = await fs.readdir(templatesDir);

    for (const category of categories) {
      const categoryPath = path.join(templatesDir, category);

      try {
        const stat = await fs.stat(categoryPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(categoryPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const filePath = path.join(categoryPath, file);

          // 跳过已经在JSON修复列表中的文件
          const relativePath = path.relative(templatesDir, filePath).replace(/\\/g, '/');
          if (JSON_ERROR_FILES.includes(relativePath)) {
            continue;
          }

          this.stats.total++;
          const result = await this.fixCategory(filePath);
          if (result.fixed) {
            this.stats.fixed++;
          } else if (!result.success) {
            this.stats.failed++;
          }
        }
      } catch (error) {
        // 跳过非目录文件
      }
    }
  }

  /**
   * 显示统计信息
   */
  showStats() {
    console.log('\n\n' + '='.repeat(70));
    console.log('📊 修复统计:');
    console.log('='.repeat(70));
    console.log(`   - 检查文件数: ${this.stats.total} 个`);
    console.log(`   - 修复成功: ${this.stats.fixed} 个`);
    console.log(`     * JSON格式修复: ${this.stats.jsonFixed} 个`);
    console.log(`     * 分类修复: ${this.stats.categoryFixed} 个`);
    console.log(`   - 修复失败: ${this.stats.failed} 个`);
    console.log('='.repeat(70));

    if (this.stats.fixed > 0) {
      console.log('\n✅ 修复完成！');
      console.log('\n下一步:');
      console.log('   cd desktop-app-vue/src/main/templates');
      console.log('   node import-templates-to-db.js');
    }
  }

  /**
   * 运行修复
   */
  async run() {
    try {
      await this.fixAll();
      this.showStats();
    } catch (error) {
      console.error('\n❌ 修复过程出错:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// 运行
if (require.main === module) {
  const fixer = new TemplateFixer();
  fixer.run().catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  });
}

module.exports = TemplateFixer;
