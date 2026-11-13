# CLI 0.166.149 / IDE 保留历史目录边界

## 发行与源码边界

准确发行源码为 `168a3d561b5a16e9d27b060944c63b2264c99df0`，已合并到 `main`。CLI CI **76/76**、Strict Sandbox **6/6** 在全部配置平台通过。CLI **0.166.149** 已完成 [Actions OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/43475425890)、官方来源验证和公开归档回读；独立下载与正式制品逐字节一致。

| 渠道      | 本轮版本  | 状态                                               |
| --------- | --------- | -------------------------------------------------- |
| npm CLI   | 0.166.149 | 已公开并验证                                       |
| Open VSX  | 0.37.188  | 已公开、列出、可下载，与官方 VSIX 字节一致         |
| JetBrains | 0.4.203   | 已通过完整正式门禁并上传，待商店审核及公开下载核验 |

两款新 IDE 推荐 CLI **0.166.149**。Open VSX .188 已完成正式宿主、Remote-SSH、浏览器和公开回读门禁；JetBrains .203 已通过完整正式门禁并上传，待商店审核及公开下载核验，当前已核验公开 .202 推荐 CLI .148。Microsoft Marketplace 本轮仍不发布；PC/mobile 当前公开版保持 **v5.0.3.145**。见[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release149-public/publication.json)。

## 原组件所有权与目录重验

Evolution Ledger 的真实工厂通过私有 WeakMap 保留原始 journal、manifest backend、catalog/head 与文件端口的所有权关系。纯身份探针不触发调用方 getter、代理或回调；目录边界检查沿用原文件能力。

保留 observed-text 历史和签名 anchor 历史在捕获、重放及最终 journal 验证后重验原始 catalog/head 目录。真实原后端发生目录身份变化时拒绝报告；未拥有原文件端口的后端不提供原目录能力，自定义后端保留原有读写语义。

| 临时报告字段                         | 含义                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `manifestDirectoryBoundaryDigest`    | 原始目录边界的临时摘要，使用独立摘要域及 catalog/head 角色 |
| `manifestDirectoryBoundaryRechecked` | 原始目录边界已完成重验                                     |
| `manifestBoundaryScope`              | 声明能力限于原始 catalog/head 目录                         |

持久化 descriptor、index/anchor schema、签名格式、CAS 和 `localCompositionDigest` 均保持兼容。临时目录报告不写回持久化格式，也不产生生产晋升权限。

## 验证范围

本地聚焦验证覆盖九个测试文件，138 项通过、两项已有平台专用 FIFO 检查跳过。完整发行门禁另在准确提交上验证 Linux、Windows、macOS，不能用本地结果替代。两款 IDE 的正式标签工作流和完整宿主矩阵均已通过。Open VSX 公开字节核验通过；JetBrains 已上传，待商店审核和公开下载核验。

完整运行时 producer/storage graph、独立 installer/pins、A/B/C 评测、模型任务增益和业务效果仍未完成。CLI 自进化状态仍由 CLI 拥有，IDE 只显示该状态；`productionAuthority=false`、`runtimeEvidence=false`、`automaticPromotion=HOLD` 保持。

**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保持，本次发行没有新增模型任务验收。

## 关键实现

- `packages/cli/src/lib/evolution/evolution-ledger-v2-journal.js`
- `packages/cli/src/lib/evolution/rrsi-observed-text-index.js`
- `packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-history.js`
- [Governed skill evolution 设计](./modules/112-governed-skill-evolution-design.md)
- [用户升级说明](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-13-149.html)
