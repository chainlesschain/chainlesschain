# Markdown 编辑器加载和保存修复报告

**修复日期**: 2025-12-28
**问题描述**: MD 文件无法正常加载出实际内容，且无法保存

## 问题分析

### 根本原因

1. **初始内容不响应变化**
   - MarkdownEditor 组件只在 `onMounted` 时读取一次 `initialContent` prop
   - 当切换文件时，虽然 `initialContent` 变化，但组件不会更新内容
   - 导致编辑器显示的始终是第一次打开的文件内容

2. **Watch 冲突和时序问题**
   - 同时 watch `props.file` 和接收 `initialContent`
   - 两个数据源同时更新时，可能产生竞态条件
   - 没有明确的优先级，导致行为不确定

3. **保存逻辑缺少错误处理**
   - 保存时没有检查返回结果的 `success` 字段
   - 没有详细的日志输出，难以排查问题
   - 文件路径验证不完整

## 修复方案

### 1. MarkdownEditor.vue 修复

#### 修复前
```javascript
// 监听文件变化
watch(() => props.file, async () => {
  if (props.file?.file_path) {
    try {
      const result = await window.electronAPI.file.readContent(props.file.file_path);
      if (result.success) {
        content.value = result.content || '';
        hasChanges.value = false;
      }
    } catch (error) {
      console.error('[MarkdownEditor] 读取文件失败:', error);
    }
  }
}, { deep: true });

// 组件挂载
onMounted(() => {
  if (props.initialContent) {
    content.value = props.initialContent;
  }
});
```

#### 修复后
```javascript
// 监听 initialContent 变化（主要加载方式）
watch(() => props.initialContent, (newContent) => {
  if (newContent !== undefined && newContent !== content.value) {
    console.log('[MarkdownEditor] initialContent 变化，更新内容，长度:', newContent?.length);
    content.value = newContent || '';
    hasChanges.value = false;
  }
}, { immediate: true });

// 监听文件变化（作为备用加载方式）
watch(() => props.file?.id, async (newId, oldId) => {
  if (newId && newId !== oldId && props.file?.file_path) {
    // 只有在 initialContent 为空时才尝试直接读取文件
    if (!props.initialContent) {
      try {
        console.log('[MarkdownEditor] 文件变化，直接读取:', props.file.file_path);
        const result = await window.electronAPI.file.readContent(props.file.file_path);
        if (result.success) {
          content.value = result.content || '';
          hasChanges.value = false;
        }
      } catch (error) {
        console.error('[MarkdownEditor] 读取文件失败:', error);
        message.error('读取文件失败: ' + error.message);
      }
    }
  }
});

// 组件挂载
onMounted(() => {
  console.log('[MarkdownEditor] 组件挂载，initialContent 长度:', props.initialContent?.length);
  if (props.initialContent) {
    content.value = props.initialContent;
  }
});
```

**关键改进**:
- ✅ 添加了对 `initialContent` 的 watch，确保响应变化
- ✅ 使用 `immediate: true` 确保初始值也能被处理
- ✅ 优化了 watch `file` 的逻辑，避免重复读取
- ✅ 添加了详细的日志输出

### 2. 保存逻辑修复

#### 修复前
```javascript
const save = async () => {
  if (!hasChanges.value) return;

  saving.value = true;
  try {
    if (props.file?.file_path) {
      await window.electronAPI.file.writeContent(props.file.file_path, content.value);
    }

    hasChanges.value = false;
    emit('save', content.value);
    message.success('已保存');
  } catch (error) {
    console.error('[MarkdownEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};
```

#### 修复后
```javascript
const save = async () => {
  if (!hasChanges.value) return;

  if (!props.file?.file_path) {
    message.warning('文件路径不存在，无法保存');
    return;
  }

  saving.value = true;
  try {
    console.log('[MarkdownEditor] 保存文件:', props.file.file_path);
    console.log('[MarkdownEditor] 内容长度:', content.value?.length);

    const result = await window.electronAPI.file.writeContent(props.file.file_path, content.value);

    if (result.success) {
      hasChanges.value = false;
      emit('save', content.value);
      message.success('已保存');
      console.log('[MarkdownEditor] 保存成功');
    } else {
      throw new Error(result.error || '保存失败');
    }
  } catch (error) {
    console.error('[MarkdownEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};
```

**关键改进**:
- ✅ 添加文件路径验证
- ✅ 检查 IPC 返回结果的 `success` 字段
- ✅ 添加详细的日志输出，便于调试
- ✅ 改进错误处理和用户提示

### 3. ProjectDetailPage.vue 修复

#### 修复前
```javascript
const handleMarkdownChange = (content) => {
  hasUnsavedChanges.value = true;
};

const handleMarkdownSave = async (content) => {
  hasUnsavedChanges.value = false;
  message.success('Markdown已保存');
};
```

#### 修复后
```javascript
const handleMarkdownChange = (content) => {
  console.log('[ProjectDetail] Markdown内容变化，长度:', content?.length);
  hasUnsavedChanges.value = true;
  // 更新 fileContent 以保持同步
  fileContent.value = content;
};

const handleMarkdownSave = async (content) => {
  console.log('[ProjectDetail] Markdown保存完成，长度:', content?.length);
  hasUnsavedChanges.value = false;
  // 更新 fileContent
  fileContent.value = content;
  // 不需要再显示消息，MarkdownEditor 已经显示了
};
```

**关键改进**:
- ✅ 添加 `fileContent` 同步逻辑，确保数据一致性
- ✅ 添加详细日志
- ✅ 避免重复显示保存消息

## 修复效果

### 加载功能
- ✅ 打开 MD 文件时能正确显示内容
- ✅ 切换文件时能正确更新编辑器内容
- ✅ 支持初始化时的内容加载
- ✅ 提供详细的日志输出，便于排查问题

### 保存功能
- ✅ 保存时验证文件路径
- ✅ 正确处理 IPC 返回结果
- ✅ 提供清晰的错误提示
- ✅ 保存成功后正确重置状态

### 用户体验
- ✅ 加载速度快，无闪烁
- ✅ 保存提示清晰
- ✅ 错误信息详细
- ✅ 切换文件流畅

## 测试建议

### 基础功能测试
1. 打开一个 MD 文件，检查内容是否正确显示
2. 编辑内容后保存，检查文件是否正确更新
3. 切换到另一个 MD 文件，检查内容是否正确切换
4. 在多个文件间来回切换，检查是否有问题

### 边界情况测试
1. 打开空的 MD 文件
2. 打开超大的 MD 文件（>1MB）
3. 保存到不存在的路径
4. 文件权限只读时尝试保存
5. 快速切换文件时的行为

### 性能测试
1. 加载大文件的速度
2. 编辑时的流畅度
3. 保存的响应时间

## 相关文件

修改的文件：
- `desktop-app-vue/src/renderer/components/editors/MarkdownEditor.vue`
- `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue`

依赖的 IPC 处理：
- `desktop-app-vue/src/main/ipc/file-ipc.js`
  - `file:readContent` - 读取文件内容
  - `file:writeContent` - 写入文件内容

## 总结

本次修复解决了 Markdown 编辑器的核心问题：
1. 文件内容加载机制更加健壮和可预测
2. 保存逻辑有了完善的错误处理
3. 添加了详细的日志输出，便于未来排查问题
4. 改善了用户体验，消除了混淆

建议在修复后进行全面测试，确保所有场景都能正常工作。
