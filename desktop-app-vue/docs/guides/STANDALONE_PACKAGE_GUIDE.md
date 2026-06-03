# ChainlessChain 无 Docker 版本打包指南

本指南介绍如何创建不依赖 Docker 的 ChainlessChain 独立安装包。

## 目录

- [概述](#概述)
- [打包模式](#打包模式)
- [使用方法](#使用方法)
- [后端服务编译](#后端服务编译)
- [部署方案对比](#部署方案对比)
- [常见问题](#常见问题)

---

## 概述

无 Docker 版本适用于：
- ✅ 无法安装 Docker 的环境
- ✅ 轻量级部署需求
- ✅ 后端服务已单独部署
- ✅ 仅需要前端应用
- ✅ 内网离线环境

**与 Docker 版本的对比：**

| 特性 | Docker 版本 | 无 Docker 版本 |
|------|------------|---------------|
| 安装难度 | 需要安装 Docker Desktop | 直接安装 |
| 磁盘占用 | 5-6GB（含镜像） | 50MB - 500MB |
| 启动速度 | 较慢（需启动容器） | 快速 |
| 依赖项 | Docker Desktop | 可选 Java/Python |
| 适用场景 | 完整功能 | 轻量级部署 |

---

## 打包模式

无 Docker 版本提供三种打包模式：

### 模式 1: 仅前端应用（最轻量）

**特点：**
- 只包含 Electron 前端应用
- 体积最小（约 50MB）
- 需要用户自行部署后端或连接远程后端

**适用场景：**
- 后端服务已单独部署（Docker/云端）
- 多个客户端连接同一后端
- 测试和开发环境

**使用流程：**
```bash
# 打包
cd desktop-app-vue
build-windows-package-standalone.bat
# 选择 [1] 仅前端应用

# 用户安装后需要：
# 1. 在设置中配置后端服务地址
# 2. 重启应用
```

---

### 模式 2: 前端 + 便携后端（完整独立）

**特点：**
- 包含前端 + 编译后的后端服务
- 完全独立运行，无需任何依赖
- 体积较大（200-500MB，取决于编译方式）

**适用场景：**
- 完全离线环境
- 单机使用
- 不想安装 Docker 和 Java/Python

**使用流程：**
```bash
# 1. 编译后端服务
cd backend
build-standalone.bat
# 选择编译方式：
#   [1] JAR + JRE (需要 Java 运行时)
#   [2] GraalVM Native Image (完全独立)
#   [3] jpackage (推荐)

# 2. 打包前端 + 后端
cd ../desktop-app-vue
build-windows-package-standalone.bat
# 选择 [2] 前端 + 便携后端

# 用户安装后：
# 双击图标即可使用，后端自动启动
```

---

### 模式 3: 前端 + 云端后端配置（云端连接）

**特点：**
- 包含前端 + 云端后端配置模板
- 体积小（约 50MB）
- 适合使用云服务

**适用场景：**
- 使用云端 LLM API（OpenAI、Qwen 等）
- 后端服务托管在云端
- 多用户共享后端

**使用流程：**
```bash
# 打包
cd desktop-app-vue
build-windows-package-standalone.bat
# 选择 [3] 前端 + 云端后端配置

# 用户安装后需要：
# 1. 编辑 backend-config\backend-config.env
# 2. 填入云端服务地址和 API Key
# 3. 启动应用
```

**配置示例：**
```env
# backend-config.env

# Project Service (云端)
PROJECT_SERVICE_URL=https://api.chainlesschain.com
PROJECT_SERVICE_PORT=9090

# AI Service (云端)
AI_SERVICE_URL=https://ai.chainlesschain.com
AI_SERVICE_PORT=8001

# LLM 配置
LLM_PROVIDER=openai  # 或 qwen, glm, claude 等
LLM_API_KEY=sk-xxxxxxxxxxxxx
LLM_MODEL=gpt-3.5-turbo

# 向量数据库（云端）
VECTOR_DB_URL=https://qdrant.chainlesschain.com
VECTOR_DB_API_KEY=your_key
```

---

## 使用方法

### 开发者端：打包安装程序

#### 快速开始

```bash
cd C:\code\chainlesschain\desktop-app-vue
build-windows-package-standalone.bat
```

#### 详细步骤

**1. 选择打包模式**

运行脚本后，选择您需要的模式：
```
打包模式选择：
  [1] 仅前端应用 - 最轻量，不包含任何后端服务
  [2] 前端 + 便携后端 - 包含编译后的后端服务（需要先构建）
  [3] 前端 + 云端后端配置 - 连接到云端/远程后端服务

请选择模式 (1/2/3，默认 1):
```

**2. 等待构建完成**

脚本会自动：
- 检查环境（Node.js, npm, Inno Setup）
- 安装依赖
- 构建前端应用
- 准备后端服务（如果选择）
- 生成安装包

**3. 获取安装包**

输出文件位于：
```
desktop-app-vue\out\installer\ChainlessChain-Standalone-Setup-*.exe
```

### 用户端：安装和使用

#### 模式 1: 仅前端

**安装：**
1. 运行 `ChainlessChain-Standalone-Setup-*.exe`
2. 按照向导完成安装

**配置后端：**
1. 启动应用
2. 进入 设置 → 后端配置
3. 填入后端服务地址：
   ```
   Project Service: http://your-server:9090
   AI Service: http://your-server:8001
   ```
4. 保存并重启

#### 模式 2: 前端 + 便携后端

**安装：**
1. 运行 `ChainlessChain-Standalone-Setup-*.exe`
2. 按照向导完成安装

**使用：**
- 双击桌面图标启动
- 后端服务自动在后台运行
- 无需任何配置

**手动管理后端：**
1. 打开开始菜单
2. 找到 "管理后端服务"
3. 选择启动/停止/重启

#### 模式 3: 云端后端

**安装：**
1. 运行 `ChainlessChain-Standalone-Setup-*.exe`
2. 按照向导完成安装

**配置：**
1. 找到安装目录（默认：`C:\Program Files\ChainlessChain Standalone`）
2. 进入 `backend-config` 文件夹
3. 用记事本编辑 `backend-config.env`
4. 填入您的云端服务信息
5. 保存并启动应用

---

## 后端服务编译

如果选择模式 2（前端 + 便携后端），需要先编译后端服务。

### 前置要求

根据编译方式不同，需要：

| 编译方式 | 要求 | 输出大小 | 依赖性 |
|---------|------|---------|--------|
| JAR + JRE | Maven, JDK 17+ | ~200MB | 需要 Java 运行时 |
| GraalVM Native | Maven, GraalVM | ~50MB | 完全独立 |
| jpackage | Maven, JDK 14+ | ~100MB | 完全独立（推荐） |
| PyInstaller | Python 3.11+, PyInstaller | ~30-50MB | 完全独立 |

### 编译步骤

**1. 运行编译脚本**

```bash
cd C:\code\chainlesschain\backend
build-standalone.bat
```

**2. 选择编译方式**

```
请选择编译方式：
  [1] 打包 JAR + JRE（快速，体积较大约 200MB）
  [2] GraalVM Native Image（慢，体积小约 50MB，需要 GraalVM）
  [3] jpackage（推荐，体积适中约 100MB）

请选择 (1/2/3，默认 1):
```

**3. 等待编译**

- 方式 1: 约 2-5 分钟
- 方式 2: 约 10-20 分钟
- 方式 3: 约 5-10 分钟

**4. 验证输出**

编译完成后，检查 `backend\standalone\` 目录：
```
backend\standalone\
├── project-service.exe  (或 .bat)
├── ai-service.exe
├── application.yml
└── config.yml
```

### 编译方式详解

#### 方式 1: JAR + JRE

**优点：**
- 编译快速
- 兼容性好

**缺点：**
- 需要 Java 运行时
- 体积较大

**使用：**
```bash
# 启动服务
project-service.bat
```

#### 方式 2: GraalVM Native Image

**优点：**
- 完全独立
- 体积最小
- 启动速度快

**缺点：**
- 编译慢
- 需要安装 GraalVM
- 某些功能可能不兼容

**安装 GraalVM：**
```bash
# 1. 下载 GraalVM
# https://www.graalvm.org/downloads/

# 2. 安装 native-image
gu install native-image

# 3. 设置环境变量
set JAVA_HOME=C:\graalvm-jdk-17.0.7+7.1
set PATH=%JAVA_HOME%\bin;%PATH%
```

#### 方式 3: jpackage（推荐）

**优点：**
- 完全独立
- 体积适中
- JDK 内置工具

**缺点：**
- 需要 JDK 14+

**要求：**
```bash
# 检查 JDK 版本
java -version  # 应该 >= 14

# 检查 jpackage
jpackage --version
```

### Python 服务编译

AI Service（Python）使用 PyInstaller 编译：

```bash
# 安装 PyInstaller
pip install pyinstaller

# 编译（自动执行）
python -m PyInstaller --onefile main.py
```

---

## 部署方案对比

| 方案 | 安装包大小 | 运行依赖 | 适用场景 | 部署难度 |
|------|-----------|---------|---------|---------|
| **Docker 版** | 200MB-6GB | Docker Desktop | 完整功能、开发环境 | 中等 |
| **仅前端** | ~50MB | 后端服务 | 后端已部署 | 简单 |
| **前端+便携后端** | 200-500MB | 无（或 Java） | 单机、离线 | 简单 |
| **云端后端** | ~50MB | 云端服务 | 云端部署 | 简单 |

### 场景推荐

#### 场景 1: 企业内网部署

**推荐：** 前端 + 便携后端（jpackage 方式）

**理由：**
- 不需要 Docker
- 完全独立运行
- 易于分发

**步骤：**
```bash
# 1. 编译后端
cd backend
build-standalone.bat  # 选择 [3] jpackage

# 2. 打包
cd ../desktop-app-vue
build-windows-package-standalone.bat  # 选择 [2]

# 3. 分发
# 将 ChainlessChain-Standalone-Setup-*.exe 分发给用户
```

#### 场景 2: 云端 SaaS 服务

**推荐：** 云端后端配置

**理由：**
- 前端体积小
- 后端统一管理
- 易于更新

**步骤：**
```bash
# 1. 部署后端到云端（使用 Docker）
cd backend
docker-compose up -d

# 2. 打包前端
cd ../desktop-app-vue
build-windows-package-standalone.bat  # 选择 [3]

# 3. 用户配置
# 编辑 backend-config.env
# 填入云端服务地址
```

#### 场景 3: 开发测试

**推荐：** 仅前端 + Docker 后端

**理由：**
- 后端易于调试
- 前端快速迭代

**步骤：**
```bash
# 1. 启动 Docker 后端
cd backend
docker-compose up -d

# 2. 打包前端
cd ../desktop-app-vue
build-windows-package-standalone.bat  # 选择 [1]

# 3. 配置连接本地后端
# localhost:9090, localhost:8001
```

#### 场景 4: 个人用户

**推荐：** 前端 + 便携后端（或使用 Docker 版）

**理由：**
- 一键安装
- 无需配置

---

## 常见问题

### Q1: 编译后端失败怎么办？

**A:** 检查以下几点：

1. **Maven 编译失败**
   ```bash
   # 检查 Java 版本
   java -version  # 应该 >= 17

   # 清理缓存
   mvn clean

   # 重新编译
   mvn package -DskipTests
   ```

2. **GraalVM Native Image 失败**
   ```bash
   # 检查 GraalVM 安装
   native-image --version

   # 安装 native-image 组件
   gu install native-image

   # 设置环境变量
   set JAVA_HOME=C:\path\to\graalvm
   ```

3. **PyInstaller 失败**
   ```bash
   # 升级 PyInstaller
   pip install --upgrade pyinstaller

   # 清理缓存
   python -m PyInstaller --clean main.py
   ```

### Q2: 安装包太大如何优化？

**A:** 优化建议：

1. **使用 GraalVM Native Image**
   - 从 200MB 减少到 50MB

2. **移除不需要的依赖**
   ```bash
   # 检查依赖
   mvn dependency:tree

   # 移除未使用的依赖
   ```

3. **使用仅前端模式**
   - 最小体积（50MB）
   - 后端单独部署

### Q3: 便携后端服务启动失败？

**A:** 排查步骤：

1. **检查端口占用**
   ```bash
   netstat -ano | findstr :9090
   netstat -ano | findstr :8001
   ```

2. **查看日志**
   ```bash
   # 后端服务日志
   type logs\project-service.log
   type logs\ai-service.log
   ```

3. **手动启动测试**
   ```bash
   cd backend-standalone
   project-service.exe
   # 查看错误信息
   ```

### Q4: 如何从 Docker 版迁移到独立版？

**A:** 迁移步骤：

1. **导出数据**
   ```bash
   # 备份用户数据
   copy "%APPDATA%\chainlesschain-desktop-vue" backup\
   ```

2. **卸载 Docker 版**
   - 运行卸载程序
   - 选择保留数据

3. **安装独立版**
   - 运行独立版安装包
   - 数据会自动识别

4. **验证**
   - 启动应用
   - 检查数据是否完整

### Q5: 云端模式如何配置？

**A:** 配置步骤：

1. **获取配置文件**
   ```
   安装目录\backend-config\backend-config.env
   ```

2. **填写配置**
   ```env
   # 必填项
   PROJECT_SERVICE_URL=https://your-server.com
   AI_SERVICE_URL=https://your-ai.com
   LLM_API_KEY=your_key

   # 可选项（根据需要）
   VECTOR_DB_URL=
   DB_HOST=
   ```

3. **重启应用**
   - 配置会在重启后生效

4. **验证连接**
   - 查看应用设置 → 系统状态
   - 确认后端连接成功

### Q6: 性能对比如何？

**A:** 性能对比：

| 指标 | Docker 版 | 独立版（JAR） | 独立版（Native） |
|------|----------|--------------|-----------------|
| 启动时间 | 30-60秒 | 5-10秒 | 1-2秒 |
| 内存占用 | 2-4GB | 500MB-1GB | 200-400MB |
| CPU 占用 | 中等 | 低 | 极低 |
| 磁盘占用 | 5-6GB | 200MB | 100MB |

**结论：** 独立版（Native）性能最佳

---

## 总结

### 选择建议

- **开发/测试**: Docker 版或仅前端模式
- **企业部署**: 前端 + 便携后端（jpackage）
- **云端 SaaS**: 云端后端配置模式
- **个人用户**: 根据是否有 Docker 选择

### 优缺点对比

**无 Docker 版优点：**
- ✅ 安装简单，无需 Docker
- ✅ 启动快速
- ✅ 资源占用低
- ✅ 便于分发

**无 Docker 版缺点：**
- ⚠️ 功能可能受限（取决于后端部署）
- ⚠️ 需要手动管理后端（非便携模式）
- ⚠️ 编译过程复杂（便携模式）

### 最佳实践

1. **生产环境**: 使用 jpackage 编译的便携后端
2. **开发环境**: 使用 Docker 版本
3. **云端部署**: 使用云端后端配置模式
4. **内网环境**: 使用便携后端（GraalVM Native）

---

## 相关文档

- [BUILD_PACKAGE_GUIDE.md](BUILD_PACKAGE_GUIDE.md) - 基础打包指南（Docker 版）
- [ADVANCED_FEATURES_GUIDE.md](ADVANCED_FEATURES_GUIDE.md) - 高级功能说明
- [CLAUDE.md](../CLAUDE.md) - 项目总体说明

## 反馈支持

如有问题或建议，请提交 GitHub Issue。
