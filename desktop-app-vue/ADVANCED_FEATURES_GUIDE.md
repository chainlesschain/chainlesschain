# ChainlessChain 高级打包功能指南

本文档介绍 ChainlessChain 的三个高级打包功能：离线安装包、Docker Desktop 自动安装和增量更新。

## 目录

- [功能概览](#功能概览)
- [功能 1: 离线安装包支持](#功能-1-离线安装包支持)
- [功能 2: Docker Desktop 自动安装](#功能-2-docker-desktop-自动安装)
- [功能 3: 增量更新支持](#功能-3-增量更新支持)
- [完整使用流程](#完整使用流程)
- [常见问题](#常见问题)

---

## 功能概览

| 功能 | 描述 | 安装包大小 | 适用场景 |
|------|------|------------|----------|
| **在线安装包** | 基础打包，用户自行安装 Docker 和下载镜像 | ~200MB | 网络良好的环境 |
| **离线安装包** | 包含所有 Docker 镜像，无需联网下载 | ~5-6GB | 内网部署、网络受限 |
| **自动安装 Docker** | 安装时自动下载并安装 Docker Desktop | ~200MB + 500MB | 简化用户操作 |
| **增量更新** | 只下载变更部分，快速升级 | 变化量决定 | 版本升级 |

---

## 功能 1: 离线安装包支持

### 功能说明

离线安装包包含所有 Docker 镜像，用户无需在首次启动时下载 2-3GB 的镜像数据。

**包含的镜像：**
- Ollama (~500MB) - 本地 LLM 服务
- Qdrant (~100MB) - 向量数据库
- ChromaDB (~200MB) - 向量数据库
- PostgreSQL (~150MB) - 关系数据库
- Redis (~50MB) - 缓存服务
- Python 3.11 (~500MB) - AI 服务运行时
- OpenJDK 17 (~200MB) - 项目服务运行时

### 使用方法

#### 开发者端：创建离线安装包

```bash
cd desktop-app-vue

# 方式1: 使用统一打包脚本
build-windows-package.bat
# 选择 [2] 离线安装包

# 方式2: 单独导出镜像
export-docker-images.bat
```

**导出流程：**

1. **脚本自动执行：**
   - 检测 Docker Desktop 是否运行
   - 拉取最新镜像
   - 导出镜像为 .tar 文件
   - 创建导入脚本 `import-docker-images.bat`
   - 生成镜像清单 `README.md`

2. **输出文件：**
   ```
   docker-images-offline/
   ├── ollama-ollama-latest.tar       (~500MB)
   ├── qdrant-qdrant-latest.tar       (~100MB)
   ├── chromadb-chroma-latest.tar     (~200MB)
   ├── postgres-16-alpine.tar         (~150MB)
   ├── redis-7-alpine.tar             (~50MB)
   ├── python-3-11-slim.tar           (~500MB)
   ├── openjdk-17-slim.tar            (~200MB)
   ├── import-docker-images.bat       (导入脚本)
   └── README.md                      (使用说明)
   ```

3. **打包到安装包：**
   ```bash
   # 脚本自动复制镜像文件到打包目录
   out/ChainlessChain-win32-x64/backend-services/docker-images/
   ```

#### 用户端：使用离线安装包

**首次启动流程：**

1. 安装 `ChainlessChain-Setup-*.exe`
2. 双击 "启动 ChainlessChain (含后端)" 快捷方式
3. 后端管理脚本自动检测离线镜像
4. 自动导入镜像（约 2-5 分钟）
5. 启动后端服务
6. 启动前端应用

**优势：**
- ✅ 无需等待下载（节省 2-3GB 下载时间）
- ✅ 适合内网部署
- ✅ 首次启动即可使用

**劣势：**
- ⚠️ 安装包较大（5-6GB）
- ⚠️ 下载安装包时间较长

### 技术实现

**导出镜像脚本：**`desktop-app-vue/export-docker-images.bat`
- 自动拉取并导出所有镜像
- 创建导入脚本
- 支持压缩为单一 .zip 文件

**导入镜像脚本：**自动生成的 `import-docker-images.bat`
- 自动检测 Docker Desktop
- 批量导入所有镜像
- 显示导入进度

**集成到打包流程：**`desktop-app-vue/build-windows-package.bat`
- 询问用户选择在线/离线模式
- 自动导出和打包镜像
- 更新 `manage-backend.bat` 支持离线镜像导入

---

## 功能 2: Docker Desktop 自动安装

### 功能说明

安装完成后，如果系统未检测到 Docker Desktop，会提示用户选择自动安装。

### 使用方法

#### 用户安装流程

1. **运行安装程序：**
   ```
   ChainlessChain-Setup-*.exe
   ```

2. **Docker 检测：**
   - 如果已安装 Docker Desktop → 正常安装
   - 如果未安装 → 显示提示对话框

3. **选择自动安装：**
   ```
   ┌─────────────────────────────────────────────┐
   │  ChainlessChain 需要 Docker Desktop         │
   │                                             │
   │  系统未检测到 Docker Desktop。              │
   │                                             │
   │  是否现在自动安装 Docker Desktop？          │
   │  （将自动下载约 500MB 并安装）              │
   │                                             │
   │  [是(Y)]  [否(N)]                           │
   └─────────────────────────────────────────────┘
   ```

4. **自动安装流程：**
   - 点击"是"→ 自动启动 `install-docker-desktop.bat`
   - 自动下载 Docker Desktop 安装程序
   - 可选静默安装或交互式安装
   - 可选安装 WSL2（推荐）

5. **完成安装：**
   - 重启计算机（Docker 要求）
   - 运行 ChainlessChain

#### 手动安装 Docker Desktop

如果选择了"否"或需要稍后安装：

```bash
# 方式1: 运行安装脚本
<安装目录>\install-docker-desktop.bat

# 方式2: 手动下载
# 访问: https://www.docker.com/products/docker-desktop
```

### 技术实现

**Docker 检测：**`desktop-app-vue/installer.iss` 中的 `IsDockerInstalled()` 函数
```pascal
function IsDockerInstalled(): Boolean;
begin
  Result := FileExists('C:\Program Files\Docker\Docker\Docker Desktop.exe') or
            FileExists('C:\Program Files\Docker\Docker\resources\bin\docker.exe') or
            (Exec('cmd.exe', '/c where docker >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0));
end;
```

**自动安装脚本：**`desktop-app-vue/install-docker-desktop.bat`
- 检查管理员权限
- 下载 Docker Desktop 安装程序（PowerShell）
- 检测和安装 WSL2
- 静默或交互式安装
- 自动清理临时文件

**安装后集成：**`desktop-app-vue/installer.iss` 中的 `CurStepChanged()` 过程
- 安装完成后显示提示
- 提供自动安装选项
- 如果用户拒绝，提供手动安装指引

### 支持的安装模式

| 模式 | 特点 | 使用场景 |
|------|------|----------|
| **静默安装** | 无需用户交互，自动完成 | 批量部署 |
| **交互式安装** | 用户可自定义选项 | 个人安装 |
| **WSL2 后端** | 更好的性能和兼容性 | 推荐使用 |
| **Hyper-V 后端** | 传统虚拟化方式 | WSL2 不可用时 |

---

## 功能 3: 增量更新支持

### 功能说明

使用 `electron-updater` 实现自动更新，支持增量下载（只下载变更部分）。

### 工作流程

```
应用启动
    ↓
延迟3秒检查更新
    ↓
发现新版本 v0.2.0
    ↓
提示用户下载 → 用户选择 → 后台下载（增量）
    ↓               ↓
更新下载完成    稍后提醒
    ↓
提示安装 → 立即重启/退出时安装
```

### 配置说明

#### 1. 版本号管理

遵循[语义化版本](https://semver.org/)：

```
主版本号.次版本号.修订号
例如: 0.1.0 → 0.1.1 → 0.2.0 → 1.0.0
```

更新 `package.json`：
```json
{
  "version": "0.2.0"
}
```

#### 2. 更新服务器配置

**方案 A: GitHub Releases（推荐）**

`electron-builder.yml`:
```yaml
publish:
  - provider: github
    owner: chainlesschain
    repo: chainlesschain
    private: false
```

发布命令：
```bash
npm run build
npx electron-builder --publish always
```

**方案 B: 自建服务器**

`electron-builder.yml`:
```yaml
publish:
  - provider: generic
    url: https://your-server.com/releases
```

**方案 C: AWS S3**

`electron-builder.yml`:
```yaml
publish:
  - provider: s3
    bucket: chainlesschain-updates
    region: us-east-1
```

#### 3. 增量更新配置

`electron-builder.yml`:
```yaml
nsis:
  differentialPackage: true  # 启用增量更新
```

**增量更新原理：**
- 首次安装完整包（例如 200MB）
- 更新时只下载差异（例如 20MB）
- 自动合并生成新版本

### 发布新版本

#### 完整流程

```bash
# 1. 更新版本号
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.1 → 0.2.0
npm version major  # 0.2.0 → 1.0.0

# 2. 提交代码
git add .
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --tags

# 3. 构建和发布
npm run build
npx electron-builder --win --publish always
```

#### 验证发布

访问 GitHub Releases 页面，确认包含：
- 安装包（`ChainlessChain-Setup-0.2.0.exe`）
- 元数据（`latest.yml`）
- 增量文件（`RELEASES`, `*.nupkg`）

### 用户体验

**首次启动：**
1. 应用启动
2. 延迟 3 秒后检查更新
3. 如果有更新 → 显示提示
4. 用户选择下载 → 后台下载（不影响使用）
5. 下载完成 → 提示重启安装

**定期检查：**
- 每 4 小时自动检查一次
- 静默检查，有更新时才提示

**增量下载示例：**
```
完整包: 200MB
更新包: 20MB (仅变更部分)
节省: 90% 下载量
```

### 自动更新 API

应用已实现完整的自动更新模块：`src/main/auto-updater.js`

**关键功能：**
```javascript
// 手动检查更新
autoUpdater.checkForUpdates();

// 下载更新
autoUpdater.downloadUpdate();

// 退出并安装
autoUpdater.quitAndInstall();
```

**监听事件：**
- `checking-for-update` - 开始检查
- `update-available` - 发现更新
- `update-not-available` - 无更新
- `download-progress` - 下载进度
- `update-downloaded` - 下载完成
- `error` - 错误处理

---

## 完整使用流程

### 场景 1: 在线安装 + 自动安装 Docker

**开发者：**
```bash
cd desktop-app-vue
build-windows-package.bat
# 选择 [1] 在线安装包
```

**用户：**
1. 运行 `ChainlessChain-Setup-*.exe`
2. 提示安装 Docker → 选择"是"
3. 自动下载并安装 Docker Desktop
4. 重启计算机
5. 启动 ChainlessChain
6. 首次启动下载 Docker 镜像（2-3GB）

### 场景 2: 离线安装包（内网部署）

**开发者：**
```bash
cd desktop-app-vue
build-windows-package.bat
# 选择 [2] 离线安装包

# 等待镜像导出和打包完成
# 输出: ChainlessChain-Setup-*.exe (约 5-6GB)
```

**用户（内网环境）：**
1. 复制安装包到内网机器
2. 运行 `ChainlessChain-Setup-*.exe`
3. 提示安装 Docker → 选择"是"或手动安装
4. 启动 ChainlessChain
5. 自动导入离线镜像（2-5 分钟）
6. 立即可用，无需下载

### 场景 3: 版本升级（增量更新）

**开发者：**
```bash
# 更新版本
npm version minor  # 0.1.0 → 0.2.0

# 发布
npm run build
npx electron-builder --publish always
```

**用户：**
1. 应用自动检测到新版本
2. 提示"发现新版本 v0.2.0"
3. 点击"立即下载"
4. 后台下载更新（仅 20MB，增量）
5. 下载完成 → "立即重启"
6. 自动安装并重启
7. 升级完成

---

## 常见问题

### Q1: 离线安装包太大，如何缩小？

**A:** 可以选择性导出镜像

编辑 `export-docker-images.bat`，移除不需要的镜像：
```batch
REM 仅导出核心镜像
set IMAGES=ollama/ollama:latest qdrant/qdrant:latest postgres:16-alpine
```

### Q2: Docker Desktop 自动安装失败？

**A:** 检查以下几点：
1. 是否有管理员权限
2. 网络连接是否正常
3. 防火墙是否阻止下载
4. 手动下载：https://www.docker.com/products/docker-desktop

### Q3: 增量更新不生效，每次都下载完整包？

**A:** 确认以下配置：

`electron-builder.yml`:
```yaml
nsis:
  differentialPackage: true
```

检查发布文件是否包含：
- `RELEASES` 文件
- `*.nupkg` 文件

### Q4: 如何跳过自动更新？

**A:** 修改 `src/main/auto-updater.js`：

```javascript
// 禁用启动时检查
// setTimeout(() => {
//   this.checkForUpdates();
// }, 3000);

// 禁用定期检查
// this.setupPeriodicCheck();
```

### Q5: 如何测试更新功能？

**A:** 本地测试流程：

```bash
# 1. 构建 v0.1.0
# package.json: "version": "0.1.0"
npm run build && npx electron-builder

# 2. 安装 v0.1.0
out\build\ChainlessChain-Setup-0.1.0.exe

# 3. 构建 v0.2.0
# package.json: "version": "0.2.0"
npm run build && npx electron-builder

# 4. 启动测试更新服务器
node scripts/test-update-server.js

# 5. 启动已安装的 v0.1.0
# 应该检测到 v0.2.0 更新
```

### Q6: 离线镜像可以手动导入吗？

**A:** 可以

```bash
# 进入镜像目录
cd <安装目录>\backend-services\docker-images

# 运行导入脚本
import-docker-images.bat

# 或手动导入
docker load -i ollama-ollama-latest.tar
docker load -i qdrant-qdrant-latest.tar
# ... 其他镜像
```

### Q7: 如何部署企业内网更新服务器？

**A:** 使用自建服务器方案

```javascript
// 1. 创建更新服务器
const express = require('express');
const app = express();
app.use(express.static('releases'));
app.listen(3000);

// 2. 上传构建文件到服务器
scp out/build/* user@server:/releases/

// 3. 配置应用
// electron-builder.yml
publish:
  - provider: generic
    url: http://your-internal-server:3000
```

---

## 总结

三个高级功能协同工作，提供完整的部署和更新解决方案：

| 功能 | 解决的问题 | 适用场景 |
|------|-----------|---------|
| 离线安装包 | 首次启动需要下载大量数据 | 内网部署、网络受限 |
| 自动安装 Docker | 用户不知道如何安装 Docker | 简化安装流程 |
| 增量更新 | 每次更新下载量大 | 快速升级 |

**推荐组合：**

- **公网用户**: 在线安装包 + 自动安装 Docker + 增量更新
- **内网用户**: 离线安装包 + 手动安装 Docker
- **企业部署**: 离线安装包 + 自建更新服务器

## 相关文档

- [BUILD_PACKAGE_GUIDE.md](BUILD_PACKAGE_GUIDE.md) - 打包指南
- [AUTO_UPDATE_GUIDE.md](AUTO_UPDATE_GUIDE.md) - 更新详细配置
- [CLAUDE.md](../CLAUDE.md) - 项目总体说明

## 反馈和支持

如有问题或建议，请提交 GitHub Issue。
