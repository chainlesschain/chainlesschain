# 插件市场 (plugin)

CLI Phase 5 — 插件安装、管理和注册表搜索。

## 命令概览

```bash
chainlesschain plugin list                         # 列出已安装插件
chainlesschain plugin install <name> --version <v> # 安装插件
chainlesschain plugin remove <name>                # 卸载插件
chainlesschain plugin enable <name>                # 启用插件
chainlesschain plugin disable <name>               # 禁用插件
chainlesschain plugin update <name> --version <v>  # 更新插件
chainlesschain plugin info <name>                  # 插件详情
chainlesschain plugin search <query>               # 搜索注册表
chainlesschain plugin registry                     # 浏览注册表
chainlesschain plugin summary                      # 安装统计
```

## 功能说明

### 插件生命周期

- `installPlugin` — 安装插件（记录名称、版本、作者、权限等）
- `enablePlugin` / `disablePlugin` — 启用/禁用
- `removePlugin` — 卸载（同时清理设置）
- `updatePlugin` — 更新版本

### 插件设置

- `setPluginSetting(db, pluginName, key, value)` — 设置配置项
- `getPluginSetting` — 读取单个配置
- `getPluginSettings` — 读取所有配置

### 注册表/市场

- `registerInMarketplace` — 注册插件到市场
- `searchRegistry` — 按名称/描述搜索（模糊匹配）
- `listRegistry` — 浏览所有注册表插件（按下载量排序）

### 统计

- `getPluginSummary` — 已安装数、已启用数、注册表总数

## 数据库表

| 表名 | 说明 |
|------|------|
| `plugins` | 已安装插件（名称、版本、状态、启停标记） |
| `plugin_settings` | 插件配置键值对 |
| `plugin_registry` | 注册表/市场目录 |

## 依赖

- 纯 Node.js crypto（ID 生成）
- 无外部依赖
