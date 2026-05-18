# desktop-app-vue 根目录组织结构

本文档记录了 desktop-app-vue 根目录的文件组织方式。

## 📁 目录结构

```
desktop-app-vue/
├── .husky/                    # Git hooks 配置
├── .storybook/                # Storybook 配置
├── assets/                    # 静态资源（图标、图片等）
├── browser-extension/         # 浏览器扩展
├── config/                    # 配置文件
├── contracts/                 # 智能合约
├── docs/                      # 📚 所有文档（详见下文）
├── native-messaging/          # 原生消息通信
├── plugins/                   # 插件系统
├── public/                    # 公共静态资源
├── scripts/                   # 构建和工具脚本
├── src/                       # 源代码
├── templates/                 # 模板文件
├── test-auto-mkdir/           # 测试生成目录（git-ignored）
├── test-scripts/              # 性能测试脚本（被 package.json 引用）
├── tests/                     # 测试文件
│   └── fixtures/              # 测试数据和 fixtures
│       ├── data/              # 测试数据（原 test-data/）
│       └── plugin/            # 测试插件（原 test-plugin/）
├── tools/                     # 工具类
├── utils/                     # 工具函数
├── .env.example               # 环境变量示例
├── .env.blockchain.example    # 区块链环境变量示例
├── .gitignore                 # Git 忽略配置
├── .npmrc                     # npm 配置
├── .prettierignore            # Prettier 忽略配置
├── electron-builder.yml       # Electron 构建配置
├── eslint.config.js           # ESLint 配置
├── forge.config.js            # Electron Forge 配置
├── LICENSE                    # 许可证
├── package.json               # 项目配置
├── playwright.config.ts       # Playwright E2E 测试配置
├── start-dev.sh               # 开发启动脚本
├── tsconfig.json              # TypeScript 配置
├── vite.config.js             # Vite 配置
└── vitest.config.ts           # Vitest 测试配置
```

## 📚 docs/ 目录结构

所有文档文件已按主题分类到 `docs/` 子目录：

```
docs/
├── api/                       # API 文档
├── bugfixes/                  # Bug 修复记录
├── deployment/                # 部署相关文档
│   ├── PRODUCTION_BUILD_AND_ESLINT_FIXES.md
│   └── PRODUCTION_DEPLOYMENT_CHECKLIST.md
├── developer-guide/           # 开发者指南
├── features/                  # 功能文档
│   ├── EXTERNAL_DEVICE_FILE_FEATURE.md
│   ├── MCP_POC_QUICKSTART.md
│   └── ...（其他功能文档）
├── fixes/                     # 修复文档
├── guides/                    # 使用指南
├── implementation/            # 实现文档
├── optimization/              # 性能优化文档
│   ├── OPTIMIZATION_PROGRESS_REPORT.md
│   ├── OPTIMIZATION_RECOMMENDATIONS.md
│   ├── OPTIMIZATION_SUMMARY.md（最新版本）
│   └── ...（其他优化文档）
├── project-management/        # 项目管理
├── releases/                  # 发布相关
│   ├── RELEASE.md
│   ├── RELEASE_NOTES_TEMPLATE.md
│   └── RELEASE_NOTES_v0.21.0.md
├── reports/                   # 各类报告
├── security/                  # 安全相关
│   ├── SECURITY.md
│   └── SQL_SECURITY_AUDIT.md
├── status/                    # 状态报告
├── testing/                   # 测试相关
│   ├── ESLINT_AND_TESTING_SUMMARY.md
│   ├── TEST_COVERAGE_PLAN.md
│   ├── TEST_PROGRESS.md
│   ├── TEST_REPORT.md
│   └── ...（其他测试文档）
├── user-guide/                # 用户指南
├── user-guides/               # 用户使用手册
├── FINAL_SUMMARY.md           # 项目总结
├── LOGGER_GUIDE.md            # 日志指南
├── README.md                  # 文档索引
└── TESTING_GUIDELINES.md      # 测试指导
```

## 🎯 整理原则

### 文档文件
- **不放在根目录**：所有 Markdown 文档都应在 `docs/` 的子目录中
- **按主题分类**：文档应按主题分类到对应的子目录
- **避免重复**：发现重复文档时，保留最新、最完整的版本

### 测试文件
- **测试代码**：放在 `tests/` 目录
- **测试数据**：放在 `tests/fixtures/data/`
- **测试 fixtures**：放在 `tests/fixtures/`
- **测试脚本**：
  - 被 `package.json` 引用的脚本保留在 `test-scripts/`
  - 其他测试相关脚本放在 `scripts/` 或 `tests/`
- **临时测试目录**：添加到 `.gitignore`

### 配置文件
- **保留在根目录**：
  - 构建工具配置（vite.config.js, tsconfig.json, etc.）
  - 代码质量工具配置（eslint.config.js, .prettierignore, etc.）
  - 包管理配置（package.json, .npmrc）
  - 环境变量示例（.env.example）
  - Git 配置（.gitignore）

## 📝 维护指南

### 添加新文档时
1. 确定文档类型和主题
2. 放入 `docs/` 下对应的子目录
3. 如果是新类型，创建新的子目录
4. 更新 `docs/README.md` 中的索引

### 添加新测试时
1. 测试代码放在 `tests/` 下对应子目录
2. 测试数据放在 `tests/fixtures/data/`
3. 测试 fixtures 放在 `tests/fixtures/`

### Git 忽略规则
需要忽略的测试生成目录：
```gitignore
# Test generated directories
test-auto-mkdir/
```

## 🔄 整理历史

### 2026-01-26
- 移动 11 个文档文件到 `docs/` 子目录
- 删除 `OPTIMIZATION_SUMMARY.md`（根目录旧版本）
- 移动 `test-data/` -> `tests/fixtures/data/`
- 移动 `test-plugin/` -> `tests/fixtures/plugin/`
- 添加 `test-auto-mkdir/` 到 `.gitignore`
- 创建整理脚本 `scripts/organize-root.sh`

## 🛠️ 整理工具

使用 `scripts/organize-root.sh` 可以自动整理根目录文件。

```bash
cd desktop-app-vue
bash scripts/organize-root.sh
```

## 📋 核心文件清单

根目录应保留的核心文件：
- ✅ package.json
- ✅ 构建配置（vite.config.js, electron-builder.yml, forge.config.js）
- ✅ 代码质量配置（eslint.config.js, .prettierignore）
- ✅ TypeScript 配置（tsconfig.json）
- ✅ 测试配置（vitest.config.ts, playwright.config.ts）
- ✅ 环境变量示例（.env.example, .env.blockchain.example）
- ✅ Git 配置（.gitignore）
- ✅ LICENSE
- ✅ 开发脚本（start-dev.sh）
- ✅ npm 配置（.npmrc）

根目录 **不应** 有：
- ❌ 散落的 Markdown 文档
- ❌ 测试数据文件
- ❌ 临时测试目录（应在 .gitignore 中）
