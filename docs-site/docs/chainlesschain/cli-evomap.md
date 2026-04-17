# EvoMap 基因交换 (evomap)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔍 **基因搜索**: 在 Hub 上搜索智能体能力基因
- 📥 **基因下载**: 从 Hub 下载并安装基因到本地
- 📤 **基因发布**: 将基因发布到 Hub 分享给社区
- 📋 **本地管理**: 列出本地已安装的基因
- 🌐 **联邦管理**: 联邦 Hub 网络、基因同步、演化压力报告
- 🧬 **基因重组**: 两个基因重组产生后代，追踪血统谱系
- 🏛️ **治理系统**: 基因所有权注册、提案投票、治理仪表板

## 概述

ChainlessChain CLI EvoMap 模块实现了智能体能力的基因交换协议。`search`/`download`/`publish`/`list`/`hubs` 五个基础命令管理基因的搜索、安装、发布和 Hub 配置。

`federation` 子命令提供联邦 Hub 管理：添加和列出联邦 Hub、跨 Hub 基因同步、演化压力报告、基因重组和血统追踪。`gov` 子命令提供治理功能：基因所有权注册与追踪、创建治理提案、投票和查看治理仪表板。

## 命令参考

### evomap search — 搜索基因

```bash
chainlesschain evomap search <query>
chainlesschain evomap search "code-review" -c development -n 10
```

在 Hub 上搜索基因。`-c` 按类别过滤，`-n` 限制结果数量（默认 20）。显示名称、版本、作者、描述、下载量和评分。

### evomap download — 下载基因

```bash
chainlesschain evomap download <gene-id>
```

从 Hub 下载指定基因并安装到本地 `evomap/genes/` 目录。

### evomap publish — 发布基因

```bash
chainlesschain evomap publish --name "my-gene"
chainlesschain evomap publish --name "reviewer" --description "代码审查基因" --category development --author "Alice"
chainlesschain evomap publish --name "helper" --content "基因内容"
```

发布基因到 Hub。`--name` 必填，可选 `--description`、`--category`、`--content`、`--author`。

### evomap list — 本地基因列表

```bash
chainlesschain evomap list
```

列出本地已安装的所有基因，显示名称、版本和类别。

### evomap hubs — Hub 列表

```bash
chainlesschain evomap hubs
```

列出已配置的 EvoMap Hub，显示 URL 和状态。

### evomap federation list-hubs — 联邦 Hub 列表

```bash
chainlesschain evomap federation list-hubs
chainlesschain evomap federation list-hubs --status active --region asia --json
```

列出联邦 Hub 网络中的 Hub。支持按状态和区域过滤，显示 Hub URL、状态、区域、基因数量和信任评分。

### evomap federation add-hub — 添加联邦 Hub

```bash
chainlesschain evomap federation add-hub <url>
chainlesschain evomap federation add-hub https://hub.example.com -n "Asia Hub" -r asia
```

将 Hub 添加到联邦网络。`-n` 设置名称，`-r` 设置区域（默认 global）。

### evomap federation sync — 同步基因

```bash
chainlesschain evomap federation sync <hub-id>
chainlesschain evomap federation sync hub-001 --gene-ids "gene1,gene2,gene3"
```

与指定联邦 Hub 同步基因。`--gene-ids` 指定要同步的基因 ID（逗号分隔），不指定则同步全部。

### evomap federation pressure — 演化压力报告

```bash
chainlesschain evomap federation pressure
chainlesschain evomap federation pressure --json
```

查看演化压力报告：基因总数、平均适应度、最大代数、变异次数和重组次数。

### evomap federation recombine — 基因重组

```bash
chainlesschain evomap federation recombine <gene-id-1> <gene-id-2>
```

将两个基因重组产生后代基因。返回子代基因 ID、双亲信息、代数和适应度评分。

### evomap federation lineage — 基因血统

```bash
chainlesschain evomap federation lineage <gene-id>
chainlesschain evomap federation lineage gene-001 --json
```

追踪基因的血统和祖先链，显示每代的基因 ID、代数、适应度和变异类型。

### evomap gov ownership-register — 注册所有权

```bash
chainlesschain evomap gov ownership-register <gene-id> <owner-did>
```

注册基因的所有权，将基因 ID 与所有者 DID 绑定。

### evomap gov ownership-trace — 追踪所有权

```bash
chainlesschain evomap gov ownership-trace <gene-id>
chainlesschain evomap gov ownership-trace gene-001 --json
```

追踪基因的所有权和贡献者列表。

### evomap gov propose — 创建提案

```bash
chainlesschain evomap gov propose <title>
chainlesschain evomap gov propose "升级评分算法" -d "将适应度评分改为加权平均" -p did:key:alice
```

创建治理提案。`-d` 添加描述，`-p` 指定提案者 DID（默认 cli-user）。

### evomap gov vote — 投票

```bash
chainlesschain evomap gov vote <proposal-id> <direction>
chainlesschain evomap gov vote prop-001 for -v did:key:bob
chainlesschain evomap gov vote prop-001 against
```

对治理提案投票，`<direction>` 为 `for` 或 `against`。`-v` 指定投票者 DID。

### evomap gov dashboard — 治理仪表板

```bash
chainlesschain evomap gov dashboard
chainlesschain evomap gov dashboard --json
```

查看治理仪表板：提案总数、活跃/通过/拒绝/已执行提案数量。

## 系统架构

```
用户命令 → evomap.js (Commander)
              │
    ┌─────────┼──────────────┐
    ▼         ▼              ▼
 基础命令   federation     gov
    │         │              │
    ▼         ▼              ▼
EvoMapClient  evomap-       evomap-
EvoMapManager federation.js governance.js
    │         │              │
    ▼         ▼              ▼
 Hub API    SQLite         SQLite
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/evomap.js` | evomap 命令主入口 |
| `packages/cli/src/lib/evomap-client.js` | EvoMap Hub 客户端（搜索/下载/发布） |
| `packages/cli/src/lib/evomap-manager.js` | 本地基因管理（安装/列出/打包） |
| `packages/cli/src/lib/evomap-federation.js` | 联邦 Hub 管理、基因同步、演化压力 |
| `packages/cli/src/lib/evomap-governance.js` | 治理系统（所有权/提案/投票） |

## 使用示例

### 场景 1：搜索并安装基因

```bash
# 搜索代码审查相关基因
chainlesschain evomap search "code-review" -c development

# 下载并安装
chainlesschain evomap download gene-abc123

# 查看本地基因
chainlesschain evomap list
```

### 场景 2：联邦 Hub 管理

```bash
# 添加联邦 Hub
chainlesschain evomap federation add-hub https://asia-hub.example.com -n "Asia" -r asia

# 同步基因
chainlesschain evomap federation sync hub-001

# 查看演化压力
chainlesschain evomap federation pressure --json
```

### 场景 3：基因重组与治理

```bash
# 重组两个基因
chainlesschain evomap federation recombine gene-001 gene-002

# 注册所有权
chainlesschain evomap gov ownership-register gene-003 did:key:alice

# 创建提案并投票
chainlesschain evomap gov propose "新评分策略" -d "采用多维度评分"
chainlesschain evomap gov vote prop-001 for
chainlesschain evomap gov dashboard
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Search failed" | Hub 不可达 | 检查网络连接和 Hub 配置 |
| "No genes installed" | 未下载基因 | 使用 `evomap download` 安装 |
| "Database not available" | 数据库未初始化 | 运行 `chainlesschain db init` |

## 相关文档

- [演化系统](./cli-evolution) — 自诊断与演化学习
- [DAO 治理](./cli-dao) — 去中心化自治组织
- [智能体联邦](./agent-federation) — 智能体网络联邦
