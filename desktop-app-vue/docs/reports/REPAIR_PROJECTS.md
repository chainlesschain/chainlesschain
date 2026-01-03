# 修复项目 root_path 指南

## 问题
你的数据库中还有项目的 `root_path` 为 `null` 或 `undefined`，导致无法加载文件列表。

## 快速修复方法

### 方法 1：批量修复所有项目（推荐）

1. **启动应用**
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

2. **打开开发者工具**
   - 按 `F12` 键

3. **在 Console 标签中运行以下命令**
   ```javascript
   await window.electronAPI.project.repairAllRootPaths()
   ```

4. **查看结果**
   命令会返回类似这样的结果：
   ```javascript
   {
     success: true,
     message: "修复完成：成功 5 个，失败 0 个",
     fixed: 5,
     failed: 0,
     details: [
       {
         id: "b3cbcaab-fd91-49a2-92d0-648db0d45f21",
         name: "项目名称",
         status: "fixed",
         rootPath: "C:\\code\\chainlesschain\\data\\projects\\b3cbcaab-..."
       },
       // ... 更多项目
     ]
   }
   ```

### 方法 2：修复单个项目

如果只想修复特定项目（如 `b3cbcaab-fd91-49a2-92d0-648db0d45f21`）：

```javascript
await window.electronAPI.project.repairRootPath('b3cbcaab-fd91-49a2-92d0-648db0d45f21')
```

## 验证修复是否成功

修复后，刷新项目页面，应该能看到文件列表了。

## 为什么会出现这个问题？

这是之前版本的 bug：
- 创建 document 类型项目时，如果没有文件，`root_path` 不会被设置
- 现在的版本已经修复了这个问题
- 新创建的项目不会再有这个问题

## 修复原理

修复工具会：
1. 扫描数据库找出所有 `root_path` 为空的 document 项目
2. 为每个项目创建目录：`data/projects/[项目ID]`
3. 更新数据库中的 `root_path` 字段

## 需要帮助？

如果修复失败，请检查：
1. 应用是否有权限创建目录
2. `data/projects/` 目录是否存在
3. 磁盘空间是否充足

---

💡 **提示**: 修复是安全的，不会删除或修改任何现有文件。
