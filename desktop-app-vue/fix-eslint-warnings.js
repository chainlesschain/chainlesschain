/**
 * 批量修复ESLint warnings
 * 主要修复未使用的变量和参数
 */

const fs = require('fs');
const path = require('path');

// 需要修复的文件列表和对应的修复规则
const fixes = [
  // Remove unused createLogger imports
  {
    files: [
      'src/main/ai-engine/task-planner-enhanced.js',
      'src/main/ai-engine/task-executor.js',
      'src/main/ai-engine/smart-plan-cache.js',
      'src/main/ai-engine/llm-decision-engine.js',
      'src/main/ai-engine/critical-path-optimizer.js',
      'src/main/ai-engine/real-time-quality-gate.js',
      'src/renderer/router/index.js'
    ],
    find: /const { createLogger } = require\('.*logger.*'\);?\n?/g,
    replace: '// Logger import removed (unused)\n'
  },
  {
    files: [
      'src/renderer/router/index.js'
    ],
    find: /^\s*progressiveLoader,?\n/gm,
    replace: ''
  },
  {
    files: [
      'src/renderer/router/index.js'
    ],
    find: /const (aiPages|monitoringPages|p2pAdvancedPages|miscPages) = \[[\s\S]*?\];?\n/g,
    replace: '// Unused page array removed\n'
  }
];

// 通用规则：将未使用的参数前缀加下划线
const parameterFixes = [
  {
    pattern: /\bcatch \(error\)/g,
    replacement: 'catch (_error)'
  },
  {
    pattern: /\(event\)/g,
    replacement: '(_event)'
  },
  {
    pattern: /\(step\)/g,
    replacement: '(_step)'
  }
];

console.log('开始修复ESLint warnings...\n');

let totalFixed = 0;

fixes.forEach(fix => {
  fix.files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  文件不存在: ${file}`);
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    content = content.replace(fix.find, fix.replace);

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ 已修复: ${file}`);
      totalFixed++;
    }
  });
});

console.log(`\n共修复 ${totalFixed} 个文件`);
console.log('\n请手动检查并修复剩余的warnings');
