# 修复项目路径问题指南

## 问题描述

如果你看到以下错误日志：
```
[Main] 项目根路径: undefined
[Main] ⚠️  项目没有根路径！
```

这意味着项目的 `root_path` 字段为 null，导致：
- 文件无法正确保存到文件系统
- 文件监听功能无法启动
- 无法在外部编辑器中打开项目文件

## 问题原因

1. **旧版本创建的项目** - 在添加路径功能之前创建的项目没有 `root_path`
2. **AI 创建流程** - AI 创建的项目在某些情况下可能没有正确设置路径
3. **数据库字段更新** - `updateProject` 方法的 `allowedFields` 缺少 `root_path` 字段

## 已修复的问题

### 1. 修复 `updateProject` 方法 ✅

**文件**: `src/main/database.js` (line 2240)

**修改**: 在 `allowedFields` 中添加了 `root_path`, `folder_path`, `project_type`

```javascript
const allowedFields = [
  'name', 'description', 'status', 'tags', 'cover_image_url',
  'file_count', 'total_size', 'sync_status', 'synced_at',
  'root_path', 'folder_path', 'project_type'  // ✅ 新增
];
```

### 2. 新增项目路径修复功能 ✅

**文件**: `src/main/index.js` (line 5228, 5314, 5361)

添加了三个 IPC 处理器：
- `project:fix-path` - 修复单个项目（新增，更全面）
- `project:repair-root-path` - 修复单个项目（已存在）
- `project:repair-all-root-paths` - 批量修复所有项目（已存在）

## 解决方案

### 方法 1: 通过浏览器控制台修复（推荐）

1. **打开应用开发者工具**
   - Windows/Linux: `Ctrl + Shift + I`
   - macOS: `Cmd + Option + I`

2. **在控制台执行以下命令**

   **修复单个项目：**
   ```javascript
   // 使用项目 ID 修复
   const projectId = 'b3cbcaab-fd91-49a2-92d0-648db0d45f21'; // 替换为你的项目 ID
   const result = await window.electronAPI.project.repairRootPath(projectId);
   console.log('修复结果:', result);
   ```

   **批量修复所有项目：**
   ```javascript
   const result = await window.electronAPI.project.repairAllRootPaths();
   console.log('批量修复结果:', result);
   // 输出示例:
   // {
   //   success: true,
   //   message: "修复完成：成功 3 个，失败 0 个",
   //   fixed: 3,
   //   failed: 0,
   //   details: [...]
   // }
   ```

3. **刷新页面**
   - 按 `F5` 或 `Ctrl/Cmd + R` 刷新页面
   - 重新进入项目详情页

### 方法 2: 通过 Node.js 脚本修复

1. **确保应用已关闭**（避免数据库锁）

2. **运行修复脚本**
   ```bash
   cd desktop-app-vue
   node scripts/fix-project-paths.js
   ```

3. **查看输出**
   ```
   ============================================================
   修复项目路径工具
   ============================================================

   找到 5 个项目
   需要修复的项目: 3 个
   ------------------------------------------------------------

   项目: 做一个工作报告 (b3cbcaab-fd91-49a2-92d0-648db0d45f21)
     类型: document
     当前 root_path: null
     ✓ 创建目录: C:\code\chainlesschain\data\projects\b3cbcaab-...
     ✓ 更新 root_path
     找到 1 个文件，开始写入文件系统...
       ✓ 工作报告.docx
     ✓ 项目修复完成

   ============================================================
   ✓ 完成！成功修复 3 个项目
   ============================================================
   ```

4. **重启应用**

### 方法 3: 通过应用 UI 修复（未来）

_计划在项目设置页面添加"修复路径"按钮，一键修复。_

## 验证修复

修复后，检查以下内容：

### 1. 检查日志

重新打开项目，应该看到：
```
[Main] 项目根路径: C:\code\chainlesschain\data\projects\{project-id}
[ProjectDetail] 文件系统监听已启动
```

### 2. 检查文件系统

项目目录应该已创建：
```
C:\code\chainlesschain\data\projects\
  └── {project-id}/
      ├── 文件1.txt
      ├── 文件2.md
      └── ...
```

### 3. 检查数据库

在控制台执行：
```javascript
const project = await window.electronAPI.project.get('your-project-id');
console.log('root_path:', project.root_path);
// 应该输出: C:\code\chainlesschain\data\projects\{project-id}
```

### 4. 测试文件监听

1. 用外部编辑器（如 VS Code）打开项目目录
2. 修改文件并保存
3. 应用界面应该自动刷新显示最新内容

## API 参考

### `window.electronAPI.project.repairRootPath(projectId)`

修复单个项目的 `root_path`。

**参数：**
- `projectId` (string) - 项目 ID

**返回值：**
```javascript
{
  success: true,
  message: "项目已有root_path" | "修复成功",
  rootPath: "C:\\code\\chainlesschain\\data\\projects\\{id}"
}
```

### `window.electronAPI.project.repairAllRootPaths()`

批量修复所有缺少 `root_path` 的项目。

**返回值：**
```javascript
{
  success: true,
  message: "修复完成：成功 3 个，失败 0 个",
  fixed: 3,
  failed: 0,
  details: [
    {
      id: "project-id-1",
      name: "项目名称",
      status: "fixed",
      rootPath: "C:\\code\\..."
    },
    // ...
  ]
}
```

### `window.electronAPI.project.fixPath(projectId)` (新增)

更全面的修复方法，包括：
- 创建项目目录
- 设置 `root_path`
- 将所有文件写入文件系统
- 设置文件的 `fs_path`

**参数：**
- `projectId` (string) - 项目 ID

**返回值：**
```javascript
{
  success: true,
  message: "路径已修复，写入 5 个文件",
  path: "C:\\code\\chainlesschain\\data\\projects\\{id}",
  fileCount: 5
}
```

## 预防措施

为了避免将来再次出现此问题：

1. **新项目创建时自动设置路径** ✅
   - 已在 `project:create` 处理器中实现 (index.js:4818-4841)

2. **定期检查项目完整性**
   - 建议定期运行 `repairAllRootPaths()` 检查

3. **数据库备份**
   - 定期备份 `data/chainlesschain.db`

## 故障排查

### 问题 1: 修复后仍然显示 `undefined`

**解决方法：**
1. 刷新页面（F5）
2. 重启应用
3. 清除缓存：删除 `data/chainlesschain.db-journal`

### 问题 2: 文件未写入文件系统

**可能原因：**
- 文件内容为空
- 权限不足

**解决方法：**
```javascript
const result = await window.electronAPI.project.fixPath('project-id');
console.log('写入文件数:', result.fileCount);
```

### 问题 3: 批量修复失败

**检查日志：**
```javascript
const result = await window.electronAPI.project.repairAllRootPaths();
result.details.forEach(item => {
  if (item.status === 'failed') {
    console.error(`项目 ${item.name} 修复失败:`, item.error);
  }
});
```

## 相关文件

- `src/main/database.js` - 数据库操作（updateProject 方法）
- `src/main/index.js` - IPC 处理器（修复功能）
- `src/preload/index.js` - API 暴露
- `scripts/fix-project-paths.js` - 独立修复脚本

## 联系支持

如果以上方法都无法解决问题，请：
1. 导出项目数据
2. 记录完整错误日志
3. 提交 Issue 到 GitHub

---

**最后更新**: 2025-12-28
