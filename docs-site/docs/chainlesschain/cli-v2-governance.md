# V2 治理命令族（开发者参考）

> **版本: CLI v0.134.0+ | 状态: ✅ 内部/运维工具 | 23 个统一治理命令 | 内存态，进程内有效**
>
> 这是 `cc` CLI 中一族**统一形态的内部治理命令**——每个命令在内存中治理某个 V2 子系统的 **profile 成熟度** 与 **job/query 生命周期**，并暴露每 owner/每 profile 的配额、空闲/卡死超时、自动清道夫与治理统计。它们面向**开发者与运维**，不是终端用户日常功能；全部输出 JSON，状态进程内有效、不持久化。

> 提示：本页是把 23 个高度同构的小命令合并成一篇参考，避免每命令一页的冗余。其底层子系统的**用户向**能力（如永久记忆、会话用量、网页抓取工具）各有独立文档，见[相关文档](#相关文档)。

## 概述

ChainlessChain 的多个 V2 内部子系统（BM25 搜索、记忆注入、Prompt 压缩、响应缓存、任务模型选择……）都遵循同一套**治理生命周期模型**：先注册一个 _profile_（带成熟度状态），再在其下创建 _job/query_（带生命周期状态），并由统一的配额与超时规则约束、由自动清道夫回收闲置/卡死项。每个子系统对应一个 `cc <cmd>` 治理命令，命令之间**子命令词汇完全一致**，只是名词随子系统而变（profile/target、query/job/task…）。

这族命令用于：检视某子系统的内部状态、手动驱动状态机做调试、调整治理参数、跑一次自动回收、读取治理统计。

## 核心特性

- 🧬 **统一形态**：23 个命令共享同一套子命令词汇，学一个即会全部
- 🟢 **Profile 成熟度**：`pending → active → stale/paused → archived` 状态机
- 🔄 **Job/Query 生命周期**：`created → running/searching → completed / failed / cancelled`
- 🎚️ **治理配额**：每 owner 最大活跃 profile 数、每 profile 最大 pending job 数
- ⏱️ **空闲/卡死超时**：profile idle 超时、job stuck 超时（毫秒）
- 🧹 **自动清道夫**：一键把闲置 profile 置 stale、把卡死 job 置 failed
- 📊 **治理统计**：每子系统的 `gov stats`（计数/分布）
- 🧾 **全 JSON 输出**：便于脚本/运维管道消费
- 💾 **内存态**：状态进程内有效、不落盘——是治理视图而非持久存储

## 系统架构

```
cc <cmd>  （治理命令，src/commands/<cmd>.js）
   │  薄封装，全部委托给底层 lib 的 *V2 函数
   ▼
src/lib/<subsystem>.js   （V2 治理 API，内存态）
   ├─ Profile 成熟度： register → activate → stale/pause → archive（+ touch 续活）
   ├─ Job/Query 生命周期： create → start/searching → complete / fail / cancel
   ├─ 配额： maxActivePerOwner / maxPendingPerProfile
   ├─ 超时： profileIdleMs / jobStuckMs
   ├─ 清道夫： autoStaleIdleProfiles / autoFailStuckJobs
   └─ 统计： get<Subsystem>GovStatsV2
```

### 统一子命令词汇

| 子命令                                              | 作用                             |
| --------------------------------------------------- | -------------------------------- |
| `enums-v2`                                          | 打印成熟度 + 生命周期枚举常量    |
| `config-v2`                                         | 查看当前治理配置（配额/超时）    |
| `set-max-active-v2 <n>`                             | 设每 owner 最大活跃 profile 数   |
| `set-max-pending-v2 <n>`                            | 设每 profile 最大 pending job 数 |
| `set-idle-ms-v2 <ms>`                               | 设 profile 空闲超时              |
| `set-stuck-ms-v2 <ms>`                              | 设 job 卡死超时                  |
| `register-profile-v2`（或 `register-target-v2`）    | 注册 profile/target              |
| `activate-profile-v2 <id>`                          | 置 active                        |
| `stale-profile-v2`/`pause-profile-v2 <id>`          | 置 stale/paused                  |
| `archive-profile-v2 <id>`                           | 归档                             |
| `touch-profile-v2 <id>`                             | 续活（刷新空闲计时）             |
| `get-profile-v2 <id>` / `list-profiles-v2`          | 查/列 profile                    |
| `create-<job>-v2` … `complete/fail/cancel-<job>-v2` | job/query 生命周期流转           |
| `get-<job>-v2 <id>` / `list-<job>-v2`               | 查/列 job                        |
| `auto-stale-idle-...` / `auto-fail-stuck-...`       | 自动清道夫                       |

## 命令清单

| 命令            | 子系统                                | 底层 lib                      |
| --------------- | ------------------------------------- | ----------------------------- |
| `cc bm25`       | BM25 搜索 profile/query               | `lib/bm25-search.js`          |
| `cc ccron`      | Cowork 定时任务                       | `lib/cowork-cron.js`          |
| `cc consol`     | 会话整合（Consolidator）              | `lib/session-consolidator.js` |
| `cc fflag`      | 功能开关（Feature Flags）             | `lib/feature-flags.js`        |
| `cc itbudget`   | 迭代预算（Iteration Budget）          | `lib/iteration-budget.js`     |
| `cc mcpscaf`    | MCP 脚手架                            | `lib/mcp-scaffold.js`         |
| `cc meminj`     | 记忆注入（Memory Injection）          | `lib/memory-injection.js`     |
| `cc orchgov`    | 编排器治理（Orchestrator）            | `lib/orchestrator.js`         |
| `cc pdfp`       | PDF 解析器                            | `lib/pdf-parser.js`           |
| `cc permmem`    | 永久记忆 pin 成熟度 + 保留任务        | `lib/permanent-memory.js`     |
| `cc promcomp`   | Prompt 压缩器                         | `lib/prompt-compressor.js`    |
| `cc rcache`     | 响应缓存 profile 成熟度 + 刷新任务    | `lib/response-cache.js`       |
| `cc seshhook`   | 会话钩子（Session Hooks）             | `lib/session-hooks.js`        |
| `cc seshsearch` | 会话搜索                              | `lib/session-search.js`       |
| `cc seshtail`   | 会话 Tail                             | `lib/session-tail.js`         |
| `cc seshu`      | 会话用量（Session Usage）             | `lib/session-usage.js`        |
| `cc slotfill`   | 槽位填充器（Slot Filler）             | `lib/slot-filler.js`          |
| `cc svccont`    | 服务容器（Service Container）         | `lib/service-container.js`    |
| `cc tms`        | 任务模型选择器（Task Model Selector） | `lib/task-model-selector.js`  |
| `cc topiccls`   | 主题分类器（Topic Classifier）        | `lib/topic-classifier.js`     |
| `cc uprof`      | 用户画像（User Profile）              | `lib/user-profile.js`         |
| `cc vcheck`     | 版本检查器（Version Checker）         | `lib/version-checker.js`      |
| `cc webfetch`   | 网页抓取 profile/target 治理          | `lib/web-fetch.js`            |

> 注：`cc webfetch` 是网页抓取**子系统的治理面**（profile/target 生命周期），区别于 agent 的 `web_fetch` 抓取工具本身。

## 配置参考

每个子系统的治理参数都用相同的四个开关，运行时可调（内存态，进程内有效）：

| 参数                           | 子命令                   | 含义                                |
| ------------------------------ | ------------------------ | ----------------------------------- |
| 每 owner 最大活跃 profile 数   | `set-max-active-v2 <n>`  | 限制单 owner 同时 active 的 profile |
| 每 profile 最大 pending job 数 | `set-max-pending-v2 <n>` | 限制单 profile 排队的 job           |
| profile 空闲超时（ms）         | `set-idle-ms-v2 <ms>`    | 超过则被 `auto-stale-idle` 回收     |
| job 卡死超时（ms）             | `set-stuck-ms-v2 <ms>`   | 超过则被 `auto-fail-stuck` 失败     |

查看当前值用 `config-v2`，查看枚举常量用 `enums-v2`。

## 性能指标

- **内存态 O(1) 流转**：注册/激活/流转/查询均为内存 Map 操作，无 I/O。
- **清道夫批量回收**：`auto-stale-idle` / `auto-fail-stuck` 一次扫描批量处理超时项。
- **零持久化开销**：不写盘、不查库，纯进程内治理视图。

## 测试覆盖率

各底层子系统的 V2 治理 API 在 lib 层有单元测试（命令层为薄封装）：

```bash
cd packages/cli
npx vitest run __tests__/unit/bm25-search.test.js \
  __tests__/unit/lib/task-model-selector-v2.test.js \
  __tests__/unit/lib/user-profile-v2.test.js \
  __tests__/unit/lib/topic-classifier-v2.test.js
```

> 测试覆盖成熟度/生命周期状态机流转、配额拒绝、空闲/卡死清道夫、治理统计。

## 安全考虑

- **内存态、不持久化**：治理状态进程内有效，重启即清空——不要把它当作可靠存储。
- **开发/运维面**：这些命令用于调试与运维，不在终端用户日常路径上；输出为内部状态。
- **配额即防护**：每 owner/每 profile 配额防止单方占满活跃槽位；清道夫防止闲置/卡死项堆积。
- **无内容泄露**：治理面只暴露 profile/job 的元数据与计数，不暴露底层数据内容。

## 故障排查

| 现象                       | 可能原因                         | 处理                                                         |
| -------------------------- | -------------------------------- | ------------------------------------------------------------ |
| 重启后 profile/job 全没了  | 内存态、不持久化（设计如此）     | 重新 register；不要依赖其跨重启                              |
| `register-profile-v2` 被拒 | 超过每 owner 最大活跃数          | `config-v2` 看配额，`set-max-active-v2` 调高或归档旧 profile |
| `create-<job>-v2` 被拒     | 超过每 profile 最大 pending 数   | `set-max-pending-v2` 调高或先消费 pending job                |
| profile 莫名变 stale       | 空闲超过 `idle-ms` 被清道夫回收  | `touch-profile-v2` 续活；或调高 `set-idle-ms-v2`             |
| job 莫名 failed            | 运行超过 `stuck-ms` 被清道夫失败 | 调高 `set-stuck-ms-v2`；排查真实卡死原因                     |
| 不知道有哪些状态           | —                                | `cc <cmd> enums-v2` 打印枚举                                 |

## 关键文件

| 路径                                  | 说明                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `packages/cli/src/commands/<cmd>.js`  | 各治理命令（薄封装，委托 lib 的 `*V2` 函数）               |
| `packages/cli/src/lib/<subsystem>.js` | 各子系统的 V2 治理 API（成熟度/生命周期/配额/清道夫/统计） |
| `packages/cli/__tests__/unit/**`      | lib 层 V2 治理单元测试                                     |

## 使用示例

以 `cc bm25` 为例（其它命令同构）：

```bash
# 看枚举与当前配置
cc bm25 enums-v2
cc bm25 config-v2

# 注册一个 profile 并激活
cc bm25 register-profile-v2 --id p1 --owner alice --field content
cc bm25 activate-profile-v2 p1

# 在其下创建一个 query 并走完生命周期
cc bm25 create-query-v2 --profile p1 --text "hello"
cc bm25 list-queries-v2

# 调治理参数
cc bm25 set-max-active-v2 5
cc bm25 set-idle-ms-v2 600000

# 跑一次自动清道夫并看统计
cc bm25 auto-stale-idle-profiles-v2
cc bm25 list-profiles-v2
```

```bash
# 同一套词汇适用于其它子系统，例如任务模型选择器：
cc tms enums-v2
cc tms register-profile-v2 --id m1 --owner bob
cc tms config-v2
```

## 相关文档

- [CLI 命令参考](./cli.md)
- [永久记忆系统](./permanent-memory.md)
- [上下文工程](./context-engineering.md)
- [会话管理器](./session-manager.md)
- [CLI Agent 智能代理](./cli-agent.md)
