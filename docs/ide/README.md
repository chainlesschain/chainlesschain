# IDE 文档

> 2026-10-10 公开回读：CLI **0.166.96**、Agent SDK **0.2.14**、Open VSX **0.37.140**、JetBrains **0.4.158** 已公开，两个 IDE 均推荐 CLI `0.166.96`，准确发行提交 `da91e730d8`。Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64** 保持独立版本；产品 **v5.0.3.140** 仍来自 `f733f92cb9`。源码核对至 `main@2650447476`。本轮改善并发权限设置、JetBrains 审批卡片布局与失败诊断，补齐 Windows 私有工具链和清理取证；正式 36+9 评测保持 NOT_RUN，完整 native review 保持 NOT_ADMITTED，自动晋升 HOLD。 详见[本轮升级与诊断](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-10.html)。

> 2026-10-08 历史核对：公开 CLI **0.166.92**、Open VSX **0.37.137**、JetBrains **0.4.155**，两个 IDE 均推荐 CLI `0.166.92`；Session Core **0.3.17**、Context/Memory Kernel **0.1.7**、PDH **0.4.64**。发行提交 `e812a89952`，产品 **v5.0.3.139** 已公开。主线核对至 `381f8018ef`：产品已包含个人目标巡检/动作/独立验收与组织任务工作台；个人记忆面板、组织转移/风险/共享目标/巡检/验收/记忆、站内通知和 IDE 调查循环恢复属于后续源码。 使用[个人目标](https://docs.chainlesschain.com/chainlesschain/project-goals-current.html)、[组织项目](https://docs.chainlesschain.com/chainlesschain/organization-project-current.html)与[RRSI](https://docs.chainlesschain.com/chainlesschain/rrsi-current.html)指南；详见[最新设计](https://design.chainlesschain.com/governance-runtime-update-2026-10-08.html)。

[返回文档中心](../README.md)

2026-10-06 历史发布后核对：npm CLI **0.166.90** 与 Open VSX **0.37.135** 已公开，发行标签绑定 `28cff6adc8`，Open VSX 推荐 CLI `0.166.90`。Session Core **0.3.15**、Agent SDK **0.2.13**、PDH **0.4.63** 已先于 CLI 经 OIDC 发布并下载核验。JetBrains **0.4.153** 也已批准公开上架（`approve/listed=true`、`hidden=false`），推荐 CLI `0.166.90`，发行标签同样绑定 `28cff6adc8`，标签发布工作流成功。文档核对源码为 `main@2b4de8bcd7`；桌面与移动端产品包保持独立 **v5.0.3.138**，新增桌面任务工作区须运行本轮源码，不能从 npm/IDE 发布推断已进入该安装包。 投影恢复、任务动作与风险规则见[最新设计](../design/data-actions-update-2026-10-06.md)。较早带日期段落保留其历史范围。

- [工作台、技能库与 LLM 配置页面](./IDE_WORKSPACE_PANELS.md)
- [演进工作台运行说明](../features/evolution-workbench/README.md)
- [VS Code / VSCodium 扩展](../../packages/vscode-extension/README.md)
- [IDE 差距分析与优化路线](../research/ide/README.md)
- [CLI 与 IDE 发布检查表](../releases/CLI_IDE_RELEASE_READINESS_2026-09-05.md)
