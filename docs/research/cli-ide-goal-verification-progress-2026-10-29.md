# Goal 独立验收定义与执行

日期：2026-10-29。对应[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.2、4.3、4.10 节，第十七批实施；直接修改 `main`，Microsoft 渠道继续暂缓。

增加显式 `--goal-condition "verify:<manifest.json>"`。主机在第一次作者调用前读取并冻结验收清单、检查程序及声明的依赖文件，然后自行启动验收进程。作者回复不能提供检查结果，也不能只选择通过的检查。原有 `model:`、`exit-zero:` 等条件保留各自语义，不据此宣称默认自然语言 Goal 已变为独立验收。

| 项目       | 当前完成情况                                                                  | 证据 / 边界                                                                                               |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 验收定义   | 严格校验 manifest、唯一检查与要求 ID；保存定义摘要及文件身份                  | 恢复时重验原始定义，修改 checker 或 manifest 停止运行，不能自动降低标准                                   |
| 真实执行   | 经现有 process broker，以 argv、无 shell、精简环境启动                        | Node 预加载变量与 provider 凭据不继承；没有新增模型调用；任意 checker 的网络 / 文件访问不因此成为隔离沙箱 |
| 完成证据   | 必须全部检查退出 0，并输出恰好一条与本次随机 invocation ID 匹配的完整要求回执 | 缺失、重放、重复或缺少要求的回执均不能通过；提前 `process.exit(0)` 也不能通过                             |
| 文件绑定   | 核对冻结 checker；绑定当前源码范围及必需产物的字节与身份                      | 缺失产物、旧代码成功记录、检查期间改写均不能完成；检查不应修改候选源码或声明产物                          |
| 取消与资源 | 接入运行 / session 取消；检查时限受 Goal 剩余时间约束；限制输出               | 取消后的迟到成功被拒绝；超时或输出溢出停止进程；无法确认进程树清理时终止自动续跑                          |
| 持久化     | 作者开始前保存定义；检查派发前保存 running intent；完成前保存 evaluated 结果  | 写失败不派发；中断的 running checkpoint 需核对后显式恢复；恢复重新执行当前候选的检查                      |
| 修复反馈   | 给下一作者轮提供失败检查的脱敏、有界 stdout / stderr 预览                     | 回执与原始输出摘要仍留在结构化 evidence，不把输出文字当作验收成功                                         |
| 本地回归   | Windows / Node 22.22.2，12 个套件、266 项通过                                 | 其中独立计划 19 项、headless 集成 7 项；真实子进程、模拟作者，真实模型调用 0 次                           |
| 静态审计   | 1,707 个 Git 可见源码 / 脚本文件，78 个网络候选，0 项审查问题                 | 全目录扫描另有 4 个被忽略的生成 Web Panel 包未审查，不将它们标为已通过                                    |
| 生成清单   | 命令 manifest 无漂移；进程清单刷新且 runtime unreviewed 为 0                  | 新 Goal 调用为 brokered；同时补入前批源码扫描及 Memory / Codex 维护脚本的清单漂移                         |

第 4.2 节要求的四类负例均使用冻结的验收定义：

| 固定负例                              | 实际检查结果                                  | 完成判定                                      |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| 作者声称成功，但实现计算错误          | 外部断言进程退出 1                            | 未完成；headless 集成会收到失败诊断并继续修复 |
| 关键失败位于 stdout 前 2,000 字符之后 | 在 6,000 字符后输出失败，保留尾部预览，退出 1 | 未完成                                        |
| 当前源码已改，旧代码曾检查成功        | 再次实际执行；源码摘要改变，断言失败          | 未完成，不复用旧成功                          |
| 必需产物缺失                          | 捕获产物失败，不启动验收进程                  | 未完成                                        |

这些固定负例没有误报完成；不据此估算真实任务误报率。真实任务合格产物仍为 **34/45**，剩余 **11** 项。`.129` 单次派发仍须先核对不确定结果，本批没有重发或新增付费任务。

使用示例、清单协议、断言回执及恢复方式见 [Managed Agents](../cli/managed-agents.md#source-checkout-independent-goal-acceptance-unreleased)。实现拆分为 [goal-verification-plan.js](../../packages/cli/src/lib/goal-verification-plan.js) 与 [goal-verification-command.js](../../packages/cli/src/lib/goal-verification-command.js)。清单最多 8 项检查、32 项产物、每检查 32 个 checker 文件、共 65 个冻结输入；manifest 最大 64 KiB，checker 输入每个最大 8 MiB；准备 / 输入核对限时 30 秒，单检查最多 60 秒，stdout / stderr 各 128 KiB。

主机冻结的是操作者声明的文件与检查约定；操作者仍需提供真正独立的断言并列全 checker 依赖。Git 源码范围不包含被忽略依赖及工作区外文件，显式产物限于工作区内。协议不是对同进程恶意候选代码伪造回执的安全证明，也不覆盖最终检查之后的文件变化或全部外部运行环境。

Windows 本地超时 / 溢出验证曾出现 `terminateOwnedProcessTree` 无法确认整个进程树结束。产品返回 `CC_GOAL_VERIFICATION_FAILED` 和 `cleanup-unconfirmed`、要求核对，禁止自动续跑；回归容许正常确认清理后的未通过结果，或此明确的终止结果。真实取消测试确认根 PID 已消失，不据此宣称所有后代已清理。完整跨平台生命周期及 CLI / 双 IDE 崩溃恢复旅程仍未完成。

原始测试结果压缩归档、源码 SHA-256 与审查报告见[验证回执](./cli/evidence/goal-verification-2026-10-29/verification.json)。ESLint 因本地缺少 `@eslint-community/eslint-utils` 无法启动，未声明通过；语法、Prettier、生成清单与 `git diff --check` 单独记录。本地回归不能代替准确提交的三系统 CLI CI / Strict Sandbox。此批没有发布 npm / IDE 包，也不改变 `NOT_PAID_READY` / `NOT_ADMITTED` / `HOLD`。

复现命令：

```powershell
cd packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/goal-verification-plan.test.js __tests__/unit/headless-goal-verification.test.js __tests__/unit/goal-workspace-evidence.test.js __tests__/unit/goal-check-evidence.test.js __tests__/unit/headless-goal-model-budget.test.js __tests__/unit/goal-model-call.test.js __tests__/unit/headless-runner.test.js __tests__/unit/headless-runner-cost-budget.test.js __tests__/unit/headless-runtime-ledger-failclosed.test.js __tests__/unit/goal-assess.test.js __tests__/unit/direct-model-usage.test.js __tests__/unit/goal-condition-engine.test.js --maxWorkers 1
```
