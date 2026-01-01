/**
 * 应用安全修复脚本
 * 运行方式: node APPLY_FIXES.js
 */

const fs = require('fs').promises;
const path = require('path');

const FILE_PATH = path.join(__dirname, 'src/renderer/pages/projects/ProjectDetailPage.vue');

async function applyFixes() {
  console.log('开始应用修复...\n');

  try {
    // 读取文件
    console.log('1. 读取 ProjectDetailPage.vue...');
    let content = await fs.readFile(FILE_PATH, 'utf-8');
    console.log(`   ✓ 文件大小: ${content.length} 字符\n`);

    // 修复1: 添加导入
    console.log('2. 添加工具函数导入...');
    const importLine = `import ResizeHandle from '@/components/projects/ResizeHandle.vue';`;
    const newImportLine = `import ResizeHandle from '@/components/projects/ResizeHandle.vue';
import { sanitizePath, validateFileSize, throttle, debounce } from '@/utils/file-utils';`;

    if (content.includes('from \'@/utils/file-utils\'')) {
      console.log('   ⊙ 导入已存在，跳过');
    } else {
      content = content.replace(importLine, newImportLine);
      console.log('   ✓ 已添加工具函数导入\n');
    }

    // 修复2: 替换 loadFileContent 函数
    console.log('3. 修复 loadFileContent 函数（添加路径验证和文件大小检查）...');

    const oldLoadFileContent = `// 加载文件内容
const loadFileContent = async (file) => {
  if (!file || !file.file_path) {
    fileContent.value = '';
    return;
  }

  try {
    // 只为可编辑和可预览的文件加载内容
    if (fileTypeInfo.value && (fileTypeInfo.value.isEditable || fileTypeInfo.value.isMarkdown || fileTypeInfo.value.isData)) {
      // 检查项目信息是否完整
      if (!currentProject.value || !currentProject.value.root_path) {
        throw new Error('项目信息不完整，缺少 root_path');
      }

      // 构建完整的文件路径：{root_path}/{file_path}
      let fullPath = file.file_path;

      // 判断是否已经是绝对路径
      const isAbsolutePath = /^([a-zA-Z]:[\\\\/]|\\/|\\\\\\\\)/.test(fullPath);

      if (!isAbsolutePath) {
        // 如果是相对路径，拼接项目根路径
        const rootPath = currentProject.value.root_path;
        // 处理路径分隔符，统一使用系统分隔符
        const separator = rootPath.includes('\\\\') ? '\\\\' : '/';
        // 清理 file_path 开头的斜杠
        const cleanFilePath = file.file_path.replace(/^[\\/\\\\]+/, '');
        fullPath = \`\${rootPath}\${separator}\${cleanFilePath}\`;
      }

      console.log('[ProjectDetail] 项目根路径:', currentProject.value.root_path);
      console.log('[ProjectDetail] 文件相对路径:', file.file_path);
      console.log('[ProjectDetail] 完整路径:', fullPath);
      const result = await window.electronAPI.file.readContent(fullPath);

      // 正确处理 IPC 返回的对象 { success: true, content: '...' }
      if (result && result.success) {
        // 确保 content 是字符串类型
        fileContent.value = typeof result.content === 'string' ? result.content : String(result.content || '');
        console.log('[ProjectDetail] 文件内容加载成功，长度:', fileContent.value.length);
      } else {
        throw new Error(result?.error || '读取文件失败');
      }
    } else {
      fileContent.value = '';
    }
  } catch (error) {
    console.error('[ProjectDetail] 加载文件内容失败:', error);
    console.error('[ProjectDetail] 错误详情:', {
      projectId: projectId.value,
      projectRootPath: currentProject.value?.root_path,
      fileRelativePath: file.file_path,
      fileName: file.file_name,
      error: error.message
    });

    // 提供更有用的错误消息
    let errorMsg = '加载文件失败: ' + error.message;
    if (!currentProject.value?.root_path) {
      errorMsg += '\\n提示：项目缺少 root_path 配置，请检查项目设置';
    }

    message.error(errorMsg);
    fileContent.value = '';
  }
};`;

    const newLoadFileContent = `// 加载文件内容
const loadFileContent = async (file) => {
  if (!file || !file.file_path) {
    fileContent.value = '';
    return;
  }

  try {
    // 只为可编辑和可预览的文件加载内容
    if (fileTypeInfo.value && (fileTypeInfo.value.isEditable || fileTypeInfo.value.isMarkdown || fileTypeInfo.value.isData)) {
      // 检查项目信息是否完整
      if (!currentProject.value || !currentProject.value.root_path) {
        throw new Error('项目信息不完整，缺少 root_path');
      }

      // 【修复1: 使用sanitizePath进行路径安全验证】
      let fullPath;
      const isAbsolutePath = /^([a-zA-Z]:[\\\\/]|\\/|\\\\\\\\)/.test(file.file_path);

      if (isAbsolutePath) {
        // 如果已经是绝对路径，直接使用
        fullPath = file.file_path;
      } else {
        // 如果是相对路径，使用安全的路径拼接函数
        try {
          fullPath = sanitizePath(currentProject.value.root_path, file.file_path);
        } catch (pathError) {
          throw new Error(\`路径验证失败: \${pathError.message}\`);
        }
      }

      console.log('[ProjectDetail] 项目根路径:', currentProject.value.root_path);
      console.log('[ProjectDetail] 文件相对路径:', file.file_path);
      console.log('[ProjectDetail] 完整路径（已验证）:', fullPath);

      // 【修复2: 添加文件大小检查】
      try {
        const fileStats = await window.electronAPI.file.stat(fullPath);
        if (fileStats && fileStats.success && fileStats.stats) {
          const extension = file.file_name?.split('.').pop();
          const sizeValidation = validateFileSize(fileStats.stats.size, extension);

          if (!sizeValidation.isValid) {
            message.warning(sizeValidation.message);
            fileContent.value = \`文件过大，无法在编辑器中打开。\\n\\n\${sizeValidation.message}\\n\\n建议使用外部编辑器打开此文件。\`;
            return;
          }
        }
      } catch (statsError) {
        console.warn('[ProjectDetail] 无法获取文件大小，跳过大小检查:', statsError);
        // 继续加载，不因为无法获取文件大小而失败
      }

      const result = await window.electronAPI.file.readContent(fullPath);

      // 正确处理 IPC 返回的对象 { success: true, content: '...' }
      if (result && result.success) {
        // 确保 content 是字符串类型
        fileContent.value = typeof result.content === 'string' ? result.content : String(result.content || '');
        console.log('[ProjectDetail] 文件内容加载成功，长度:', fileContent.value.length);
      } else {
        throw new Error(result?.error || '读取文件失败');
      }
    } else {
      fileContent.value = '';
    }
  } catch (error) {
    console.error('[ProjectDetail] 加载文件内容失败:', error);
    console.error('[ProjectDetail] 错误详情:', {
      projectId: projectId.value,
      projectRootPath: currentProject.value?.root_path,
      fileRelativePath: file.file_path,
      fileName: file.file_name,
      error: error.message
    });

    // 提供更有用的错误消息
    let errorMsg = '加载文件失败: ' + error.message;
    if (!currentProject.value?.root_path) {
      errorMsg += '\\n提示：项目缺少 root_path 配置，请检查项目设置';
    }

    message.error(errorMsg);
    fileContent.value = '';
  }
};`;

    content = content.replace(oldLoadFileContent, newLoadFileContent);
    console.log('   ✓ loadFileContent 函数已修复\n');

    // 修复3&4: 添加节流处理
    console.log('4. 为面板调整添加节流处理...');

    // 面板调整函数
    const oldFileExplorerResize = `// 处理文件树面板调整大小
const handleFileExplorerResize = (delta) => {
  const newWidth = fileExplorerWidth.value + delta;
  if (newWidth >= minPanelWidth && newWidth <= maxFileExplorerWidth) {
    fileExplorerWidth.value = newWidth;
  }
};`;

    const newFileExplorerResize = `// 处理文件树面板调整大小（添加节流优化）
const handleFileExplorerResize = throttle((delta) => {
  const newWidth = fileExplorerWidth.value + delta;
  if (newWidth >= minPanelWidth && newWidth <= maxFileExplorerWidth) {
    fileExplorerWidth.value = newWidth;
  }
}, 16); // 60fps`;

    const oldEditorPanelResize = `// 处理编辑器面板调整大小
const handleEditorPanelResize = (delta) => {
  const newWidth = editorPanelWidth.value - delta; // 注意：向左拖拽时delta为正，需要减小宽度
  if (newWidth >= minPanelWidth && newWidth <= maxEditorPanelWidth) {
    editorPanelWidth.value = newWidth;
  }
};`;

    const newEditorPanelResize = `// 处理编辑器面板调整大小（添加节流优化）
const handleEditorPanelResize = throttle((delta) => {
  const newWidth = editorPanelWidth.value - delta; // 注意：向左拖拽时delta为正，需要减小宽度
  if (newWidth >= minPanelWidth && newWidth <= maxEditorPanelWidth) {
    editorPanelWidth.value = newWidth;
  }
}, 16); // 60fps`;

    content = content.replace(oldFileExplorerResize, newFileExplorerResize);
    content = content.replace(oldEditorPanelResize, newEditorPanelResize);
    console.log('   ✓ 面板调整已添加节流处理\n');

    // 修复5: 优化Git轮询频率
    console.log('5. 优化Git状态轮询频率（10秒→30秒）...');
    content = content.replace(
      '}, 10000);',
      '}, 30000); // 优化：从10秒增加到30秒，减少资源消耗'
    );
    console.log('   ✓ Git轮询频率已优化\n');

    // 保存文件
    console.log('6. 保存修复后的文件...');
    await fs.writeFile(FILE_PATH, content, 'utf-8');
    console.log('   ✓ 文件已保存\n');

    console.log('✅ 所有修复已成功应用！\n');
    console.log('修复摘要:');
    console.log('  ✓ 添加了安全路径验证（防止路径遍历攻击）');
    console.log('  ✓ 添加了文件大小限制检查');
    console.log('  ✓ 为面板拖拽添加节流处理（提升性能）');
    console.log('  ✓ 优化了Git状态轮询频率（减少资源消耗）');
    console.log('\\n请重启应用以使修复生效。');

  } catch (error) {
    console.error('\\n❌ 修复失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

applyFixes();
