# 脚本工具目录

本目录包含项目的各类脚本工具，已按功能分类整理。

## 📁 目录结构

### 🗄️ database/
数据库和数据管理相关脚本（11个文件）

**数据库检查**:
- `check-db-schema.js` - 检查数据库架构
- `check-json-errors.js` - 检查JSON错误

**数据导入**:
- `import-all-builtin-data.js` - 导入所有内置数据
- `import-missing-templates.js` - 导入缺失的模板
- `debug-import.js` - 调试导入过程
- `verify-builtin-data.js` - 验证内置数据

**数据修复**:
- `fix-json-manually.js` - 手动修复JSON
- `fix-json-precise.py` - 精确修复JSON（Python）
- `fix-remaining-json.js` - 修复剩余JSON问题
- `inspect-json-error.js` - 检查JSON错误详情

**测试数据**:
- `test-sync-data.json` - 同步测试数据

### 🔨 build/
构建和启动相关脚本（7个文件）

**Windows打包**:
- `build-windows-package.bat` - Windows打包脚本（批处理）
- `build-windows-package.sh` - Windows打包脚本（Shell）

**服务启动**:
- `start-chromadb.bat` - 启动ChromaDB
- `start-cloud.bat` - 启动云端服务（Windows）
- `start-cloud.sh` - 启动云端服务（Shell）
- `restart-project-service.bat` - 重启项目服务

**工具**:
- `install.bat` - 安装脚本（在上级目录）
- `open-latest-word.bat` - 打开最新Word文档

### 🧪 test/
测试相关脚本（4个文件）

**RAG测试**:
- `test-rag.js` - RAG功能测试
- `verify-rag-advanced.js` - 高级RAG验证
- `verify-rag-fix.js` - RAG修复验证

**其他测试**:
- `test_ppt_generation.py` - PPT生成测试（Python）

### 🛠️ utils/
通用工具脚本（4个文件）

**项目检查**:
- `check-projects.js` - 检查项目状态

**模板管理**:
- `fix-failed-templates.js` - 修复失败的模板
- `fix-template-category-constraint.js` - 修复模板分类约束

**文档工具**:
- `extract_docs.py` - 提取文档（Python）

### 📋 根级脚本
- `run-ipc-tests.js` - 运行IPC测试

## 📊 统计信息

- **总脚本数**: 26个
- **JavaScript**: 19个
- **Python**: 3个
- **批处理**: 4个
- **Shell**: 2个
- **数据文件**: 1个

## 🚀 常用命令

### 数据管理
```bash
# 导入内置数据
node scripts/database/import-all-builtin-data.js

# 检查数据库架构
node scripts/database/check-db-schema.js

# 验证数据
node scripts/database/verify-builtin-data.js
```

### 构建和部署
```bash
# Windows打包
./scripts/build/build-windows-package.sh

# 启动云端服务
./scripts/build/start-cloud.sh
```

### 测试
```bash
# RAG测试
node scripts/test/test-rag.js

# IPC测试
node scripts/run-ipc-tests.js
```

## 📝 注意事项

1. **Windows脚本** (.bat): 仅在Windows环境下运行
2. **Shell脚本** (.sh): 在macOS/Linux下运行，Windows需要Git Bash或WSL
3. **Python脚本**: 需要Python环境，建议Python 3.8+
4. **数据脚本**: 运行前请备份数据库

---

**最后更新**: 2026-01-03
