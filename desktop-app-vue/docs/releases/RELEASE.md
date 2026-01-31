# Release Guide (Quick Start)

## 快速发布流程

### 方法一：GitHub Actions 自动发布（推荐）

这是最简单和推荐的方式，GitHub 会自动构建所有平台的版本。

```bash
# 1. 更新版本号
cd desktop-app-vue
npm version 0.21.0 --no-git-tag-version

# 2. 提交更改
git add package.json
git commit -m "chore: bump version to 0.21.0"
git push origin main

# 3. 创建并推送 tag
git tag v0.21.0
git push origin v0.21.0

# 4. GitHub Actions 会自动:
#    - 构建 Windows (x64)
#    - 构建 macOS (x64 + arm64)
#    - 构建 Linux (x64)
#    - 创建 GitHub Release
#    - 上传所有构建产物
```

查看构建进度：https://github.com/YOUR_ORG/chainlesschain/actions

### 方法二：本地脚本发布

```bash
cd desktop-app-vue

# Windows (PowerShell)
.\scripts\release.ps1 -Draft

# macOS/Linux (Node.js)
npm run release:draft

# 或者跳过构建（使用已有的构建产物）
npm run release:skip-build
```

## 安装 GitHub CLI

### Windows

```powershell
winget install --id GitHub.cli
gh auth login
```

### macOS

```bash
brew install gh
gh auth login
```

### Linux

```bash
# Debian/Ubuntu
sudo apt install gh

# Fedora/RHEL
sudo dnf install gh

gh auth login
```

## 常用命令

```bash
# 创建草稿发布
npm run release:draft

# 创建正式发布
npm run release

# 跳过构建（使用已有产物）
npm run release:skip-build

# 指定版本
node scripts/release.js --version v0.21.0 --draft

# 使用自定义发布说明
node scripts/release.js --notes RELEASE_NOTES.md
```

## 构建单个平台

```bash
# Windows
npm run make:win

# macOS (Intel)
npm run make:mac:x64

# macOS (Apple Silicon)
npm run make:mac:arm64

# Linux
npm run make:linux:x64
```

## 手动使用 gh CLI

```bash
# 创建发布
gh release create v0.21.0 \
  --title "ChainlessChain v0.21.0" \
  --notes "Release notes here" \
  --draft

# 上传文件
gh release upload v0.21.0 out/make/**/*.zip

# 发布（移除 draft 状态）
gh release edit v0.21.0 --draft=false

# 查看发布
gh release view v0.21.0

# 列出所有发布
gh release list
```

## 构建产物位置

```
desktop-app-vue/out/make/
├── zip/
│   ├── darwin/         # macOS .zip
│   ├── linux/          # Linux .zip
│   └── win32/          # Windows .zip
├── deb/                # Linux .deb
├── rpm/                # Linux .rpm
├── dmg/                # macOS .dmg
└── squirrel.windows/   # Windows installer (如果启用)
```

## 完整文档

详细文档请查看：[docs/RELEASE_GUIDE.md](../docs/RELEASE_GUIDE.md)

---

## 故障排查

### GitHub CLI 未安装

```bash
# 检查是否安装
gh --version

# 如果未安装，参考上面的安装说明
```

### 未认证

```bash
gh auth login
# 选择 GitHub.com
# 选择 HTTPS
# 选择 Login with a web browser
# 复制 one-time code 并打开浏览器完成认证
```

### 构建失败

```bash
# 清理并重新构建
rm -rf out node_modules package-lock.json
npm install
npm run build
npm run make:win  # 或其他平台
```

### 权限错误

```bash
# 确保有仓库写入权限
gh auth status

# 如果需要，重新登录
gh auth login
```

## 版本号规范

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **主版本号 (Major)**: 不兼容的 API 修改
- **次版本号 (Minor)**: 向下兼容的功能性新增
- **修订号 (Patch)**: 向下兼容的问题修正

示例：

- `v0.21.0` - 稳定版本
- `v0.21.0-rc.1` - 发布候选版本
- `v0.21.0-beta.1` - Beta 版本
- `v0.21.0-alpha.1` - Alpha 版本
