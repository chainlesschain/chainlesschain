# CLI / IDE 差距优化首批实施：Goal 验收与检查点恢复

日期：2026-10-27。承接[差距复核报告](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.2、4.3 节，以及[原实施计划](./cli-ide-codex-claude-implementation-plan-2026-10-15.md)的 RUN-03。

产品源码起点为 `c17680d284`；后续 `67db629cb9` 提交了本次差距报告。工作分支为 `feature/goal-completion-recovery-20261027`。本批实现范围是 CLI headless Goal 条件执行，跨 IDE 的完整恢复旅程继续单独验收。

## 本批改动

### 完成判定使用实际工具观察

新增 [goal-check-evidence.js](../../packages/cli/src/lib/goal-check-evidence.js)，按本轮真实调用身份配对工具开始与结果，记录有界的参数、输出、退出码和状态摘要。

- 默认自然语言 judge 必须引用本轮已结束、成功且未过期的工具观察；仅有助手的成功声明不能完成 Goal。
- 当前没有可用工具观察时，返回条件未满足并要求执行明确检查，省去没有依据的额外 judge 模型调用。
- 后续可能改变状态的工具会使较早观察过期；跨外层轮次清空旧观察，未结束的调用也不能作为完成依据。
- 命令退出码未知、非零、被信号终止、仍在后台运行或输出尚未读完，均不能被引用为成功的命令检查。
- 保留长输出的头尾摘要，最多提供 24 条工具观察；最终助手声明同样有界截取并保留尾部信息。

这仍是模型对观察材料的语义评价，不等于独立执行产物验收。测试、构建、文件存在等明确条件继续优先使用现有确定性 checker；完整工作区版本绑定与独立产物检查仍是后续工作。

### 修复确定性命令检查的成功误判

[goal-condition-engine.js](../../packages/cli/src/lib/goal-condition-engine.js) 只接受数值 `0` 作为成功退出码。`null`、`false`、空串和字符串 `"0"` 不再通过类型转换被当作成功。进程返回错误或终止信号时，检查结果保持未满足。

条件未达成且 Goal 预算耗尽时，[headless-runner.js](../../packages/cli/src/runtime/headless-runner.js) 返回非零退出码与 `error_goal_condition`，避免先报告 `goal_exhausted`、最后又返回成功。

### 检查点失败立即结束当前 Goal 执行

Goal 快照增加 `ready / running / evaluated` 阶段：执行前保存运行标记，发布评价和终态前先保存结果。写入失败后不再开始下一轮，也不会先显示完成再吞掉保存错误。

读取失败、损坏状态、未知检查点格式或未收尾的 `running` 检查点，会返回 `CC_GOAL_CHECKPOINT_FAILED`；文件系统错误沿用既有 `error_persistence` 和内容脱敏的持久化投影。快照读取失败不再退回新 Goal 并重置已记录状态。

显式恢复入口：

```bash
cc agent -p "继续完成原任务" --resume <session-id> --goal-condition "exit-zero:npm test" --goal-recovery-reviewed
```

`--goal-recovery-reviewed` 表示调用方已经核对中断前的副作用和用量，允许继续未收尾的 Goal。恢复保留原条件、已记录轮数、token、费用和起始时间，不用新参数覆盖原预算。该标记不替代账户账单核对、未决副作用处理或现有预算 authority；无法读取或格式损坏的检查点仍然拒绝恢复。

旧格式快照继续兼容；已完成 Goal 在用户显式提供完成条件开启新周期时沿用原有行为。本批没有宣称覆盖全部崩溃窗口、恢复入口或预算出口。

### 配套入口与测试隔离

CLI 命令与生成的帮助索引增加恢复参数。同步刷新进程调用清单以匹配当前源码。

预算回归用例继续使用原有 20 秒时限，以 hermetic 模式运行注入的 usage 事件，隔离真实用户配置、Skills 和项目规则扫描。它验证预算处理；常规启动路径由 headless-runner 的其他用例覆盖。

## 验证记录

Windows x64，Node `22.22.2`，Vitest `4.1.11`。

- 修复前针对性测试复现了退出码类型转换、检查点写入失败后继续运行、读取失败后重置等问题，13 项失败。
- 首轮检查点与命令边界定向复测：24 项通过。筛选跳过的用例不计入通过数。
- 完整相关回归：6 个文件、177 项通过，0 失败、0 跳过；覆盖 Goal 引擎、工具观察、headless runner、持久化失败、费用预算和恢复角色。
- 共享引擎影响回归：REPL Goal 与 bounded skill pilot 两个文件、26 项通过。以上共 8 个文件、203 项不同用例通过；重复定向运行不累加。
- CLI `agent --help` 能显示恢复参数；命令 manifest、帮助索引、Shell completions 和进程调用清单一致性检查通过。
- 修改的生产 JavaScript 通过 `node --check`，代码与文档通过 Prettier 和本地链接检查，`git diff --check` 通过。
- ESLint 未能启动：本地安装缺少 `@eslint-community/eslint-utils`。这属于验证环境限制，不能记作 lint 通过；本批未改动依赖清单。

合入主分支前，另行验证 Goal 证据、条件引擎、headless runner、费用预算和 Agent 命令绑定共 6 个文件 **187/187 通过、0 跳过**，验证前后 8 个改动源码/测试文件摘要一致。此组合与上述用例有重叠，不累加通过数；[源码绑定和结果](./cli/evidence/recovery-2026-10-27/goal-merge-validation.json)及压缩原始 JSON 报告一并保存。

主要回归命令：

```bash
cd packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/goal-check-evidence.test.js __tests__/unit/goal-condition-engine.test.js __tests__/unit/headless-runner.test.js __tests__/unit/headless-runtime-ledger-failclosed.test.js __tests__/unit/headless-runner-cost-budget.test.js __tests__/unit/headless-runner-resume-roles.test.js --maxWorkers 1
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/repl-goal.test.js __tests__/unit/bounded-skill-improvement-pilot.test.js --maxWorkers 1
```

测试不调用真实模型。工具事件与磁盘异常通过注入控制；模型 judge 的引用校验在纯函数层验证，CLI 输出及恢复顺序通过 runner 用例验证。

## 当前交付边界

本批为源码改动，尚未发布。公开版本仍沿用 CLI `.127`、Open VSX `.165`、JetBrains `.182` 及其独立发行证据。

跨版本累计交付 `32/45`、剩余 `13` 项、正式预算 readiness 和 native 准入均不因本地回归自动改变。本批没有发起付费任务或发布操作。

下一步优先接入与当前代码和产物摘要绑定的独立 checker，再验证公开包上的 CLI / 双 IDE 状态与恢复一致性；模型推荐、目录检索、Memory 性能和渠道发布继续按差距报告推进。
