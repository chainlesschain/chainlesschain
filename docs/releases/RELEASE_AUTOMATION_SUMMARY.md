# ChainlessChain Release Automation - Setup Summary

本文档总结了为 ChainlessChain 项目创建的完整发布自动化系统。

## 📁 创建的文件

### 1. 自动化脚本

#### `.github/workflows/release.yml`

**GitHub Actions 工作流** - 多平台自动构建和发布

- **功能**：在云端自动构建 Windows、macOS (x64/arm64)、Linux 版本
- **触发方式**：
  - 推送 tag (`v*.*.*` 格式)
  - 手动触发（workflow_dispatch）
- **优点**：
  - 无需本地多平台环境
  - 一致的构建环境
  - 自动化程度最高
  - 内置构建产物上传

#### `desktop-app-vue/scripts/release.js`

**Node.js 发布脚本** - 跨平台本地发布工具

- **功能**：
  - 检查 GitHub CLI 和认证状态
  - 构建所有平台（可选）
  - 收集构建产物
  - 自动生成发布说明
  - 创建 GitHub Release
  - 上传构建产物
- **使用**：
  ```bash
  node scripts/release.js [options]
  npm run release:draft  # 快捷方式
  ```
- **选项**：
  - `--version <version>` - 指定版本
  - `--draft` - 创建草稿发布
  - `--prerelease` - 标记为预发布
  - `--notes <file>` - 使用自定义发布说明
  - `--skip-build` - 跳过构建

#### `desktop-app-vue/scripts/release.ps1`

**PowerShell 发布脚本** - Windows 原生发布工具

- **功能**：与 release.js 相同，但使用 PowerShell
- **使用**：
  ```powershell
  .\scripts\release.ps1 -Draft
  .\scripts\release.ps1 -Version v0.21.0
  ```
- **优点**：
  - Windows 原生体验
  - 彩色输出
  - 更好的 Windows 集成

#### `desktop-app-vue/scripts/pre-release-check.js`

**发布前检查脚本** - 验证发布准备就绪

- **功能**：
  - 验证版本号
  - 检查 Git 状态
  - 验证依赖安装
  - 检查构建产物
  - 安全审计
  - GitHub CLI 认证检查
  - 生成检查报告
- **使用**：
  ```bash
  node scripts/pre-release-check.js [version]
  npm run release:check  # 快捷方式
  ```

### 2. 文档

#### `docs/RELEASE_GUIDE.md`

**完整发布指南** - 详细的发布流程文档

- **内容**：
  - 三种发布方法（GitHub Actions、本地脚本、手动）
  - 版本管理规范
  - 构建产物说明
  - 故障排查指南
  - CI/CD 集成说明
  - 完整的命令参考

#### `desktop-app-vue/RELEASE.md`

**快速发布指南** - 精简的快速参考

- **内容**：
  - 快速发布流程
  - 常用命令速查
  - 安装 GitHub CLI
  - 故障排查快速参考
  - 版本号规范

#### `desktop-app-vue/RELEASE_NOTES_TEMPLATE.md`

**发布说明模板** - 标准化的发布说明格式

- **内容**：
  - 新功能列表
  - Bug 修复
  - 改进项
  - 破坏性变更
  - 安装说明
  - 系统要求
  - 校验和
  - 快速开始指南

### 3. 配置更新

#### `desktop-app-vue/package.json`

**新增 npm 脚本**：

```json
{
  "scripts": {
    "release": "node scripts/release.js",
    "release:draft": "node scripts/release.js --draft",
    "release:skip-build": "node scripts/release.js --skip-build",
    "release:check": "node scripts/pre-release-check.js"
  }
}
```

## 🚀 推荐发布流程

### 方法一：GitHub Actions（最推荐）

```bash
# 1. 更新版本
cd desktop-app-vue
npm version 0.21.0 --no-git-tag-version

# 2. 运行发布前检查
npm run release:check

# 3. 提交更改
git add package.json
git commit -m "chore: bump version to 0.21.0"
git push origin main

# 4. 创建并推送 tag
git tag v0.21.0
git push origin v0.21.0

# 5. GitHub Actions 自动完成剩余步骤
# 访问 https://github.com/YOUR_ORG/chainlesschain/actions 查看进度
```

### 方法二：本地脚本发布

```bash
# 1. 发布前检查
cd desktop-app-vue
npm run release:check

# 2. 创建草稿发布
npm run release:draft

# 3. 测试构建产物

# 4. 发布正式版本
gh release edit v0.21.0 --draft=false
```

## 📋 完整发布检查清单

使用自动化检查脚本：

```bash
npm run release:check
```

手动检查清单：

- [ ] 更新版本号 (package.json)
- [ ] 更新 CHANGELOG.md
- [ ] 运行所有测试：`npm run test:all`
- [ ] 运行安全审计：`npm audit`
- [ ] 构建验证：`npm run build`
- [ ] 发布前检查：`npm run release:check`
- [ ] 创建 git tag
- [ ] GitHub Actions 构建通过
- [ ] 测试所有平台的构建产物
- [ ] 验证自动更新功能
- [ ] 更新文档

## 🛠️ 工具安装

### GitHub CLI

```bash
# Windows
winget install --id GitHub.cli

# macOS
brew install gh

# Linux (Debian/Ubuntu)
sudo apt install gh

# 认证
gh auth login
```

### 验证安装

```bash
gh --version
gh auth status
node --version  # 需要 22.12.0+
npm --version   # 需要 10.0.0+
```

## 📦 构建产物说明

### Windows

- `ChainlessChain-win32-x64-{version}.zip` - 便携版本

### macOS

- `ChainlessChain-darwin-x64-{version}.dmg` - Intel Mac 安装器
- `ChainlessChain-darwin-arm64-{version}.dmg` - Apple Silicon 安装器

### Linux

- `ChainlessChain-{version}.AppImage` - 通用 Linux 包
- `chainlesschain_{version}_amd64.deb` - Debian/Ubuntu 包
- `chainlesschain-{version}.x86_64.rpm` - Fedora/RHEL 包

## 🔄 工作流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    发布流程选择                              │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌───────────────┐   ┌──────────────────┐
│ GitHub Actions│   │  本地脚本发布     │
│   (推荐)      │   │                  │
└───────┬───────┘   └────────┬─────────┘
        │                    │
        ▼                    ▼
┌──────────────┐    ┌──────────────────┐
│ 1. Push tag  │    │ 1. 发布前检查     │
│              │    │ npm run          │
│ 2. 自动构建  │    │ release:check    │
│    - Windows │    │                  │
│    - macOS   │    │ 2. 执行发布       │
│    - Linux   │    │ npm run          │
│              │    │ release:draft    │
│ 3. 自动发布  │    │                  │
└──────┬───────┘    └────────┬─────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
        ┌──────────────────┐
        │ GitHub Release   │
        │   已创建完成      │
        └──────────────────┘
```

## 📊 各方法对比

| 特性       | GitHub Actions | 本地脚本          | 手动流程          |
| ---------- | -------------- | ----------------- | ----------------- |
| **难度**   | 简单           | 中等              | 复杂              |
| **速度**   | 20-30分钟      | 依赖本地环境      | 最慢              |
| **多平台** | ✅ 全支持      | ⚠️ 受限于本地环境 | ⚠️ 受限于本地环境 |
| **自动化** | ✅ 完全自动    | ⚠️ 半自动         | ❌ 手动           |
| **一致性** | ✅ 高          | ⚠️ 中             | ❌ 低             |
| **推荐度** | ⭐⭐⭐⭐⭐     | ⭐⭐⭐            | ⭐⭐              |

## 🎯 使用场景

### GitHub Actions - 适用于：

- ✅ 正式版本发布
- ✅ 需要所有平台构建
- ✅ 希望一致的构建环境
- ✅ 团队协作发布

### 本地脚本 - 适用于：

- ✅ 快速测试发布流程
- ✅ 单平台构建
- ✅ 离线或内网环境
- ✅ 个人开发测试

### 手动流程 - 适用于：

- ✅ 完全自定义控制
- ✅ 调试构建问题
- ✅ 学习发布流程
- ✅ 特殊场景处理

## 🔍 故障排查

### GitHub CLI 未安装

```bash
# 检查
gh --version

# 如果未安装，参考上面的安装说明
```

### GitHub CLI 未认证

```bash
gh auth login
# 选择 GitHub.com
# 选择 HTTPS
# 选择 Login with a web browser
# 复制 one-time code 并在浏览器完成认证
```

### 构建失败

```bash
# 清理并重新构建
cd desktop-app-vue
rm -rf out node_modules package-lock.json
npm install
npm run build
npm run make:win  # 或其他平台
```

### GitHub Actions 失败

1. 访问 Actions 页面查看错误日志
2. 检查是否有足够的 Actions 分钟数
3. 验证仓库 secrets 配置
4. 检查 workflow 文件语法

## 📚 相关文档

- **完整指南**：`docs/RELEASE_GUIDE.md`
- **快速参考**：`desktop-app-vue/RELEASE.md`
- **发布说明模板**：`desktop-app-vue/RELEASE_NOTES_TEMPLATE.md`
- **项目文档**：`CLAUDE.md`

## 🎓 最佳实践

1. **始终使用 GitHub Actions** 进行正式发布
2. **创建草稿发布** 进行测试验证
3. **运行发布前检查** 确保准备就绪
4. **遵循语义化版本** 管理版本号
5. **编写详细的发布说明** 帮助用户理解变更
6. **测试所有平台** 的构建产物
7. **保持 CHANGELOG** 更新

## 📞 支持

如有问题，请：

1. 查阅 `docs/RELEASE_GUIDE.md` 获取详细信息
2. 运行 `npm run release:check` 诊断问题
3. 在 GitHub Issues 提出问题
4. 联系项目维护者

---

**创建日期**：2024-01-19
**最后更新**：2024-01-19
**维护者**：ChainlessChain Team

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain Release Automation - Setup Summary。

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
