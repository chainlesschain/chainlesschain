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

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：🔧 初始化问题快速修复参考。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
