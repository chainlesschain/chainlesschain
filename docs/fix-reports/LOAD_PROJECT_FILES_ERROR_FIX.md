# "loadProjectFiles" 错误修复

## 问题描述

在尝试查看项目详情时，出现以下错误：

```
[ERROR] [Store] ========== loadProjectFiles 错误 ==========
[ERROR] 获取项目详情失败
[ERROR] Load project failed
```

## 根本原因

当用户创建新项目并导航到项目详情页时，`loadProjectFiles` 方法尝试加载项目文件，但：

1. **新创建的项目可能还没有文件系统目录**
2. **文件缓存管理器可能找不到项目路径**
3. **Main process 抛出错误而不是返回空结果**

### 错误传播链

```
ProjectDetailPage.vue
  → projectStore.getProject(projectId)
    → projectStore.loadProjectFiles(projectId)
      → electronAPI.project.getFiles(projectId)
        → IPC: "project:get-files"
          → fileCacheManager.getFiles(projectId)
            → 抛出错误：项目目录不存在 ❌
```

## 修复方案

### 修复 1: Main Process 错误处理

**文件**: `src/main/project/project-core-ipc.js` (line ~1075)

**变更**: 对于不存在的项目文件，返回空结果而不是抛出错误

```javascript
// BEFORE:
} catch (error) {
  logger.error("[Main] 获取项目文件失败:", error);
  throw error;  // ❌ 抛出错误会阻塞页面
}

// AFTER:
} catch (error) {
  logger.error("[Main] 获取项目文件失败:", error);
  logger.error("[Main] Error details - message:", error?.message);
  logger.error("[Main] Error details - stack:", error?.stack);

  // 对于新项目或没有文件的项目，返回空结果而不是抛出错误
  if (error?.message?.includes("not found") ||
      error?.message?.includes("No such file") ||
      error?.message?.includes("ENOENT")) {
    logger.warn("[Main] 项目文件不存在，返回空结果");
    return {
      files: [],
      total: 0,
      hasMore: false,
      fromCache: false
    };
  }

  throw error;
}
```

### 修复 2: Renderer Process 错误处理（用户已添加）

**文件**: `src/renderer/stores/project.js` (line ~616)

**变更**: `loadProjectFiles` 捕获错误并返回空数组

```javascript
} catch (error) {
  logger.error("[Store] ========== loadProjectFiles 错误 ==========");
  logger.error("[Store] 错误类型:", error?.name);
  logger.error("[Store] 错误消息:", error?.message);
  logger.error("[Store] 错误堆栈:", error?.stack);
  logger.error("[Store] 完整错误:", error);
  logger.error("[Store] 项目ID:", projectId);

  // 返回空数组而不是抛出错误，避免阻塞页面加载
  this.projectFiles = [];
  logger.warn("[Store] 已将 projectFiles 重置为空数组");
  return [];
}
```

## 为什么这样修复有效？

### 1. 优雅降级 (Graceful Degradation)

- **之前**: 文件不存在 → 抛出错误 → 页面无法加载 → 用户看到错误
- **之后**: 文件不存在 → 返回空数组 → 页面正常显示 → 显示"暂无文件"

### 2. 新项目友好

新创建的项目通常：
- ✅ 有项目记录（数据库）
- ❌ 没有文件系统目录
- ❌ 没有任何文件

修复后，这些项目可以正常打开，只是文件列表为空。

### 3. 错误日志增强

添加了详细的错误信息输出，帮助诊断其他可能的问题：
- `error.name` - 错误类型
- `error.message` - 错误消息
- `error.stack` - 错误堆栈

## 测试验证

### 测试场景

1. **新建项目** → 打开项目详情 → 应该显示空文件列表 ✅
2. **现有项目** → 打开项目详情 → 应该显示文件列表 ✅
3. **删除项目目录** → 打开项目详情 → 应该显示空文件列表 ✅

### 预期结果

✅ **修复前**:
```
[ERROR] loadProjectFiles 错误
[ERROR] 获取项目详情失败
页面显示错误信息，无法加载
```

✅ **修复后**:
```
[WARN] 项目文件不存在，返回空结果
[WARN] 已将 projectFiles 重置为空数组
页面正常显示，文件列表为空
```

## 影响范围

### 修改文件

| 文件 | 修改类型 | 行数变更 |
|------|----------|----------|
| `src/main/project/project-core-ipc.js` | 添加错误处理 | ~15行 |
| `src/renderer/stores/project.js` | 已由用户添加 | ~10行 |

### 影响功能

- ✅ 项目详情页加载
- ✅ 文件列表显示
- ✅ 新项目创建流程
- ✅ 项目导航

### 兼容性

✅ 向后兼容 - 不影响现有功能
✅ 新项目友好 - 新项目可以正常打开
✅ 错误信息增强 - 更容易诊断问题

## 后续改进建议

### 1. 自动创建项目目录

在项目创建时自动创建文件系统目录：

```javascript
// 在 project-manager.js 的 createProject 方法中
const projectPath = path.join(PROJECTS_ROOT, projectId);
await fs.promises.mkdir(projectPath, { recursive: true });
```

### 2. 文件系统检查

在加载文件前检查项目目录是否存在：

```javascript
const projectPath = getProjectPath(projectId);
if (!fs.existsSync(projectPath)) {
  logger.warn("[FileCacheManager] 项目目录不存在:", projectPath);
  return { files: [], total: 0, hasMore: false, fromCache: false };
}
```

### 3. UI 提示优化

在文件列表为空时显示友好提示：

```vue
<template>
  <div v-if="projectFiles.length === 0" class="empty-state">
    <a-empty description="暂无文件">
      <a-button type="primary" @click="uploadFile">
        上传文件
      </a-button>
    </a-empty>
  </div>
</template>
```

## 相关问题

### 为什么文件缓存管理器找不到项目？

可能的原因：
1. 项目刚创建，文件系统目录还未生成
2. 项目被外部删除，但数据库记录仍存在
3. 项目路径配置错误

### 如何避免类似问题？

**设计原则**:
- ✅ 优雅降级：无法获取数据时返回空结果，而不是抛出错误
- ✅ 防御性编程：假设外部资源可能不存在
- ✅ 详细日志：记录错误详情，便于诊断
- ✅ 用户友好：即使出错，页面也应该可用

## 总结

✅ **Main process 错误处理已修复**
- 文件不存在时返回空结果而不是抛出错误

✅ **Renderer process 错误处理已增强**
- 捕获错误并返回空数组
- 添加详细错误日志

✅ **用户体验改善**
- 新项目可以正常打开
- 页面不会因文件不存在而崩溃
- 显示友好的空状态

**状态**: 🟢 已修复
**测试状态**: 待用户验证
**影响**: 低风险，向后兼容

---

**修复日期**: 2026-02-04
**修复人**: Claude (Sonnet 4.5)
**文档版本**: v1.0
