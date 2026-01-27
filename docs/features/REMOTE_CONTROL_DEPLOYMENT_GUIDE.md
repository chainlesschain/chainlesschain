# 远程控制系统部署指南

**版本**: v0.27.0
**最后更新**: 2026-01-27
**适用平台**: PC (Windows/macOS/Linux) + Android (12+)

---

## 目录

1. [部署架构](#部署架构)
2. [环境要求](#环境要求)
3. [PC 端部署](#pc-端部署)
4. [Android 端部署](#android-端部署)
5. [配置管理](#配置管理)
6. [性能优化](#性能优化)
7. [安全配置](#安全配置)
8. [监控和维护](#监控和维护)
9. [故障排查](#故障排查)

---

## 部署架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                   Android 端                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   UI 层      │  │ ViewModel   │  │ Repository  │      │
│  │  (Compose)  │→│  (StateFlow)│→│   (Room)    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│         │                                                │
│         ↓                                                │
│  ┌─────────────────────────────────────────┐            │
│  │     RemoteCommandClient (P2P + DID)      │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
                      │
                      │ P2P Network (libp2p + Signal)
                      │ WebRTC Data Channels
                      ↓
┌─────────────────────────────────────────────────────────┐
│                    PC 端 (Electron)                      │
│  ┌─────────────────────────────────────────┐            │
│  │     RemoteControlGateway (P2P + DID)     │            │
│  └─────────────────────────────────────────┘            │
│         │                                                │
│         ↓                                                │
│  ┌──────────┬──────────┬──────────┬──────────┐          │
│  │ AI       │ System   │ Logging  │ Statistics│          │
│  │ Handler  │ Handler  │ Manager  │ Collector │          │
│  └──────────┴──────────┴──────────┴──────────┘          │
│         │         │         │          │                 │
│         ↓         ↓         ↓          ↓                 │
│  ┌──────────┬──────────┬──────────────────┐             │
│  │ LLM      │ System   │ SQLite Database  │             │
│  │ Manager  │ Info     │ (WAL Mode)       │             │
│  └──────────┴──────────┴──────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 组件说明

#### PC 端核心组件
- **RemoteControlGateway**: P2P 网关，处理连接和消息路由
- **AI Handler**: 处理 AI 相关命令（chat, ragSearch, controlAgent）
- **System Handler**: 处理系统命令（screenshot, getStatus, getInfo）
- **Logging Manager**: 日志记录和查询
- **Statistics Collector**: 统计数据收集和聚合

#### Android 端核心组件
- **RemoteCommandClient**: P2P 客户端，发送命令和接收结果
- **Repository**: 数据持久化（Room 数据库）
- **ViewModel**: 业务逻辑和状态管理
- **UI (Compose)**: 用户界面

---

## 环境要求

### PC 端要求

#### 硬件要求
- **CPU**: 2 核以上（推荐 4 核）
- **内存**: 最低 4 GB（推荐 8 GB）
- **磁盘**: 最低 2 GB 可用空间（日志和数据库）
- **网络**: 稳定的网络连接（至少 1 Mbps）

#### 软件要求
| 软件 | 版本 | 用途 | 必需 |
|------|------|------|------|
| Node.js | 22.x | 运行时环境 | ✅ |
| Electron | 39.2.6+ | 桌面框架 | ✅ |
| SQLite | 3.x | 数据库 | ✅ |
| Ollama | 0.1.x+ | LLM 服务 | ⚠️ AI 功能需要 |
| Qdrant | 1.7.x+ | 向量数据库 | ⚠️ RAG 功能需要 |

#### 操作系统要求
- **Windows**: 10/11 (64-bit)
- **macOS**: 10.15 (Catalina) 或更高
- **Linux**: Ubuntu 20.04+, Debian 11+, Fedora 35+

### Android 端要求

#### 硬件要求
- **Android 版本**: 12 (API Level 31) 或更高
- **内存**: 最低 2 GB RAM
- **存储**: 最低 100 MB 可用空间
- **网络**: Wi-Fi 或移动数据连接

#### 权限要求
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

---

## PC 端部署

### 3.1 前置准备

#### 步骤 1: 安装 Node.js

**Windows**:
```bash
# 使用 nvm-windows
nvm install 22
nvm use 22
node --version  # 应显示 v22.x.x
```

**macOS**:
```bash
# 使用 Homebrew
brew install node@22
node --version  # 应显示 v22.x.x
```

**Linux**:
```bash
# 使用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22
```

#### 步骤 2: 安装依赖服务（可选）

**Ollama（用于 AI 功能）**:
```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# 下载安装器: https://ollama.ai/download/windows

# 启动服务
ollama serve

# 下载模型
ollama pull qwen2:7b
```

**Qdrant（用于 RAG 功能）**:
```bash
# Docker 方式（推荐）
docker run -d -p 6333:6333 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant

# 或使用 docker-compose
# 在项目根目录执行
docker-compose up -d qdrant
```

### 3.2 安装主应用

#### 从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain/desktop-app-vue

# 2. 安装依赖
npm install

# 3. 构建主进程
npm run build:main

# 4. 构建渲染进程
npm run build:renderer

# 5. 打包应用
npm run make:win   # Windows
npm run make:mac   # macOS
npm run make:linux # Linux

# 生成的安装包在 out/ 目录
```

#### 使用预构建版本

```bash
# 1. 下载发布版本
# https://github.com/chainlesschain/chainlesschain/releases

# 2. 安装
# Windows: 运行 ChainlessChain-Setup-0.27.0.exe
# macOS: 拖动到 Applications 文件夹
# Linux: dpkg -i chainlesschain_0.27.0_amd64.deb
```

### 3.3 初始化配置

#### 首次启动

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

#### 配置文件位置

**Windows**:
```
%APPDATA%\chainlesschain-desktop-vue\.chainlesschain\config.json
```

**macOS**:
```
~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/config.json
```

**Linux**:
```
~/.config/chainlesschain-desktop-vue/.chainlesschain/config.json
```

#### 基础配置示例

```json
{
  "version": "0.27.0",
  "p2p": {
    "port": 9000,
    "enableRelay": true,
    "enableMdns": true
  },
  "remote": {
    "enableRemoteControl": true,
    "enableLogging": true,
    "enableStatistics": true,
    "performance": {
      "batchSize": 50,
      "batchInterval": 1000,
      "maxLogAge": 2592000000,
      "maxLogCount": 100000
    }
  },
  "security": {
    "enableEncryption": true,
    "allowedNamespaces": ["ai", "system"],
    "commandWhitelist": ["chat", "ragSearch", "controlAgent", "screenshot", "getStatus", "getInfo"]
  }
}
```

### 3.4 数据库初始化

数据库会在首次启动时自动创建，位置：

**Windows**:
```
%APPDATA%\chainlesschain-desktop-vue\data\chainlesschain.db
```

**macOS**:
```
~/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db
```

**Linux**:
```
~/.config/chainlesschain-desktop-vue/data/chainlesschain.db
```

#### 手动初始化

```bash
# 进入项目目录
cd desktop-app-vue

# 运行数据库测试（会自动创建表）
npm run test:db
```

### 3.5 启动服务

#### 开发环境

```bash
# 1. 启动 Vite 开发服务器
npm run dev:renderer

# 2. 启动 Electron（另一个终端）
npm run dev:electron
```

#### 生产环境

```bash
# 启动应用
npm start

# 或使用安装包安装后，通过桌面图标启动
```

---

## Android 端部署

### 4.1 开发环境配置

#### 步骤 1: 安装 Android Studio

1. 下载 Android Studio: https://developer.android.com/studio
2. 安装 Android SDK (API Level 31+)
3. 配置 Kotlin 插件

#### 步骤 2: 配置项目

```bash
# 1. 进入 Android 项目目录
cd android-app

# 2. 同步 Gradle
./gradlew sync

# 3. 构建项目
./gradlew build
```

### 4.2 配置文件

#### build.gradle.kts (app 级别)

```kotlin
android {
    namespace = "com.chainlesschain.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.chainlesschain.android"
        minSdk = 31
        targetSdk = 34
        versionCode = 27
        versionName = "0.27.0"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.3"
    }
}

dependencies {
    // Jetpack Compose
    implementation("androidx.compose.ui:ui:1.5.4")
    implementation("androidx.compose.material3:material3:1.2.0")

    // Room Database
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    // Paging 3
    implementation("androidx.paging:paging-runtime:3.2.1")
    implementation("androidx.paging:paging-compose:3.2.1")

    // Hilt DI
    implementation("com.google.dagger:hilt-android:2.48")
    kapt("com.google.dagger:hilt-compiler:2.48")

    // Kotlin Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

### 4.3 构建和安装

#### 构建 APK

```bash
# Debug 版本
./gradlew assembleDebug
# APK 位置: app/build/outputs/apk/debug/app-debug.apk

# Release 版本（需要签名）
./gradlew assembleRelease
# APK 位置: app/build/outputs/apk/release/app-release.apk
```

#### 签名配置

创建 `keystore.properties`:
```properties
storeFile=/path/to/your/keystore.jks
storePassword=your_store_password
keyAlias=your_key_alias
keyPassword=your_key_password
```

更新 `build.gradle.kts`:
```kotlin
android {
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))

            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

#### 安装到设备

```bash
# 安装 Debug 版本
./gradlew installDebug

# 或使用 adb
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## 配置管理

### 5.1 PC 端配置

#### 远程控制配置

编辑 `.chainlesschain/config.json`:

```json
{
  "remote": {
    "enableRemoteControl": true,
    "enableLogging": true,
    "enableStatistics": true,
    "performance": {
      "batchSize": 50,          // 日志批处理大小
      "batchInterval": 1000,    // 批处理间隔（毫秒）
      "maxLogAge": 2592000000,  // 日志最大保留时间（30天）
      "maxLogCount": 100000     // 日志最大条数
    },
    "database": {
      "enableWAL": true,        // 启用 WAL 模式
      "synchronous": "NORMAL",  // 同步模式
      "cacheSize": 10000       // 缓存页数
    }
  }
}
```

#### 安全配置

```json
{
  "security": {
    "enableEncryption": true,
    "allowedNamespaces": ["ai", "system"],
    "commandWhitelist": [
      "chat",
      "ragSearch",
      "controlAgent",
      "screenshot",
      "getStatus",
      "getInfo"
    ],
    "commandBlacklist": [
      "execCommand"  // 危险命令，禁用
    ],
    "deviceWhitelist": [
      "did:key:z6Mk..."  // 允许的设备 DID
    ]
  }
}
```

#### AI 服务配置

```json
{
  "ai": {
    "ollama": {
      "host": "http://localhost:11434",
      "defaultModel": "qwen2:7b",
      "timeout": 30000
    },
    "rag": {
      "qdrantHost": "http://localhost:6333",
      "collectionName": "knowledge_base",
      "topK": 5
    }
  }
}
```

### 5.2 Android 端配置

#### 应用配置

编辑 `app/src/main/res/values/config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- P2P 配置 -->
    <string name="p2p_default_port">9000</string>
    <bool name="p2p_enable_relay">true</bool>

    <!-- 远程控制配置 -->
    <bool name="remote_enable_auto_refresh">true</bool>
    <integer name="remote_auto_refresh_interval">5000</integer>

    <!-- 性能配置 -->
    <integer name="paging_page_size">20</integer>
    <integer name="paging_prefetch_distance">10</integer>
    <integer name="paging_max_size">200</integer>

    <!-- 缓存配置 -->
    <integer name="cache_max_age_days">7</integer>
    <integer name="cache_max_size_mb">50</integer>
</resources>
```

#### Room 数据库配置

```kotlin
@Database(
    entities = [CommandHistoryEntity::class],
    version = 1,
    exportSchema = false
)
abstract class CommandHistoryDatabase : RoomDatabase() {
    companion object {
        fun getDatabase(context: Context): CommandHistoryDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                CommandHistoryDatabase::class.java,
                "command_history.db"
            )
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)  // WAL 模式
                .fallbackToDestructiveMigration()  // 版本升级策略
                .build()
        }
    }
}
```

---

## 性能优化

### 6.1 PC 端优化

#### 数据库优化

```javascript
// 应用性能配置
const { applyDatabaseOptimizations } = require('./src/main/remote/logging/performance-config');

// 初始化数据库时
const db = require('better-sqlite3')(dbPath);
applyDatabaseOptimizations(db);
```

**效果**:
- 写入延迟减少 58.3%
- 写入吞吐量提升 140%
- 并发性能显著提升

#### 日志批处理

```javascript
// 使用批处理日志记录器
const BatchedCommandLogger = require('./src/main/remote/logging/batched-command-logger');

const logger = new BatchedCommandLogger(db, {
  batchSize: 50,        // 批次大小
  batchInterval: 1000,  // 批处理间隔
  enableAutoCleanup: true
});
```

**效果**:
- 数据库 I/O 减少 98%
- 内存使用优化

#### 性能监控

```bash
# 运行性能基准测试
npm run benchmark:remote

# 查看性能报告
cat tests/reports/remote-performance-report.json
```

### 6.2 Android 端优化

#### Compose 优化

```kotlin
// 使用 remember 缓存计算结果
@Composable
fun CommandHistoryItem(command: CommandHistoryEntity) {
    val formattedTime = remember(command.timestamp) {
        formatTimestamp(command.timestamp)
    }
    Text(formattedTime)
}

// 使用 derivedStateOf 避免不必要的重组
@Composable
fun CommandList(commands: List<CommandHistoryEntity>) {
    val filteredCommands by remember {
        derivedStateOf {
            commands.filter { it.status == "success" }
        }
    }
}
```

#### Paging 优化

```kotlin
// 配置 PagingConfig
Pager(
    config = PagingConfig(
        pageSize = 20,
        prefetchDistance = 10,
        maxSize = 200,
        enablePlaceholders = false,
        initialLoadSize = 40
    )
).flow.cachedIn(viewModelScope)
```

#### 图片优化

```kotlin
// 使用 Coil 加载图片
AsyncImage(
    model = ImageRequest.Builder(LocalContext.current)
        .data(imageUrl)
        .crossfade(true)
        .memoryCachePolicy(CachePolicy.ENABLED)
        .diskCachePolicy(CachePolicy.ENABLED)
        .build(),
    contentDescription = null
)
```

---

## 安全配置

### 7.1 网络安全

#### 启用 HTTPS（如果使用中继服务器）

```javascript
// 配置 P2P 中继服务器
{
  "p2p": {
    "relay": {
      "enabled": true,
      "servers": [
        {
          "url": "https://relay.chainlesschain.com",
          "secure": true
        }
      ]
    }
  }
}
```

#### 防火墙配置

**Windows**:
```bash
# 允许应用通过防火墙
netsh advfirewall firewall add rule name="ChainlessChain" dir=in action=allow program="C:\Program Files\ChainlessChain\chainlesschain.exe" enable=yes
```

**Linux (ufw)**:
```bash
# 允许 P2P 端口
sudo ufw allow 9000/tcp
sudo ufw allow 9000/udp
```

### 7.2 权限控制

#### PC 端命令权限

编辑 `.chainlesschain/security.json`:

```json
{
  "devicePermissions": {
    "did:key:z6Mk...": {
      "deviceName": "My Android Phone",
      "permissions": {
        "ai": {
          "chat": true,
          "ragSearch": true,
          "controlAgent": false
        },
        "system": {
          "screenshot": true,
          "getStatus": true,
          "getInfo": true,
          "execCommand": false,
          "notify": false
        }
      }
    }
  }
}
```

#### Android 端运行时权限

```kotlin
// 请求存储权限（用于保存截图）
val launcher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestPermission()
) { isGranted ->
    if (isGranted) {
        saveScreenshot()
    }
}

Button(onClick = {
    launcher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
}) {
    Text("保存截图")
}
```

### 7.3 数据加密

#### PC 端数据库加密

```javascript
// 使用 SQLCipher 加密数据库
const Database = require('better-sqlite3-multiple-ciphers');

const db = new Database(dbPath, {
  verbose: console.log
});

// 设置加密密钥
db.pragma('key="your-encryption-key"');
db.pragma('cipher="aes256cbc"');
```

#### P2P 通信加密

Signal 协议已内置端到端加密，无需额外配置。

---

## 监控和维护

### 8.1 日志管理

#### PC 端日志

**日志位置**:
```
Windows: %APPDATA%\chainlesschain-desktop-vue\logs\
macOS: ~/Library/Logs/chainlesschain-desktop-vue/
Linux: ~/.config/chainlesschain-desktop-vue/logs/
```

**日志级别**:
```javascript
// 配置日志级别
{
  "logging": {
    "level": "info",  // debug, info, warn, error
    "maxFileSize": "10MB",
    "maxFiles": 5
  }
}
```

#### 查看日志

```bash
# 实时查看日志
tail -f ~/.config/chainlesschain-desktop-vue/logs/main.log

# 查看错误日志
grep ERROR ~/.config/chainlesschain-desktop-vue/logs/main.log
```

### 8.2 数据库维护

#### 备份数据库

```bash
# 备份命令日志数据库
cp data/chainlesschain.db data/chainlesschain_backup_$(date +%Y%m%d).db
```

#### 清理旧数据

```bash
# 进入项目目录
cd desktop-app-vue

# 运行清理脚本（删除 30 天以前的日志）
node scripts/cleanup-old-logs.js
```

#### 数据库优化

```bash
# 运行 VACUUM 优化数据库
sqlite3 data/chainlesschain.db "VACUUM;"
```

### 8.3 性能监控

#### 查看统计数据

在 PC 端应用中：
1. 打开 "远程控制" → "命令日志"
2. 查看统计卡片和图表
3. 导出统计报告

#### 性能报告

```bash
# 生成性能报告
npm run benchmark:remote

# 查看报告
cat tests/reports/remote-performance-report.json
```

---

## 故障排查

### 9.1 PC 端问题

#### 问题: 应用无法启动

**可能原因**:
1. Node.js 版本不兼容
2. 数据库损坏
3. 端口被占用

**解决方法**:
```bash
# 1. 检查 Node.js 版本
node --version  # 应该是 v22.x

# 2. 重置数据库
rm -rf data/chainlesschain.db
npm run dev  # 会自动重新创建

# 3. 检查端口占用
# Windows
netstat -ano | findstr :9000

# macOS/Linux
lsof -i :9000

# 杀掉占用进程
# Windows
taskkill /PID <pid> /F

# macOS/Linux
kill -9 <pid>
```

#### 问题: AI 命令无响应

**解决方法**:
```bash
# 1. 检查 Ollama 服务
curl http://localhost:11434/api/tags

# 2. 重启 Ollama
# Windows
taskkill /IM ollama.exe /F
ollama serve

# macOS/Linux
pkill ollama
ollama serve

# 3. 检查模型是否已下载
ollama list
ollama pull qwen2:7b
```

### 9.2 Android 端问题

#### 问题: 应用闪退

**解决方法**:
```bash
# 1. 查看日志
adb logcat -s ChainlessChain:V

# 2. 清除应用数据
adb shell pm clear com.chainlesschain.android

# 3. 重新安装
./gradlew uninstallDebug installDebug
```

#### 问题: 连接失败

**解决方法**:
```bash
# 1. 检查网络连接
adb shell ping 8.8.8.8

# 2. 检查权限
adb shell dumpsys package com.chainlesschain.android | grep permission

# 3. 检查 PC 端状态
# 在 PC 端查看 P2P 状态
```

---

## 附录

### A. 配置参数完整列表

#### PC 端配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `remote.enableRemoteControl` | boolean | true | 启用远程控制 |
| `remote.enableLogging` | boolean | true | 启用日志记录 |
| `remote.performance.batchSize` | number | 50 | 批处理大小 |
| `remote.performance.batchInterval` | number | 1000 | 批处理间隔（ms） |
| `remote.performance.maxLogAge` | number | 2592000000 | 日志保留时间（ms） |
| `remote.performance.maxLogCount` | number | 100000 | 最大日志条数 |
| `remote.database.enableWAL` | boolean | true | 启用 WAL 模式 |
| `remote.database.cacheSize` | number | 10000 | 缓存页数 |

### B. 端口清单

| 服务 | 端口 | 协议 | 说明 |
|------|------|------|------|
| P2P | 9000 | TCP/UDP | P2P 网络通信 |
| Vite Dev | 5173 | TCP | 开发服务器 |
| Ollama | 11434 | TCP | LLM 服务 |
| Qdrant | 6333 | TCP | 向量数据库 |

### C. 常用命令速查

```bash
# PC 端
npm run dev              # 开发模式
npm run build            # 构建
npm run test             # 运行测试
npm run benchmark:remote # 性能测试

# Android 端
./gradlew assembleDebug  # 构建 Debug 版本
./gradlew installDebug   # 安装到设备
./gradlew test           # 运行测试
```

---

**最后更新**: 2026-01-27
**文档版本**: v1.0
**维护者**: ChainlessChain 团队
