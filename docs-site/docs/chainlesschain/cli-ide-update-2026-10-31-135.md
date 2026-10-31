# CLI 0.166.135 / IDE 升级说明

## 概述

CLI **0.166.135** 与 Open VSX **0.37.173** 已公开并完成正式制品核验；JetBrains **0.4.189** 已通过完整测试、构建与上传，仍待 Marketplace 审核/上架。两个新 IDE 的推荐版本均为 CLI **0.166.135**，但目前公开 JetBrains 仍是 **0.4.188**，其推荐标记为 CLI **0.166.133**。Kernel 保持 **0.1.11**。完整精确源码 CLI CI（76/76）和 Strict Sandbox（6/6）、OIDC 发行与独立回读已通过。

CLI / JetBrains 来源为 `82aa6d703a8695721a7ccf0793a435853bc2bbf2`，Open VSX 来源为 `98db89940de30106f57ee73c063acf249d23bec0`；后者仅修改两个 VS Code README/版本文件，CLI、Web Panel、锁文件、SDK 和 Kernel 对象相同。 [发行回执](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/evidence/release135-public/publication.json)记录本次发行时的公开状态和待审上传。

## 核心特性

本版修复非流式 OpenAI Responses 读取 JSON 时断连直接显示 `terminated` 的路径；无已接受输出时使用既有有限重试，每个物理请求单独记录，HTTP/provider 拒绝、取消、用量持久化失败与工作流禁止重放策略仍有效。请求头与 JSON 正文读取都有期限，用户取消优先。

流式请求收到完成事件即可结算，连接持续开放不再阻塞下一步；超时不再等待一个可能永不结束的 reader.cancel。未完成工具调用仍不执行、不自动重放，已经执行的工具不会因这次恢复而再次执行。

保存与恢复后台启动配置时，显式空工具白名单继续表示不允许工具；非法权限、沙箱及预算值被拒绝。修复前，空列表可能在 argv 重建时丢失，非法值可能静默变为默认值。

## 系统架构

CLI 运行时处理 Responses 请求、工具续接与用量结算，Web 与 IDE 宿主使用该运行时。IDE 配套版本独立发布，Kernel 保持 **0.1.11**。

## 配置参考

后台启动配置保留显式空工具白名单。权限、沙箱及预算配置必须有效；恢复配置被拒绝时应修正原值，不能依赖静默回退。

## 使用示例

```bash
npm i -g chainlesschain@0.166.135 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启已经运行的 `cc ui`、终端或 IDE 聊天宿主。Microsoft Marketplace、PC 与移动端不在本轮范围。

## 性能指标

本版未公布独立的延迟、吞吐量或资源占用基准。请求终止与断连恢复的回归结果不代表新的性能测量。

## 测试覆盖

历史 OpenAI 实测为 **39/45**，不是本版新的 45 项通过率。此次补充错误场景回归并修复根因；旧任务、候选文件、原始失败和用量没有改写。详情见[根因分析](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/openai-turn-recovery-134.md)。

CLI 0.166.134 的候选标签指向已通过完整测试的源码，但其提交包含 `[skip ci]`，没有触发正式发布。该版本未发布到 npm。0.166.135 使用新的、无跳过标记的发布提交并重新运行完整精确提交门禁；已推送标签的源码身份保持不变。

VS Code 0.37.172 被现有 Marketplace overview 单测拦截，因为 README 首段混入发行说明，不再等于包描述。保留原测试和不可变标签，仅修复 README 结构与版本，顺延到 0.37.173；没有重复发布 CLI。用户随后允许使用可测试包，不等待 JetBrains 审核，并限定先重测上次失败的 6 项。本轮 **1/6** 通过（`verify-26`），其余 **5** 项仍未通过；跨版本累计 **40/45** 不是新版完整 45 项重跑。历史 **39/45** 不改写。[完整重测报告](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/verify01-openai-135/retest-six-99b93fc209/REPORT.md)保留全部独立验收和失败候选。

## 安全考虑

恢复流程继续遵守取消、provider 拒绝、用量持久化失败与禁止重放策略。未完成工具调用不会执行，已执行工具不会因恢复再次执行。发行使用 Actions OIDC 并独立核验公开制品。

## 故障排查

若升级后仍出现 `terminated`，核对 `cc --version` 并重启已有宿主。若安装 `.134` 失败，使用本页已公开的 `.135` 安装命令；`.134` 未发布到 npm。

## 关键文件

`packages/cli/src/runtime/agent-core.js` 实现请求恢复；`packages/cli/src/lib/background-launch-profile.js` 实现启动配置校验；`docs/research/cli/evidence/release135-public/` 保存发行回执；`docs/research/cli/verify01-openai-135/retest-six-99b93fc209/` 保存重测证据。

## 相关文档

参见[前序候选说明](./cli-ide-update-2026-10-31-134)、[CLI 0.166.133 升级说明](./cli-ide-update-2026-10-30-133)及[根因分析](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/openai-turn-recovery-134.md)。
