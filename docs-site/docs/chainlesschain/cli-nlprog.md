# 自然语言编程 CLI（Phase 28）

> `chainlesschain nlprog` — 自然语言→结构化规格的翻译与管理。
>
> 涵盖意图分类、实体提取、技术栈检测、翻译 CRUD、项目约定管理。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [分析（无状态）](#分析无状态)
- [翻译管理](#翻译管理)
- [项目约定](#项目约定)
- [统计](#统计)

---

## 概述

NL Programming 模块将自然语言描述转为结构化规格（intent / entities / stack），
辅以项目级代码约定（convention），帮助 Agent 生成符合项目风格的代码。

---

## 核心特性

- **9 种意图分类** — 创建 / 修改 / 删除 / 查询 / 分析 / 重构 / 测试 / 部署 / 调试
- **实体提取** — 从自然语言中抽取函数名、参数、类型、关系
- **技术栈检测** — 关键词启发式识别 react/vue/node/python/java 等
- **翻译管理** — draft / reviewing / approved / rejected 状态机 + refine 精炼
- **项目约定** — naming / style / architecture / testing 等类别，影响翻译输出
- **V2 治理层** — 102 V2 tests 覆盖 5 态 spec maturity + 4 态 dialogue-turn lifecycle（`nl_programming_v2_phase28_cli.md`）

---

## 系统架构

```
┌───────────────────────────────────────────────────┐
│         chainlesschain nlprog (Phase 28)           │
├───────────────────────────────────────────────────┤
│  Stateless Analysis                                │
│  classify → intent                                 │
│  extract  → entities[]                             │
│  detect-stack → stack[]                            │
├───────────────────────────────────────────────────┤
│  Translation Lifecycle                             │
│  translate → Spec (intent+entities+stack)          │
│  refine / status / show / list                     │
├───────────────────────────────────────────────────┤
│  Project Conventions                               │
│  naming / style / architecture / testing           │
│  影响 translate 输出的风格                          │
├───────────────────────────────────────────────────┤
│  SQLite: nlprog_translations / nlprog_conventions  │
└───────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                  | 含义                    | 默认                     |
| ----------------------- | ----------------------- | ------------------------ |
| `intents`               | 支持意图数              | 9                        |
| `statuses`              | 翻译状态                | draft/reviewing/approved/rejected |
| `style-categories`      | 约定类别                | naming/style/architecture/testing |
| 约定影响范围            | 对所有后续 translate 生效 |                        |
| V2 spec maturity caps   | 见 `nl_programming_v2_phase28_cli.md` |         |

查看：`chainlesschain nlprog intents`、`nlprog statuses`、`nlprog style-categories`。

---

## 性能指标

| 操作                        | 典型耗时          |
| --------------------------- | ----------------- |
| classify（100 字以内）      | < 10 ms           |
| extract                     | < 15 ms           |
| detect-stack                | < 10 ms           |
| translate（含启发式匹配）   | < 50 ms           |
| refine                      | < 50 ms           |
| list --limit 20             | < 10 ms           |

---

## 测试覆盖率

```
__tests__/unit/nl-programming.test.js — 102 tests (959 lines)
```

覆盖：9 种意图分类、实体提取、stack 检测、translate + refine 状态流转、
convention CRUD、约定对 translate 的影响、JSON 输出。
V2 surface：102 V2 tests（见 `nl_programming_v2_phase28_cli.md`）。

---

## 安全考虑

1. **完全本地处理** — 分析/翻译均为启发式规则，不调用任何外部 LLM 服务
2. **约定不可执行** — convention 仅作为文本提示，不会被 eval 或 exec
3. **翻译内容审计** — status 状态机留痕，approved 前应人工 review
4. **refine 保留历史** — refine 不覆盖原 spec，可回溯前一版本
5. **约定优先级** — 多条约定冲突时按添加顺序合并，可通过 remove 调优

---

## 故障排查

**Q: `classify` 返回的意图不准?**

1. 尝试更具体的描述（如 "修改 login 函数" > "改代码"）
2. 启发式规则覆盖有限；复杂意图建议人工修正 `status`
3. 可通过 `convention-add --category intent` 注入领域关键词

**Q: `translate` 输出的规格风格不符?**

1. `conventions` 查看当前已加载的约定
2. `convention-add` 补充命名 / 风格规则后重新 `translate`
3. 或使用 `refine <id> --spec "..."` 指定调整方向

**Q: `detect-stack` 未识别自定义技术栈?**

CLI 侧的 stack 关键词为内置列表；自定义栈建议在 translate 后由上层流水线补充。

---

## 关键文件

- `packages/cli/src/commands/nlprog.js` — Commander 子命令（~685 行）
- `packages/cli/src/lib/nl-programming.js` — 启发式分析 + 约定引擎
- `packages/cli/__tests__/unit/nl-programming.test.js` — 单测（102 tests）
- 数据表：`nlprog_translations` / `nlprog_conventions`
- 设计文档：`docs/design/modules/28_自然语言编程.md`

---

## 使用示例

```bash
# 1. 无状态分析
chainlesschain nlprog classify "帮我写一个排序函数"
chainlesschain nlprog extract "创建接收 name 返回 greeting 的函数"
chainlesschain nlprog detect-stack "用 React + TypeScript 写 Todo"

# 2. 添加项目约定
chainlesschain nlprog convention-add "变量命名使用 camelCase" --category naming
chainlesschain nlprog convention-add "组件使用函数式" --category style

# 3. 翻译 + 精炼 + 审批
tid=$(chainlesschain nlprog translate "实现登录：邮箱+密码" --json | jq -r .id)
chainlesschain nlprog refine $tid --spec "增加验证码"
chainlesschain nlprog status $tid approved

# 4. 查看历史
chainlesschain nlprog list --json
chainlesschain nlprog stats
```

---

## 目录/枚举

```bash
chainlesschain nlprog intents            # 列出支持的意图类型
chainlesschain nlprog statuses           # 列出翻译状态
chainlesschain nlprog style-categories   # 列出风格分析类别
```

---

## 分析（无状态）

```bash
# 意图分类 — 判断用户输入属于哪种编程意图
chainlesschain nlprog classify "帮我写一个排序函数"

# 实体提取 — 从文本中抽取编程实体（函数名、参数、类型等）
chainlesschain nlprog extract "创建一个接收 name 参数返回 greeting 的函数"

# 技术栈检测 — 从文本描述推断使用的技术栈
chainlesschain nlprog detect-stack "用 React + TypeScript 写一个 Todo 组件"
```

以上命令均为无状态纯计算，不写数据库。

---

## 翻译管理

```bash
# 将自然语言翻译为结构化规格
chainlesschain nlprog translate "实现用户登录功能，包含邮箱密码验证"

# 查看翻译详情
chainlesschain nlprog show <id>

# 列出所有翻译
chainlesschain nlprog list
chainlesschain nlprog list --json

# 更新翻译状态（draft / reviewing / approved / rejected）
chainlesschain nlprog status <id> approved

# 基于更新后的描述重新翻译
chainlesschain nlprog refine <id> --spec "增加验证码功能"

# 删除翻译
chainlesschain nlprog remove <id>
```

---

## 项目约定

```bash
# 添加项目编码约定
chainlesschain nlprog convention-add "变量命名使用 camelCase" --category naming

# 查看约定详情
chainlesschain nlprog convention-show <id>

# 列出所有约定
chainlesschain nlprog conventions

# 删除约定
chainlesschain nlprog convention-remove <id>
```

约定会影响后续 `translate` 输出的规格内容，使生成结果贴合项目风格。

---

## 统计

```bash
chainlesschain nlprog stats          # 可读格式
chainlesschain nlprog stats --json   # JSON 格式
```

---

## 相关文档

- 设计文档：`docs/design/modules/28_自然语言编程.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [Codegen →](/chainlesschain/cli-codegen)
- [Multimodal →](/chainlesschain/cli-mm)
- [Autonomous Developer →](/chainlesschain/cli-dev)
