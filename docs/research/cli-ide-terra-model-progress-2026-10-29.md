# Terra API 能力与缓存计费修复

日期：2026-10-29。第十九批，承接[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.5 节。源码基线 `16af6d6199ea5c8d261b9a1872c50b185841192d`；直接修改 `main`，Microsoft 渠道继续暂缓。

已补入 `gpt-6.1-terra` 的精确官方 API profile，并修复 Responses 缓存写入漏计：原适配器只扣除缓存读取，没有读取 `cache_write_tokens`，会把写入当作普通输入。现在按实际返回的 30 分钟／12 小时分项计价，并传到连接测试回执、会话账本、费用汇总、Eval 和恢复后的预算结算。默认推荐仍为原来的模型，旧配置不自动迁移。

| 任务 | 当前完成情况 | 验证 / 边界 |
| --- | --- | --- |
| Terra 官方 API 合同 | **文档核对与精确 profile 完成** | 目录版本 `2026-10-29`；旧模型保留各自审核日期；官方模型、价格、迁移和缓存四份原文已下载核对并记录时间、字节数与 SHA-256 |
| 协议与 reasoning | **实现及本地模拟回归通过** | 官方端点选 Responses；支持 `none / low / medium / high / xhigh / max`；显式关闭发送 `none`，未指定时保留服务端默认；非流式、流式路径均覆盖 Terra |
| 上下文与输入限制 | **实现及本地规划回归通过** | 总窗口 1,050,000；最大输入 922,000；最大输出 128,000；规划分别约束输入和输出，CLI 能力诊断显示输入上限；本地 token 估算不替代服务端 tokenizer |
| 服务档位 | **精确目录与拒绝测试通过** | Standard、Flex、Fast；保留现有 `default / auto / priority` API 档位名称；不继承 Sol / Astra 的 Ultrafast；Batch 仅计价，不作为实时请求档位 |
| 价格与缓存 | **实现及边界回归通过** | 标准输入 / 输出为 $1 / $5 每百万 token，读取 $0.05，30 分钟写入 $1.25，12 小时写入 $2.50；写入分项和不等、缺失或与 Anthropic TTL 混用时费用未知 |
| 请求级费用与预算 | **本地回归通过** | 输入超过 272K 时整次请求的输入及缓存 ×2、输出 ×1.5；Flex / Batch ×0.5、Fast ×2、区域处理 ×1.1；保留请求分桶，不拿跨请求总和触发长上下文价格 |
| 首次配置及双 IDE | **生成检查通过** | CLI / VS Code / JetBrains 共享目录版本及来源摘要同步；默认推荐和已有凭据、端点、模型选择不变 |
| 本地测试 | **352 项通过** | 16 个 Vitest 文件、343 项；Node 审查证据测试 9 项；包括 Haiku TTL 回归、SQLite 成本记录、真实适配器的模拟 HTTP / SSE、预算恢复 |
| 审查工作流 | **实现完成，远端结果待验收** | 新基准包含 Terra 输入上限、默认 reasoning 和 12 小时写价；主分支相关变更触发本地合同门禁；周期 / 手动执行继续抓取上游发行版本，不自动启用模型 |
| API 账号及真实账单 | **未验证** | 本批没有真实模型请求；官方 API 文档、产品订阅可用、指定账号权限及账单分别计数；模拟回归不证明目标账号可调用 |
| 上游能力变化自动闭环 | **部分完成** | 价格 / 能力字段与人工审核基准可比对；官方网页字段变化的自动抽取、地区 / 退役审查及真实目标端点验证仍未完成 |
| 公开发行 | **未发布本批改动** | `.129` 仍是既有公开版本；必须等待最终准确提交的三系统门禁，再按子包 → CLI → IDE → 客户端顺序发布 |

本批还修正了连接测试的最终回执：原先它只保留四个总计数，即使前一步已正确解析，也会丢弃 TTL 和档位证据。回执现在保留经过白名单投影的计费字段。只有写入总数而没有有效 TTL 分项时保留已知用量，费用返回未知；不会猜成默认写价或显示免费。其他已有 GPT-6 精确条目共用这套缓存写入规则。

官方模型合同只用于官方端点；自定义网关继续使用未核验的兼容路径，未知 Terra 后缀不继承精确 profile 或价格。`runtimeVerified:false` 和账号未验证状态保留。价格表是公开标价估算，不代表自定义网关合同或最终账单；本批也未增加选择 12 小时缓存的用户配置入口，只按响应证据正确结算。

来源与原始回归见[验证回执](./cli/evidence/terra-model-2026-10-29/verification.json)和[官方事实摘录](./cli/evidence/terra-model-2026-10-29/official-facts.json)。完整官方原文仅用于本地核对，仓库保存来源链接、下载摘要和必要事实，不复制整页文档。

本地首次测试发现 SQLite 11.10.0 缺少 Node 22 原生绑定，已下载该锁定版本对应的官方预编译绑定后重跑通过，没有修改依赖版本。语法、Prettier、生成目录与进程清单检查单独记录；ESLint 的依赖缺失问题未记为通过。

| 官方来源 | 本批核对用途 |
| --- | --- |
| [Terra 模型页](https://developers.openai.com/api/docs/models/gpt-6.1-terra) | 精确 ID、输入 / 输出限制、协议、reasoning 与基本价格 |
| [API 价格](https://developers.openai.com/api/docs/pricing) | 缓存寿命、服务档位、长上下文与区域加价 |
| [GPT-6 迁移指南](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart) | 工具调用使用 Responses，reasoning 参数与采样参数兼容性 |
| [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | `cache_write_tokens_details.ttl_30m_tokens / ttl_12h_tokens`、读写互斥及避免重复收费 |

本批模型测试期间，既有 Memory 100 次长测继续运行，未修改其绑定的查询实现或测量脚本。该本地测量与少量编辑、单 worker 回归共用工作站，不能描述为隔离硬件实验；跨平台结果和完整 10K / 100K 采样继续跟踪。
