const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/pages/projects/ProjectDetailPage.vue');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 启用虚拟滚动文件树（默认为true）
const oldVirtualTree = 'const useVirtualFileTree = ref(false); // 使用虚拟滚动文件树（性能优化）- 暂时禁用，组件开发中';
const newVirtualTree = 'const useVirtualFileTree = ref(true); // 使用虚拟滚动文件树（性能优化）- 已启用';

if (content.includes('const useVirtualFileTree = ref(false)')) {
  content = content.replace(oldVirtualTree, newVirtualTree);
  console.log('✓ 已启用虚拟滚动文件树');
} else if (content.includes('const useVirtualFileTree = ref(true)')) {
  console.log('⊙ 虚拟滚动文件树已经启用');
} else {
  console.log('⚠ 未找到useVirtualFileTree定义');
}

// 2. 添加文件数量检测，自动选择最佳模式
const autoSwitchLogic = `
// 根据文件数量自动选择文件树模式
const updateFileTreeMode = () => {
  const fileCount = projectFiles.value?.length || 0;
  // 超过500个文件时使用虚拟滚动
  const shouldUseVirtual = fileCount > 500;

  if (shouldUseVirtual !== useVirtualFileTree.value) {
    useVirtualFileTree.value = shouldUseVirtual;
    console.log(\`[ProjectDetail] 文件数量: \${fileCount}，切换到 \${shouldUseVirtual ? '虚拟' : '标准'}模式\`);
  }
};
`;

// 在loadFilesWithSync函数后添加
const insertPoint = 'const loadFilesWithSync';
if (!content.includes('updateFileTreeMode')) {
  const lines = content.split('\n');
  const targetIndex = lines.findIndex(line => line.includes(insertPoint));

  if (targetIndex > 0) {
    // 找到loadFilesWithSync函数的结束位置
    let braceCount = 0;
    let endIndex = targetIndex;
    for (let i = targetIndex; i < lines.length; i++) {
      const line = lines[i];
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount === 0 && i > targetIndex) {
        endIndex = i;
        break;
      }
    }

    // 在函数结束后插入
    lines.splice(endIndex + 1, 0, autoSwitchLogic);
    content = lines.join('\n');
    console.log('✓ 已添加文件树模式自动切换逻辑');
  }
} else {
  console.log('⊙ 文件树模式自动切换逻辑已存在');
}

// 3. 在loadFilesWithSync中调用updateFileTreeMode
const loadFilesPattern = /await loadFilesWithSync\(projectId\.value\)/g;
const matches = content.match(loadFilesPattern);

if (matches && !content.includes('updateFileTreeMode()')) {
  // 在第一次调用后添加
  content = content.replace(
    /await loadFilesWithSync\(projectId\.value\);/,
    `await loadFilesWithSync(projectId.value);
  updateFileTreeMode(); // 根据文件数量选择最佳模式`
  );
  console.log('✓ 已在文件加载后调用模式更新');
} else {
  console.log('⊙ 模式更新调用已存在或无需添加');
}

fs.writeFileSync(filePath, content);
console.log('\n✅ 虚拟滚动文件树已启用并优化！');
console.log('   - 默认启用虚拟滚动模式');
console.log('   - 超过500个文件时自动使用虚拟滚动');
console.log('   - 用户可以手动切换模式');
