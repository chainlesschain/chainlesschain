# ChainlessChain 打包方案对比指南

本文档帮助您快速选择合适的打包方案。

## 快速选择

```
需要 Docker 吗？
    ├─ 是 → 使用 Docker 版本
    │       ├─ 用户网络好 → 在线安装包
    │       ├─ 内网部署 → 离线安装包
    │       └─ 需要自动安装 Docker → 在线 + 自动安装
    │
    └─ 否 → 使用独立版本
            ├─ 仅需前端 → 仅前端模式
            ├─ 完整功能 → 前端 + 便携后端
            └─ 使用云服务 → 云端后端配置
```

---

## 所有打包方案总览

| 方案 | 脚本 | 模式 | 大小 | 依赖 | 适用场景 |
|------|------|------|------|------|----------|
| **Docker 在线** | build-windows-package.bat | [1] | 200MB | Docker Desktop | 网络良好 |
| **Docker 离线** | build-windows-package.bat | [2] | 5-6GB | Docker Desktop | 内网部署 |
| **仅前端** | build-windows-package-standalone.bat | [1] | 50MB | 后端服务 | 后端已部署 |
| **前端+便携后端** | build-windows-package-standalone.bat | [2] | 200-500MB | 无（或 Java） | 单机使用 |
| **云端后端** | build-windows-package-standalone.bat | [3] | 50MB | 云端服务 | SaaS 模式 |

---

## 详细对比

### 1. Docker 版本（build-windows-package.bat）

#### 在线安装包 [模式 1]

**特点：**
- ✅ 功能完整（所有后端服务）
- ✅ 安装包小（200MB）
- ✅ 易于更新
- ⚠️ 首次启动需下载镜像（2-3GB，10-30分钟）
- ⚠️ 需要 Docker Desktop

**适用场景：**
- 开发和测试环境
- 网络连接良好
- 个人用户

**安装流程：**
```bash
# 开发者
build-windows-package.bat
# 选择 [1] 在线安装包

# 用户
1. 安装应用
2. 安装 Docker Desktop（可自动）
3. 首次启动下载镜像
4. 开始使用
```

#### 离线安装包 [模式 2]

**特点：**
- ✅ 功能完整
- ✅ 无需联网下载
- ✅ 首次启动快（2-5分钟导入镜像）
- ⚠️ 安装包大（5-6GB）
- ⚠️ 需要 Docker Desktop

**适用场景：**
- 内网部署
- 网络受限环境
- 批量部署

**安装流程：**
```bash
# 开发者
build-windows-package.bat
# 选择 [2] 离线安装包

# 用户
1. 安装应用（较慢，文件大）
2. 安装 Docker Desktop
3. 首次启动自动导入镜像
4. 开始使用
```

### 2. 独立版本（build-windows-package-standalone.bat）

#### 仅前端应用 [模式 1]

**特点：**
- ✅ 安装包最小（50MB）
- ✅ 无需 Docker
- ✅ 启动快速
- ⚠️ 需要单独部署后端
- ⚠️ 需要配置后端地址

**适用场景：**
- 后端已单独部署（Docker/云端）
- 多客户端共享后端
- 测试环境

**安装流程：**
```bash
# 开发者
build-windows-package-standalone.bat
# 选择 [1] 仅前端应用

# 用户
1. 安装应用
2. 配置后端地址
3. 开始使用
```

#### 前端 + 便携后端 [模式 2]

**特点：**
- ✅ 完全独立（无需 Docker/Java/Python）
- ✅ 功能完整
- ✅ 一键安装
- ⚠️ 安装包较大（200-500MB）
- ⚠️ 编译过程复杂

**适用场景：**
- 单机使用
- 离线环境
- 不想安装 Docker

**安装流程：**
```bash
# 开发者
# 1. 编译后端
cd backend
build-standalone.bat
# 选择 [3] jpackage (推荐)

# 2. 打包
cd ../desktop-app-vue
build-windows-package-standalone.bat
# 选择 [2] 前端 + 便携后端

# 用户
1. 安装应用
2. 双击图标即可使用
```

#### 云端后端配置 [模式 3]

**特点：**
- ✅ 安装包小（50MB）
- ✅ 无需 Docker
- ✅ 后端统一管理
- ⚠️ 需要云端服务
- ⚠️ 需要配置 API Key

**适用场景：**
- SaaS 服务
- 云端部署
- 使用云 LLM API

**安装流程：**
```bash
# 开发者
build-windows-package-standalone.bat
# 选择 [3] 前端 + 云端后端配置

# 用户
1. 安装应用
2. 编辑 backend-config.env
3. 填入云端地址和 API Key
4. 开始使用
```

---

## 性能对比

| 指标 | Docker 在线 | Docker 离线 | 仅前端 | 便携后端 | 云端后端 |
|------|------------|------------|--------|---------|---------|
| **安装包大小** | 200MB | 5-6GB | 50MB | 200-500MB | 50MB |
| **首次启动** | 10-30分钟 | 2-5分钟 | <1分钟 | <1分钟 | <1分钟 |
| **磁盘占用** | 5-6GB | 5-6GB | 500MB | 500MB-1GB | 500MB |
| **内存占用** | 2-4GB | 2-4GB | 200MB | 500MB-1GB | 200MB |
| **启动速度** | 30-60秒 | 30-60秒 | 1-2秒 | 5-10秒 | 1-2秒 |

---

## 使用场景推荐

### 场景 1: 企业内网部署（50+ 用户）

**推荐：** Docker 离线安装包

**理由：**
- 功能最完整
- 无需联网
- 统一管理

**部署步骤：**
```bash
1. 创建离线安装包（5-6GB）
2. 内网分发
3. 用户安装 Docker Desktop + 应用
4. 自动导入镜像
```

### 场景 2: 云端 SaaS（100+ 用户）

**推荐：** 云端后端配置

**理由：**
- 前端体积小
- 后端统一部署
- 易于维护和更新

**部署步骤：**
```bash
1. 云端部署后端（Docker/K8s）
2. 创建云端配置安装包
3. 用户安装并配置 API Key
```

### 场景 3: 个人用户（离线使用）

**推荐：** 前端 + 便携后端（jpackage）

**理由：**
- 无需 Docker
- 一键安装
- 完整功能

**部署步骤：**
```bash
1. 编译后端（jpackage）
2. 打包前端 + 后端
3. 用户一键安装
```

### 场景 4: 开发测试

**推荐：** Docker 在线 + 仅前端

**理由：**
- 后端易于调试（Docker）
- 前端快速迭代
- 灵活配置

**部署步骤：**
```bash
# 后端
docker-compose up -d

# 前端
build-windows-package-standalone.bat [1]
```

### 场景 5: 演示 Demo

**推荐：** 前端 + 便携后端（Native Image）

**理由：**
- 体积最小
- 启动最快
- 无需安装

**部署步骤：**
```bash
1. 编译后端（GraalVM Native）
2. 打包为便携版（zip）
3. 解压即用
```

---

## 成本对比

### 开发成本

| 方案 | 构建时间 | 维护难度 | 技术要求 |
|------|---------|---------|---------|
| Docker 在线 | 10分钟 | 低 | Docker 基础 |
| Docker 离线 | 30-60分钟 | 低 | Docker 基础 |
| 仅前端 | 5分钟 | 极低 | Node.js 基础 |
| 便携后端 | 20-30分钟 | 中 | Java/Python 编译 |
| 云端后端 | 5分钟 + 部署 | 中 | 云服务运维 |

### 用户成本

| 方案 | 下载时间 | 安装时间 | 学习成本 | 运行要求 |
|------|---------|---------|---------|---------|
| Docker 在线 | 5分钟 | 30-60分钟 | 中 | Docker |
| Docker 离线 | 60-120分钟 | 10分钟 | 中 | Docker |
| 仅前端 | 1分钟 | 2分钟 | 低 | 后端服务 |
| 便携后端 | 10-30分钟 | 5分钟 | 低 | 无 |
| 云端后端 | 1分钟 | 5分钟 | 中 | API Key |

---

## 决策树

```
1. 是否需要完整的本地后端服务？
   ├─ 是 → 2
   └─ 否 → 5

2. 用户是否可以安装 Docker？
   ├─ 是 → 3
   └─ 否 → 前端 + 便携后端

3. 用户网络环境如何？
   ├─ 网络良好 → Docker 在线
   └─ 内网/受限 → Docker 离线

4. 完成

5. 后端部署在哪里？
   ├─ 已有后端服务器 → 仅前端
   ├─ 云端托管 → 云端后端配置
   └─ 需要完整功能 → 前端 + 便携后端
```

---

## 快速命令参考

### Docker 版本

```bash
# 在线安装包
cd desktop-app-vue
build-windows-package.bat
# 选择 [1]

# 离线安装包
cd desktop-app-vue
build-windows-package.bat
# 选择 [2]
```

### 独立版本

```bash
# 仅前端
cd desktop-app-vue
build-windows-package-standalone.bat
# 选择 [1]

# 前端 + 便携后端
cd backend
build-standalone.bat  # 选择 [3] jpackage
cd ../desktop-app-vue
build-windows-package-standalone.bat
# 选择 [2]

# 云端后端
cd desktop-app-vue
build-windows-package-standalone.bat
# 选择 [3]
```

---

## 总结建议

### 最推荐方案（按场景）

| 场景 | 首选 | 备选 |
|------|------|------|
| **企业内网** | Docker 离线 | 前端 + 便携后端 |
| **云端 SaaS** | 云端后端配置 | 仅前端 |
| **个人用户** | 前端 + 便携后端 | Docker 在线 |
| **开发测试** | Docker 在线 | 仅前端 |
| **演示 Demo** | 便携后端（Native） | Docker 离线 |

### 新手推荐

- **有 Docker**: Docker 在线安装包
- **无 Docker**: 前端 + 便携后端（jpackage）

### 专业用户推荐

根据具体需求选择，参考决策树。

---

## 相关文档

- [BUILD_PACKAGE_GUIDE.md](BUILD_PACKAGE_GUIDE.md) - Docker 版打包指南
- [STANDALONE_PACKAGE_GUIDE.md](STANDALONE_PACKAGE_GUIDE.md) - 独立版打包指南
- [ADVANCED_FEATURES_GUIDE.md](ADVANCED_FEATURES_GUIDE.md) - 高级功能说明
- [CLAUDE.md](../CLAUDE.md) - 项目总体说明

---

## 获取帮助

如有疑问：
1. 查看对应的详细文档
2. 搜索 GitHub Issues
3. 提交新的 Issue
