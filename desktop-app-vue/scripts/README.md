# Desktop App 脚本工具

桌面应用开发和维护使用的各类脚本工具。

## 📁 目录结构

### 🔍 analysis/ - 分析工具
代码分析、质量检查、性能基准测试

**脚本列表**:
- `analyze-missing-fields.js` - 检查缺失字段
- `analyze-permission-formats.js` - 分析权限格式
- `analyze-skill-system.js` - 技能系统分析
- `analyze-tools-quality.js` - 工具质量分析
- `analyze-unused-tools.js` - 未使用工具分析
- `benchmark-p2-intelligence.js` - P2智能层性能基准
- `ab-test-performance.js` - A/B性能测试
- `adaptive-threshold.js` - 自适应阈值

### 🔨 build/ - 构建脚本
打包、编译、图标生成等构建相关脚本

**脚本列表**:
- `build-main.js` - 构建主进程
- `build-installer.bat` - 构建安装程序（Windows）
- `build-windows-package-standalone.bat` - 独立Windows打包
- `create-icon.js` / `generate-icon.js` - 图标生成
- `convert-icon.js` - 图标转换
- `create-zip.js` / `create-zip-simple.js` - 创建压缩包
- `install-native-messaging.js` - 安装原生消息传递
- `link-hoisted-modules.js` - 链接提升的模块
- 其他构建辅助脚本

### ⚡ performance/ - 性能优化
性能分析和优化工具

**脚本列表**:
- `advanced-optimizer.js` - 高级优化器

### 🛠️ tools/ - 通用工具
修复、应用补丁、数据修复等工具脚本

**脚本列表**:
- `apply-*.js` - 应用各类补丁和示例
- `fix-*.js` - 各类修复脚本
- `comprehensive-fix.js` - 综合修复
- `simple-fix.js` - 简单修复
- `auto-fix-runner.js` - 自动修复运行器
- `check-db-tables.js` - 检查数据库表

### 🧪 testing/ - 测试脚本
已整合到 `tests/` 目录下的单元测试

**说明**: 测试脚本已移至 `tests/unit/` 目录，使用统一的测试框架

## 🚀 常用命令

### 构建应用
```bash
# 构建主进程
node scripts/build/build-main.js

# Windows打包
scripts/build/build-installer.bat
```

### 分析代码
```bash
# 分析技能系统
node scripts/analysis/analyze-skill-system.js

# 质量分析
node scripts/analysis/analyze-tools-quality.js

# 性能基准测试
node scripts/analysis/benchmark-p2-intelligence.js
```

### 修复问题
```bash
# 综合修复
node scripts/tools/comprehensive-fix.js

# 自动修复
node scripts/tools/auto-fix-runner.js

# 数据库修复
node scripts/tools/fix-database-sync.js
```

### 性能优化
```bash
# 高级优化
node scripts/performance/advanced-optimizer.js
```

## 📝 注意事项

1. **权限要求**: 某些脚本可能需要管理员权限
2. **环境依赖**: 确保已安装所需的Node.js模块
3. **数据备份**: 运行修复脚本前请备份数据
4. **Windows脚本**: `.bat` 文件仅在Windows环境运行

## 🔗 相关目录

- **tests/** - 单元测试和集成测试
- **src/main/** - 主进程源代码
- **docs/** - 项目文档

---

**最后更新**: 2026-01-03
