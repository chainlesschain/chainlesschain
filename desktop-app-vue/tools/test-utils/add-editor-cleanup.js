const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/pages/projects/ProjectDetailPage.vue');
let content = fs.readFileSync(filePath, 'utf-8');

// 添加编辑器清理函数（在watch currentFile之前）
const cleanupFunction = `
// 清理编辑器实例（避免内存泄漏）
const cleanupEditorInstances = () => {
  try {
    console.log('[ProjectDetail] 清理编辑器实例...');

    // 清理各类编辑器实例
    if (excelEditorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理Excel编辑器');
      excelEditorRef.value.destroy();
    }
    if (wordEditorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理Word编辑器');
      wordEditorRef.value.destroy();
    }
    if (codeEditorRef.value?.dispose) {
      // Monaco Editor使用dispose方法
      console.log('[ProjectDetail] 清理代码编辑器');
      codeEditorRef.value.dispose();
    }
    if (markdownEditorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理Markdown编辑器');
      markdownEditorRef.value.destroy();
    }
    if (webEditorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理Web编辑器');
      webEditorRef.value.destroy();
    }
    if (pptEditorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理PPT编辑器');
      pptEditorRef.value.destroy();
    }
    if (editorRef.value?.destroy) {
      console.log('[ProjectDetail] 清理简单编辑器');
      editorRef.value.destroy();
    }

    console.log('[ProjectDetail] ✓ 编辑器实例清理完成');
  } catch (error) {
    console.warn('[ProjectDetail] 清理编辑器实例时出错:', error);
  }
};
`;

// 在 "// 监听当前文件变化，加载文件内容" 之前插入清理函数
const insertPoint = '// 监听当前文件变化，加载文件内容';
if (!content.includes('cleanupEditorInstances')) {
  content = content.replace(insertPoint, cleanupFunction + '\n' + insertPoint);
  console.log('✓ 已添加cleanupEditorInstances函数');
} else {
  console.log('⊙ cleanupEditorInstances函数已存在');
}

// 修改watch currentFile以调用清理函数
const oldWatch = `// 监听当前文件变化，加载文件内容
watch(() => currentFile.value, async (newFile) => {
  if (newFile) {
    await loadFileContent(newFile);
  } else {
    fileContent.value = '';
  }
}, { immediate: false });`;

const newWatch = `// 监听当前文件变化，加载文件内容
watch(() => currentFile.value, async (newFile, oldFile) => {
  // 切换文件前清理旧编辑器实例
  if (oldFile && oldFile !== newFile) {
    cleanupEditorInstances();
  }

  if (newFile) {
    await loadFileContent(newFile);
  } else {
    fileContent.value = '';
  }
}, { immediate: false });`;

if (!content.includes('oldFile && oldFile !== newFile')) {
  content = content.replace(oldWatch, newWatch);
  console.log('✓ 已修改watch currentFile添加清理逻辑');
} else {
  console.log('⊙ watch已包含清理逻辑');
}

// 在onUnmounted中添加清理调用
const onUnmountedPattern = /\/\/ 组件卸载时清理定时器\nonUnmounted\(async \(\) => \{/;
const newOnUnmounted = `// 组件卸载时清理定时器
onUnmounted(async () => {
  // 清理所有编辑器实例
  cleanupEditorInstances();
`;

if (!content.match(/onUnmounted.*cleanupEditorInstances/s)) {
  content = content.replace(onUnmountedPattern, newOnUnmounted);
  console.log('✓ 已在onUnmounted中添加编辑器清理');
} else {
  console.log('⊙ onUnmounted已包含清理逻辑');
}

fs.writeFileSync(filePath, content);
console.log('\n✅ 编辑器实例清理机制已完善！');
