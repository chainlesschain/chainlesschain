const fs = require('fs');
const path = require('path');

const templatesDir = 'desktop-app-vue/src/main/templates';
const files = [
  'creative-writing/short-story.json',
  'ecommerce/product-detail-page.json',
  'travel/cultural-immersion-trip.json'
];

files.forEach(file => {
  const filePath = path.join(templatesDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');

  try {
    JSON.parse(content);
    console.log('✓', file, '- OK');
  } catch (error) {
    console.log('\n✗', file);
    console.log('Error:', error.message);

    const errorPos = parseInt(error.message.match(/position (\d+)/)?.[1] || 0);
    const lines = content.split('\n');
    let charCount = 0;

    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1;
      if (charCount >= errorPos) {
        console.log('  错误在第', i + 1, '行:');
        if (i > 0) console.log('  Prev:', lines[i-1].trim());
        console.log('  >>> :', lines[i].trim());
        if (i < lines.length - 1) console.log('  Next:', lines[i+1].trim());

        // 显示错误上下文
        const contextStart = Math.max(0, errorPos - 100);
        const contextEnd = Math.min(content.length, errorPos + 100);
        console.log('\n  上下文:');
        console.log('  ...', content.substring(contextStart, contextEnd), '...');
        break;
      }
    }
  }
});
