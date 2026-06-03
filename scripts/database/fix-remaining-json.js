const fs = require('fs');

const files = [
  'desktop-app-vue/src/main/templates/ecommerce/product-detail-page.json',
  'desktop-app-vue/src/main/templates/travel/cultural-immersion-trip.json'
];

files.forEach(filepath => {
  console.log(`\n修复: ${filepath}`);

  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');

  let fixed = false;

  for (let i = 0; i < lines.length; i++) {
    // 找到包含 variables_schema 的行
    if (lines[i].includes('"variables_schema":') && i > 0) {
      const prevLine = lines[i - 1];

      // 检查上一行是否以引号结尾但没有逗号
      const trimmed = prevLine.trimEnd();
      if (trimmed.endsWith('"') && !trimmed.endsWith('",')) {
        // 在引号后添加逗号
        lines[i - 1] = prevLine.replace(/"$/, '",');
        fixed = true;
        console.log(`  在第 ${i} 行前添加逗号`);
        break;
      }
    }
  }

  if (fixed) {
    const newContent = lines.join('\n');

    // 验证JSON
    try {
      JSON.parse(newContent);
      // 保存
      fs.writeFileSync(filepath, newContent, 'utf-8');
      console.log('  ✅ 修复并验证成功');
    } catch (e) {
      console.log('  ❌ 验证失败:', e.message);
    }
  } else {
    console.log('  ⚠️  未找到需要修复的位置');
  }
});
