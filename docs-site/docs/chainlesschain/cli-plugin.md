# 插件市场 (plugin)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容���化等无桌面环境。

## 核心特性

- 📦 **插件安装**: 安装/卸载/更新插件完整生命周期
- 🔄 **启停控制**: 单独启用/禁用已安装的插件
- 🛒 **注册表/市场**: 搜索和浏览插件注册表
- ⚙️ **插件设置**: 每个插件独立的键值对配置
- 📊 **安装统计**: 已安装数、已启用数、注册表总数

## 系统架构

```
plugin 命令 → plugin.js (Commander) → plugin-manager.js
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
           插件生命周期               插件设置                 注册表/市场
        install/remove/update    get/set settings          search/browse
                  │                        │                        │
                  ▼                        ▼                        ▼
           plugins 表            plugin_settings 表       plugin_registry 表
```

## 概述

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

## 安全考虑

- 插件安装记录权限信息，支持权限审计
- 卸载时级联清理插件设置数据
- 注册表搜索仅匹配名称和描述，不执行代码

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `install` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `search` 无结果 | 尝试更短的关键词，或用 `registry` 浏览全部 |
| `enable` 报插件不存在 | 确认插件已安装：`chainlesschain plugin list` |

## 关键文件

- `packages/cli/src/commands/plugin.js` — 命令实现
- `packages/cli/src/lib/plugin-manager.js` — 插件管理库

## 相关文档

- [技能系统](./cli-skill) — 内置技能管理
- [技能市场](./skill-marketplace) — 桌面端插件生态
- [CLI 命令行工具](./cli) — 完整命令参考

## 依赖

- 纯 Node.js crypto（ID 生成）
- 无外部依赖
