const fs = require('fs');

const file = 'desktop-app-vue/src/main/templates/ecommerce/product-detail-page.json';
const content = fs.readFileSync(file, 'utf-8');

// 找到第11行
const lines = content.split('\n');
const line11 = lines[10]; // 0-indexed

console.log('第11行长度:', line11.length);
console.log('错误位置: column 5696\n');
console.log('错误附近的内容 (5680-5720):');
console.log(line11.substring(5680, 5720));
console.log('\n查找未转义的引号:');

// 查找可能的问题字符
const problemChars = [];
for (let i = 5680; i < 5720; i++) {
  const char = line11[i];
  if (char === '"' || char === '\'' || char === '\\') {
    problemChars.push({ pos: i, char, context: line11.substring(i-5, i+10) });
  }
}

problemChars.forEach(p => {
  console.log(`  位置 ${p.pos}: '${p.char}' - ...${p.context}...`);
});
