# 📦 ChainlessChain 发布脚本

自动化发布工具集，用于版本管理和多平台打包发布。

---

## 🛠️ 脚本列表

### 1. bump-version.sh - 版本管理

**功能**: 自动更新版本号、创建 git commit 和 tag

**使用方法:**

```bash
# 递增版本号
./bump-version.sh patch    # 0.16.0 -> 0.16.1
./bump-version.sh minor    # 0.16.0 -> 0.17.0
./bump-version.sh major    # 0.16.0 -> 1.0.0

# 手动指定版本
./bump-version.sh v0.16.5
./bump-version.sh 0.16.5   # 自动添加 v 前缀
```

**自动操作:**
- ✅ 更新 `package.json` 版本号
- ✅ 更新 `CHANGELOG.md`（需手动编辑内容）
- ✅ 创建 git commit
- ✅ 创建 git tag

---

### 2. release-local.sh - Linux/macOS 本地发布

**功能**: 完整的本地构建和发布流程（Docker 离线版）

**前置条件:**
- Docker Desktop 已安装并运行
- Node.js 20+ 已安装
- GitHub CLI (gh) 已安装并登录

**使用方法:**

```bash
# 正式版本
./release-local.sh v0.16.5

# 草稿版本（不立即发布）
./release-local.sh v0.16.5 --draft

# 预发布版本
./release-local.sh v0.16.5-beta.1 --prerelease
```

**自动操作:**
1. ✅ 环境检查（Docker、Node.js、gh CLI）
2. ✅ 导出 Docker 镜像（PostgreSQL, Redis, Qdrant, Ollama）
3. ✅ 安装依赖
4. ✅ 构建应用（主进程 + 渲染进程）
5. ✅ 打包安装包（DEB、RPM、ZIP）
6. ✅ 创建 GitHub Release 并上传

**输出文件:**
- `release-output/chainlesschain_*.deb` - Debian/Ubuntu 安装包
- `release-output/chainlesschain-*.rpm` - Fedora/RHEL 安装包
- `release-output/ChainlessChain-Linux-x64.zip` - 通用 ZIP 包

---

### 3. release-local.bat - Windows 本地发布

**功能**: 与 `release-local.sh` 功能相同，Windows 批处理版本

**使用方法:**

```cmd
REM 正式版本
release-local.bat v0.16.5

REM 草稿版本
release-local.bat v0.16.5 --draft

REM 预发布版本
release-local.bat v0.16.5-beta.1 --prerelease
```

**输出文件:**
- `release-output\ChainlessChain-Setup.exe` - Windows 安装程序（如果配置）
- `release-output\ChainlessChain-Windows-x64.zip` - Windows 便携版

---

## 🚀 快速开始

### 完整发布流程（推荐）

使用 GitHub Actions 自动发布，支持多平台并行构建：

```bash
# 1. 更新版本号
cd packaging/scripts
./bump-version.sh minor    # 例如：0.16.0 -> 0.17.0

# 2. 编辑 CHANGELOG.md
vi ../../CHANGELOG.md      # 填写更新内容

# 3. 推送 tag 触发 GitHub Actions
git push && git push --tags

# 4. 等待 GitHub Actions 完成（~45 分钟）
# 查看进度: https://github.com/你的仓库/actions
```

GitHub Actions 会自动构建 Windows、macOS、Linux 三个平台的安装包。

---

### 本地快速测试

如果只需要测试当前平台，使用本地脚本：

**Linux/macOS:**
```bash
cd packaging/scripts
chmod +x release-local.sh
./release-local.sh v0.16.5-test --draft
```

**Windows:**
```cmd
cd packaging\scripts
release-local.bat v0.16.5-test --draft
```

本地脚本仅构建当前平台，速度更快（~15分钟）。

---

## 📚 详细文档

完整的发布指南请参考：**[packaging/RELEASE_GUIDE.md](../RELEASE_GUIDE.md)**

包含：
- ✅ GitHub Actions vs 本地构建对比
- ✅ 完整的发布检查清单
- ✅ 故障排除指南
- ✅ 发布最佳实践
- ✅ 回滚方案

---

## 🔧 环境验证

使用前请确保环境正确：

```bash
# 检查工具版本
docker --version      # Docker version 24.0+
node --version        # v20.0+
gh --version          # gh version 2.0+

# 验证 Docker 运行
docker info

# 验证 gh 登录
gh auth status
```

---

## ⚠️ 注意事项

1. **平台限制**
   - 本地脚本只能构建当前平台的安装包
   - 多平台发布请使用 GitHub Actions

2. **磁盘空间**
   - Docker 镜像导出需要 ~1 GB 空间
   - 完整构建需要 ~5 GB 空间

3. **网络要求**
   - 导出 Docker 镜像需要联网（首次）
   - 创建 GitHub Release 需要联网

4. **版本号规范**
   - 遵循语义化版本控制：`v<major>.<minor>.<patch>`
   - 示例：`v0.16.5`、`v0.16.5-beta.1`

---

## 🐛 常见问题

### Q: Docker 镜像导出失败？

**A**: 确保 Docker Desktop 正在运行：
```bash
docker info  # 应该显示 Docker 信息，不报错
```

### Q: gh CLI 未登录？

**A**: 运行 gh auth login：
```bash
gh auth login
# 选择 GitHub.com > HTTPS > 浏览器登录
```

### Q: 构建失败，提示缺少依赖？

**A**: 清理并重新安装：
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Q: Release 创建成功但没有文件？

**A**: 检查 `release-output/` 目录是否有文件：
```bash
ls -lh release-output/
# 应该看到 .exe、.zip、.deb、.rpm 等文件
```

---

## 📞 支持

如有问题，请参考：
- 📖 完整文档：[packaging/RELEASE_GUIDE.md](../RELEASE_GUIDE.md)
- 🐛 提交 Issue：[GitHub Issues](https://github.com/chainlesschain/chainlesschain/issues)
- 💬 社区支持：[Discord](https://discord.gg/chainlesschain)

---

**最后更新**: 2025-01-20
**维护者**: ChainlessChain Team
