# unified-config-manager

**Source**: `src/main/config/unified-config-manager.js`

**Generated**: 2026-02-17T10:13:18.254Z

---

## const

```javascript
const
```

* 统一配置管理器
 *
 * 基于 OpenClaude 最佳实践，集中管理所有配置、日志、缓存和会话数据
 *
 * 目录结构（位于 Electron userData 目录下）：
 * .chainlesschain/
 * ├── config.json              # 核心配置
 * ├── rules.md                 # 项目规则
 * ├── memory/                  # 会话与学习数据
 * │   ├── sessions/            # 会话历史
 * │   ├── preferences/         # 用户偏好
 * │   └── learned-patterns/    # 学习到的模式
 * ├── logs/                    # 操作日志
 * │   ├── error.log
 * │   ├── performance.log
 * │   └── llm-usage.log
 * ├── cache/                   # 缓存数据
 * │   ├── embeddings/          # 向量缓存
 * │   ├── query-results/       # 查询结果缓存
 * │   └── model-outputs/       # 模型输出缓存
 * └── checkpoints/             # 检查点和备份
 *     └── auto-backup/
 *
 * @version 1.1.0
 * @since 2026-01-16
 * @updated 2026-01-18 - 使用 Electron userData 目录替代 process.cwd()

---

## function getConfigDir()

```javascript
function getConfigDir()
```

* 获取配置目录路径
 * 优先使用 Electron 的 userData 目录，确保开发和生产环境一致
 * @returns {string} 配置目录路径

---

## class UnifiedConfigManager

```javascript
class UnifiedConfigManager
```

* 统一配置管理器类

---

## initialize()

```javascript
initialize()
```

* 初始化配置管理器
   * - 迁移旧配置（从项目根目录）
   * - 创建目录结构
   * - 加载配置文件
   * - 合并环境变量

---

## migrateFromProjectRoot()

```javascript
migrateFromProjectRoot()
```

* 从项目根目录迁移配置到 userData 目录
   * 仅在 userData 目录没有配置文件时执行

---

## migrateDirectory(srcDir, destDir)

```javascript
migrateDirectory(srcDir, destDir)
```

* 递归迁移目录
   * @param {string} srcDir - 源目录
   * @param {string} destDir - 目标目录

---

## ensureDirectoryStructure()

```javascript
ensureDirectoryStructure()
```

* 确保目录结构存在

---

## createGitkeepFiles()

```javascript
createGitkeepFiles()
```

* 在空目录中创建 .gitkeep 文件

---

## loadConfig()

```javascript
loadConfig()
```

* 加载配置文件

---

## getDefaultConfig()

```javascript
getDefaultConfig()
```

* 获取默认配置

---

## getEnvConfig()

```javascript
getEnvConfig()
```

* 从环境变量获取配置

---

## mergeConfigs(...configs)

```javascript
mergeConfigs(...configs)
```

* 深度合并配置对象

---

## validateConfig()

```javascript
validateConfig()
```

* 验证配置

---

## saveConfig()

```javascript
saveConfig()
```

* 保存配置文件

---

## getAllConfig()

```javascript
getAllConfig()
```

* 获取所有配置

---

## getConfig(category)

```javascript
getConfig(category)
```

* 获取特定配置

---

## updateConfig(updates)

```javascript
updateConfig(updates)
```

* 更新配置

---

## resetConfig()

```javascript
resetConfig()
```

* 重置为默认配置

---

## getPaths()

```javascript
getPaths()
```

* 获取路径配置

---

## getLogsDir()

```javascript
getLogsDir()
```

* 获取日志目录

---

## getCacheDir()

```javascript
getCacheDir()
```

* 获取缓存目录

---

## getSessionsDir()

```javascript
getSessionsDir()
```

* 获取会话目录

---

## getCheckpointsDir()

```javascript
getCheckpointsDir()
```

* 获取检查点目录

---

## clearCache(type = "all")

```javascript
clearCache(type = "all")
```

* 清理缓存
   * @param {string} type - 缓存类型：'all', 'embeddings', 'queryResults', 'modelOutputs'

---

## cleanOldLogs(maxFiles = 30)

```javascript
cleanOldLogs(maxFiles = 30)
```

* 清理旧日志文件
   * @param {number} maxFiles - 保留的最大文件数

---

## exportConfig(exportPath)

```javascript
exportConfig(exportPath)
```

* 导出配置
   * @param {string} exportPath - 导出路径

---

## importConfig(importPath)

```javascript
importConfig(importPath)
```

* 导入配置
   * @param {string} importPath - 导入路径

---

## getConfigSummary()

```javascript
getConfigSummary()
```

* 获取配置摘要（用于调试）

---

## getDirectoryStats()

```javascript
getDirectoryStats()
```

* 获取目录统计信息
   * @returns {Object} 目录统计

---

## function getUnifiedConfigManager()

```javascript
function getUnifiedConfigManager()
```

* 获取统一配置管理器实例

---

## function getCurrentConfigDir()

```javascript
function getCurrentConfigDir()
```

* 获取当前配置目录路径
 * @returns {string} 配置目录路径

---

