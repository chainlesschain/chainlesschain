# ChainlessChain Windows 安装包构建指南

## 📋 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [详细步骤](#详细步骤)
- [手动集成说明](#手动集成说明)
- [故障排除](#故障排除)
- [FAQ](#faq)

---

## 前置要求

### 必需软件

1. **Node.js** (v18+ 推荐)
   - 下载: https://nodejs.org/
   - 验证: `node --version`

2. **npm** (通常随Node.js安装)
   - 验证: `npm --version`

3. **Git** (可选，用于版本控制)
   - 下载: https://git-scm.com/

### 可选软件（根据构建需求）

4. **Maven** (如果需要构建Java后端)
   - 下载: https://maven.apache.org/download.cgi
   - 验证: `mvn --version`
   - 或使用预构建的JAR文件

5. **Java JDK 17** (如果需要构建Java后端)
   - 下载: https://adoptium.net/temurin/releases/?version=17
   - 验证: `java -version`
   - 或仅下载JRE 17用于运行时

### 系统要求

- **操作系统**: Windows 10/11 (64位)
- **磁盘空间**: 至少5GB可用空间
- **内存**: 8GB+ 推荐
- **网络**: 需要下载第三方组件

---

## 快速开始

### 一键构建（推荐）

```batch
# 克隆或进入项目目录
cd C:\code\chainlesschain

# 运行构建脚本
build-windows-package.bat
```

构建脚本会自动：
1. 检查必需工具
2. 构建Java后端（如果Maven可用）
3. 下载第三方组件（PostgreSQL、Redis、Qdrant）
4. 创建配置文件
5. 构建Electron应用
6. 打包并生成安装程序

**输出位置**: `packaging/dist/ChainlessChain-Setup-*.exe`

---

## 详细步骤

如果一键构建失败或需要自定义，请按以下步骤手动构建。

### 步骤 1: 准备第三方组件

在项目根目录创建 `packaging` 文件夹，并按以下结构准备组件：

```
packaging/
├── jre-17/                 # Java运行时环境
│   └── bin/
│       └── java.exe
├── postgres/               # PostgreSQL数据库
│   └── bin/
│       └── postgres.exe
├── redis/                  # Redis缓存
│   └── redis-server.exe
├── qdrant/                 # Qdrant向量数据库
│   └── qdrant.exe
└── config/                 # 配置文件
    ├── redis.conf
    └── qdrant.yaml
```

#### 1.1 下载 PostgreSQL Portable

```batch
# 下载地址
https://get.enterprisedb.com/postgresql/postgresql-16.1-1-windows-x64-binaries.zip

# 解压到
packaging\postgres\
```

#### 1.2 下载 Redis for Windows

```batch
# 下载地址
https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip

# 解压到
packaging\redis\
```

#### 1.3 下载 Qdrant

```batch
# 下载地址
https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip

# 解压到
packaging\qdrant\
```

#### 1.4 下载 JRE 17

```batch
# 下载地址
https://adoptium.net/temurin/releases/?version=17

# 选择: Windows x64 JRE .zip
# 解压到
packaging\jre-17\
```

### 步骤 2: 构建 Java 后端服务

```batch
cd backend\project-service

# 使用Maven构建
mvn clean package -DskipTests

# 输出文件
# target/project-service.jar
```

**或者** 使用预构建的JAR文件（如果可用）。

### 步骤 3: 集成后端服务管理器到 Electron

**重要**: 需要手动修改 `desktop-app-vue/src/main/index.js`

参考文件：`desktop-app-vue/src/main/backend-integration.patch.js`

**修改内容**:

1. **添加导入** (约第67行):
```javascript
const { getBackendServiceManager } = require('./backend-service-manager');
```

2. **添加退出事件** (在 `setupApp()` 方法中，约第260行):
```javascript
app.on('will-quit', async (event) => {
  event.preventDefault();
  console.log('[Main] Application is quitting, stopping backend services...');
  const backendManager = getBackendServiceManager();
  await backendManager.stopServices();
  app.exit(0);
});
```

3. **启动服务** (在 `onReady()` 方法开始，约第265行):
```javascript
async onReady() {
  console.log('ChainlessChain Vue 启动中...');

  // 启动后端服务（仅在生产环境）
  try {
    const backendManager = getBackendServiceManager();
    await backendManager.startServices();
  } catch (error) {
    console.error('[Main] Failed to start backend services:', error);
  }

  // 原有代码继续...
```

4. **添加IPC处理程序** (在 `registerCoreIPCHandlers()` 中):
```javascript
// 后端服务管理 IPC handlers
ipcMain.handle('backend-service:get-status', async () => {
  try {
    const backendManager = getBackendServiceManager();
    return await backendManager.getServicesStatus();
  } catch (error) {
    console.error('[Main] Failed to get backend service status:', error);
    return { error: error.message };
  }
});

ipcMain.handle('backend-service:restart', async () => {
  try {
    const backendManager = getBackendServiceManager();
    await backendManager.restartServices();
    return { success: true };
  } catch (error) {
    console.error('[Main] Failed to restart backend services:', error);
    return { error: error.message };
  }
});
```

### 步骤 4: 构建 Electron 应用

```batch
cd desktop-app-vue

# 安装依赖
npm install

# 构建前端
npm run build:renderer

# 构建主进程
npm run build:main

# 打包应用
npm run package

# 创建安装程序
npm run make:win
```

### 步骤 5: 验证输出

检查输出目录：
```
desktop-app-vue/out/make/squirrel.windows/x64/
├── ChainlessChain-Setup-0.16.0.exe    # 安装程序
└── RELEASES
```

---

## 手动集成说明

### 方案A: 使用 Electron Forge (推荐)

已配置文件：`desktop-app-vue/forge.config.js`

**关键配置**:
```javascript
extraResource: [
  // 后端服务脚本
  {
    from: path.join(__dirname, '..', 'packaging', 'scripts'),
    to: 'scripts'
  },
  // 第三方组件（需要取消注释并确保文件存在）
  // - backend/project-service.jar
  // - backend/jre
  // - backend/postgres
  // - backend/redis
  // - backend/qdrant
  // - config/*
]
```

### 方案B: 使用 electron-builder

创建 `electron-builder.yml`:
```yaml
appId: com.chainlesschain.app
productName: ChainlessChain
directories:
  buildResources: build
  output: dist
files:
  - dist/**/*
  - package.json
extraResources:
  - from: ../packaging/backend
    to: backend
  - from: ../packaging/scripts
    to: scripts
  - from: ../packaging/config
    to: config
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: ChainlessChain
```

---

## 故障排除

### 问题 1: Maven 构建失败

**错误**: `mvn: command not found`

**解决方案**:
1. 安装 Maven: https://maven.apache.org/download.cgi
2. 添加到PATH环境变量
3. 或使用预构建的JAR文件

---

### 问题 2: Node模块构建错误

**错误**: `gyp ERR! build error`

**解决方案**:
```batch
# 安装 Windows构建工具
npm install --global windows-build-tools

# 或安装 Visual Studio Build Tools
# https://visualstudio.microsoft.com/downloads/
```

---

### 问题 3: Electron打包失败

**错误**: `Cannot find module ...`

**解决方案**:
```batch
# 清理并重新安装
cd desktop-app-vue
rm -rf node_modules
npm cache clean --force
npm install
```

---

### 问题 4: 后端服务启动失败

**错误**: 服务端口被占用

**解决方案**:
```batch
# 检查端口占用
netstat -ano | findstr ":5432 :6379 :6333 :9090"

# 关闭占用端口的进程
taskkill /PID <PID> /F
```

---

### 问题 5: PostgreSQL 初始化失败

**错误**: `initdb: command not found`

**解决方案**:
1. 确保 PostgreSQL binaries 已正确解压到 `packaging/postgres/`
2. 检查 `packaging/postgres/bin/initdb.exe` 是否存在
3. 确认目录权限正确

---

## FAQ

### Q1: 安装包大小多大？

**A**: 完整安装包约 **800MB - 1.2GB**，包含：
- Electron应用 (~200MB)
- Java运行时 (~200MB)
- PostgreSQL (~100MB)
- Redis (~5MB)
- Qdrant (~50MB)
- 其他组件 (~100-300MB)

---

### Q2: 能否减小安装包大小？

**A**: 可以，有几种方案：

1. **轻量版**（仅桌面应用 + 云LLM）
   - 移除PostgreSQL（使用SQLite替代）
   - 移除Redis（使用内存缓存）
   - 移除Qdrant（使用ChromaDB客户端模式）
   - 安装包 ~300MB

2. **下载器模式**
   - 安装包只包含核心应用
   - 首次运行时下载所需组件
   - 初始安装包 ~200MB

3. **在线安装器**
   - 使用NSIS的在线下载功能
   - 实时下载组件
   - 安装包 ~50MB

---

### Q3: 支持哪些Windows版本？

**A**:
- ✅ Windows 10 (64位)
- ✅ Windows 11 (64位)
- ❌ Windows 7/8 (不支持)
- ❌ 32位系统 (不支持)

---

### Q4: 如何更新应用？

**A**: 有两种方式：

1. **覆盖安装**
   - 运行新版安装程序
   - 自动保留用户数据

2. **自动更新** (需要额外配置)
   - 使用 electron-updater
   - 配置更新服务器
   - 应用内检查更新

---

### Q5: 用户数据存储在哪里？

**A**:
- **应用数据**: `C:\Program Files\ChainlessChain\data\`
- **数据库**: `data\chainlesschain.db` (SQLite加密)
- **PostgreSQL**: `data\postgres\`
- **Redis**: `data\redis\`
- **Qdrant**: `data\qdrant\`
- **日志**: `data\logs\`

**备份建议**: 复制整个 `data` 目录

---

### Q6: 卸载后数据会删除吗？

**A**:
- 默认情况下，卸载会提示是否保留数据
- 可以修改卸载脚本保留数据目录
- 建议在卸载前手动备份 `data` 目录

---

### Q7: 如何调试构建问题？

**A**:
1. 检查构建日志：`packaging\build.log`
2. 使用详细输出：
   ```batch
   set DEBUG=*
   build-windows-package.bat
   ```
3. 单独测试各组件：
   ```batch
   # 测试Java后端
   cd backend\project-service
   mvn clean package

   # 测试Electron构建
   cd desktop-app-vue
   npm run build
   npm run package
   ```

---

### Q8: 可以跨平台构建吗？

**A**:
- ❌ 不建议在Windows上构建macOS安装包
- ❌ 不建议在Windows上构建Linux安装包
- ✅ 可以使用Docker进行跨平台构建（高级用法）
- ✅ 推荐使用CI/CD（如GitHub Actions）进行多平台构建

---

## 构建检查清单

在运行构建脚本前，确保：

- [ ] Node.js (v18+) 已安装
- [ ] npm 可用
- [ ] PostgreSQL portable 已下载并解压到 `packaging/postgres/`
- [ ] Redis for Windows 已下载并解压到 `packaging/redis/`
- [ ] Qdrant 已下载并解压到 `packaging/qdrant/`
- [ ] JRE 17 已下载并解压到 `packaging/jre-17/`
- [ ] Java后端已构建（或使用预构建JAR）
- [ ] Electron主进程已集成后端服务管理器
- [ ] 所有依赖已安装 (`npm install` 在 `desktop-app-vue/`)

---

## 进阶配置

### 代码签名

为了避免Windows SmartScreen警告，建议对安装程序进行代码签名：

```javascript
// forge.config.js
packagerConfig: {
  ...
  osxSign: {}, // macOS签名
  osxNotarize: {}, // macOS公证
  win32metadata: {
    CompanyName: 'ChainlessChain Team',
    FileDescription: 'ChainlessChain Installer',
    OriginalFilename: 'ChainlessChain-Setup.exe',
    ProductName: 'ChainlessChain',
    InternalName: 'ChainlessChain'
  }
}
```

购买代码签名证书：
- DigiCert
- Sectigo
- GlobalSign

---

### 自动更新配置

使用 electron-updater:

```javascript
// main/index.js
const { autoUpdater } = require('electron-updater');

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.on('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: '发现新版本，正在下载...'
  });
});
```

---

## 技术支持

- **文档**: `packaging/docs/WINDOWS_PACKAGE_DESIGN.md`
- **问题反馈**: https://github.com/chainlesschain/chainlesschain/issues
- **讨论**: https://github.com/chainlesschain/chainlesschain/discussions

---

## 许可证

MIT License - 详见 LICENSE 文件
