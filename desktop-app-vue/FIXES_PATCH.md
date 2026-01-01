# ProjectDetailPage.vue 修复补丁

## 1. 添加导入（在第460行后添加）

```javascript
import { sanitizePath, validateFileSize, throttle, debounce } from '@/utils/file-utils';
```

## 2. 替换 loadFileContent 函数（第707-772行）

```javascript
// 加载文件内容
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

      // 【修复1：使用sanitizePath进行路径安全验证】
      let fullPath;
      const isAbsolutePath = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(file.file_path);

      if (isAbsolutePath) {
        // 如果已经是绝对路径，直接使用
        fullPath = file.file_path;
      } else {
        // 如果是相对路径，使用安全的路径拼接函数
        try {
          fullPath = sanitizePath(currentProject.value.root_path, file.file_path);
        } catch (pathError) {
          throw new Error(`路径验证失败: ${pathError.message}`);
        }
      }

      console.log('[ProjectDetail] 项目根路径:', currentProject.value.root_path);
      console.log('[ProjectDetail] 文件相对路径:', file.file_path);
      console.log('[ProjectDetail] 完整路径（已验证）:', fullPath);

      // 【修复2：添加文件大小检查】
      try {
        const fileStats = await window.electronAPI.file.getStats(fullPath);
        if (fileStats) {
          const extension = file.file_name?.split('.').pop();
          const sizeValidation = validateFileSize(fileStats.size, extension);

          if (!sizeValidation.isValid) {
            message.warning(sizeValidation.message);
            fileContent.value = `文件过大，无法在编辑器中打开。\n\n文件大小: ${formatFileSize(fileStats.size)}\n限制大小: ${formatFileSize(sizeValidation.limit)}\n\n建议使用外部编辑器打开此文件。`;
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
      errorMsg += '\n提示：项目缺少 root_path 配置，请检查项目设置';
    }

    message.error(errorMsg);
    fileContent.value = '';
  }
};

// 添加formatFileSize辅助函数（如果window.electronAPI.file.getStats需要）
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
```

## 3. 替换 handleFileExplorerResize 函数（第674-679行）

```javascript
// 【修复3：添加节流处理】
// 处理文件树面板调整大小
const handleFileExplorerResize = throttle((delta) => {
  const newWidth = fileExplorerWidth.value + delta;
  if (newWidth >= minPanelWidth && newWidth <= maxFileExplorerWidth) {
    fileExplorerWidth.value = newWidth;
  }
}, 16); // 60fps
```

## 4. 替换 handleEditorPanelResize 函数（第682-687行）

```javascript
// 【修复4：添加节流处理】
// 处理编辑器面板调整大小
const handleEditorPanelResize = throttle((delta) => {
  const newWidth = editorPanelWidth.value - delta; // 注意：向左拖拽时delta为正，需要减小宽度
  if (newWidth >= minPanelWidth && newWidth <= maxEditorPanelWidth) {
    editorPanelWidth.value = newWidth;
  }
}, 16); // 60fps
```

## 5. 修改 Git 状态轮询逻辑（第1348-1355行）

```javascript
// 【修复5：优化Git轮询 - 增加间隔到30秒】
// 初始化 Git 状态
await refreshGitStatus();
// 每 30 秒刷新一次 Git 状态（从10秒增加到30秒）
gitStatusInterval = setInterval(() => {
  refreshGitStatus().catch(err => {
    console.error('[ProjectDetail] Git status interval error:', err);
  });
}, 30000); // 从10000改为30000
```

## 6. 添加编辑器实例清理（在 watch currentFile 之前添加）

```javascript
// 【修复6：编辑器实例清理】
// 清理编辑器实例
const cleanupEditorInstances = () => {
  try {
    // 清理各类编辑器实例
    if (excelEditorRef.value?.destroy) {
      excelEditorRef.value.destroy();
    }
    if (wordEditorRef.value?.destroy) {
      wordEditorRef.value.destroy();
    }
    if (codeEditorRef.value?.destroy) {
      codeEditorRef.value.destroy();
    }
    if (markdownEditorRef.value?.destroy) {
      markdownEditorRef.value.destroy();
    }
    if (webEditorRef.value?.destroy) {
      webEditorRef.value.destroy();
    }
    if (pptEditorRef.value?.destroy) {
      pptEditorRef.value.destroy();
    }
    if (editorRef.value?.destroy) {
      editorRef.value.destroy();
    }
  } catch (error) {
    console.warn('[ProjectDetail] 清理编辑器实例时出错:', error);
  }
};
```

## 7. 修改 watch currentFile（第1536-1542行）

```javascript
// 监听当前文件变化，加载文件内容
watch(() => currentFile.value, async (newFile, oldFile) => {
  // 【修复7：切换文件前清理旧编辑器实例】
  if (oldFile && oldFile !== newFile) {
    cleanupEditorInstances();
  }

  if (newFile) {
    await loadFileContent(newFile);
  } else {
    fileContent.value = '';
  }
}, { immediate: false });
```

## 8. 修改 onUnmounted 清理逻辑（第1437-1473行添加）

```javascript
// 组件卸载时清理定时器
onUnmounted(async () => {
  // 【修复8：清理编辑器实例】
  cleanupEditorInstances();

  if (gitStatusInterval) {
    clearInterval(gitStatusInterval);
    gitStatusInterval = null;
  }

  // ... 原有的其他清理代码
});
```

---

## 需要在 main 进程添加的 API（如果还没有）

在 `desktop-app-vue/src/main/index.js` 中添加：

```javascript
// 获取文件状态（大小等信息）
ipcMain.handle('file:getStats', async (event, filePath) => {
  try {
    const fs = require('fs').promises;
    const stats = await fs.stat(filePath);
    return {
      success: true,
      size: stats.size,
      mtime: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    console.error('Get file stats error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});
```

并在 preload 中暴露：

```javascript
file: {
  // ... 现有的 API
  getStats: (filePath) => ipcRenderer.invoke('file:getStats', filePath),
}
```
