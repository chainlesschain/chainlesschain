const fs = require('fs');

const content = fs.readFileSync('./src/main/skill-tool-system/builtin-tools.js', 'utf-8');
const lines = content.split('\n');

const duplicateIds = [
  'tool_template_renderer',
  'tool_speech_recognizer',
  'tool_wallet_manager',
  'tool_model_predictor',
  'tool_performance_profiler',
  'tool_text_to_speech'
];

console.log('=== 重复工具定义位置 ===\n');

const duplicateRanges = [];

duplicateIds.forEach(id => {
  const occurrences = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`id: '${id}'`)) {
      occurrences.push(i + 1); // 行号从1开始
    }
  }

  console.log(`${id}:`);
  console.log(`  第1个定义: 行 ${occurrences[0]}`);
  console.log(`  第2个定义: 行 ${occurrences[1]} (需要删除)`);

  if (occurrences.length === 2) {
    // 找到第二个定义的完整工具对象范围
    const startLine = occurrences[1] - 1; // 转换回0-based index
    let openBraces = 0;
    let closedBraces = 0;
    let endLine = startLine;

    // 向上找到工具对象的开始 (找到前一个 {)
    for (let i = startLine; i >= 0; i--) {
      if (lines[i].trim() === '{') {
        startLine = i;
        break;
      }
    }

    // 从开始位置向下找到对应的结束 }
    for (let i = startLine; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') openBraces++;
        if (char === '}') closedBraces++;
      }

      if (openBraces > 0 && openBraces === closedBraces) {
        endLine = i;
        break;
      }
    }

    // 检查下一行是否是逗号，如果是也要删除
    if (endLine + 1 < lines.length && lines[endLine + 1].trim() === ',') {
      endLine++;
    }

    duplicateRanges.push({
      id,
      start: startLine + 1,
      end: endLine + 1
    });

    console.log(`  删除范围: 行 ${startLine + 1} - ${endLine + 1}`);
  }

  console.log('');
});

console.log('\n=== 删除总结 ===');
console.log(`需要删除 ${duplicateRanges.length} 个重复工具定义`);
console.log(`预计删除行数: ${duplicateRanges.reduce((sum, r) => sum + (r.end - r.start + 1), 0)}`);
