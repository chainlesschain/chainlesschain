# E2E测试命令参考 🚀

> 快速查找所有可用命令和工具

---

## 📌 最常用命令

```bash
# 健康检查（推荐首次运行）
npm run test:e2e:health

# 运行所有模块测试
npm run test:e2e:all

# 快速验证（11个代表性测试）
npm run test:e2e:quick

# 生成HTML报告
npm run test:e2e:report

# UI交互模式（最佳调试体验）
npm run test:e2e:ui
```

---

## 🔧 所有NPM脚本

### 新增的E2E工具命令

| 命令 | 说明 | 执行时间 |
|-----|------|---------|
| `npm run test:e2e:health` | 环境健康检查 | ~2分钟 |
| `npm run test:e2e:check` | 文件结构检查 | ~5秒 |
| `npm run test:e2e:quick` | 快速验证（11个测试） | ~30-40分钟 |
| `npm run test:e2e:all` | 运行所有模块 | ~60-90分钟 |
| `npm run test:e2e:report` | 生成HTML报告 | ~5秒 |

### 标准Playwright命令

| 命令 | 说明 |
|-----|------|
| `npm run test:e2e` | 运行所有E2E测试 |
| `npm run test:e2e:ui` | UI交互模式 |

---

## 📁 按模块运行测试

```bash
# 知识管理（6个文件）
npm run test:e2e -- tests/e2e/knowledge/

# 社交网络（7个文件）
npm run test:e2e -- tests/e2e/social/

# 项目管理（7个文件）
npm run test:e2e -- tests/e2e/project/

# 系统设置（7个文件）
npm run test:e2e -- tests/e2e/settings/

# 系统监控（8个文件）
npm run test:e2e -- tests/e2e/monitoring/

# 交易市场（7个文件）
npm run test:e2e -- tests/e2e/trading/

# 企业版（8个文件）
npm run test:e2e -- tests/e2e/enterprise/

# 开发工具（2个文件）
npm run test:e2e -- tests/e2e/devtools/

# 内容聚合（5个文件）
npm run test:e2e -- tests/e2e/content/

# 插件生态（3个文件）
npm run test:e2e -- tests/e2e/plugins/

# 多媒体（2个文件）
npm run test:e2e -- tests/e2e/multimedia/
```

---

## 🎯 使用场景指南

### 场景1: 首次使用

```bash
# 步骤1: 检查环境
npm run test:e2e:health

# 步骤2: 如果主进程未构建
npm run build:main

# 步骤3: 运行快速验证
npm run test:e2e:quick

# 步骤4: 生成报告查看结果
npm run test:e2e:report
```

### 场景2: 日常开发

```bash
# 只测试你修改的模块
npm run test:e2e -- tests/e2e/<your-module>/

# 或使用UI模式实时查看
npm run test:e2e:ui
```

### 场景3: PR提交前

```bash
# 完整测试所有模块
npm run test:e2e:all

# 生成报告
npm run test:e2e:report
```

### 场景4: 调试失败测试

```bash
# UI模式（推荐）
npm run test:e2e:ui

# 或显示浏览器窗口
npm run test:e2e -- <path> --headed

# 或调试模式
npm run test:e2e -- <path> --debug
```

---

## 🔍 Playwright高级选项

### 显示选项

```bash
# 显示浏览器窗口
npm run test:e2e -- <path> --headed

# 调试模式（暂停执行）
npm run test:e2e -- <path> --debug
```

### 性能选项

```bash
# 并行运行（3个worker）
npm run test:e2e -- <path> --workers=3

# 重试失败测试
npm run test:e2e -- <path> --retries=2

# 增加超时时间
npm run test:e2e -- <path> --timeout=90000
```

### 过滤选项

```bash
# 只运行匹配的测试
npm run test:e2e -- <path> --grep "应该能够访问"

# 排除某些测试
npm run test:e2e -- <path> --grep-invert "跳过"
```

### 输出选项

```bash
# 生成trace文件
npm run test:e2e -- <path> --trace on

# 录制视频
npm run test:e2e -- <path> --video on

# 截图
npm run test:e2e -- <path> --screenshot only-on-failure
```

---

## 📊 测试模块统计

| 模块 | 文件数 | 状态 | 通过率 |
|-----|-------|------|--------|
| 知识管理 | 6 | ✅ | 100% |
| 社交网络 | 7 | ✅ | 100% |
| 项目管理 | 7 | ✅ | 100% |
| 系统设置 | 7 | ✅ | 100% |
| 系统监控 | 8 | ✅ | 100% |
| 交易市场 | 7 | ✅ | 100% |
| 多媒体 | 2 | ✅ | 100% |
| 企业版 | 8 | ✅ | 100% |
| 开发工具 | 2 | ✅ | 100% |
| 内容聚合 | 5 | ✅ | 100% |
| 插件生态 | 3 | ✅ | 100% |
| **总计** | **62** | **✅** | **100%** |

---

## 🛠️ 直接运行脚本

如果不想用npm脚本，可以直接运行：

```bash
cd desktop-app-vue

# 健康检查
node tests/e2e/health-check.js

# 批量运行所有模块
node tests/e2e/run-all-modules.js

# 快速验证
node tests/e2e/quick-validation.js

# 生成报告
node tests/e2e/generate-report.js

# 文件检查
node tests/e2e/quick-check.js
```

---

## 📚 文档快速链接

| 文档 | 用途 | 详细程度 |
|-----|------|---------|
| **USER_GUIDE.md** | 使用指南 | ⭐⭐⭐⭐⭐ |
| **FINAL_100_PERCENT_REPORT.md** | 完整报告 | ⭐⭐⭐⭐⭐ |
| **COMPLETION_SUMMARY.md** | 项目总结 | ⭐⭐⭐⭐ |
| **COMPLETE_VALIDATION_REPORT.md** | 验证报告 | ⭐⭐⭐⭐ |
| **COMMANDS_REFERENCE.md** | 命令参考 | ⭐⭐⭐ |

---

## 🚨 常见问题解决

### ❌ 测试超时

```bash
# 方法1: 增加超时
npm run test:e2e -- <path> --timeout=120000

# 方法2: 在测试文件中增加超时
test('name', async () => { ... }, { timeout: 90000 })
```

### ❌ 主进程未构建

```bash
npm run build:main
```

### ❌ 环境问题

```bash
npm run test:e2e:health
```

### ❌ 依赖问题

```bash
cd desktop-app-vue
npm install
```

---

## ⚡ 速记卡

```bash
health  → npm run test:e2e:health   # 检查环境
all     → npm run test:e2e:all      # 运行所有
quick   → npm run test:e2e:quick    # 快速验证
report  → npm run test:e2e:report   # 生成报告
ui      → npm run test:e2e:ui       # UI模式
```

---

## 🎓 最佳实践

### ✅ 推荐做法

1. **开始前**: 运行 `npm run test:e2e:health`
2. **开发时**: 使用 `npm run test:e2e:ui` 调试
3. **修改后**: 运行相关模块测试
4. **PR前**: 运行 `npm run test:e2e:all`
5. **完成后**: 运行 `npm run test:e2e:report`

### ❌ 避免做法

1. 不要在不同窗口同时运行多个测试（Electron冲突）
2. 不要跳过健康检查直接运行测试
3. 不要忽略失败的测试（立即修复或报告）
4. 不要在CI中运行全部测试（分批运行）

---

## 📞 获取帮助

1. 查看 `USER_GUIDE.md` 获取详细指南
2. 查看 `FINAL_100_PERCENT_REPORT.md` 了解完整功能
3. 运行 `npm run test:e2e:health` 检查环境问题

---

**版本**: 1.0.0
**更新**: 2026-01-25
**状态**: ✅ 生产就绪

🎯 **记住**: `health` 检查环境, `quick` 快速验证, `all` 完整测试, `ui` 调试利器!
