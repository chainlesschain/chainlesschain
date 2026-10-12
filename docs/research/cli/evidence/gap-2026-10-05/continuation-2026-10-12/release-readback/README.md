# CLI 0.166.98 与配对 IDE：发行补档及实时只读回读

准确发行源码 `e0d4e9caaa0ce6a6145c0d5b66a53b9559e154c9` 的 CLI **0.166.98**、Open VSX **0.37.142**、JetBrains **0.4.160** 已公开。此前报告中的“候选待发布”停留在第四轮修复时点，不能继续作为当前发行结论。本次仅补档和只读核验，没有再次发布。

| 范围         | 当前核验结果                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准确源码七门 | CLI CI 71/71、Strict 5/5、IDE 18 成功/1 非标签后验证条件跳过、ARM64 10/10、Memory Index 3/3、Context Memory 3/3、Background Interaction 3/3；实时读取原 run 的实际 attempt/jobs，并按准确源码 workflow 合同核验通过 |
| npm OIDC     | run `38150341893` completed/success；历史独立回读为 VERIFIED，14 个公开包含 13 个子包，CLI 字节与不可变候选一致                                                                                                     |
| Open VSX     | 标签 run `38151479654` completed/success；精确版本当前 downloadable=true；本次下载与历史公开 VSIX 的 SHA-256 相同                                                                                                   |
| JetBrains    | 标签 run `38151479621` completed/success；update `1191567` 当前 approved/listed、hidden=false；本次下载与历史公开 ZIP 的 SHA-256 相同，历史回读已核验所有 ZIP entry 字节与标签候选一致                              |

本次归档 **165 份 gzip 原件**，包含历史候选/公开制品、子包元数据与包、来源报告、工作流、七门及发行 run/jobs、读取 helper 源码，以及当前公开元数据和重新下载的三份制品。每份压缩前后大小与 SHA-256 均见 [manifest.json](./manifest.json)，已逐项解压核验。具体当前时间、来源 SHA、run/attempt、公开制品摘要及历史完整路径见 [summary.json](./summary.json)。

历史 `.work` 原件保存的是 **2026-10-11** 的实际观察，当前采集另列为 `current-api-readback` / `current-public-readback`，不改写原观察时间。CLI 原件的完整根路径是 `.work/release-readback-0.166.98/verified-38150341893-e0d4e9caaa0ce6a6145c0d5b66a53b9559e154c9/public-2026-10-11T15-26-47.238Z`；根下 `public-authority-readback.json` 记录历史独立来源与安装回读。VS Code 和 JetBrains 对应根目录亦完整记录在 summary。

历史 registry 安装禁用了 lifecycle scripts；本次没有重新安装或运行签名审计。公开发行与准确发行源码绑定，不把七门转移给当前工作区 `e5b58f18ff826460a268f25127215c9e2d39177c` 或任何后续修复提交。正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99** 不变；本次没有模型调用、正式样本、人工/账单/长时验收或 native/durable 准入。
