# config 命令

> 管理 ChainlessChain 配置 — 查看、修改和重置系统配置

## 概述

`config` 命令用于管理 ChainlessChain 的系统配置，支持查看、读取、设置和重置配置项。配置文件采用 JSON 格式存储在本地，支持点号表示法访问嵌套键名，敏感信息（如 API 密钥）在输出时自动遮蔽。

## 核心特性

- 🔹 **配置查看**: 列出所有配置项，敏感信息自动遮蔽
- 🔹 **点号表示法**: 支持 `llm.provider` 等嵌套键名的读写
- 🔹 **编辑器集成**: 直接在默认编辑器中打开配置文件
- 🔹 **一键重置**: 恢复所有配置为默认值（带确认提示）
- 🔹 **安全输出**: 包含 "key" 的配置值自动显示为 `****`

## 系统架构

```
chainlesschain config
    │
    ├── list ────▶ loadConfig() ──▶ 递归打印所有配置项
    │                                （key 类字段自动遮蔽）
    │
    ├── get <key> ▶ getConfigValue(key) ──▶ 支持点号表示法
    │
    ├── set <key> <value> ▶ setConfigValue(key, value) ──▶ 写入 config.json
    │
    ├── edit ────▶ 打开 $EDITOR / $VISUAL / notepad / vi
    │
    └── reset ───▶ askConfirm() ──▶ resetConfig() ──▶ 恢复默认值
```

## 子命令

### config list

显示所有配置值。

```bash
chainlesschain config list
```

### config get

获取指定配置值（支持点号表示法）。

```bash
chainlesschain config get <key>
```

| 参数 | 说明 |
|------|------|
| `<key>` | 配置键名，支持点号嵌套（如 `llm.provider`） |

### config set

设置指定配置值。

```bash
chainlesschain config set <key> <value>
```

| 参数 | 说明 |
|------|------|
| `<key>` | 配置键名（点号表示法） |
| `<value>` | 要设置的值 |

### config edit

在默认编辑器中打开配置文件。

```bash
chainlesschain config edit
```

编辑器选择优先级：`$EDITOR` > `$VISUAL` > `notepad`（Windows）/ `vi`（其他平台）

### config reset

重置所有配置为默认值。

```bash
chainlesschain config reset
```

执行前会弹出确认提示，防止误操作。

## 关键文件

- `packages/cli/src/commands/config.js` — 命令注册与子命令定义
- `packages/cli/src/lib/config-manager.js` — 配置管理核心：loadConfig、getConfigValue、setConfigValue、resetConfig、saveConfig
- `packages/cli/src/lib/paths.js` — 配置文件路径获取（`getConfigPath()`）
- `packages/cli/src/lib/prompts.js` — 交互式确认提示（`askConfirm()`）

## 安全考虑

- 包含 `key` 关键字的配置值（如 API 密钥）在 `config list` 中自动显示为 `****`
- `config.json` 文件应设置适当的文件权限，避免其他用户读取
- 配置文件已加入 `.gitignore`，不会被意外提交到版本控制
- `config reset` 操作不可逆，需要交互确认

## 使用示例

### 场景 1：查看所有配置

```bash
chainlesschain config list
```

输出示例：
```
  Config: /home/user/.chainlesschain/config.json

  llm:
    provider: ollama
    model: qwen2:7b
    apiKey: ****
  database:
    path: /home/user/.chainlesschain/data/chainlesschain.db
```

### 场景 2：读取特定配置

```bash
chainlesschain config get llm.provider
# 输出: ollama
```

### 场景 3：修改 LLM 提供商

```bash
chainlesschain config set llm.provider openai
# 输出: Set llm.provider = openai
```

### 场景 4：用编辑器编辑配置

```bash
EDITOR=code chainlesschain config edit
```

### 场景 5：重置为默认配置

```bash
chainlesschain config reset
# 提示: Reset all configuration to defaults? (y/N)
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Key not found` | 检查键名拼写，使用 `config list` 查看所有可用键 |
| 编辑器未打开 | 设置 `EDITOR` 环境变量，如 `export EDITOR=nano` |
| 配置文件不存在 | 运行 `chainlesschain setup` 初始化 |
| 修改后不生效 | 重启应用以加载新配置 |
| Windows 中文乱码 | 配置文件使用 UTF-8 编码，确保编辑器以 UTF-8 打开 |

## 相关文档

- [setup 命令](./cli-setup) — 交互式初始化向导（会创建配置文件）
- [doctor 命令](./cli-doctor) — 环境诊断（检查配置文件是否存在）
