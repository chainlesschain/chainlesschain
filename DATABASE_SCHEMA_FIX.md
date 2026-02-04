# 数据库 Schema 错误修复指南

## 🔥 问题描述

```
Error: no such column: is_folder
```

应用尝试查询 `project_files` 表的 `is_folder` 列，但您的数据库是旧版本，缺少这个列。

---

## 🎯 快速修复（推荐）

### 方法 1: 使用自动化脚本

1. **关闭应用**（如果正在运行）

2. **运行重置脚本**:
   ```cmd
   reset-database.bat
   ```

3. **按提示操作**:
   - 脚本会自动备份旧数据库
   - 输入 `YES` 确认删除
   - 等待完成

4. **重启应用**:
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

应用会自动创建新的数据库，包含所有最新的列。

---

### 方法 2: 手动操作

如果脚本无法运行，请手动执行：

#### 步骤 1: 找到数据库文件

```
C:\Users\admin\AppData\Roaming\chainlesschain-desktop-vue\data\chainlesschain.db
```

#### 步骤 2: 备份数据库

```cmd
cd %APPDATA%\chainlesschain-desktop-vue\data
ren chainlesschain.db chainlesschain.db.backup
```

#### 步骤 3: 重启应用

应用会自动创建新数据库。

---

## 📋 完整的数据库 Schema 问题列表

本次会话中遇到的所有数据库 Schema 不匹配问题：

| 错误 | 缺失的列 | 所属表 | 状态 |
|------|----------|--------|------|
| 1 | `owner_did` | `projects` | ✅ 已通过重建数据库修复 |
| 2 | `is_folder` | `project_files` | 🔄 当前问题 |

---

## 🔍 为什么会出现这个问题？

### 原因分析

1. **代码更新**:
   - 代码添加了新功能（文件夹支持）
   - 新功能需要 `is_folder` 列

2. **数据库未更新**:
   - 您的数据库是旧版本创建的
   - 自动迁移逻辑可能未执行或执行失败

3. **Schema 不匹配**:
   - 代码期望：`SELECT ... is_folder FROM project_files`
   - 数据库实际：表中没有 `is_folder` 列
   - 结果：SQL 查询失败

---

## 🛠️ 迁移逻辑说明

数据库代码包含自动迁移逻辑（`database.js` line 3556-3561）：

```javascript
if (!filesSyncInfo.some((col) => col.name === "is_folder")) {
  logger.info("[Database] 添加 project_files.is_folder 列");
  this.db.run(
    "ALTER TABLE project_files ADD COLUMN is_folder INTEGER DEFAULT 0",
  );
}
```

这个逻辑应该在应用启动时自动添加缺失的列，但可能因为以下原因失败：
- 数据库锁定
- 权限问题
- 初始化顺序问题

---

## 🎓 Schema 定义参考

### `project_files` 表完整定义

```sql
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER DEFAULT 0,
  content TEXT,
  content_hash TEXT,
  version INTEGER DEFAULT 1,
  fs_path TEXT,
  is_folder INTEGER DEFAULT 0,          -- ⭐ 这个列
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  synced_at INTEGER,
  device_id TEXT,
  deleted INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

---

## ✅ 验证修复

### 1. 检查数据库表结构

重启应用后，在开发者工具 Console 中运行：

```javascript
// 这个命令不会直接工作，但应用启动日志会显示：
// [Database] ✓ 所有表和索引创建成功
```

### 2. 查看启动日志

正确的启动日志应该包含：

```
[INFO] [Database] ✓ 所有表和索引创建成功
[INFO] [Database] Database initialized successfully
```

### 3. 测试项目文件加载

- 打开任意项目详情页
- 应该**不再出现** `no such column: is_folder` 错误
- 文件列表应该正常显示（即使为空）

---

## ⚠️ 注意事项

### 数据丢失

重建数据库会导致**所有本地数据丢失**：
- ✅ **会丢失**: 本地创建的项目、笔记、聊天记录
- ✅ **已备份**: 旧数据库备份为 `.backup` 文件
- ⚠️ **建议**: 定期备份重要数据

### 恢复旧数据

如果需要恢复旧数据：

```cmd
cd %APPDATA%\chainlesschain-desktop-vue\data
del chainlesschain.db
ren chainlesschain.db.backup chainlesschain.db
```

但恢复后仍会遇到 Schema 问题。

### 正确的升级方式

未来应该实现：
1. **版本检测**: 记录数据库 Schema 版本号
2. **自动迁移**: 启动时自动执行所有缺失的迁移
3. **迁移日志**: 记录迁移历史
4. **回滚支持**: 支持迁移失败时回滚

---

## 🚀 长期解决方案

为避免将来出现类似问题，建议实现以下功能：

### 1. Schema 版本管理

```javascript
// database-migrations.js
const MIGRATIONS = [
  {
    version: 1,
    up: (db) => {
      db.run("ALTER TABLE projects ADD COLUMN owner_did TEXT");
    },
  },
  {
    version: 2,
    up: (db) => {
      db.run("ALTER TABLE project_files ADD COLUMN is_folder INTEGER DEFAULT 0");
    },
  },
];
```

### 2. 启动时自动迁移

```javascript
async function runMigrations(db) {
  const currentVersion = db.prepare("PRAGMA user_version").get().user_version;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      logger.info(`[Migration] Running migration ${migration.version}`);
      migration.up(db);
      db.run(`PRAGMA user_version = ${migration.version}`);
    }
  }
}
```

### 3. 数据库备份功能

在应用设置中添加：
- 手动备份按钮
- 自动备份（每周/每月）
- 导出/导入功能

---

## 📚 相关文档

- `FINAL_VERIFICATION_REPORT.md` - 首次 Schema 问题修复（`owner_did`）
- `COMPLETE_FIX_SUMMARY.md` - 所有修复总结
- `LOAD_PROJECT_FILES_ERROR_FIX.md` - 文件加载错误修复

---

## 🆘 故障排除

### 问题 1: 脚本报错"找不到文件"

**原因**: 数据库路径可能不同

**解决**:
1. 在应用中检查实际的数据库路径
2. 手动导航到该路径执行备份和删除

### 问题 2: 删除失败"文件正在使用"

**原因**: 应用仍在运行

**解决**:
1. 完全关闭应用（包括任务栏图标）
2. 检查任务管理器，结束相关进程
3. 重新运行脚本

### 问题 3: 新数据库仍然报错

**原因**: 代码未正确构建

**解决**:
```bash
cd desktop-app-vue
npm run build:main
npm run dev
```

---

## ✅ 总结

**当前状态**: 🔴 数据库 Schema 不匹配

**修复步骤**:
1. ✅ 运行 `reset-database.bat`
2. ✅ 输入 `YES` 确认
3. ✅ 重启应用 (`npm run dev`)
4. ✅ 验证无错误

**预期结果**: 🟢 项目文件正常加载，无 `is_folder` 错误

---

**修复日期**: 2026-02-04
**修复人**: Claude (Sonnet 4.5)
**文档版本**: v1.0
**最后更新**: 2026-02-04 17:05 (UTC+8)
