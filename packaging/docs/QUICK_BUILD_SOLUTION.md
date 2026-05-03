# 快速构建方案 (无需后端依赖)

如果你只想快速打包桌面应用的前端功能，可以暂时跳过后端服务依赖。

## 🚀 快速步骤

### 方案 1: 使用轻量级配置(推荐)

创建一个不包含后端服务的打包版本：

```bash
cd D:/code/chainlesschain/desktop-app-vue

# 使用环境变量跳过后端检查
export SKIP_BACKEND_CHECK=true
npm run make:win
```

然后修改 `forge.config.js` 第315-325行：

```javascript
prePackage: async (config, platform, arch) => {
  // Mac打包：使用Docker，不需要所有后端资源
  if (platform === 'darwin' || process.env.SKIP_BACKEND_CHECK === 'true') {
    console.log('[Packaging] Skipping backend resources check (SKIP_BACKEND_CHECK=true)');
    console.log('[Packaging] Frontend-only build - backend services will use Docker');
  } else if (missingResources.length > 0) {
    const missingList = missingResources.map(item => `- ${item}`).join('\n');
    throw new Error(
      `Missing packaging resources:\n${missingList}\n\nFollow packaging/docs/BUILD_INSTRUCTIONS.md before packaging.`
    );
  }
```

### 方案 2: 创建空的占位文件

如果只是为了通过检查，可以创建空的占位目录：

```bash
cd D:/code/chainlesschain/packaging

# 创建占位目录
mkdir -p jre-17/bin postgres/bin redis qdrant

# 创建空的可执行文件占位符
touch jre-17/bin/java.exe
touch postgres/bin/postgres.exe
touch redis/redis-server.exe
touch qdrant/qdrant.exe

# 创建一个空的 JAR 文件
mkdir -p ../backend/project-service/target
touch ../backend/project-service/target/project-service-0.0.1.jar
```

**注意**: 这种方式打包的应用无法使用后端功能，仅用于测试打包流程。

### 方案 3: 只打包前端(最快)

直接打包 renderer 部分，不使用 Electron Forge：

```bash
cd D:/code/chainlesschain/desktop-app-vue

# 仅构建前端
npm run build:renderer

# 使用 electron-builder 简单打包
npx electron-builder --dir
```

---

## 📦 各方案对比

| 方案 | 打包时间 | 包大小 | 功能完整性 | 推荐度 |
|------|----------|--------|-----------|--------|
| **方案1: 环境变量** | 5分钟 | ~50MB | 前端完整 | ⭐⭐⭐⭐⭐ |
| **方案2: 占位文件** | 5分钟 | ~50MB | 前端完整 | ⭐⭐⭐ |
| **方案3: 仅前端** | 2分钟 | ~40MB | 基础功能 | ⭐⭐ |
| **完整打包** | 15分钟 | ~400MB | 全部功能 | ⭐⭐⭐⭐ |

---

## 🎯 推荐流程

**如果你想验证打包是否能成功运行：**

1. 使用方案1 (环境变量)
2. 打包成功后测试应用启动
3. 后续再补全后端依赖

**如果你需要完整功能的部署包：**

1. 参考 `MANUAL_DOWNLOAD_GUIDE.md` 手动下载所有依赖
2. 构建 Java 项目
3. 运行完整打包

---

## ⚡ 实际命令

### 快速打包 (推荐)

```bash
# 1. 修改 forge.config.js (见上面方案1)
cd D:/code/chainlesschain/desktop-app-vue

# 2. 使用 Git Bash
export SKIP_BACKEND_CHECK=true && npm run make:win
```

### 完整打包 (需要手动下载依赖)

```bash
# 1. 参考 MANUAL_DOWNLOAD_GUIDE.md 下载所有依赖
# 2. 构建 Java 项目
cd ../backend/project-service
mvn clean package -DskipTests

# 3. 运行打包
cd ../../desktop-app-vue
npm run make:win
```

---

## 🔍 验证打包结果

打包完成后，检查输出目录：

```bash
cd D:/code/chainlesschain/desktop-app-vue/out

# 查看打包的文件
ls -lh make/squirrel.windows/x64/
```

应该看到：
- `chainlesschain-*-Setup.exe` - 安装程序
- `RELEASES` - 版本信息

运行安装程序测试应用是否正常启动。

---

## 💡 后续步骤

1. ✅ 验证应用能正常启动
2. ✅ 测试前端基础功能
3. 📥 手动下载后端依赖 (如果需要)
4. 🏗️ 重新打包完整版本
5. 🚀 部署到目标机器

---

**快速打包让你先验证流程，完整打包让你部署生产环境！**
