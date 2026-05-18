/**
 * 验证模板和分类配置的一致性
 */
const fs = require('fs');
const path = require('path');

// 定义模板目录映射到项目分类的关系
const CATEGORY_MAPPING = {
  'writing': '写作',
  'creative-writing': '创意写作',
  'marketing': '营销',
  'marketing-pro': '营销',  // 归到营销分类
  'excel': 'Excel',
  'resume': '简历',
  'ppt': 'PPT',
  'research': '研究',
  'education': '教育',
  'lifestyle': '生活',
  'podcast': '播客',
  'video': '视频',
  'design': '设计',
  'web': '网页',
  'learning': '学习',
  'health': '健康',
  'time-management': '时间管理',
  'productivity': '效率',
  'code-project': '编程',
  'data-science': '数据科学',
  'tech-docs': '技术文档',
  'legal': '法律',
  'social-media': '社交媒体',
  'ecommerce': '电商'
};

function main() {
  console.log('='.repeat(60));
  console.log('模板和分类配置验证');
  console.log('='.repeat(60));
  console.log();

  // 1. 检查模板目录
  const templatesDir = path.join(__dirname, 'src/main/templates');
  const actualDirs = fs.readdirSync(templatesDir)
    .filter(item => {
      const itemPath = path.join(templatesDir, item);
      return fs.statSync(itemPath).isDirectory();
    })
    .sort();

  console.log('📁 实际存在的模板目录 (' + actualDirs.length + '个):');
  actualDirs.forEach(dir => {
    const dirPath = path.join(templatesDir, dir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    const templateCount = files.length;
    const mapping = CATEGORY_MAPPING[dir];
    const status = mapping ? '✓' : '✗';

    console.log(`  ${status} ${dir.padEnd(25)} (${templateCount} 个模板) → ${mapping || '未映射'}`);
  });
  console.log();

  // 2. 读取 template-manager.js 中的分类配置
  const templateManagerPath = path.join(__dirname, 'src/main/template/template-manager.js');
  const templateManagerContent = fs.readFileSync(templateManagerPath, 'utf-8');
  const categoriesMatch = templateManagerContent.match(/const categories = \[([\s\S]*?)\];/);

  if (categoriesMatch) {
    const categoriesStr = categoriesMatch[1];
    const configuredCategories = categoriesStr
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith("'"))
      .map(line => line.match(/'([^']+)'/)[1])
      .sort();

    console.log('⚙️  template-manager.js 配置的分类 (' + configuredCategories.length + '个):');
    configuredCategories.forEach(cat => {
      const exists = actualDirs.includes(cat);
      const status = exists ? '✓' : '✗';
      const mapping = CATEGORY_MAPPING[cat];
      console.log(`  ${status} ${cat.padEnd(25)} → ${mapping || '未映射'}`);
    });
    console.log();

    // 3. 比较差异
    const missingInConfig = actualDirs.filter(dir => !configuredCategories.includes(dir));
    const missingInFs = configuredCategories.filter(cat => !actualDirs.includes(cat));

    if (missingInConfig.length > 0) {
      console.log('⚠️  文件系统中存在但配置中缺失的目录:');
      missingInConfig.forEach(dir => console.log(`  - ${dir}`));
      console.log();
    }

    if (missingInFs.length > 0) {
      console.log('⚠️  配置中存在但文件系统中缺失的目录:');
      missingInFs.forEach(cat => console.log(`  - ${cat}`));
      console.log();
    }

    if (missingInConfig.length === 0 && missingInFs.length === 0) {
      console.log('✅ 模板目录和配置完全匹配!');
      console.log();
    }
  }

  // 4. 读取 category-manager.js 中的项目分类
  const categoryManagerPath = path.join(__dirname, 'src/main/category-manager.js');
  const categoryManagerContent = fs.readFileSync(categoryManagerPath, 'utf-8');
  const projectCategoriesMatch = categoryManagerContent.match(/const categories = \[([\s\S]*?)\];/);

  if (projectCategoriesMatch) {
    const categoriesStr = projectCategoriesMatch[1];
    const projectCategories = [];
    const lines = categoriesStr.split('\n');

    lines.forEach(line => {
      const nameMatch = line.match(/name:\s*'([^']+)'/);
      if (nameMatch) {
        projectCategories.push(nameMatch[1]);
      }
    });

    console.log('📋 category-manager.js 中的项目分类 (' + projectCategories.length + '个):');
    projectCategories.forEach(cat => {
      console.log(`  - ${cat}`);
    });
    console.log();

    // 5. 检查模板目录是否都有对应的项目分类
    console.log('🔗 模板目录 → 项目分类映射:');
    const unmappedDirs = [];
    actualDirs.forEach(dir => {
      const expectedCategory = CATEGORY_MAPPING[dir];
      if (expectedCategory) {
        const exists = projectCategories.includes(expectedCategory);
        const status = exists ? '✓' : '✗';
        console.log(`  ${status} ${dir.padEnd(25)} → ${expectedCategory}`);
        if (!exists) {
          unmappedDirs.push({ dir, expectedCategory });
        }
      }
    });
    console.log();

    if (unmappedDirs.length > 0) {
      console.log('❌ 以下模板目录缺少对应的项目分类:');
      unmappedDirs.forEach(({ dir, expectedCategory }) => {
        console.log(`  - ${dir} 需要项目分类: ${expectedCategory}`);
      });
      console.log();
    } else {
      console.log('✅ 所有模板目录都有对应的项目分类!');
      console.log();
    }
  }

  // 6. 统计模板数量
  console.log('📊 模板统计:');
  let totalTemplates = 0;
  actualDirs.forEach(dir => {
    const dirPath = path.join(templatesDir, dir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    totalTemplates += files.length;
  });
  console.log(`  - 总计: ${totalTemplates} 个模板`);
  console.log(`  - 分布在: ${actualDirs.length} 个分类`);
  console.log();

  console.log('='.repeat(60));
  console.log('验证完成!');
  console.log('='.repeat(60));
}

main();
