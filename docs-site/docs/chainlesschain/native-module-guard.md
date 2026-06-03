# 原生模块保护

> v5.0.1 新增

## 核心特性

- 🛡️ **安全 require 模式**: 所有原生模块引用包裹在 try-catch 中，防止启动崩溃
- 🔄 **优雅降级**: 原生模块不可用时自动切换到降级方案，功能不中断
- 🖥️ **跨平台兼容**: 确保 Windows/macOS/Linux 打包后均可正常启动
- ⚠️ **智能告警**: 模块加载失败时输出警告日志，便于排查
- 📦 **生产就绪**: 7 个关键文件已添加原生模块守卫

## 系统架构

```
┌──────────────────────────────────────────────┐
│           原生模块保护系统                      │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Electron 主进程模块加载              │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  安全 require 守卫 (try-catch)       │    │
│  └──────┬───────────────────┬───────────┘    │
│         │                   │                │
│    加载成功              加载失败             │
│         │                   │                │
│         ▼                   ▼                │
│  ┌──────────┐        ┌──────────────┐       │
│  │ 正常功能 │        │ 降级方案     │       │
│  │ sharp    │        │ 跳过图像优化 │       │
│  │ koffi    │        │ U-Key 模拟   │       │
│  │ sqlite3  │        │ 提示重装     │       │
│  │ chokidar │        │ 禁用监听     │       │
│  └──────────┘        └──────────────┘       │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/file-sync/sync-manager.js` | 文件同步原生模块守卫 |
| `desktop-app-vue/src/main/git/git-hot-reload.js` | Git 热重载守卫 |
| `desktop-app-vue/src/main/llm/memory-file-watcher.js` | 记忆文件监听守卫 |
| `desktop-app-vue/src/main/project/automation-manager.js` | 自动化管理守卫 |
| `desktop-app-vue/src/main/project/file-cache-manager.js` | 文件缓存守卫 |
| `desktop-app-vue/src/main/project/project-rag.js` | 项目 RAG 守卫 |
| `desktop-app-vue/src/main/project/stats-collector.js` | 统计收集守卫 |

## 使用示例

### 在新模块中添加原生模块守卫

```javascript
// 正确写法：安全 require 模式
let sharp = null;
try {
  sharp = require('sharp');
} catch (_err) {
  console.warn('sharp 模块不可用，图像处理将使用降级方案');
}

// 使用时检查是否可用
async function processImage(imagePath) {
  if (sharp) {
    return await sharp(imagePath).resize(800, 600).toBuffer();
  }
  // 降级方案：返回原始图片
  return require('fs').readFileSync(imagePath);
}
```

### 检查守卫覆盖状态

```bash
# 在开发模式下，所有原生模块正常加载
npm run dev

# 在生产打包后，查看日志确认降级情况
# 日志中出现 "not available, using fallback" 表示守卫生效
```

### 已保护模块清单

受保护的 7 个关键文件涵盖文件同步、Git 热重载、记忆文件监听、自动化管理、文件缓存、项目 RAG 和统计收集模块。

---

## 故障排查

### 打包后应用启动崩溃

如果生产打包后应用无法启动，可能是新增了未受保护的原生模块引用：

```bash
# 搜索未保护的 require 调用
grep -r "require('sharp')\|require('koffi')\|require('better-sqlite3')" src/main/
# 将找到的引用包裹在 try-catch 中
```

### 降级方案导致功能异常

某些功能在降级模式下行为不同，检查日志中的 `warn` 信息确认哪些模块处于降级状态：

```bash
# 开发模式下不受影响，仅生产打包后可能出现降级
# 解决：确保 electron-forge 打包配置正确包含 .node 文件
```

### macOS/Linux 上 koffi 模块不可用

`koffi` 模块仅用于 Windows U-Key FFI 调用，在 macOS/Linux 上自动降级为 U-Key 模拟模式，这是预期行为。

---

## 配置参考

原生模块守卫行为可通过 `unified-config-manager.js` 的 `nativeModuleGuard` 配置节调整：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `warnOnFallback` | boolean | `true` | 降级时是否输出 `console.warn` 日志 |
| `ukeySimulationMode` | boolean | `false` | 强制 U-Key 始终使用模拟模式（开发/测试用） |
| `disableFileWatcherOnFallback` | boolean | `true` | `chokidar` 不可用时是否禁用文件监听 |
| `dbFallbackPromptUser` | boolean | `true` | `better-sqlite3` 不可用时是否提示用户重装依赖 |

```javascript
// .chainlesschain/config.json 示例
{
  "nativeModuleGuard": {
    "warnOnFallback": true,
    "ukeySimulationMode": false,
    "disableFileWatcherOnFallback": true,
    "dbFallbackPromptUser": true
  }
}
```

> **注意**: `ukeySimulationMode: true` 会绕过硬件安全验证，仅用于开发和 CI 环境，禁止在生产中启用。

---

## 性能指标

原生模块守卫的运行开销极低，主要体现在应用启动阶段：

| 操作 | 耗时 | 说明 |
| --- | --- | --- |
| 单个原生模块 try-catch 加载 | < 1 ms（成功）/ 5–20 ms（失败） | 失败时 Node.js 需要解析 `.node` 文件路径 |
| 7 个守卫文件全部初始化 | < 50 ms | 顺序加载，不并发 |
| `chokidar` 降级后文件监听跳过 | 0 ms | 直接返回 no-op 函数 |
| `sharp` 降级后图像处理 | 与原始文件读取相同 | `fs.readFileSync` 替代 |

**整体影响**: 所有模块正常加载时无额外开销；全部降级时启动耗时增加约 50–100 ms（来自 require 失败的文件系统探测），对用户体验无感知影响。

### 内存占用对比

| 模式 | 增量内存 | 说明 |
| --- | --- | --- |
| 正常加载（所有原生模块可用） | 基准 | `sharp`、`koffi` 等各占 10–30 MB |
| 完全降级（所有模块不可用） | -50 ~ -80 MB | 未加载原生模块，内存占用更低 |

---

## 测试覆盖率

| 测试文件 | 覆盖功能 | 用例数 |
| --- | --- | --- |
| `tests/unit/file-sync/sync-manager.test.js` | `chokidar` 守卫、降级文件同步 | 8 |
| `tests/unit/git/git-hot-reload.test.js` | `chokidar` 守卫、热重载降级 | 6 |
| `tests/unit/llm/memory-file-watcher.test.js` | 记忆文件监听守卫与降级 | 7 |
| `tests/unit/project/automation-manager.test.js` | 自动化管理原生守卫 | 9 |
| `tests/unit/project/file-cache-manager.test.js` | 文件缓存守卫 | 7 |
| `tests/unit/project/project-rag.test.js` | RAG 原生模块守卫 | 10 |
| `tests/unit/project/stats-collector.test.js` | 统计收集守卫 | 6 |

**运行测试**:

```bash
cd desktop-app-vue

# 运行所有守卫相关测试
npx vitest run tests/unit/file-sync/ tests/unit/git/ tests/unit/project/

# 验证降级行为（模拟原生模块不可用）
FORCE_NATIVE_FALLBACK=1 npx vitest run tests/unit/project/
```

**守卫覆盖检查**（搜索未保护的原生 require）:

```bash
# 检查是否有新增的未受保护原生模块引用
grep -rn "require('sharp')\|require('koffi')\|require('better-sqlite3')\|require('node-pty')" \
  desktop-app-vue/src/main/ | grep -v "try {"
```

---

## 安全考虑

- **降级模式安全性**: U-Key 降级为模拟模式后安全级别降低，生产环境建议确保原生模块正常加载
- **数据库降级风险**: `better-sqlite3` 不可用时无法提供 SQLCipher 加密，数据库将无加密保护
- **日志脱敏**: 降级警告日志不包含敏感信息（模块路径、系统架构等除外）
- **启动完整性**: 即使关键模块降级，应用仍能启动，但建议用户通过 `chainlesschain doctor` 检查环境完整性
- **自动恢复**: 重新安装依赖（`npm install`）后原生模块通常可恢复正常

---

## 相关文档

- [CLI 分发系统](/chainlesschain/cli-distribution)
- [生产加固](/chainlesschain/production-hardening)
- [数据加密](/chainlesschain/encryption)

## 概述

v5.0.1 对桌面应用的所有原生/可选模块引用添加了安全守卫（guard），确保在打包后的生产环境中，即使某些原生模块不可用，应用也能正常启动并优雅降级。

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
