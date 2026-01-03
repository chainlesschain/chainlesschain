// 测试视频项目功能
const fs = require('fs');
const path = require('path');

console.log('🎬 ChainlessChain 视频项目功能测试\n');

// 1. 检查模板文件
console.log('1️⃣ 检查视频模板文件...');
const templatesDir = path.join(__dirname, 'src/main/templates/video');
const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));

console.log(`   找到 ${templateFiles.length} 个模板文件`);

let validTemplates = 0;
let invalidTemplates = [];
const subcategories = new Set();

templateFiles.forEach(file => {
  try {
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
    const template = JSON.parse(content);

    // 验证必需字段
    if (template.id && template.name && template.display_name && template.category === 'video') {
      validTemplates++;
      if (template.subcategory) {
        subcategories.add(template.subcategory);
      }
    } else {
      invalidTemplates.push(file);
    }
  } catch (e) {
    invalidTemplates.push(`${file} (${e.message})`);
  }
});

console.log(`   ✓ 有效模板: ${validTemplates}/${templateFiles.length}`);
console.log(`   ✓ 子分类数: ${subcategories.size}个`);
if (invalidTemplates.length > 0) {
  console.log(`   ✗ 无效模板: ${invalidTemplates.join(', ')}`);
}

// 2. 检查数据库迁移文件
console.log('\n2️⃣ 检查数据库迁移文件...');
const migrationFile = path.join(__dirname, 'src/main/database/migrations/004_video_skills_tools.sql');
if (fs.existsSync(migrationFile)) {
  const migrationContent = fs.readFileSync(migrationFile, 'utf8');

  // 统计SQL语句
  const skillsCount = (migrationContent.match(/INSERT INTO skills/g) || []).length;
  const toolsCount = (migrationContent.match(/INSERT INTO tools/g) || []).length;
  const mappingsCount = (migrationContent.match(/INSERT INTO skill_tools/g) || []).length;

  console.log(`   ✓ 迁移文件存在: 004_video_skills_tools.sql`);
  console.log(`   ✓ 技能插入: ${skillsCount}条`);
  console.log(`   ✓ 工具插入: ${toolsCount}条`);
  console.log(`   ✓ 映射插入: ${mappingsCount}条`);
} else {
  console.log(`   ✗ 迁移文件不存在`);
}

// 3. 检查文档文件
console.log('\n3️⃣ 检查文档文件...');
const docs = [
  'VIDEO_PROJECT_IMPLEMENTATION_REPORT.md',
  'VIDEO_QUICK_START_GUIDE.md',
  'VIDEO_PROJECT_FINAL_SUMMARY.md'
];

docs.forEach(doc => {
  const docPath = path.join(__dirname, doc);
  if (fs.existsSync(docPath)) {
    const stats = fs.statSync(docPath);
    console.log(`   ✓ ${doc} (${Math.round(stats.size / 1024)}KB)`);
  } else {
    console.log(`   ✗ ${doc} 不存在`);
  }
});

// 4. 列出所有子分类
console.log('\n4️⃣ 视频子分类列表:');
const subcategoryList = Array.from(subcategories).sort();
subcategoryList.forEach((subcat, index) => {
  const count = templateFiles.filter(f => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8'));
      return t.subcategory === subcat;
    } catch {
      return false;
    }
  }).length;
  console.log(`   ${index + 1}. ${subcat} (${count}个模板)`);
});

// 5. 总结
console.log('\n📊 测试总结:');
console.log(`   视频模板: ${validTemplates}个`);
console.log(`   子分类: ${subcategories.size}个`);
console.log(`   状态: ${invalidTemplates.length === 0 ? '✅ 全部通过' : '⚠️ 存在问题'}`);

console.log('\n🚀 准备就绪！运行 npm run dev 启动应用\n');
