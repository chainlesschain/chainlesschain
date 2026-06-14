# 🚀 ChainlessChain 快速发布指南

> 5 分钟了解如何发布 ChainlessChain

## 📦 最简发布流程（推荐）

```bash
# 1. 安装 GitHub CLI (如果还未安装)
winget install --id GitHub.cli  # Windows
brew install gh                 # macOS
sudo apt install gh             # Linux

# 2. 认证
gh auth login

# 3. 更新版本号
cd desktop-app-vue
npm version 0.21.0 --no-git-tag-version

# 4. 提交并推送
git add package.json
git commit -m "chore: bump version to 0.21.0"
git push origin main

# 5. 创建 tag（GitHub Actions 自动发布）
git tag v0.21.0
git push origin v0.21.0

# ✅ 完成！GitHub Actions 会自动构建并发布所有平台版本
```

查看进度：https://github.com/YOUR_ORG/chainlesschain/actions

## 🎯 三种发布方式

### 1️⃣ GitHub Actions（自动，推荐）

**优点**：全自动，支持所有平台，一致性高

```bash
git tag v0.21.0
git push origin v0.21.0
# 等待 GitHub Actions 完成（20-30分钟）
```

### 2️⃣ 本地脚本（半自动）

**优点**：快速，可控

```bash
npm run release:draft          # 创建草稿发布
npm run release:skip-build     # 跳过构建
npm run release:check          # 发布前检查
```

### 3️⃣ 手动流程（完全控制）

**优点**：完全自定义

```bash
npm run build
npm run make:win
gh release create v0.21.0 --draft
gh release upload v0.21.0 out/make/**/*.zip
```

## 📝 快速命令参考

```bash
# 发布前检查
npm run release:check

# 创建草稿发布
npm run release:draft

# 创建正式发布
npm run release

# 跳过构建（使用已有产物）
npm run release:skip-build

# 构建单个平台
npm run make:win        # Windows
npm run make:mac:x64    # macOS Intel
npm run make:mac:arm64  # macOS Apple Silicon
npm run make:linux:x64  # Linux

# GitHub CLI 命令
gh release list                        # 列出所有发布
gh release view v0.21.0               # 查看发布详情
gh release edit v0.21.0 --draft=false # 发布（移除草稿状态）
gh release delete v0.21.0             # 删除发布
```

## ✅ 发布检查清单

```bash
# 自动检查
npm run release:check

# 手动检查
□ 更新 package.json 版本号
□ 运行测试：npm run test:all
□ 运行构建：npm run build
□ 提交所有更改
□ 创建 git tag
□ 推送到 GitHub
□ 等待 GitHub Actions 完成
□ 测试构建产物
□ 发布 Release（移除草稿）
```

## 🔧 故障排查速查

| 问题                             | 解决方案                                          |
| -------------------------------- | ------------------------------------------------- |
| `gh: command not found`          | 安装 GitHub CLI：`winget install --id GitHub.cli` |
| `HTTP 401: Bad credentials`      | 重新认证：`gh auth login`                         |
| `EPERM: operation not permitted` | 关闭所有 ChainlessChain 实例，删除 `out` 目录     |
| 构建失败                         | `rm -rf out node_modules && npm install`          |
| GitHub Actions 失败              | 查看 Actions 日志，检查 secrets 配置              |

## 📂 构建产物位置

```
desktop-app-vue/out/make/
├── zip/darwin/          # macOS .zip
├── zip/linux/           # Linux .zip
├── zip/win32/           # Windows .zip
├── deb/                 # Linux .deb
├── rpm/                 # Linux .rpm
└── dmg/                 # macOS .dmg
```

## 🎓 版本号规范

遵循[语义化版本](https://semver.org/)：

- **主版本**：`v1.0.0` - 不兼容的 API 修改
- **次版本**：`v0.1.0` - 向下兼容的新功能
- **修订号**：`v0.0.1` - 向下兼容的 bug 修复

特殊版本：

- `v0.21.0-rc.1` - 发布候选
- `v0.21.0-beta.1` - Beta 版
- `v0.21.0-alpha.1` - Alpha 版

## 📚 详细文档

- **完整指南**：[docs/RELEASE_GUIDE.md](docs/RELEASE_GUIDE.md)
- **快速参考**：[desktop-app-vue/RELEASE.md](desktop-app-vue/RELEASE.md)
- **总结文档**：[RELEASE_AUTOMATION_SUMMARY.md](RELEASE_AUTOMATION_SUMMARY.md)

## 🎯 推荐工作流

### 开发版本（频繁）

```bash
npm run release:draft
# 测试后删除或发布
```

### 正式版本（里程碑）

```bash
# 使用 GitHub Actions
git tag v0.21.0
git push origin v0.21.0
```

## 💡 提示

1. ✅ **始终创建草稿发布进行测试**
2. ✅ **使用 GitHub Actions 发布正式版本**
3. ✅ **运行 `npm run release:check` 验证准备状态**
4. ✅ **遵循语义化版本规范**
5. ✅ **编写清晰的发布说明**

## 🆘 获取帮助

```bash
# 查看脚本帮助
node scripts/release.js --help           # Linux/macOS
.\scripts\release.ps1 -Help              # Windows

# 运行检查诊断问题
npm run release:check

# 查看详细文档
cat docs/RELEASE_GUIDE.md
```

---

**快速链接**：

- [GitHub Actions](https://github.com/chainlesschain/chainlesschain/actions)
- [Releases](https://github.com/chainlesschain/chainlesschain/releases)
- [Issues](https://github.com/chainlesschain/chainlesschain/issues)

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：🚀 ChainlessChain 快速发布指南。

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
