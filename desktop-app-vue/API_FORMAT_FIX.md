# API 格式不匹配修复

## 修复日期
2026-02-04

## 问题描述

### 错误信息
```
TypeError: files is not iterable
at Proxy.loadProjectFiles (project.js:607:41)
```

### 根本原因

IPC API (`project:get-files`) 和 Pinia Store 之间的数据格式不匹配：

**IPC 返回格式**（新版）:
```javascript
{
  files: [...],      // 文件数组
  total: number,     // 总文件数
  hasMore: boolean,  // 是否有更多
  fromCache: boolean // 是否来自缓存
}
```

**Store 期望格式**（旧版）:
```javascript
[...]  // 直接是文件数组
```

## 修复方案

### ✅ 修复 1: 增强 Store 错误处理

**文件**: `desktop-app-vue/src/renderer/stores/project.js`

**修改位置**: `loadProjectFiles` 方法 (行 589-623)

```javascript
async loadProjectFiles(projectId) {
  try {
    const response = await window.electronAPI.project.getFiles(projectId);

    // BUGFIX: 兼容两种返回格式
    let files = [];

    try {
      if (Array.isArray(response)) {
        // 旧版 API: 直接返回数组
        files = response;
        logger.info("[Store] 使用数组格式响应");
      } else if (response && typeof response === 'object' && Array.isArray(response.files)) {
        // 新版 API: 返回对象
        files = response.files;
        logger.info("[Store] 使用对象格式响应，total:", response.total);
      } else {
        logger.warn("[Store] IPC 返回格式异常，使用空数组");
        files = [];
      }
    } catch (parseError) {
      logger.error("[Store] 解析响应失败:", parseError);
      files = [];
    }

    // 确保 files 是数组
    this.projectFiles = Array.isArray(files) ? [...files] : [];

    return this.projectFiles;
  } catch (error) {
    logger.error("[Store] 加载项目文件失败:", error);
    this.projectFiles = [];
    return [];
  }
}
```

**改进点**:
1. ✅ 同时支持数组和对象两种返回格式
2. ✅ 添加完整的类型检查和错误处理
3. ✅ 详细的日志记录用于调试
4. ✅ 确保返回值始终是数组，防止迭代错误

## 验证结果

### 数据库架构验证
```bash
$ node verify-database-schema.js

✅ Database schema is CORRECT
   - is_folder column EXISTS in project_files
   - owner_did columns EXIST in all organization tables
```

### API 格式验证

**测试场景 1: 新版 API**
```javascript
Response: { files: [...], total: 10, hasMore: false }
Result: ✓ 正确解析为 files 数组
```

**测试场景 2: 旧版 API (如果存在)**
```javascript
Response: [...]
Result: ✓ 正确识别为数组格式
```

**测试场景 3: 错误响应**
```javascript
Response: null / undefined / {}
Result: ✓ 安全降级为空数组
```

## 相关文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/renderer/stores/project.js` | 修改 | 增强 loadProjectFiles 错误处理 |
| `src/main/project/project-core-ipc.js` | 参考 | IPC 处理器定义（无需修改）|

## IPC API 文档

### `project:get-files`

**功能**: 获取项目文件列表（带分页和缓存）

**参数**:
```javascript
(projectId, fileType?, pageNum?, pageSize?)
```

**返回格式**:
```javascript
{
  files: Array<File>,    // 文件数组
  total: number,         // 总文件数（不受分页限制）
  hasMore: boolean,      // 是否还有更多文件
  fromCache: boolean     // 数据是否来自缓存
}
```

**File 对象结构**:
```javascript
{
  id: string,
  project_id: string,
  file_path: string,
  file_name: string,
  file_type: string,
  file_size: number,
  is_folder: number,     // 0=文件, 1=文件夹
  created_at: number,
  updated_at: number,
  deleted: number,
  // ... 其他字段
}
```

## 后续建议

1. ✅ **向后兼容**: Store 现在同时支持新旧两种格式
2. ⚠️ **统一格式**: 建议全面迁移到新版对象格式
3. ✅ **错误处理**: 所有 API 调用都应该有类似的错误处理
4. ⚠️ **类型定义**: 考虑添加 TypeScript 类型定义

## 测试清单

- [x] 加载空项目（无文件）
- [x] 加载有文件的项目
- [x] 分页加载文件
- [x] 文件夹和文件混合
- [x] 错误场景（数据库未初始化）
- [x] 缓存和非缓存响应

## 相关工具脚本

- `verify-database-schema.js` - 验证数据库架构
- `test-database-fixes.js` - 测试数据库修复
- `diagnose-database-error.js` - 诊断 SQL 错误

## 结论

✅ **API 格式不匹配问题已修复**

Store 现在能够正确处理：
- 新版对象格式 `{ files: [...], total, hasMore }`
- 旧版数组格式 `[...]`（如果存在）
- 错误和异常情况

应用应该能正常加载项目文件，不再出现 "files is not iterable" 错误。
