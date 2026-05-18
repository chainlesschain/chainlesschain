# 🔧 初始化问题快速修复参考

## 📋 问题概述

应用启动时出现多个"未初始化"错误，导致模板、组织、项目等功能无法正常使用。

## ✅ 已修复内容

### 1. TemplateManager 初始化错误
- **文件**: `src/main/bootstrap/core-initializer.js:111`
- **修复**: `context.database` → `context.database.db`
- **影响**: 模板加载、项目模板功能

### 2. OrganizationManager 初始化错误
- **文件**: `src/main/bootstrap/social-initializer.js:146`
- **修复**: `context.database` → `context.database.db`
- **影响**: 组织邀请、企业功能

## 🚀 快速验证（3步）

```bash
# 1. 停止应用
taskkill /F /IM electron.exe

# 2. 已构建完成，直接启动
cd desktop-app-vue
npm run dev

# 3. 检查日志
# 应该看到: ✓ TemplateManager initialized successfully
# 应该看到: ✓ OrganizationManager initialized successfully
```

## 🎯 期望结果

### ✅ 成功标志
- Console 显示: `[Bootstrap] ✓ TemplateManager initialized successfully`
- Console 显示: `[Bootstrap] ✓ OrganizationManager initialized successfully`
- 项目页面正常加载
- 模板列表可以打开
- 组织邀请功能正常

### ❌ 不应出现的错误
- ~~模板管理器未初始化~~
- ~~组织管理器未初始化~~
- ~~Failed to load projects~~
- ~~Failed to load templates~~
- ~~加载待处理邀请失败~~

## 📁 修改的文件

1. `src/main/bootstrap/core-initializer.js` (行 108-121)
2. `src/main/bootstrap/social-initializer.js` (行 143-165)

## 🔍 根本原因

- **问题**: 某些管理器需要原始 SQLite `db` 对象
- **错误**: Bootstrap 传递了 `DatabaseManager` 包装器
- **修复**: 传递 `database.db` 而不是 `database`

## 📚 相关文档

- 详细说明: `INITIALIZATION_FIX_SUMMARY.md`
- 验证指南: `VERIFICATION_GUIDE.md`

## 💡 故障排除

### 如果仍有问题:

1. **重新构建**:
   ```bash
   npm run build:main
   ```

2. **清理缓存**:
   ```bash
   del data\chainlesschain.db-wal
   del data\chainlesschain.db-shm
   ```

3. **检查构建**:
   ```bash
   grep "context.database.db" dist/main/bootstrap/core-initializer.js
   ```

## 📞 获取帮助

如果问题持续存在，请提供:
- Console 日志（F12 → Console 标签）
- 错误截图
- `npm run dev` 的完整输出

---

**状态**: ✅ 已修复并构建
**构建时间**: 2026-02-04
**验证**: 待用户确认
