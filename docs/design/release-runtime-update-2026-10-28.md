# CLI .128：证据判定、可选复查与发行来源（2026-10-28）

## 发行来源与当前状态

| 渠道      | 版本与状态                         | 固定源码                                   | 工作流                                                                                        |
| --------- | ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| CLI       | `0.166.128`，公开且回读通过        | `dfa158e36171e347a40e23356c2ed7bd04e0c061` | [OIDC 40552876222](https://github.com/chainlesschain/chainlesschain/actions/runs/40552876222) |
| Open VSX  | `0.37.166`，公开且回读通过         | `6551a06c2f694bb93d0197fa8b82becd25a83173` | [40557016206](https://github.com/chainlesschain/chainlesschain/actions/runs/40557016206)      |
| JetBrains | `0.4.183`，公开且 payload 回读通过 | `6551a06c2f694bb93d0197fa8b82becd25a83173` | [40557015160](https://github.com/chainlesschain/chainlesschain/actions/runs/40557015160)      |
| 移动 / PC | `v5.0.3.143`，五平台构建中         | `036d2b8be2048c98e56e917c93380f169e6a9d7b` | [40565272034](https://github.com/chainlesschain/chainlesschain/actions/runs/40565272034)      |

当前客户端公开版本仍为 `.142`。最新事实与后续上架结果见[公开状态回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release128-public/publication.json)。Microsoft Marketplace 仍未发布。

## Headless Goal 的证据边界

默认自然语言完成判定从仅依赖最终回复，调整为读取当前轮次成功工具证据，并核对判定返回的证据 ID。旧轮次、缺失或失败工具结果不能被当作当前成功证据。已有确定性完成条件继续保留。

Goal 状态的持久化失败会暴露给调用方，防止界面看似完成而恢复时只能读取旧检查点。工具副作用、模型回复、Goal 判定与可靠持久化分别表示不同事实；恢复不能把缺失回执当作副作用已经回滚。

这仍是带证据的模型判定，不等于对所有产物完成独立验收。要求明确的任务应优先绑定确定性条件和实际执行结果。

## 可选复查的控制边界

`--review-changes` 只为 headless / stream-json 入口提供显式选择，默认关闭。真正成功的文件内容变更才会安排复查，失败、拒绝或延迟的变更不会触发。

复查复用同一运行循环、工具范围、用量结算与剩余预算。共享的一次性状态防止外层 Goal 续跑反复追加复查；用量未知、预算耗尽、来源拒绝或取消不会因复查获得例外。它提供一次复查机会，而不是承诺仅增加一个模型请求。

启用时抑制临时文本与 thinking delta，仅发布被接受的最终文本，避免宿主把初稿与修正结果拼成一个答复。复查消息不授予新权限，也不充当测试通过或独立验收回执。

## 配置、协议与检索

双 IDE 共享模型推荐，并区分未配置、配置读取失败与已配置。会话 `/model` 覆盖不写入其他会话。OpenAI 连接探测按能力配置复用 Responses 编解码，仍通过原有 `providerFetch` 发出一次受预算范围约束的推理请求。

探针仍归类为 `MODEL_REQUEST`，不被当作免费健康 GET。输出上限、超时、重定向拒绝、预算错误传播及凭据脱敏继续执行；用量不完整保持未知，失败回执保留已知用量。源码出口审查仅绑定经过复核的具体字节，不构成付费准入。

MCP / Skills 改进多语言检索。MCP 的 `compact` 目录模式默认关闭，完整工具库存与执行权限继续保留。Memory 优化索引候选归并，磁盘验证仍执行；局部归并基线不能当作完整冷磁盘查询 SLO。

## 跨端发行与源码冻结

所需子 npm 包先公开并核验，再经准确提交的 Linux、Windows、macOS CLI CI / Strict Sandbox 和 GitHub Actions OIDC 发布 CLI。CLI 公开归档、签名来源与依赖版本通过回读后，才推送配套 IDE 正式发行标签；客户端保持最后发布。

CLI 的独立回读 [40556529770](https://github.com/chainlesschain/chainlesschain/actions/runs/40556529770) 证明公开 npm 归档与不可变 CI 制品逐字节一致，源提交与正式标签一致。十个直接 child pins 保持不变，Session Core 为 `0.3.24`。

客户端使用冻结源码，保留整个 npm 包目录与已授权 CLI 标签的字节一致性；默认分支上的文档或复测工具改动不自动进入客户端。Android bundle 从公开 `.128` 和签名来源刷新，保留既有 Android 运行时及必要原生绑定，并通过新 binaries 版本和解包版本号替换旧包。归档验证不表示已在 Android 设备上执行。

## 验证与遗留边界

CLI CI 的 71 个必需任务和 Strict Sandbox 全部配置平台通过，发布遵循 OIDC。RC6 的 macOS 容量取消通过同一提交补跑，后置审查又发现连接探测器摘要过期；RC7 完成具体源码复核后更新内容绑定，并重新运行全部准确提交门禁。旧候选与原标签保留，未用旧提交或部分成功结果放行。

发布过程中的本地检验还覆盖预算出口审查、探针模拟响应及原生准入 / 预检合同；它们仅补充云端结果。公开版本、归档身份、工程构建、真实模型任务接受度与账单验收分别记录。

累计任务验收仍为 **32/45**，另有 **13** 项未完成。合成 token 与局部性能测量不代表真实费用下降或整体质量提升。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留；本轮发布不新增付费模型任务调用。

## 关键文件

- `packages/cli/src/runtime/headless-runner.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/lib/coding-task-guidance.js`
- `packages/cli/src/lib/llm-connection-probe.js`
- `packages/cli/src/runtime/mcp-tool-search.js`
- `packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`
- `packages/cli/scripts/budget-egress-reviewed-sources.json`
- [发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release128-public/publication.json)

设计权威源位于 `docs/design/`，两个 VitePress 站点通过同步脚本生成副本；三站部署须绑定同一文档提交，并保留旧站点供回滚。
