# 配置文件目录

本目录包含应用的各类配置文件。

## 📁 目录结构

### 🎨 installers/ - 安装程序配置（2个ISS文件）
Inno Setup安装程序脚本

**文件列表**:
- `installer.iss` - 标准安装程序配置（10KB）
- `installer-standalone.iss` - 独立安装程序配置（7KB）

### 🗄️ 数据库配置
- `fix-database-sync-fields.sql` - 数据库同步字段修复脚本

### 🔧 electron-vite/ - 构建配置
Electron Vite构建配置（如果存在）

## 📋 配置文件说明

### installer.iss
Inno Setup标准安装程序配置，包含：
- 应用程序信息（名称、版本、发布者）
- 安装路径设置
- 文件包含规则
- 快捷方式创建
- 卸载配置

### installer-standalone.iss
独立安装程序配置，特点：
- 单文件打包
- 便携式部署
- 无需安装程序
- 适合企业分发

### fix-database-sync-fields.sql
数据库维护SQL脚本：
- 添加同步字段
- 修复字段约束
- 更新表结构

## 🚀 使用方法

### 构建Windows安装程序
```bash
# 使用标准配置
iscc config/installers/installer.iss

# 使用独立配置
iscc config/installers/installer-standalone.iss
```

### 应用数据库修复
```bash
# 在SQLite中执行
sqlite3 data/chainlesschain.db < config/fix-database-sync-fields.sql

# 或在代码中执行
# 参见 src/main/database.js
```

## ⚙️ 相关配置文件

### 根目录配置
- `electron-builder.yml` - Electron Builder打包配置
- `forge.config.js` - Electron Forge配置
- `vite.config.js` - Vite构建配置
- `vitest.config.ts` - Vitest测试配置
- `playwright.config.ts` - Playwright E2E测试配置

### 环境配置
- `.env.example` - 环境变量示例
- `.env.production` - 生产环境配置
- `.env.p2-development` - P2开发环境配置
- `.env.p2-production` - P2生产环境配置

## 📝 注意事项

1. **ISS文件**: 需要安装 Inno Setup 编译器
2. **SQL脚本**: 执行前备份数据库
3. **环境变量**: 不要提交 `.env` 文件到Git
4. **版本同步**: 更新版本时同步修改所有配置文件

## 🔗 相关文档

- **scripts/build/** - 构建脚本
- **utils/build/** - 构建工具
- **docs/deployment/** - 部署文档

---

**最后更新**: 2026-01-03
