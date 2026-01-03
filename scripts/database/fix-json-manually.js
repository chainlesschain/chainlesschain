const fs = require('fs');
const path = require('path');

const files = [
  'desktop-app-vue/src/main/templates/creative-writing/short-story.json',
  'desktop-app-vue/src/main/templates/ecommerce/product-detail-page.json',
  'desktop-app-vue/src/main/templates/travel/cultural-immersion-trip.json'
];

files.forEach(file => {
  console.log('\n修复:', file);

  let content = fs.readFileSync(file, 'utf-8');

  // 找到 "prompt_template": "..." 后面应该有逗号的位置
  // 使用正则表达式匹配 prompt_template 字段结束后的位置
  const regex = /("prompt_template":\s*"[^"]*(?:\\.[^"]*)*")(\s*\n\s*"variables_schema":)/g;

  if (regex.test(content)) {
    content = content.replace(
      /("prompt_template":\s*"[^"]*(?:\\.[^"]*)*")(\s*\n\s*"variables_schema":)/g,
      '$1,$2'
    );

    // 保存文件
    fs.writeFileSync(file, content, 'utf-8');

    // 验证
    try {
      JSON.parse(content);
      console.log('  ✅ 修复成功');
    } catch (e) {
      console.log('  ⚠️  仍有问题:', e.message);
    }
  } else {
    console.log('  ℹ️  未找到匹配模式，尝试备用方法...');

    // 备用方法：直接在 "variables_schema": 前面加逗号
    content = content.replace(
      /"(\s*\n\s*"variables_schema":)/,
      '",$1'
    );

    fs.writeFileSync(file, content, 'utf-8');

    try {
      JSON.parse(content);
      console.log('  ✅ 修复成功（备用方法）');
    } catch (e) {
      console.log('  ❌ 修复失败:', e.message);
    }
  }
});
