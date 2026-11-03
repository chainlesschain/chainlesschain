# CLI 与 IDE 升级：损坏工具参数恢复补丁

## 概述

<!-- release140-guide-status:start -->

截至 **2026-11-03T11:42:31.329Z**，CLI **0.166.140** 已通过 [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/41610020835) 公开发布，准确发行源码为 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`。公开 npm 字节、来源签名、安装与启动均已核验；同一源码的 Linux、Windows、macOS CLI CI / CLI Strict Sandbox 全部配置作业通过。

Open VSX **0.37.176** 已公开列出且可下载，VSIX 与正式构建逐字节一致。JetBrains **0.4.193** 已上传，等待商店审核或公开索引；公开可用性未核验。上一已核验公开版仍为 **0.4.192**，其推荐标记为 CLI **0.166.139**。 两个新 IDE 版本均推荐 CLI **0.166.140**。

[发行与各渠道回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/publication-readback.json) · [准确源码门禁](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/gates.json) · [CLI 公开回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/cli.json) · [Open VSX 回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/open-vsx.json) · [JetBrains 状态](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/jetbrains.json)

<!-- release140-guide-status:end -->

文档于 **2026-11-03** 按 `main@d62866538c` 核对。后续主线读取恢复提示与 Web Panel bundle 修复晚于 .140 发行源；当前 npm 包不包含这些后续改动。[最新运行时设计](/design/release-runtime-update-2026-11-03-140)。

## 核心特性

修复模型返回损坏工具参数后，自进化输入解析失败并退出的问题。非法 JSON、null、数组和其他非对象参数会在执行前被拒绝，模型可以在原权限和预算内重新发出正确调用。

对于明确未执行、唯一配对的失败调用，下一次模型请求会省略损坏参数并附上错误说明。旧版 run_code 参数快照拒绝记录也能续接；已保存的原始历史保持完整，失败调用不会被重放。

## 系统架构

内部投影规则 v10 同时修复图片及推理传输块的 SHA-256 摘要被手机号扫描误判的问题。仅可信传输元数据使用扫描视图，原始摘要和字节长度绑定不变；真实手机号、用户文本中的摘要样字符串及伪造标记仍受检查。v1–v9 历史规则定义和读取校验保留。

修复由 CLI 的工具调用和模型请求准备层承担，两款 IDE 通过推荐同一 CLI 获得恢复能力。IDE 通信协议保持原有版本。

| 组件      | 配套版本  |
| --------- | --------- |
| CLI       | 0.166.140 |
| Open VSX  | 0.37.176  |
| JetBrains | 0.4.193   |

Agent SDK **0.2.17**、Protocol **0.1.12**、Kernel **0.1.11** 和其他子包版本不变。PC/移动端 **v5.0.3.144** 已独立公开，本补丁不重复发布客户端。

## 配置参考

升级保留现有模型、审批、权限和预算配置。自进化仍由用户配置中的 evolution.enabled 控制，默认关闭；升级不会自动改变开关。切换后停止并重新启动 Agent。

```json
{
  "evolution": {
    "enabled": true
  }
}
```

普通 Agent 同样执行工具参数校验。模型重新调用工具时仍须提供完整参数，例如 run_code 所需的 language 和 code。

## 性能指标

较早 v9 的两条限定恢复实测共使用 **5 次真实模型请求、6,401 tokens**，与下方 v10 的 6,501 tokens 复测独立记录。这些数字只描述本次检查，不是延迟、费用或吞吐量承诺，也不代表其他模型任务的成功率。

## 测试覆盖

内部摘要修复的完整相关测试 **393/393 通过**；新增确定性真实 PNG / 推理摘要回归，覆盖手机号、伪造标记、绑定篡改、验签失败和旧规则读取。v10 发行源码再次通过两条真实火山恢复路径，共 **5 次请求 / 6,501 tokens**，源码哈希与当前运行时一致。见[追加实测证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/tool-argument-recovery-20261103/live-volcengine-v10.json)。

Windows 相关回归检查 **129 项通过**。两条真实火山模型恢复路径分别验证新调用被拒绝后继续，以及旧版失败历史续接；新调用场景明确向一次真实响应注入了日志中的损坏参数。两条路径均验证未执行/未重放失败调用、原历史不变、成功读取未知文件内容和自进化运行正常结束。

准确发行源码 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d` 的 Linux、Windows、macOS **CLI CI** 与 **CLI Strict Sandbox** 全部配置作业通过，GitHub Actions OIDC 发布及公开 CLI 回读已核验；两款 IDE 的准确源码宿主门禁通过，各渠道公开状态见概述。工程和恢复实测不增加历史大任务验收成绩。

同一发行源码三平台各 100 次回环通过，共 300 次仅覆盖结构封套，不是付费模型任务验收，也不替代 CLI CI / Strict Sandbox。本地 composition 在 v10 源码与较早基线上均出现超时，未计为通过。

火山 .140 全量 **36+9** 已启动，但完整最终成绩尚未归档核验；内部摘要显式输出限制的适配器修复与原轮分别记录，不将调度或离线测试计为任务通过。原冻结项目历史 **41/45**、.138 **2/4** 和含修复任务的 Sol 跨版本 **45/45** 不混算。见[全量复测记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-volcengine-140-full-20261103/README.md)。

## 安全考虑

损坏参数不会被猜测修补成可执行命令，恢复也不会授予新的权限。有效对象参数、重复键和嵌套 JSON 校验、脱敏与解析预算保留原有边界。没有明确未执行结果或配对不唯一的历史仍交由严格校验处理。

密钥未写入版本库或测试回执。JetBrains 上传、商店批准和公开可下载状态分别记录；Microsoft Marketplace 继续暂缓。

## 故障排查

旧候选 `eb0fe7a8a1` 曾在 Windows 证据索引完整性组合校验处中止，随后原规则的三平台各 100 次完整回环复测通过。具体拒绝子条件仍未定位，完整性校验继续生效；[首次失败](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/tool-argument-recovery-20261103/windows-eb-trajectory-attempt1-failure.json)和[完整复测](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/tool-argument-recovery-20261103/windows-eb-trajectory-attempt2-aggregate.json)保留各自的历史源码范围。

升级后仍报错时，先运行 cc --version 和 cc doctor，核对 IDE 实际使用的 CLI 路径，再重启现有 Agent。旧进程可能仍持有升级前的模块。

若模型仍报告缺少参数，应让它重新发出完整调用。可以继续原会话，无需删除历史；保留会话 ID 和错误日志便于定位，分享前移除密钥和私人内容。

## 关键文件

- [工具参数校验与历史恢复](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/src/runtime/tool-argument-recovery.js)
- [CLI Agent 执行入口](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/src/runtime/agent-core.js)
- [脱敏的真实恢复实测](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/tool-argument-recovery-20261103/live-volcengine.json)

## 使用示例

使用 Node.js **22.12.0+**、npm **10+** 升级：

```bash
npm i -g chainlesschain@0.166.140 --registry https://registry.npmjs.org
cc --version
cc doctor
```

CLI 应报告 0.166.140。Open VSX 0.37.176 已公开；JetBrains 0.4.193 等待商店审核或公开索引，公开可用性未核验，公开用户应等待上架。上一已核验公开版 0.4.192 的推荐标记仍为 CLI 0.166.139。重启聊天宿主后从原会话继续。

## 相关文档

- [Agent Platform 发布与升级指南](./agent-platform-release)
- [自进化开关配置](./self-evolution-configuration)
- [CLI Agent](./cli-agent)
- [IDE 插件](./ide-plugin)
