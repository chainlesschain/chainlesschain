# 智能插件生态 2.0 CLI（Phase 64）

> `chainlesschain ecosystem`（别名 `eco`）— 插件注册、依赖解析、AI 审查、沙箱测试、发布与收益分成。
>
> DFS 依赖解析 + 8 规则启发式 AI 审查 + 70/30 收益分成 + 分类亲和推荐。

---

## 概述

Plugin Ecosystem 2.0 管理插件从注册到发布的完整生命周期。
区别于 `plugin`（基础插件安装），`ecosystem` 提供企业级的依赖解析、
安全审查、沙箱隔离测试、审核发布流程与收益分成机制。

---

## 核心特性

- **DFS 依赖解析** — 构建依赖图，检测循环依赖与版本冲突，自动拓扑排序
- **8 条启发式 AI 审查** — 覆盖 eval / 网络调用 / 敏感文件 / 加密强度 / 命令注入 / XSS / 权限越界 / 依赖风险
- **沙箱隔离测试** — 在受限环境运行插件测试用例，失败即阻断发布
- **双重审核发布** — `submit → approve/reject → publish`，带管理员审核痕迹
- **70/30 收益分成** — 开发者 70%、平台 30%，记录 subscription/one-time/donation 等类型
- **分类亲和推荐** — 按插件 `category` 计算相似度，返回 top-N
- **安装回滚** — 安装失败自动回滚已安装的依赖，避免半成品状态

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│         chainlesschain eco (Phase 64 / Plugin 2.0)       │
├─────────────────────────────────────────────────────────┤
│  Registry     │  Dep Resolver │  AI Reviewer (8 rules)   │
│  register /   │  DFS topo +   │  → severity: critical/   │
│  update-stats │  cycle detect │    high/medium/low       │
├─────────────────────────────────────────────────────────┤
│  Sandbox              │  Approval Gate                   │
│  isolated run + tests │  submit → approve/reject → pub   │
├─────────────────────────────────────────────────────────┤
│  Revenue Ledger       │  Recommender                     │
│  70/30 split, types   │  category affinity               │
├─────────────────────────────────────────────────────────┤
│  SQLite: plugins / plugin_deps / reviews / sandboxes /   │
│          installs / revenues                             │
└─────────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                       | 含义                     | 默认          |
| ---------------------------- | ------------------------ | ------------- |
| `DEV_REVENUE_SHARE`          | 开发者分成比例           | 0.70          |
| `PLATFORM_REVENUE_SHARE`     | 平台分成比例             | 0.30          |
| `MAX_DEPENDENCY_DEPTH`       | 依赖链最大深度           | 10            |
| `REVIEW_RULES`               | AI 审查规则数            | 8             |
| `SEVERITIES`                 | critical/high/medium/low/info |        |
| `STATUSES`                   | draft/submitted/approved/rejected/published/archived | |
| `REVENUE_TYPES`              | subscription/one_time/donation |           |
| `DEP_KINDS`                  | runtime/peer/dev/optional |              |

查看：`chainlesschain eco config`、`eco severities`、`eco statuses`、`eco rules`。

---

## 性能指标

| 操作                          | 典型耗时          |
| ----------------------------- | ----------------- |
| register + checksum           | < 15 ms           |
| resolve（10 层依赖）          | < 30 ms           |
| review（8 规则 × ~1000 行代码）| < 50 ms          |
| sandbox 启动                  | 依赖运行时环境    |
| revenue 记录                  | < 10 ms           |
| recommend（1000 插件）        | < 20 ms           |

---

## 测试覆盖率

```
__tests__/unit/plugin-ecosystem.test.js — 110 tests (1348 lines)
```

覆盖：register/update-stats、dep-add 循环检测、DFS resolve、install 回滚、8 条审查规则
单独用例、sandbox 生命周期、approve/reject 状态机、revenue 70/30 校验、recommend 相似度排序。

---

## 安全考虑

1. **8 条规则覆盖常见漏洞** — eval、SQL 注入、命令注入、path-traversal、弱加密、网络回调、权限越界、依赖风险
2. **sandbox 隔离** — 插件测试不访问主进程环境变量与文件系统
3. **审核双人制** — `submit → approve` 不可同人操作（业务约定，CLI 侧可配置）
4. **依赖冲突阻断** — `install` 前自动 resolve，版本冲突直接失败，不进入 partial 状态
5. **revenue 审计** — 所有分成记录不可删除，只能 `rev-record`，便于对账

---

## 故障排查

**Q: `resolve` 报 circular dependency?**

1. 用 `eco deps <plugin-id>` 查看直接依赖
2. DFS 路径在错误信息中给出，按路径回溯找到环
3. 修改依赖关系（如将强依赖改为 `--kind optional`）或重构插件

**Q: `review` 显示大量 false positive?**

1. 启发式规则难免误报；CLI 侧的规则可在 `eco rules` 查看
2. 关键决策应走人工 review 流程（`approve` 时填 reason）
3. 可将可信插件的 review 结果 `submit` 后由 admin `approve` 绕过

**Q: `install` 报 dependency cycle 但 resolve 通过?**

1. 检查是否在 resolve 之后又新增 `dep-add`——再次 resolve 验证
2. 插件更新后依赖可能变更，运行 `update-stats` 刷新

---

## 关键文件

- `packages/cli/src/commands/plugin-ecosystem.js` — Commander 子命令（~790 行）
- `packages/cli/src/lib/plugin-ecosystem.js` — DFS resolver + AI reviewer + sandbox
- `packages/cli/__tests__/unit/plugin-ecosystem.test.js` — 单测（110 tests）
- 数据表：`plugins` / `plugin_deps` / `plugin_reviews` / `plugin_sandboxes` / `plugin_installs` / `plugin_revenues`
- 设计文档：`docs/design/modules/64_智能插件生态2.0.md`

---

## 使用示例

```bash
# 1. 注册 + 依赖 + 审查
pid=$(chainlesschain eco register --name my-plugin --version 1.0.0 --category ai --json | jq -r .id)
chainlesschain eco dep-add $pid --dep some-other-plugin --kind runtime
chainlesschain eco resolve $pid
chainlesschain eco review $pid --source ./src/index.js

# 2. 沙箱测试 → 提交 → 审核 → 发布
chainlesschain eco sandbox $pid
chainlesschain eco submit $pid
chainlesschain eco approve $pid
chainlesschain eco publish $pid

# 3. 记录收益 + 查看报告
chainlesschain eco rev-record $pid --amount 100 --type subscription
chainlesschain eco revenue $pid

# 4. 分类推荐
chainlesschain eco recommend --category ai --limit 5

# 5. 生态统计
chainlesschain eco stats --json
```

---

## 目录/枚举

```bash
chainlesschain eco config         # 查看配置常量
chainlesschain eco severities     # 列出审查严重级别
chainlesschain eco statuses       # 列出插件状态
chainlesschain eco revenue-types  # 列出收益类型
chainlesschain eco dep-kinds      # 列出依赖类型
chainlesschain eco rules          # 列出 8 条 AI 审查规则
```

---

## 插件注册与查询

```bash
# 注册插件
chainlesschain eco register --name my-plugin --version 1.0.0 --category ai

# 列出插件
chainlesschain eco plugins
chainlesschain eco plugins --json

# 查看详情
chainlesschain eco show <plugin-id>

# 更新统计信息
chainlesschain eco update-stats <plugin-id>
```

---

## 依赖管理

```bash
# 添加依赖
chainlesschain eco dep-add <plugin-id> --dep <dep-plugin-id> --kind runtime

# 列出依赖
chainlesschain eco deps <plugin-id>

# DFS 依赖解析（检测循环与冲突）
chainlesschain eco resolve <plugin-id>

# 安装（含自动依赖解析，失败自动回滚）
chainlesschain eco install <plugin-id>
chainlesschain eco installs                  # 列出安装记录
chainlesschain eco uninstall <plugin-id>
```

---

## AI 审查 & 沙箱

```bash
# 8 规则启发式 AI 代码审查
chainlesschain eco review <plugin-id> --source ./src/index.js
chainlesschain eco review-show <review-id>
chainlesschain eco reviews <plugin-id>

# 沙箱隔离测试
chainlesschain eco sandbox <plugin-id>
chainlesschain eco sandbox-show <sandbox-id>
chainlesschain eco sandbox-tests <sandbox-id>
```

---

## 审核与发布

```bash
# 提交审核
chainlesschain eco submit <plugin-id>

# 审核（管理员）
chainlesschain eco approve <plugin-id>
chainlesschain eco reject <plugin-id> --reason "安全问题"

# 发布
chainlesschain eco publish <plugin-id>
```

---

## 收益分成 & 推荐

```bash
# 记录收益
chainlesschain eco rev-record <plugin-id> --amount 100 --type subscription

# 查看收益报告（70% 开发者 / 30% 平台）
chainlesschain eco revenue <plugin-id>

# 基于分类亲和度的推荐
chainlesschain eco recommend --category ai --limit 5
```

---

## 统计

```bash
chainlesschain eco stats          # 插件生态统计
chainlesschain eco stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/64_智能插件生态2.0.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [MCP Registry →](/chainlesschain/cli-mcp)
- [Skill Marketplace →](/chainlesschain/cli-skill)
- [Runtime →](/chainlesschain/cli-runtime)
