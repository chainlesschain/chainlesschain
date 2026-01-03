# ChainlessChain 自动更新配置指南

本指南说明如何配置和使用 ChainlessChain 的自动更新功能。

## 功能概述

ChainlessChain 使用 `electron-updater` 实现自动更新功能：

✅ **自动检测** - 应用启动时自动检查更新
✅ **定期检查** - 每4小时自动检查一次
✅ **后台下载** - 静默下载更新包
✅ **用户确认** - 下载和安装前征求用户同意
✅ **增量更新** - 仅下载差异部分（Windows）
✅ **安全验证** - 验证更新包签名

## 工作原理

```
应用启动
    ↓
延迟3秒检查更新
    ↓
连接更新服务器
    ↓
发现新版本? ──No──> 继续使用
    ↓ Yes
显示更新提示
    ↓
用户确认下载? ──No──> 稍后提醒
    ↓ Yes
后台下载更新
    ↓
显示下载进度
    ↓
下载完成
    ↓
用户确认安装? ──No──> 下次启动安装
    ↓ Yes
退出并安装更新
    ↓
重启应用（新版本）
```

## 配置更新服务器

### 方案 1: GitHub Releases（推荐）

**优点**：
- ✅ 完全免费
- ✅ CDN 加速
- ✅ 自动托管
- ✅ 版本管理

**配置方法**：

1. **修改 package.json**：

```json
{
  "name": "chainlesschain-desktop-vue",
  "version": "0.1.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/chainlesschain/chainlesschain.git"
  },
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "chainlesschain",
        "repo": "chainlesschain"
      }
    ]
  }
}
```

2. **发布更新**：

```bash
# 构建安装程序
npm run package
npm run installer

# 发布到 GitHub Releases
gh release create v0.1.1 \
  out/installer/ChainlessChain-Setup-0.1.1.exe \
  --title "v0.1.1" \
  --notes "Bug fixes and improvements"

# electron-updater 会自动从 latest.yml 读取更新信息
```

3. **生成 latest.yml**：

在 `out/installer/` 目录创建 `latest.yml`：

```yaml
version: 0.1.1
files:
  - url: ChainlessChain-Setup-0.1.1.exe
    sha512: <SHA512-hash>
    size: 207651840
path: ChainlessChain-Setup-0.1.1.exe
sha512: <SHA512-hash>
releaseDate: '2026-01-01T00:00:00.000Z'
```

也上传这个文件到 Release。

### 方案 2: 自建更新服务器

**配置 Nginx**：

```nginx
server {
    listen 80;
    server_name updates.chainlesschain.com;

    root /var/www/updates;

    location / {
        add_header Access-Control-Allow-Origin *;
        autoindex on;
    }

    location ~ \.exe$ {
        add_header Content-Type application/octet-stream;
    }

    location ~ \.yml$ {
        add_header Content-Type text/yaml;
    }
}
```

**目录结构**：
```
/var/www/updates/
├── latest.yml
├── ChainlessChain-Setup-0.1.0.exe
└── ChainlessChain-Setup-0.1.1.exe
```

**在代码中设置**：

```javascript
// src/main/index.js
const autoUpdater = require('./auto-updater');

autoUpdater.setFeedURL('https://updates.chainlesschain.com');
```

### 方案 3: AWS S3 / Azure Blob

**AWS S3 配置**：

```json
{
  "build": {
    "publish": [
      {
        "provider": "s3",
        "bucket": "chainlesschain-updates",
        "region": "us-east-1"
      }
    ]
  }
}
```

## 集成到主进程

### 步骤 1: 导入自动更新模块

编辑 `src/main/index.js`：

```javascript
const { app, BrowserWindow } = require('electron');
const autoUpdater = require('./auto-updater');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js')
    }
  });

  // 加载页面
  mainWindow.loadFile('dist/renderer/index.html');

  // 初始化自动更新
  autoUpdater.init(mainWindow);
}

app.on('ready', createWindow);

app.on('will-quit', () => {
  // 清理资源
  autoUpdater.cleanup();
});
```

### 步骤 2: 添加 IPC 处理

添加手动检查更新的功能：

```javascript
const { ipcMain } = require('electron');

// 手动检查更新
ipcMain.handle('check-for-updates', async () => {
  return await autoUpdater.checkForUpdates();
});

// 获取更新配置
ipcMain.handle('get-update-config', () => {
  return autoUpdater.getConfig();
});

// 设置更新服务器
ipcMain.handle('set-update-server', (event, url) => {
  autoUpdater.setFeedURL(url);
});
```

### 步骤 3: 添加到预加载脚本

编辑 `src/preload/index.js`：

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // ... 其他API ...

  // 自动更新 API
  updates: {
    check: () => ipcRenderer.invoke('check-for-updates'),
    getConfig: () => ipcRenderer.invoke('get-update-config'),
    setServer: (url) => ipcRenderer.invoke('set-update-server', url),
    onStatus: (callback) => {
      ipcRenderer.on('update-status', (event, data) => callback(data));
    }
  }
});
```

## 渲染进程使用

### 创建更新组件

```vue
<template>
  <div class="update-checker">
    <a-button @click="checkUpdate" :loading="checking">
      检查更新
    </a-button>

    <div v-if="updateStatus" class="status">
      {{ updateStatus.status }}
      <a-progress
        v-if="updateStatus.data && updateStatus.data.percent"
        :percent="Math.round(updateStatus.data.percent)"
      />
    </div>

    <div v-if="updateConfig" class="config">
      <p>当前版本: v{{ updateConfig.currentVersion }}</p>
      <p>检查间隔: 每 {{ updateConfig.checkIntervalHours }} 小时</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const checking = ref(false);
const updateStatus = ref(null);
const updateConfig = ref(null);

// 检查更新
async function checkUpdate() {
  checking.value = true;
  try {
    await window.electron.updates.check();
  } finally {
    checking.value = false;
  }
}

// 获取配置
async function loadConfig() {
  updateConfig.value = await window.electron.updates.getConfig();
}

// 监听更新状态
function handleUpdateStatus(status) {
  updateStatus.value = status;
  console.log('更新状态:', status);
}

onMounted(() => {
  loadConfig();
  window.electron.updates.onStatus(handleUpdateStatus);
});

onUnmounted(() => {
  // 清理监听器
});
</script>

<style scoped>
.update-checker {
  padding: 20px;
}

.status {
  margin-top: 10px;
}

.config {
  margin-top: 20px;
  font-size: 12px;
  color: #666;
}
</style>
```

## 发布新版本

### 步骤 1: 更新版本号

编辑 `package.json`:

```json
{
  "version": "0.1.1"
}
```

### 步骤 2: 构建安装程序

```bash
cd desktop-app-vue

# 清理旧构建
rm -rf out/

# 重新打包
npm run package

# 构建安装程序
npm run installer

# 或合并为一步
npm run build && npm run package && npm run installer
```

### 步骤 3: 生成更新文件

**自动生成**（使用 electron-builder）：

```bash
npm install electron-builder --save-dev

# 在 package.json 中配置
{
  "scripts": {
    "build:release": "electron-builder --win --publish never"
  },
  "build": {
    "appId": "com.chainlesschain.app",
    "productName": "ChainlessChain",
    "win": {
      "target": ["nsis"]
    },
    "publish": {
      "provider": "github"
    }
  }
}
```

**手动生成 latest.yml**：

```bash
# 计算 SHA512
certutil -hashfile ChainlessChain-Setup-0.1.1.exe SHA512

# 创建 latest.yml
cat > latest.yml << EOF
version: 0.1.1
files:
  - url: ChainlessChain-Setup-0.1.1.exe
    sha512: <复制上面的哈希值>
    size: $(stat -f%z ChainlessChain-Setup-0.1.1.exe)
path: ChainlessChain-Setup-0.1.1.exe
sha512: <复制上面的哈希值>
releaseDate: '$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'
EOF
```

### 步骤 4: 发布到 GitHub

```bash
gh release create v0.1.1 \
  out/installer/ChainlessChain-Setup-0.1.1.exe \
  out/installer/latest.yml \
  --title "ChainlessChain v0.1.1" \
  --notes "
## What's New

- Bug fixes
- Performance improvements
- New features

## Installation

Download and run \`ChainlessChain-Setup-0.1.1.exe\`

## Auto-Update

Existing users will be notified of this update automatically.
"
```

## 测试更新流程

### 本地测试

1. **设置本地更新服务器**：

```bash
# 在 out/installer 目录启动静态服务器
cd out/installer
python -m http.server 8000
```

2. **修改代码指向本地服务器**：

```javascript
// src/main/index.js (仅测试用)
if (process.env.UPDATE_SERVER) {
  autoUpdater.setFeedURL(process.env.UPDATE_SERVER);
}

// 运行时
UPDATE_SERVER=http://localhost:8000 npm run dev
```

3. **模拟新版本**：

- 修改 `package.json` 版本号为 0.1.0
- 构建并运行应用
- 在本地服务器放置 0.1.1 版本
- 应用应检测到更新

### 生产测试

1. **beta 频道**：

```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "chainlesschain",
        "repo": "chainlesschain",
        "channel": "beta"
      }
    ]
  }
}
```

2. **测试用户组**：

- 创建 beta 版本
- 邀请测试用户安装
- 验证更新流程

## 高级配置

### 差分更新（Windows）

electron-updater 自动支持差分更新：

```javascript
autoUpdater.autoDownload = true;  // 自动下载（默认）
autoUpdater.autoInstallOnAppQuit = true;  // 退出时安装
```

### 自定义更新策略

```javascript
// 仅在 WiFi 下下载更新
autoUpdater.on('update-available', (info) => {
  // 检查网络类型
  if (isOnWiFi()) {
    autoUpdater.downloadUpdate();
  } else {
    // 提示用户连接 WiFi
  }
});
```

### 回滚机制

```javascript
// 保存上一个可用版本
const lastWorkingVersion = getUserPreference('lastWorkingVersion');

if (currentVersion !== lastWorkingVersion) {
  // 检查应用是否正常工作
  if (!appWorksCorrectly()) {
    // 提示用户回滚
    showRollbackDialog(lastWorkingVersion);
  } else {
    // 保存当前版本为可用版本
    setUserPreference('lastWorkingVersion', currentVersion);
  }
}
```

## 故障排除

### 更新检查失败

**问题**: 应用无法连接到更新服务器

**解决方案**:
1. 检查网络连接
2. 验证更新服务器 URL
3. 检查防火墙设置
4. 查看日志：`%APPDATA%/chainlesschain-desktop-vue/logs/main.log`

### 下载失败

**问题**: 更新下载中断

**解决方案**:
1. electron-updater 会自动重试
2. 检查磁盘空间
3. 验证更新包 SHA512

### 安装失败

**问题**: 更新安装失败

**解决方案**:
1. 确保应用有写入权限
2. 关闭杀毒软件临时
3. 手动下载完整安装程序

## 监控和分析

### 日志记录

electron-updater 自动记录到：
```
%APPDATA%/chainlesschain-desktop-vue/logs/main.log
```

### 更新统计

在更新服务器收集统计：

```javascript
// 发送更新统计
autoUpdater.on('update-downloaded', () => {
  fetch('https://api.yourserver.com/stats/update', {
    method: 'POST',
    body: JSON.stringify({
      version: app.getVersion(),
      platform: process.platform,
      timestamp: Date.now()
    })
  });
});
```

## 最佳实践

1. ✅ **频繁发布小更新** - 比大更新更安全
2. ✅ **测试更新流程** - 每次发布前测试
3. ✅ **保持向后兼容** - 避免破坏性更新
4. ✅ **提供回滚选项** - 以防更新问题
5. ✅ **记录详细日志** - 便于调试问题
6. ✅ **通知用户变更** - 显示更新日志
7. ✅ **签名更新包** - 确保安全性

## 安全考虑

- ✅ 使用 HTTPS 更新服务器
- ✅ 验证更新包签名
- ✅ 检查 SHA512 哈希
- ✅ 使用代码签名证书
- ✅ 不在更新中包含敏感数据

## 总结

自动更新功能已配置完成！用户将自动获得最新版本，无需手动下载安装。

**快速检查清单**：
- [ ] electron-updater 已安装
- [ ] auto-updater.js 已创建
- [ ] 主进程已集成
- [ ] IPC 处理已添加
- [ ] 渲染进程组件已创建
- [ ] GitHub Releases 或更新服务器已配置
- [ ] latest.yml 生成脚本已准备
- [ ] 测试更新流程
- [ ] 文档已更新

---

**参考资源**：
- electron-updater: https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater
- 发布指南: https://www.electron.build/configuration/publish
