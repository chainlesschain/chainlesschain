# 工具脚本目录

本目录包含开发和维护过程中使用的各类工具脚本（59个）。

## 📁 目录结构

### 🔧 fix/ - 修复工具（6个）
用于修复数据库、模板、工具引用等问题

**脚本列表**:
- `fix-all-tool-references.js` - 修复所有工具引用
- `fix-encrypted-db-templates.js` - 修复加密数据库模板
- `fix-missing-root-path.js` - 修复缺失的根路径
- `fix-template-prompt.js` - 修复模板提示
- `fix-tests.js` - 修复测试
- `fix-tool-references.js` - 修复工具引用

### 🔍 check/ - 检查工具（10个）
用于检查数据库状态、配置、重复项等

**脚本列表**:
- `check-all-tables.js` - 检查所有数据库表
- `check-and-fix-llm-db-settings.js` - 检查并修复LLM数据库设置
- `check-database.js` - 检查数据库
- `check-db-data.js` - 检查数据库数据
- `check-db-schema.js` - 检查数据库架构
- `check-duplicates.js` - 检查重复项
- `check-llm-db-config-simple.js` - 简单LLM数据库配置检查
- `check-projects.js` - 检查项目状态
- `check-template-categories.js` - 检查模板分类
- `check-template-in-db.js` - 检查数据库中的模板

### 📝 apply/ - 应用工具（6个）
用于应用示例、权限、补丁等

**脚本列表**:
- `apply-enhanced-examples.js` - 应用增强示例
- `apply-enhanced-examples-safe.js` - 安全应用增强示例
- `apply-examples.js` - 应用示例
- `apply-low-freq-examples.js` - 应用低频示例
- `apply-mid-freq-examples.js` - 应用中频示例
- `apply-permissions.js` - 应用权限

### 🔄 migration/ - 迁移工具（8个）
用于数据库迁移和版本升级

**脚本列表**:
- `run-migration.js` - 运行迁移
- `run-migration-005.js` - 运行005迁移
- `run-migration-intelligence-layer.js` - 运行智能层迁移
- `run-migration-p1.js` - 运行P1迁移
- `run-migration-p2.js` - 运行P2迁移
- `run-migration-p2-extended.js` - 运行P2扩展迁移
- `run-migration-user-feedback.js` - 运行用户反馈迁移
- `rollback-005.js` - 回滚005迁移
- `rollback-p1.js` - 回滚P1迁移

### 🛠️ test-utils/ - 测试辅助工具（29个）
用于测试准备、验证、数据生成等

**主要功能**:
- **验证工具**: `verify-*.js` - 验证迁移、模板、权限、部署等
- **识别工具**: `identify-*.js` - 识别高频/中频/低频工具
- **更新工具**: `update-*.js` - 更新内置技能、视频分类等
- **启用工具**: `enable-*.js` - 启用虚拟树等功能
- **数据工具**: `insert-*.js`、`fill-*.js` - 插入和填充数据
- **查找工具**: `find-*.js` - 查找重复项、重复行等
- **优化工具**: `improve-*.js` - 改进工具覆盖率
- **清理工具**: `remove-*.js`、`unify-*.js`、`cleanup-*.js`
- **恢复工具**: `recover-*.js`、`reset-*.js`
- **其他**: `add-*.js`、`patch-*.js`、`force-*.js`、`debug-*.js`

## 🚀 常用命令

### 修复问题
```bash
# 修复工具引用
node tools/fix/fix-all-tool-references.js

# 修复数据库模板
node tools/fix/fix-encrypted-db-templates.js
```

### 检查状态
```bash
# 检查数据库
node tools/check/check-database.js

# 检查所有表
node tools/check/check-all-tables.js

# 检查模板
node tools/check/check-template-in-db.js
```

### 应用配置
```bash
# 应用示例
node tools/apply/apply-examples.js

# 应用权限
node tools/apply/apply-permissions.js
```

### 数据库迁移
```bash
# 运行迁移
node tools/migration/run-migration.js

# 回滚迁移
node tools/migration/rollback-p1.js
```

### 验证和测试
```bash
# 验证部署
node tools/test-utils/verify-deployment.js

# 验证模板依赖
node tools/test-utils/verify-template-dependencies.js
```

## 📝 注意事项

1. **数据备份**: 运行修复和迁移脚本前务必备份数据
2. **环境要求**: 确保数据库服务正在运行
3. **权限检查**: 某些脚本需要数据库写权限
4. **日志记录**: 注意查看脚本输出的日志信息

## 🔗 相关目录

- **test-scripts/** - 测试脚本
- **scripts/** - 构建和分析脚本
- **data/reports/** - 工具生成的报告

---

**最后更新**: 2026-01-03
