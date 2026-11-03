# OpenAI 两项失败：共享 CLI harness 续查

**结论：候选有模型生成错误，共享 CLI harness 也存在已复现的缺陷，不能仅归因模型。应将 harness 修复纳入新的 CLI 发行；目前没有证据要求修改 IDE 插件自身的执行逻辑。** 修复后是否能完成这两项，仍需另一次模型生成及独立验收证明。原四项 **2/4** 成绩、失败候选及历史累计均保留。

本次用户明确授权请 **Astra（gpt-6-astra）** 独立协助。主线程复现、Astra只读核查源码与原始出站请求；此次没有使用账号密钥、启动新的付费样本或修改验收器。此前依据工具回执判断“候选完整可见”的结论不充分，现以真正发往提供方的请求正文修正。

## 确认的 harness 缺陷

| 问题                       | 证据                                                                                                                                                                                                                                        | 修复状态                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 普通源码展开语法被错误省略 | 宿主 `canProjectHostToolExcerpt` 未配置提供方既有的 `bounded-source-tokens-v1`，把 `["ancestor question", "ancestor answer", ...body]` 及 `new Map` 内的嵌套展开数组误判为损坏 JSON。两份语法合法的完整候选均被拒绝，扩大读取范围不能恢复。 | 本次只增加既有 `sourceExpressionPolicy`，使宿主预览与 provider 策略一致；未改权限、预算、严格 JSON、敏感数据规则。 |
| 恢复提示不可执行           | 冻结 CLI 在重读额度耗尽或相同范围已使用后，仍返回 `recoveryRead`；模型照做仍被省略。本地两个反例均复现。                                                                                                                                    | 当前源码已包含 `284bb5f24c95faed45e9d7e2503640888de92766` 的可恢复性检查；两个反例通过。此修正不在冻结 `.140` 中。 |

源码读取预览只判断能否投影，不承担提供方的敏感信息清理。保留并验证真正的 provider projector；也不把“可投影源码片段”等同语法完整、整个文件已读或任务通过。

## 原始出站证据

从原生 VS Code 交付 ZIP 回读，先核对 GitHub 制品 SHA-256 和原始 summary 摘要，再检查两个样本的 **42 份 effective 请求**。每份 `original.input` 与 `effective.input` 一致，转发器没有改写上下文。解析 `function_call_output.output` 时使用 `raw_decode`，保留 JSON 后的预算提示；直接 `json.loads` 会漏掉这些关键工具结果。

- `first-run-darwin-vscode`：5661 字符完整候选及3989字符尾段，在出站正文中变为 `Text omitted`，共两个不同读取调用。部分41行前缀曾实际可见。最后一次编辑将文件由5661改为5629字符，此后没有再回读最终版本。
- `verify-08`：3617字符全文、4305字符带哈希全文、两次1467字符尾段，均在出站正文中变为 `Text omitted`，共四个不同读取调用。
- 正确 `store.startSession` 的既有示例仍有实际交付，`verify-08` 的会话专属 `id` 定义也曾通过搜索交付。因此不能把所有错误归因于缺失信息；但不能依据宿主工具执行成功宣称模型已完成候选检查。

[逐请求摘要、调用 ID、范围、正文摘要与可见源码事实](outbound-read-evidence.json)。完整输入正文仍按原 ZIP 身份保存，审计报告只提取必要证据。

## 模型错误与审阅边界

两项候选原错误不变：`verify-08` 错误比较带目标会话身份的完整展示行；首次安装残留不存在的 `store.createSession`，模型最终文字也承认没有修完。两项基线各59/59，但这不能证明全部 harness 正常，也不能把失败都归为模型能力。

审阅确有独立原始要求上下文与新读取 guard，不只是提醒。然而，模型返回终态不要求可核验的“已检查/已修复/已回读”结构化证据；这是既有行为，现有测试也允许审阅直接返回 `Unverified deliverable`。活动回执 `observed=true` 仅证明进入审阅，`completed=null`，不能称为审阅验收通过。最终独立验收已正确判失败，没有把协议 `success` 当任务通过。

## 无密钥验证

- 新增两个最小展开语法回归：修复前 **2/2 失败**，均由正文被省略触发。[原始报告](spread-pre-fix.vitest.json)。
- 修复后相关读取、恢复、严格证据 JSON、provider 投影、敏感字段/PII及输出上限、审阅合同共 **514/514 通过**。[原始报告](post-fix.vitest.json)。
- 两份原始失败候选逐字节作为只读 fixture，经宿主预览 → `EvolutionEvidenceProjector` → 验签 → `buildAgentModelRequest` → Responses 工具输出，**2/2 正文完整保留**，范围和版本元数据不变。[原始报告](archived-candidate-replay.vitest.json)。这是交付回放，不是候选验收。
- 隔离加载准确冻结模块，对比当前 guard 的两个反例及两份完整候选投影。[源码摘要与复现结果](offline-reproduction.json)。
- 出网边界回归 **9/9** 通过；包含脚本的静态出网审查 **89 个候选文件，零未分类、零解析错误**。补齐上一轮公开包预检脚本的独立分发用途分类，保留元数据重定向和继承环境的边界；该分类不授予 `paidReady` 或发行准入。[回归报告](egress-regression.vitest.json)、[检查结果](egress-check.json)、[首次缺项记录](egress-pre-review.json)。
- [Astra 独立复核记录](astra-review.json)。

复现命令（仓库根目录）：

```powershell
node packages/cli/scripts/verify01-read-harness-audit.mjs
python -X utf8 docs/research/cli/verify01-openai-140-frozen-four-20261103/harness-audit-20261104/audit-outbound-reads.py --archive <原始交付ZIP路径>
```

## 发布判断

截至本次只读 npm 回读，公开 CLI 仍为 `0.166.140`。本次修复尚未发行，本地验证不代替发行门。CLI 新版须在准确候选提交通过全部配置系统的 `CLI CI`、`CLI Strict Sandbox` 与适用发行检查，再按依赖顺序使用 GitHub Actions OIDC 发布并公开回读。

两个已确认问题都位于共享 CLI harness；没有独立 IDE 业务逻辑故障证据。IDE是否配套发行取决于新 CLI 的推荐版本和依赖配对，不应把补发两个插件当作修复这两处代码的必要条件。未实跑新的模型样本，不宣称修复后两项已通过，也不给模型失败与 harness 影响分配未经验证的比例。
