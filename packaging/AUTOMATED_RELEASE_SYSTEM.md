# 🚀 ChainlessChain 自动化多平台发布系统

## ✅ 系统概览

完整的基于 GitHub CLI 和 GitHub Actions 的自动化发布系统，支持 **Windows、macOS、Linux** 三大平台的 **Docker 离线版本**打包和发布。

---

## 🎯 核心功能

### 1. GitHub Actions 自动化发布

- ✅ **多平台并行构建**：Windows、macOS、Linux 同时构建，节省时间
- ✅ **Docker 镜像离线打包**：自动导出 PostgreSQL、Redis、Qdrant、Ollama 镜像
- ✅ **完全自动化**：一键触发，无需人工干预
- ✅ **自动生成 Release Notes**：基于 git commit 历史自动生成
- ✅ **多格式支持**：每个平台提供多种安装格式

### 2. 本地手动发布

- ✅ **快速迭代测试**：适合开发调试和快速验证
- ✅ **跨平台脚本**：支持 Linux/macOS (.sh) 和 Windows (.bat)
- ✅ **完整流程**：从构建到发布一条龙自动化
- ✅ **环境检查**：自动验证必要工具和环境

### 3. 版本管理

- ✅ **语义化版本控制**：遵循 SemVer 2.0.0 规范
- ✅ **自动递增**：支持 major、minor、patch 自动递增
- ✅ **手动指定**：支持手动指定任意版本号
- ✅ **自动 tag 创建**：自动创建 git commit 和 tag

---

## 📦 输出格式

### Windows
- **Squirrel 安装程序** (如果配置)：`ChainlessChain-Setup.exe` (~1.3 GB)
- **ZIP 便携版**：`ChainlessChain-Windows-x64.zip` (~1.3 GB)

### macOS
- **DMG 安装包**：`ChainlessChain.dmg` (~1.3 GB)
- **ZIP 版本**：`ChainlessChain-macOS-Universal.zip` (~1.3 GB)
- **架构支持**：Intel + Apple Silicon (Universal Binary)

### Linux
- **DEB 包**：`chainlesschain_*.deb` (~1.3 GB) - Debian/Ubuntu
- **RPM 包**：`chainlesschain-*.rpm` (~1.3 GB) - Fedora/RHEL
- **ZIP 版本**：`ChainlessChain-Linux-x64.zip` (~1.3 GB) - 通用格式

### Docker 镜像（包含在所有安装包中）
- PostgreSQL 16 Alpine (~90 MB)
- Redis 7 Alpine (~30 MB)
- Qdrant v1.12.5 (~120 MB)
- Ollama Latest (~500 MB)

---

## 📂 文件结构

```
chainlesschain/
├── .github/
│   └── workflows/
│       └── release.yml                    # GitHub Actions 自动发布 workflow
│
├── packaging/
│   ├── scripts/
│   │   ├── bump-version.sh                # 版本管理脚本
│   │   ├── release-local.sh               # Linux/macOS 本地发布脚本
│   │   ├── release-local.bat              # Windows 本地发布脚本
│   │   └── README.md                      # 脚本使用说明
│   │
│   ├── docker-images/                     # Docker 镜像导出目录（构建时生成）
│   │   ├── postgres-16-alpine.tar
│   │   ├── redis-7-alpine.tar
│   │   ├── qdrant-qdrant-v1.12.5.tar
│   │   ├── ollama-ollama-latest.tar
│   │   └── images-manifest.txt
│   │
│   ├── export-docker-images.bat           # Docker 镜像导出脚本 (Windows)
│   ├── export-docker-images.sh            # Docker 镜像导出脚本 (Linux/macOS)
│   ├── load-docker-images.bat             # 用户端镜像加载脚本 (Windows)
│   ├── load-docker-images.sh              # 用户端镜像加载脚本 (Linux/macOS)
│   ├── start-services.bat                 # 启动服务脚本 (Windows)
│   ├── start-services.sh                  # 启动服务脚本 (Linux/macOS)
│   ├── docker-compose.production.yml      # 生产环境 Docker 配置
│   ├── .env.example                       # 环境变量示例
│   │
│   ├── DOCKER_OFFLINE_PACKAGING.md        # Docker 离线打包详细文档
│   ├── QUICK_START_OFFLINE.md             # 快速开始指南
│   ├── RELEASE_GUIDE.md                   # 完整发布指南
│   └── AUTOMATED_RELEASE_SYSTEM.md        # 本文档
│
├── desktop-app-vue/
│   └── forge.config.js                    # Electron 打包配置（已更新支持 Docker 镜像）
│
└── release-output/                        # 本地构建输出目录（.gitignore）
```

---

## 🔄 使用流程

### 方式一：GitHub Actions 自动发布（推荐）

适用于正式版本发布，多平台并行构建。

```bash
# 1. 更新版本号
cd packaging/scripts
./bump-version.sh minor    # 例如：0.16.0 -> 0.17.0

# 2. 编辑 CHANGELOG.md
vi ../../CHANGELOG.md      # 填写本次更新内容

# 3. 推送 tag 触发自动构建
git push && git push --tags

# 4. 等待 GitHub Actions 完成（约 45 分钟）
# 访问: https://github.com/你的仓库/actions
```

**自动执行流程：**
1. 导出 Docker 镜像（5-10 分钟）
2. 并行构建三个平台（15-20 分钟每个）
3. 创建 GitHub Release
4. 上传所有安装包

### 方式二：本地手动发布

适用于快速测试、单平台构建。

**Linux/macOS:**
```bash
cd packaging/scripts
./release-local.sh v0.16.5
```

**Windows:**
```cmd
cd packaging\scripts
release-local.bat v0.16.5
```

**执行流程：**
1. 环境检查
2. 导出 Docker 镜像
3. 安装依赖
4. 构建应用
5. 打包安装包
6. 创建 GitHub Release

---

## ⚙️ 配置说明

### GitHub Actions Workflow (.github/workflows/release.yml)

```yaml
# 触发条件：
on:
  push:
    tags:
      - 'v*.*.*'              # 推送 tag 时触发
  workflow_dispatch:            # 手动触发
    inputs:
      version: ...              # 版本号
      prerelease: ...           # 是否预发布
      draft: ...                # 是否草稿

# 核心 Jobs：
jobs:
  export-docker-images:         # 导出 Docker 镜像
  build-windows:                # 构建 Windows 版本
  build-macos:                  # 构建 macOS 版本
  build-linux:                  # 构建 Linux 版本
  create-release:               # 创建 GitHub Release
```

### Electron Forge 配置 (desktop-app-vue/forge.config.js)

```javascript
// 关键配置：

// 1. 自动检测并包含 Docker 镜像
const dockerImagesDir = path.join(PACKAGING_DIR, 'docker-images');
if (fs.existsSync(dockerImagesDir)) {
  extraResources.push(dockerImagesDir);
}

// 2. 跳过后端依赖检查（Docker 模式）
if (process.env.SKIP_BACKEND_CHECK === 'true') {
  // 不检查 JRE、PostgreSQL、Redis、Qdrant
}

// 3. 包含 Docker 相关脚本
const dockerFiles = [
  'docker-compose.production.yml',
  'start-services.sh',
  'start-services.bat',
  'load-docker-images.sh',
  'load-docker-images.bat',
  '.env.example'
];
```

---

## 🎛️ 环境变量

| 变量 | 说明 | 默认值 | 使用场景 |
|------|------|--------|----------|
| `SKIP_BACKEND_CHECK` | 跳过后端依赖检查 | `false` | Docker 模式打包 |
| `NODE_ENV` | Node.js 环境 | `development` | 生产构建时设为 `production` |
| `GH_TOKEN` | GitHub token | - | GitHub Actions 中自动提供 |

---

## 📊 性能数据

### GitHub Actions 构建时间

| 阶段 | 时间 | 说明 |
|------|------|------|
| Docker 镜像导出 | 5-10 分钟 | 拉取并导出 4 个镜像 |
| Windows 构建 | 10-15 分钟 | 包含依赖安装、构建、打包 |
| macOS 构建 | 15-20 分钟 | Universal binary，时间较长 |
| Linux 构建 | 10-15 分钟 | DEB + RPM + ZIP |
| **总计** | **~45 分钟** | 并行构建，非串行 |

### 本地构建时间

| 平台 | 时间 | 说明 |
|------|------|------|
| Windows | ~15 分钟 | 取决于硬件配置 |
| macOS | ~20 分钟 | Universal binary |
| Linux | ~15 分钟 | DEB + RPM + ZIP |

### 包大小

| 组件 | 大小 | 说明 |
|------|------|------|
| 应用本体 | ~60 MB | Electron + Vue |
| Docker 镜像 | ~800 MB | 4 个容器镜像 |
| 其他资源 | ~50 MB | 脚本、配置等 |
| **总计** | **~1.3 GB** | 完整离线安装包 |

---

## ✨ 特性亮点

### 1. 完全离线安装

- 📦 所有 Docker 镜像预打包
- 🌐 无需联网下载任何依赖
- 🚀 用户可在内网环境安装使用

### 2. 跨平台一致性

- 🖥️ Windows、macOS、Linux 使用相同的 Docker 镜像
- 🔧 统一的配置和启动脚本
- 📖 统一的用户文档

### 3. 自动化程度高

- ⚙️ GitHub Actions 无需人工干预
- 🤖 自动生成 Release Notes
- 📝 自动更新版本号

### 4. 易于维护

- 📂 清晰的文件组织结构
- 📚 完善的文档和注释
- 🔍 详细的日志输出

### 5. 灵活性强

- 🎯 支持草稿 Release
- 🧪 支持预发布版本
- 🔀 支持手动和自动触发

---

## 🔐 安全性

### GitHub Actions 安全

- ✅ 使用官方 actions (actions/checkout@v4, actions/upload-artifact@v4)
- ✅ 最小权限原则 (permissions: contents: write)
- ✅ 依赖锁定 (npm ci 而不是 npm install)
- ✅ 不存储敏感信息

### 本地脚本安全

- ✅ 环境检查，防止在错误环境执行
- ✅ 用户确认机制
- ✅ 错误处理和日志
- ✅ 不硬编码敏感信息

---

## 📋 发布检查清单

### 发布前

- [ ] 所有测试通过
- [ ] ESLint 无错误
- [ ] CHANGELOG.md 已更新
- [ ] 版本号符合规范
- [ ] Git 工作区干净

### 发布后

- [ ] GitHub Release 创建成功
- [ ] 所有平台安装包已上传
- [ ] Release Notes 内容完整
- [ ] 至少一个平台测试通过
- [ ] 团队成员已通知

---

## 🐛 已知问题和限制

### 当前限制

1. **macOS 代码签名**: 未配置，用户首次运行需要手动信任
2. **Windows 证书**: 未配置，用户可能看到 SmartScreen 警告
3. **自动更新**: 未实现，用户需手动下载新版本

### 未来改进

- [ ] 添加代码签名支持（macOS + Windows）
- [ ] 添加自动更新功能 (electron-updater)
- [ ] 添加安装包校验和（SHA256）
- [ ] 支持增量更新
- [ ] 添加更多测试覆盖

---

## 🎓 使用文档

### 快速开始

- 📖 [快速开始指南](QUICK_START_OFFLINE.md) - 用户安装指南
- 📖 [Docker 离线打包文档](DOCKER_OFFLINE_PACKAGING.md) - 详细技术说明

### 开发者文档

- 📖 [完整发布指南](RELEASE_GUIDE.md) - 发布流程和最佳实践
- 📖 [脚本使用说明](scripts/README.md) - 发布脚本详细说明

### 其他文档

- 📖 [项目 README](../README.md) - 项目总览
- 📖 [如何运行](../HOW_TO_RUN.md) - 开发环境搭建

---

## 🙏 致谢

本自动化发布系统基于以下开源项目：

- [Electron Forge](https://www.electronforge.io/) - Electron 打包工具
- [GitHub Actions](https://github.com/features/actions) - CI/CD 平台
- [GitHub CLI](https://cli.github.com/) - GitHub 命令行工具
- [Docker](https://www.docker.com/) - 容器化平台

---

## 📞 支持

如有问题或建议，请通过以下方式联系：

- 🐛 **GitHub Issues**: [提交 Issue](https://github.com/chainlesschain/chainlesschain/issues)
- 💬 **Discord 社区**: [加入讨论](https://discord.gg/chainlesschain)
- 📧 **邮件支持**: dev@chainlesschain.com

---

## 📄 许可证

ChainlessChain 使用 MIT 许可证。详见 [LICENSE](../LICENSE) 文件。

---

## 🎉 总结

ChainlessChain 自动化多平台发布系统提供了：

✅ **完整的 CI/CD 流程** - 从代码提交到用户下载
✅ **多平台支持** - Windows、macOS、Linux 一键发布
✅ **Docker 离线打包** - 完全离线安装，无需联网
✅ **自动化程度高** - 最小化人工操作
✅ **易于使用** - 详细文档和清晰的脚本
✅ **可扩展性强** - 易于添加新平台或功能

**准备好开始发布了吗？请参考 [RELEASE_GUIDE.md](RELEASE_GUIDE.md)！** 🚀

---

**文档版本**: v1.0.0
**最后更新**: 2025-01-20
**作者**: ChainlessChain Team
**维护者**: [@chainlesschain](https://github.com/chainlesschain)
