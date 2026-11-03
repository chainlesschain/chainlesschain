# 历史 11 项失败任务的运行时修复补测

**最终结果：生成 11/11，独立验收 0/11，历史自动交付累计保留 34/45（27/36 任务、7/9 首次启动）。** 本轮是之前尚未通过的 11 个样本，不能用其 0/11 替换全体历史成绩。[完整结果](./final-c811dbc464/results.json)及[累计账本](./cumulative-status.json)已核对 **22 份原始摘要、22 份验收回执、11 份候选文件**的 SHA256。

全部 11 项的基线通过，**188/188** 次模型请求用量完整。本轮没有输出截断、无进展终止或轮次不足导致的生成失败。仍未验收的原因是：**9 项候选测试自身通过但漏检必需的错误行为，1 项错误导入导致零测试收集，1 项测试夹具在目标断言前就失败**。见[机器可读归因](./failure-analysis.json)。这些具体候选质量问题不能继续解释成 8192 输出限制或 IDE 未执行。

| 样本 | 候选测试 | 本轮直接失败原因 |
| --- | --- | --- |
| verify-04 | 6/6 通过 | 漏检 `drop-cache-tokens-from-request-threshold`；已检出合并长短请求桶的第一种缺陷 |
| verify-07 | 6/6 通过 | 漏检 `skip-after-cursor-first-row`；仍未调用增量 `after` 路径 |
| first-run-darwin-cli | 5/5 通过 | 同样漏检 `skip-after-cursor-first-row` |
| verify-09 | 6/6 通过 | 漏检 `trust-tampered-source-digest` |
| first-run-darwin-jetbrains | 6/6 通过 | 漏检 `trust-tampered-source-digest` |
| verify-10 | 4/4 通过 | 漏检 `reuse-index-after-state-update` |
| verify-11 | 4/4 通过 | 漏检 `recover-same-question-from-other-session`；此前错误 settle 调用已被本轮候选纠正，但恢复归属覆盖仍不完整 |
| verify-19 | 5/5 通过 | 漏检 `cancellation-grants-pending-approval` |
| verify-30 | 4/4 通过 | 漏检 `ignore-animation-fallback-pixels` |
| verify-13 | 0 项收集 | 从 `__tests__/` 沿用 `unit/` 的两条导入路径；CLI 正确报错并送达后续模型请求，模型将其误判为诊断误报而未修正 |
| verify-08 | 5/6 通过 | 声明一条历史消息，却在未接收该消息时用包含它的 digest 完成分支；完成步骤已失败，尚未执行预期的「完成后拒绝晚到消息」断言 |

verify-13 的[诊断送达证明](./diagnostics-verify13/proof.json)保存原始 write 结果、后续实际请求及模型的错误解释。verify-08 此候选是夹具错误，不能据此宣称固定源码存在新缺陷；此前另行证实的 fork 源码缺陷与后续 Sol 修复源码成绩仍分别保留。

采用运行时修复和新配置后，本轮所有样本均完成生成，语义覆盖仍不完整。Sol 在同一冻结项目的 verify-04/07 成功候选覆盖了上述两种独立错误，而 DeepSeek 在本轮仍漏掉缓存阈值及增量分页条件。因此，这批失败的直接原因主要是候选质量；但版本、思考模式与协议仍不同，不能把它包装为严格的模型单变量排名。

历史自动候选交付累计 **34/45** 保留，当前只选择累计记录中尚未通过的 **11 项**；按样本 ID 去重。这里不是新的完整 45 项成功率，也不将候选验收提升为严格端到端通过。

修复包来源：`284bb5f24c95faed45e9d7e2503640888de92766`，构建 [41597482236](https://github.com/chainlesschain/chainlesschain/actions/runs/41597482236) 全部成功。CLI/VS Code/JetBrains 三包为明确未发布的 Actions 候选制品；17 个 CLI 源文件的包内摘要与该提交逐一匹配。版本号沿用 .139/.175/.192，不能视为 npm/Marketplace 已更新。

任务源码仍为 `b2aa3aba082873570e85dce39b00754e5504ff37`。运行时与任务源码以独立身份绑定，原始任务、文件权限、独立审查、Docker 验收和行为检查保留；没有将 Sol 答案或前次候选作为提示。

已修复：读取守卫不再提供已经耗尽额度、下一次必然仍被省略的 recoveryRead；采用已有的工具参数预执行拒绝及模型上下文恢复修复。后者只由独立组件试验验证，本次基准尚未证明遇到同类参数问题。

测试配置修正：Volcengine 不再强制 `parallel_tool_calls:false`，改用提供方默认；连接地址选择从 2 秒延至 10 秒，仍不自动重试推理。显式使用 40 轮、48 请求、模型目录声明的 393216 输出上限，规划窗口仍为 32768。thinking 与既有火山诊断保持 disabled，因此和 Sol 默认思考模式、不同 CLI 版本的对照不能认作严格同配置模型实验。

离线验证：新历史选择与运行时身份、真实工作流矩阵选择、原始预算、提供方、候选包以及验收绑定共 **71 项通过**。构建、离线合同通过不计作任务成功。

执行：[41599436044](https://github.com/chainlesschain/chainlesschain/actions/runs/41599436044)，精确执行源码 `c811dbc46478ec87ba10ebfe1ba7d9467e56d7f6`。已取得并验证三个 CLI trace：新请求确实省略 `parallel_tool_calls`，实际发生每次 2～3 个工具调用；verify-07 从上一轮 37 次请求变成 14 次，首次启动从 16 次读取循环终止变成 22 次请求并写出测试文件。verify-04 仍用了 42 次请求（含两次压缩），表明配置修正不保证每个样本都更高效。以上均是过程证据，验收结果另行记录，不能直接计作通过。

两项直接相关修复的单元测试 **67/67**；正常 Windows 原生 ACL 权限下，真实运行时的错误参数拒绝、严格上下文恢复和旧会话继续执行五项回归 **5/5**。完整大套件在受限沙箱和不完整 sparse checkout 下未通过，不能宣称全套运行时回归通过；详见 `validation.json`。

verify-11 的验收曾长时间停在 Actions checkout，后自行恢复并完成真实检查。为这种基础设施故障准备了单独、无模型凭据的只验收工作流，**本次没有触发该备用入口，也没有重复生成**。全部最终回执来自原始运行 41599436044；其失败结论没有用基础设施等待时间代替。
