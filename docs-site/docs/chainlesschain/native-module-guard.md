# 原生模块保护

> v5.0.1 新增

## 概述

v5.0.1 对桌面应用的所有原生/可选模块引用添加了安全守卫（guard），确保在打包后的生产环境中，���使某些原生模块不可用，应用也能正常启动并优雅降级。

## 问题背景

桌面应用（Electron）依赖多个原生 Node.js 模块：

| 模块             | 用途           | 平台限制     |
| ---------------- | -------------- | ------------ |
| `koffi`          | U-Key FFI 调用 | Windows only |
| `sharp`          | 图像处理       | 需要编译     |
| `better-sqlite3` | SQLite 数据库  | 需要编译     |
| `node-pty`       | 终端模拟       | 需要编译     |

在 Electron 打包（`electron-forge`）过程中，这些模块可能因为：

1. 平台不匹配（如 macOS 上缺少 Windows DLL）
2. 架构不匹配（arm64 vs x64）
3. 打包工具未正确包含 `.node` 文件

导致 `require()` 失败，抛出异常并阻止应用启动。

## 解决方案

### 安全 require 模式

所有原生模块的 `require()` 调用都被包裹在 try-catch 中：

```javascript
let nativeModule = null;
try {
  nativeModule = require("native-module");
} catch (_err) {
  // 原生模块不可用，使用降级方案
  console.warn("native-module not available, using fallback");
}
```

### 受保护的模块

v5.0.1 中以下文件添加了原生模块守卫：

- `src/main/file-sync/sync-manager.js` — 文件同步
- `src/main/git/git-hot-reload.js` — Git 热重载
- `src/main/llm/memory-file-watcher.js` — 记忆文件监听
- `src/main/project/automation-manager.js` — 自动化管理
- `src/main/project/file-cache-manager.js` — 文件缓存
- `src/main/project/project-rag.js` — 项目 RAG
- `src/main/project/stats-collector.js` — 统计收集

### 降级策略

| 模块             | 降级方案                   |
| ---------------- | -------------------------- |
| `sharp`          | 跳过图像优化，使用原始图片 |
| `koffi`          | 使用 U-Key 模拟模式        |
| `better-sqlite3` | 提示用户重新安装           |
| `chokidar`       | 禁用文件监听功能           |

## 影响

- 生产打包后应用可以在所有平台正常启动
- 功能在原生模块不可用时优雅降级
- 开发模式下不受影响（所有模块正常加载）
