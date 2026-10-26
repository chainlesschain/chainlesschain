# CLI 文档

> 2026-10-27：CLI **0.166.127** 已经 OIDC 公开发布，准确源码 `0377050191b6` 的三平台 CLI CI 与 Strict Sandbox 均已通过，公开归档字节、签名来源和十个直接子依赖已核验。安装：`npm i -g chainlesschain@0.166.127 --registry https://registry.npmjs.org`。共享自进化开关默认关闭，可重新开启；配套 IDE **0.37.165 / 0.4.180** 正在发布。见[配置说明](./SELF_EVOLUTION_CONFIGURATION.md)与[发布证据](../research/cli/evidence/release127-public/publication.json)。以下带日期的发布记录保留其历史范围。

> 2026-10-26：公开 CLI **0.166.123**，安装 `npm i -g chainlesschain@0.166.123 --registry https://registry.npmjs.org`。修复模型设置串用、Windows 首字延迟和 Python 格式化字符串投影误判；Session Core **0.3.24** 已先行发布。现有 IDE 仍为 **0.37.161 / 0.4.178**，推荐标记仍为 `.121`。三平台发布门禁、公共包字节、签名来源和子依赖已核验，见[发布证据](../research/cli/evidence/release123-public/publication.json)。验收 **32/45**、**13** 项未完成及 **NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

> 2026-10-16：公开 CLI **0.166.103**、Open VSX **0.37.148** 与 JetBrains **0.4.165**，两个 IDE 均推荐 CLI `.103`。CLI 发行提交 `b235ac8068`，VS Code `c8a64caa92`，JetBrains `fa64840216`；主线核对至 `920f263e3f`。Session Core **0.3.19**、Kernel **0.1.10**、PDH **0.4.65**；原生产品 **v5.0.3.140** 独立发行。正式预算保持 **NOT_PAID_READY**，36+9 **NOT_RUN（0/36、0/9）**、native **NOT_ADMITTED**、自动晋升 **HOLD**。 参见[本轮升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-16.html)。较早日期的记录保留历史范围。

> 2026-10-10 公开回读：CLI **0.166.96**、Agent SDK **0.2.14**、Open VSX **0.37.140**、JetBrains **0.4.158** 已公开，两个 IDE 均推荐 CLI `0.166.96`，准确发行提交 `da91e730d8`。Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64** 保持独立版本；产品 **v5.0.3.140** 仍来自 `f733f92cb9`。源码核对至 `main@2650447476`。本轮改善并发权限设置、JetBrains 审批卡片布局与失败诊断，补齐 Windows 私有工具链和清理取证；正式 36+9 评测保持 NOT_RUN，完整 native review 保持 NOT_ADMITTED，自动晋升 HOLD。 详见[本轮升级与诊断](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-10.html)。

[返回文档中心](../README.md)

2026-10-06 历史发布后核对：npm CLI **0.166.90** 与 Open VSX **0.37.135** 已公开，发行标签绑定 `28cff6adc8`，Open VSX 推荐 CLI `0.166.90`。Session Core **0.3.15**、Agent SDK **0.2.13**、PDH **0.4.63** 已先于 CLI 经 OIDC 发布并下载核验。JetBrains **0.4.153** 也已批准公开上架（`approve/listed=true`、`hidden=false`），推荐 CLI `0.166.90`，发行标签同样绑定 `28cff6adc8`，标签发布工作流成功。文档核对源码为 `main@2b4de8bcd7`；桌面与移动端产品包保持独立 **v5.0.3.138**，新增桌面任务工作区须运行本轮源码，不能从 npm/IDE 发布推断已进入该安装包。 投影恢复、任务动作与风险规则见[最新设计](../design/data-actions-update-2026-10-06.md)。较早带日期段落保留其历史范围。

从[安装指南](../guides/CLI_INSTALLATION_GUIDE.md)和[命令索引](./CLI_COMMANDS_REFERENCE.md)开始；完整命令清单见[自动生成的 CLI 参考](./CLI_REFERENCE.generated.md)。

差距评估见[CLI 研究索引](../research/cli/README.md)，发布流程见[发布文档](../releases/README.md)，验证产物见[evidence](./evidence/)。

## 运行时、专题与参考

- [CLI 与 IDE 自进化开关配置](./SELF_EVOLUTION_CONFIGURATION.md)
- [Auto mode Safety Classifier Evaluation](./AUTO_MODE_SAFETY_EVAL.md)
- [CLI — Phase 8: Blockchain & Enterprise](./blockchain-enterprise.md)
- [CLI 因果可观测性](./CAUSAL_OBSERVABILITY.md)
- [CLI Commands Reference](./CLI_COMMANDS_REFERENCE.md)
- [CLI 原生发行公网回读门禁](./CLI_NATIVE_RELEASE_READBACK.md)
- [CLI Reference (generated)](./CLI_REFERENCE.generated.md)
- [CLI reliability soak](./CLI_RELIABILITY_SOAK.md)
- [CLI command lifecycle telemetry and alias decisions](./COMMAND_LIFECYCLE_TELEMETRY.md)
- [CLI — Phases 2–7 · Init, Persona, Cowork](./core-phases.md)
- [Production Eval construction contract](./EVOLUTION_EVAL_COMPOSITION.md)
- [Evolution Ledger v2 payload journal and cutover](./EVOLUTION_LEDGER_V2_CUTOVER.md)
- [Direct model entry governance audit (2026-09-08)](./EVOLUTION_MODEL_ENTRY_AUDIT_2026-09-08.md)
- [EVO-P0-4 仓库闭环核验（2026-09-12）](./EVOLUTION_P0_4_REPOSITORY_CLOSURE_2026-09-12.md)
- [Governed Skill marketplace CLI](./GOVERNED_SKILL_MARKETPLACE_CLI.md)
- [长程任务的探索恢复与停止](./LONG_RUNNING_TASK_RECOVERY.md)
- [M5/M6 Runtime Convergence 架构实现文档](./M5_M6_RUNTIME_CONVERGENCE_IMPLEMENTATION.md)
- [CLI — Managed Agents & Hosted Session API](./managed-agents.md)
- [CLI — Observability & Code Intelligence](./observability.md)
- [CLI — Platform Services](./platform.md)
- [Process Spawn Inventory](./PROCESS_SPAWN_INVENTORY.generated.md)
- [Agent Protocol Capability Manifest (generated)](./PROTOCOL_CAPABILITY_MANIFEST.generated.md)
- [CLI — Video Editing Agent (CutClaw-inspired)](./video.md)
