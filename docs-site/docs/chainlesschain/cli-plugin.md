# 插件市场 (plugin)

> **CLI 0.164.0 | Headless 命令 | 受治理多 Registry 候选选择、升级影响与制品回读**
>
> 不依赖桌面 GUI，适用于服务器、CI/CD、容器化等无桌面环境。`catalog` / `select` / `impact` / `evidence` 是 `0.164.0` 的稳定契约；当前 HEAD 的后续修复不改变该 tarball 内容。

## 核心特性

- 📦 **插件安装**: 安装/卸载/更新插件完整生命周期
- 🔄 **启停控制**: 单独启用/禁用已安装的插件
- 🛒 **注册表/市场**: 搜索和浏览插件注册表
- 🔎 **受治理目录**: 跨精确 registry 集合审阅 digest、签名、SBOM、许可证、能力、依赖与健康信息
- ⚖️ **候选与影响**: 确定性选择候选，升级前比较版本、来源、完整性、许可证、能力和依赖变化
- 🧾 **制品回读**: 从已安装 bytes 回读 manifest、license、signature 与 payload SBOM，严格模式对 partial 证据返回非零状态
- ⚙️ **插件设置**: 每个插件独立的键值对配置
- 📊 **安装统计**: 已安装数、已启用数、注册表总数
- 🎯 **技能集成**: 插件可声明技能，安装时自动部署到 marketplace 层

## 系统架构

```
plugin 命令 → plugin.js (Commander)
       ├─ legacy DB lifecycle → plugin-manager.js → plugins / settings / registry 表
       └─ unified runtime
            ├─ catalog / selection → 精确 registry-set projection
            ├─ impact             → installed ↔ candidate 变更投影
            ├─ add / upgrade       → staging 校验 + authority + atomic activation
            └─ evidence            → installed bytes / manifest / signature / SBOM 回读
```

## 概述

CLI 同时保留早期 DB-backed `install/remove/update` 生命周期和统一 runtime `add/upgrade/use/uninstall`。远程市场路径先生成版本化证据投影，再由 mutation 路径重新核验 authority；搜索结果或旧投影本身不是安装授权。

## 命令概览

```bash
chainlesschain plugin list                         # 列出已安装插件
chainlesschain plugin install <name> --version <v> # 安装插件
chainlesschain plugin remove <name>                # 卸载插件
chainlesschain plugin enable <name>                # 启用插件
chainlesschain plugin disable <name>               # 禁用插件
chainlesschain plugin update <name> <version>      # 更新 DB-backed 插件记录
chainlesschain plugin info <name>                  # 插件详情
chainlesschain plugin search <query>               # 搜索注册表
chainlesschain plugin registry                     # 浏览注册表
chainlesschain plugin summary                      # 安装统计
chainlesschain plugin catalog [query] --registry <url> --strict --json
chainlesschain plugin select <name> --registry <url> --strict --json
chainlesschain plugin impact <name> --registry <url> --scope user --json
chainlesschain plugin add <source> --scope user    # 统一 runtime 安装
chainlesschain plugin upgrade <source> --scope user
chainlesschain plugin evidence <name> --scope user --strict --json
chainlesschain plugin use <name> <version>         # 切换/回滚 active 版本
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

### 受治理市场（0.164.0）

- `catalog [query]`：对一个或多个 `--registry` 生成有界版本化目录投影；`--strict` 阻止缺 digest、signature、SBOM、license 或 capabilities 的候选。
- `select <name>`：在精确 registry 集合中选择最高排名候选；早出现的 registry 只在同版本 tie-break 时优先。
- `impact <name>`：把当前已安装版本与候选的 source、integrity、license、capability 和 dependency 逐项比较。
- `evidence <name>`：从 active 安装目录重新读取 manifest、license、signature 和 payload SBOM；`--strict` 在任一 expectation 为 partial 时返回非零状态。
- `add` / `upgrade`：在 staging 中复核 source/digest/signature/SBOM、能力同意和组织策略，成功后原子切换 `.active`；失败保持旧版本。
- `use <name> <version>`：只切换到已经安装且证据有效的版本，用于受控回滚。

`--allow-insecure-registry` 会允许 HTTP registry，存在 MITM 风险，只应在明确受信的隔离网络使用。私有源使用 `--token`；不要把 token 写进文档、命令历史或 JSON 报告。

### 统计

- `getPluginSummary` — 已安装数、已启用数、注册表总数

## 插件技能集成

插件可在 manifest 中声明技能，安装时自动部署到 marketplace 技能层：

```bash
chainlesschain plugin install my-plugin --manifest ./manifest.json
```

manifest.json 示例：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "skills": [{ "name": "my-skill", "path": "skills/my-skill" }]
}
```

安装时技能目录复制到 `<userData>/marketplace/skills/`，卸载时自动清理。

## 数据库表

| 表名              | 说明                                      |
| ----------------- | ----------------------------------------- |
| `plugins`         | 已安装插件（名称、版本、状态、启停标记）  |
| `plugin_settings` | 插件配置键值对                            |
| `plugin_registry` | 注册表/市场目录                           |
| `plugin_skills`   | 插件-技能关联（插件名、技能名、技能路径） |

## 配置参考

```bash
# DB-backed lifecycle
--version <v>            # install 的插件版本
--manifest <path>        # manifest.json 路径（含技能声明）

# governed marketplace/runtime
--registry <url>         # 可重复；精确顺序参与候选身份
--scope <scope>          # user | project | local
--strict                 # 证据不完整时失败闭合
--json                   # 输出版本化证据投影

# 环境变量
CHAINLESSCHAIN_DB_PATH     # plugins / plugin_settings / plugin_registry 存储
CHAINLESSCHAIN_DATA_DIR    # marketplace 技能部署根目录
PLUGIN_REGISTRY_URL        # 注册表镜像地址
PLUGIN_MARKETPLACE_SKILLS  # marketplace 技能目录覆盖
```

## 性能指标

| 操作                          | 目标    | 实际   | 状态 |
| ----------------------------- | ------- | ------ | ---- |
| `plugin list`                 | < 100ms | ~50ms  | ✅   |
| `plugin install` (无技能)     | < 300ms | ~180ms | ✅   |
| `plugin install` (含技能复制) | < 800ms | ~500ms | ✅   |
| `plugin search` (模糊匹配)    | < 150ms | ~80ms  | ✅   |
| `plugin enable` / `disable`   | < 100ms | ~40ms  | ✅   |
| `plugin summary`              | < 120ms | ~60ms  | ✅   |

## 测试覆盖率

```
✅ plugin-manager.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- 插件安装记录权限信息，支持权限审计
- 卸载时级联清理插件设置数据
- 注册表搜索仅匹配名称和描述，不执行代码
- catalog/select/impact 是只读证据，不授予执行或安装权限；mutation 会重新读取并复验候选与 policy
- publisher、registry URL、版本、digest、signature、SBOM、license、capability 和 dependency 共同参与 authority，任一漂移都拒绝沿用旧审批
- 升级扩大 capability 时必须获得新的显式同意；运行 hooks/LSP/MCP 还要求 `plugin trust`
- `evidence --strict` 适合 CI/部署后回读，防止“命令成功”被误当成“安装 bytes 与期望一致”

## 使用示例

### 场景 1：搜索并安装插件

```bash
chainlesschain plugin search "markdown"
chainlesschain plugin install markdown-plus --version 1.0.0
chainlesschain plugin list
```

在注册表中搜索 Markdown 相关插件，安装指定版本后确认已成功安装。

### 场景 1A：受治理 Registry 安装/升级

```bash
cc plugin catalog markdown --registry https://plugins.example/catalog --strict --json
cc plugin select markdown-plus --registry https://plugins.example/catalog --strict --json
cc plugin impact markdown-plus --registry https://plugins.example/catalog --scope user --json
# 阅读投影并按 CLI 提示执行 add/upgrade 后，从已安装 bytes 回读
cc plugin evidence markdown-plus --scope user --strict --json
```

每一步都使用同一 registry 集合。若版本、digest、签名、许可证、能力或依赖在确认期间变化，重新运行 catalog/select/impact，不要复用旧 JSON。

### 场景 2：管理插件状态

```bash
chainlesschain plugin disable markdown-plus
chainlesschain plugin enable markdown-plus
chainlesschain plugin summary
```

临时禁用不需要的插件以减少资源占用，需要时重新启用。查看安装统计概览。

### 场景 3：卸载并清理插件

```bash
chainlesschain plugin info markdown-plus
chainlesschain plugin remove markdown-plus
```

查看插件详情确认后卸载，卸载时自动清理插件配置和关联的技能文件。

## 故障排查

| 问题                        | 解决方案                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `install` 失败              | 确认数据库已初始化：`chainlesschain db init`                                                   |
| `search` 无结果             | 尝试更短的关键词，或用 `registry` / `catalog` 浏览全部                                         |
| `enable` 报插件不存在       | 确认插件已安装：`chainlesschain plugin list`                                                   |
| `catalog --strict` 拒绝候选 | 补齐 registry 的 digest/signature/SBOM/license/capability 元数据；不要关闭 strict 来绕过生产门 |
| `evidence --strict` 非零    | 已安装 bytes 或证据为 partial/漂移；停止启用，重新安装或切回已验证版本                         |

## 关键文件

- `packages/cli/src/commands/plugin.js` — 命令实现
- `packages/cli/src/lib/plugin-manager.js` — 插件管理库
- `packages/cli/src/lib/plugin-runtime/marketplace-catalog.js` — 跨 registry 目录投影
- `packages/cli/src/lib/plugin-runtime/marketplace-catalog.js` 同时提供候选排序与 registry-set 绑定
- `packages/cli/src/lib/plugin-runtime/marketplace-impact.js` — 升级影响
- `packages/cli/src/lib/plugin-runtime/marketplace-artifact-readback.js` — 已安装制品回读
- `packages/cli/src/lib/plugin-runtime/marketplace-remote-artifacts.js` — 远程 artifact 核验

## 相关文档

- [技能系统](./cli-skill) — 内置技能管理
- [技能市场](./skill-marketplace) — 桌面端插件生态
- [CLI 命令行工具](./cli) — 完整命令参考

## 依赖

- 纯 Node.js crypto（ID 生成）
- 无外部依赖
