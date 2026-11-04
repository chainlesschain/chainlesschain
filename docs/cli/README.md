# CLI 文档

<!-- release141-candidate:start -->

## CLI 0.166.141 / 新版源码候选

CLI **0.166.141** 修复合法源码展开表达式被读取预览误省略的问题，并统一隔离评测中的 CLI / IDE 文件范围。配套候选为 VS Code **0.37.177**、JetBrains **0.4.194**，普通交互权限和 IDE 协议保持原有行为。

当前仍在验证阶段：准确提交的 Linux、Windows、macOS CLI CI / CLI Strict Sandbox 全矩阵通过后，通过 GitHub Actions OIDC 发布 CLI；公开安装与来源核验通过后才发布 IDE。新版本公开前，下面已核验的 `.140` 安装说明继续有效。此次不启动模型任务复测，不改写历史验收成绩。

<!-- release141-candidate:end -->

<!-- release140-current:start -->

## 当前公开 CLI：0.166.140 / IDE 恢复补丁

截至 **2026-11-03T11:42:31.329Z**，CLI **0.166.140** 已通过 [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/41610020835) 公开发布，准确发行源码为 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`。公开 npm 字节、来源签名、安装与启动均已核验；同一源码的 Linux、Windows、macOS CLI CI / CLI Strict Sandbox 全部配置作业通过。

Open VSX **0.37.176** 已公开列出且可下载，VSIX 与正式构建逐字节一致。JetBrains **0.4.193** 已上传，等待商店审核或公开索引；公开可用性未核验。上一已核验公开版仍为 **0.4.192**，其推荐标记为 CLI **0.166.139**。 两个新 IDE 版本均推荐 CLI **0.166.140**。

[发行与各渠道回执](../research/cli/evidence/release140-public/publication-readback.json) · [准确源码门禁](../research/cli/evidence/release140-public/gates.json) · [CLI 公开回读](../research/cli/evidence/release140-public/cli.json) · [Open VSX 回读](../research/cli/evidence/release140-public/open-vsx.json) · [JetBrains 状态](../research/cli/evidence/release140-public/jetbrains.json)

安装：`npm i -g chainlesschain@0.166.140 --registry https://registry.npmjs.org`，重启 CLI 与 IDE 聊天宿主，再运行 `cc --version`、`cc doctor`。

修复模型返回损坏工具参数后自进化解析退出的问题：非法参数在执行前被拒绝，后续请求只为唯一配对、明确未执行的记录生成临时占位；原始会话历史保持完整，旧版失败调用不会被重放。有效对象、重复键与嵌套 JSON 校验、脱敏和预算边界继续生效。

内部投影规则 v10 同时修复图片及推理传输块的内部 SHA-256 摘要被手机号扫描误判的问题。仅可信传输元数据使用扫描视图，原始摘要与字节长度绑定不变。真实手机号、用户文本中的摘要样字符串和伪造标记继续接受原有检查，v1–v9 历史规则保留。

Windows 聚焦检查 **129 项通过**。较早 v9 恢复实测共 **5 次真实火山请求 / 6,401 tokens**，首个场景明确向一次模型响应注入日志中的损坏参数，见[原始实测](../research/cli/evidence/tool-argument-recovery-20261103/live-volcengine.json)。独立 v10 复测再次通过两条恢复路径，共 **5 次请求 / 6,501 tokens**，运行时源码哈希与本次发行一致，见[追加实测](../research/cli/evidence/tool-argument-recovery-20261103/live-volcengine-v10.json)。完整相关投影测试 **393/393 通过**。两轮实测独立记录，不合并为历史大任务验收成绩。

旧候选 `eb0fe7a8a1` 曾在 Windows ArtifactStore post-index 完整性组合校验处失败，随后完整三平台回环复测通过；具体拒绝子条件仍未知，校验继续生效。[原始失败](../research/cli/evidence/tool-argument-recovery-20261103/windows-eb-trajectory-attempt1-failure.json)与[完整复测](../research/cli/evidence/tool-argument-recovery-20261103/windows-eb-trajectory-attempt2-aggregate.json)保留历史源码范围。最终发行源码另有三平台各 100 次回环通过，共 300 次仅覆盖结构封套，不代表付费模型任务验收，也不替代 CLI CI / Strict Sandbox。本地 composition 在 v10 源码与较早基线上均出现超时，未计为通过。

Agent SDK **0.2.17**、Protocol **0.1.12**、Kernel **0.1.11** 和其他子包沿用已公开版本；CLI 发布前已回读必需上游包并核验依赖对齐。Microsoft Marketplace 继续暂缓。PC/移动端 **v5.0.3.144** 已独立公开，本次 CLI/IDE 后续不重复发布客户端。历史 .138 **2/4**、.137 **0/5**、累计 **41/45** 各自范围保留。

<!-- release140-current:end -->

<!-- release138-current:start -->

> 2026-11-02 核对：CLI **0.166.138** 与上游 Agent SDK **0.2.17** 已通过 GitHub Actions OIDC 发布。安装：`npm i -g chainlesschain@0.166.138 --registry https://registry.npmjs.org`，升级后重启 `cc ui` 与 IDE 聊天宿主，并运行 `cc --version`、`cc doctor`。Open VSX **0.37.174** 发布工作流成功，推荐 CLI **0.166.138**。JetBrains **0.4.191** 已获 Marketplace 批准并公开列出（update `1209507`）；公开 ZIP 与正式构建的负载一致性仍待核验。两个新插件均推荐 CLI **0.166.138**。

准确发行源码 `e42ea07b6d` 的完整三平台 CLI CI / Strict Sandbox、OIDC 发布及公开包字节/签名/启动核验均通过。公开 .138 四项复验 **2/4**；verify-08、verify-36 在作者阶段耗尽 20/20 轮，仍失败。前轮 .137 **0/5**、历史累计 **41/45** 单独保留；已通过项后续跳过。见[复验结果](../research/cli/verify01-openai-138/README.md)、[升级指南](../../docs-site/docs/chainlesschain/cli-ide-update-2026-11-02-138.md)、[发行证据](../research/cli/evidence/release138-public/README.md)与[自进化开关说明](./SELF_EVOLUTION_CONFIGURATION.md)。下方带日期的记录保留历史范围。

主分支另有后续合入的独立 WebSocket 模型策略修复（`2e97ce3d79`），仍待下一版 CLI 通过完整验证后发行。本次已公开的 CLI 0.166.138 仍绑定其原始已验证发行源码。

<!-- release138-current:end -->

> 2026-10-27：CLI **0.166.127** 已经 OIDC 公开发布，准确源码 `0377050191b6` 的三平台 CLI CI 与 Strict Sandbox 均已通过，公开归档字节、签名来源和十个直接子依赖已核验。安装：`npm i -g chainlesschain@0.166.127 --registry https://registry.npmjs.org`。共享自进化开关默认关闭，可重新开启；配套 IDE **0.37.165 / 0.4.182** 已公开上架并完成制品回读。见[配置说明](./SELF_EVOLUTION_CONFIGURATION.md)与[发布证据](../research/cli/evidence/release127-public/publication.json)。以下带日期的发布记录保留其历史范围。

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
