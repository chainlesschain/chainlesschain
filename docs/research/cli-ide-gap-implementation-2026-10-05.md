# CLI / IDE 2026-10-05 差距实施状态

> 对应：[CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-10-05.md)、[IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-10-05.md)。本表记录后续实现，不覆盖原审计快照，也不把局部测试升级为发布或真实模型验收。
>
> 实施从 `8458a0a5027d1a844e382f8ad5624894745d1ef1` 开始。已完成的独立提交于 `0ad8af152ea80903a1315e6acfe7f65bdbf64e70` 合并到 `main`，保留此前 `66db4bce8a` 的发行证据文档。用户要求后续直接在主分支修改；本轮没有发布 npm/IDE 包、修改生产模型默认值或调用付费 provider。

## 1. 逐项状态

“工程完成”指实现及所列局部回归完成。真实 provider、完整 Actions 矩阵、实际 IDE 和人工验收分别列出，不共用通过标记。

| ID                           | 本轮交付                                                                                                                       | 尚需的证据或范围                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL-03                     | 精确增加 GPT-6.1 Sol / Sonnet 5.5；修正 Opus 5.5 缓存读价格；Responses 路由、reasoning 与输出上限校验、每请求价格/预算共享合同 | 真实官方端点的 stream/tool/reasoning、账户 usage 和账单核对尚未运行；自定义网关继续保留能力假设                                          |
| MODEL-04                     | 已审查模型 fixture、目录漂移检查脚本、每周及手动官方 changelog 审查工作流；发现漂移要求审查，不自动启用新型号                  | CI 执行结果与未来上游新版本审查仍需持续维护；检测到上游发行不等于已验证所有新模型                                                        |
| PERF-03                      | 权威 manifest 绑定的分片二级查询索引、过滤下推、稳定游标、损坏重建；Memory 列表和 recall 接入                                  | 本地 1K/10K/100K 测量与三系统工作流已提供；无已批准延迟 SLO，不宣称性能门通过                                                            |
| VERIFY-02                    | 冻结 CLI suite 执行、独立 setup/check 摘要、Git blobs 隔离工作区、原始终态与完整变更回执接线                                   | 36 项实际预审脚本及独立审阅、真实双 IDE / 首次安装适配、获授权付费执行仍未完成，固定 36+9 保持 NOT_RUN                                   |
| PLATFORM-02                  | `sandbox capabilities` 新增 OS/架构/引擎/stdio/权限来源/持久撤销支持投影；受控 host 从真实权限绑定生成诊断                     | 默认 CLI 不因此获得 durable host；Windows/macOS durable 后端、native Windows ARM64 准入与正式目标入口交付仍开放                          |
| CODEX-02                     | 固定 schema 及真原生进程探针升级至 0.160.0；交错线程、取消、失败与准入后断线保持无 fallback                                    | 真进程使用 synthetic loopback Responses，未验证真实 provider；生产 allowlist 仍最高 0.154.0，不扩大治理准入                              |
| BRIDGE-02                    | 显式 Linux delegated cgroup2 恢复路径：发 launch frame 前附加 supervisor，持久化内核对象身份，kill/空组 fence 后保存恢复回执   | `320301e6e7` 的真实 Linux x64/arm64 专项已通过，见第 8 节；旧 PID-only 记录仍不可恢复，默认路径不自动解除 quarantine，不扩大为同 UID 对抗隔离 |
| PERF-02                      | 校准器增加两模型 × 中文/代码/emoji/工具 schema 覆盖合同，逐请求去重和缺失项报告；冻结采样矩阵                                  | 无新付费 usage 样本；事实保真、任务成功率和估算器校准尚未完成，不凭 fixture 调整 bytes/4                                                 |
| MCP-02                       | 固定官方 server-everything 2026.8.31 + SDK 1.32.0，真实进程完成 tool/prompt/resource 及工具响应丢失后的恢复                    | 只覆盖所列 Streamable HTTP 路径；服务端 GET push、stdio、外部账号/OAuth 不在本次证据内                                                   |
| MAINT-02                     | 定价 terms 校验与 Responses reasoning 逻辑各自统一，删除重复消费者实现                                                         | 未记录独立维护工时/回归成本，不能声称已证明维护收益；不做无边界 runtime 大拆分                                                           |
| IDE-READY-02                 | 双 IDE Doctor 消费实际活动会话的 init/输入回执/请求与有效模式，显示最低与推荐版本；未知能力保留 degraded                       | 局部 JS/Java 合同和 SDK 编译已通过；当前提交的新真实 IDE 宿主旅程另行验收                                                                |
| IDE-ONBOARD-02               | JetBrains resolver、onboarding、手动更新复用严格首行 CLI 版本身份，失败时清除旧缓存                                            | 真实全新 IDE 中 gcc/PATH/managed fallback 安装旅程仍待采集                                                                               |
| IDE-COLD-02                  | JetBrains 有界初始化改为 120 秒；区分初始化超时、保存输入超时和进程失败；超时取消本次提交，迟到 init 不补发                    | 已有实际 30 秒延迟 pure-class 回归；不是实际 IDE 冷启动延迟统计                                                                          |
| VERIFY-IDE-02                | 复用原冻结计划与证据口径，拒绝 CLI 冒充 IDE 样本                                                                               | 真实双 IDE 任务、9 次公开安装、NVDA/VoiceOver/Orca 听测、8h/24h、批准后的 SLO 均未完成                                                   |
| CLOUD-02                     | 保留现有 self-hosted handoff 与 `resume:not-implemented` 合同                                                                  | 条件项，完整云端 resume 的需求未确认；不把 detached background handoff 描述为跨机器云会话恢复                                            |
| NET-02 / BRIDGE-01 / RELEASE | 原有治理和准确提交的 OIDC 发布门继续保留                                                                                       | 本轮不扩大外部 Agent 执行治理或跨平台持久撤销声明；未执行发布，不沿用历史 SHA 成功作当前发布凭据                                         |

## 2. 模型与计费合同

GPT-6.1 Sol 精确 ID 使用 Responses、1,050,000 上下文与 128,000 输出上限；支持 low/medium/high/xhigh/max，不接受 none/minimal。标准输入/缓存读/缓存写/输出分别为每百万 token `$2/$0.10/$2.50/$10`；长上下文与服务层级按单次请求计算。Sonnet 5.5 为 1M、`$2/$10`，缓存读系数 0.1；Opus 5.5 缓存读系数修为 0.05。官方说明未确认的 Anthropic 输出上限仍为 null。

`model-context-catalog.js` 是共享事实来源；`llm-pricing.js` 校验显式 terms；`causal-observability.js` 复用该校验；runtime 与请求生成器共用 reasoning 校验。未知未来 Sonnet/Opus 型号不再悄悄继承旧家族价格。自定义端点不能仅凭相同模型名继承官方窗口或计费真实性。

[官方快照审查结果](./cli/evidence/gap-2026-10-05/model-review.json) 来自干净 `b85ec50aedf0489fba54ea35bb53bdf30c488a93`，包含所读官方页面字节摘要。本结果证明目录合同与已审查资料一致，不证明账号有访问权限或已经真实调用。

## 3. Memory 查询与兼容边界

索引包含 category/scope/state/tag/sink 和稳定排序字段，不复制正文、证据和审计。manifest 同时绑定 authority shard 与 query index 的摘要和字节长度；写入和索引随同一 manifest 发布。过滤在 limit 之前，recall 仍使用既有 relevance 排序。游标绑定 store、generation、过滤与排序，跨代或篡改拒绝；索引缺失/损坏从验证后的权威分片重建，不信任 mtime。

旧 v2 存储升级保留 authority bytes、revision 和 audit；**新 descriptor 会被不认识索引字段的旧 reader 拒绝**。因此不能让升级后的存储继续由旧版本并发写入，也不能把回退旧 CLI 当作无成本回滚。未引入全文搜索索引。

本地测量查询相同数据的 `category-7`、limit 20，并校验返回摘要一致；每种规模和路径各 11 次。cold 是新 Node 进程，未清空 OS 文件缓存，机器同时可能运行其他开发工作。重建有一次性成本且可能持有存储锁；hot 查询仍需读取验证索引字节，不能称为 O(page size)。完整测量见证据目录。三系统工作流只验证一致性并采集时间，没有擅自批准性能阈值。

干净 `b85ec50aed` 的[完整本地回执](./cli/evidence/gap-2026-10-05/memory-query-index.json)记录如下 p95，单位毫秒：

| 条数 |  全量扫描 |   冷索引 |   热索引 |      重建 |
| ---- | --------: | -------: | -------: | --------: |
| 1K   |   680.206 |  545.107 |  626.495 |  1883.237 |
| 10K  |  1767.194 |  742.356 |  508.240 |  3203.138 |
| 100K | 14160.960 | 2416.313 | 1746.812 | 28615.208 |

100K 查询仅读取 19 个权威桶、8,831,462 权威字节，原全扫为 256 桶、118,940,239 字节；仍需验证 24,054,876 索引字节。1K 热路径没有稳定优于冷路径，不能掩盖该本地结果。

## 4. 协议与恢复实证

- [Codex 0.160.0 真进程回执](./cli/evidence/gap-2026-10-05/codex-0.160.0.json) 绑定干净 `eaa3014a5816b27cd778b743a88e359fe295a2bb`；另保留原始 [notifications](./cli/evidence/gap-2026-10-05/codex-0.160.0.json.notifications.json) 和 [approvals](./cli/evidence/gap-2026-10-05/codex-0.160.0.json.approvals.json)。官方原生二进制真实运行，provider 为受控 loopback；审批取消没有执行 marker，准入后断线没有 fallback。
- [MCP 参考服务端回执](./cli/evidence/gap-2026-10-05/mcp-reference.json) 绑定干净 `b85ec50aedf0489fba54ea35bb53bdf30c488a93`。加载未修改的官方 server factory 与 SDK HTTP transport。代理在真实服务器工具已经完成后隐藏响应并返回 404；客户端恢复连接但报告 outcome unknown，自动重放次数为 0，下次显式调用成功。故障由代理注入，并非声称服务端自然返回该错误。
- Linux cgroup 恢复只接受启动前记录的 boot ID、root/group device/inode 和 execution ID。先发 `cgroup.kill`，确认 `populated=0`，在 journal 锁内重新检查 identity/token 与空组，持久化恢复审计后才解除。恢复是终止并确认遗留进程，不是重放或恢复原任务。

cgroup 路径显式由受控宿主通过 `CHAINLESSCHAIN_PROCESS_RECOVERY_CGROUP_ROOT` 提供。无配置继续原路径；旧记录、缺失组、boot/inode 改变、写盘失败均不以“PID 不见了”解除。它面向协作型生命周期恢复，**不声称抵御能自行迁移 cgroup 的同 UID 恶意程序**。

## 5. 冻结评测执行边界

见[计划 README](./cli/verify01-plan-2026-10-04/README.md)与[采集/执行说明](./cli/verify01-plan-2026-10-04/COLLECTION_README.md)。冻结 `plan.json`、`tasks.json`、`comparison-bindings.json`、`plan.sha256` 不变；原始项目快照为 `b2aa3aba082873570e85dce39b00754e5504ff37`。真实目标 Node 为 22.12.0，本地 Node 22.22.2 的 fixture 测试不能成为正式样本。

执行器要求全部 36 项外部锁定的 reviewed setup/check，核对真实项目 HEAD 后从 Git blobs 创建隔离工作区。依赖文件做流式指纹而不复制正文，变更仍拒绝；setup/agent/check 共用任务总 deadline。被测 CLI 源码 SHA 与题目 checkout SHA 分开，外部声明不升级为二进制来源证明。stdout/stderr、完整变更、终态与 usage 单独保留；缺费用保留 null、缺终态保留 unknown，工作区保留给验收者。

当前没有独立审阅的 36 项实际验收器、正式 observations、账户账单和真实 IDE/首次运行采集；总体仍为 `NOT_RUN` / `INSUFFICIENT_EVIDENCE`。本轮没有付费执行授权，也没有把 dry-run 或 fixture 加进固定分母的实测结果。

## 6. 验证与提交

本地环境：Windows x64、Node 22.22.2；JetBrains 编译/测试使用真实 Temurin 21.0.12.1。已完成的局部验证：

| 范围                                        | 结果与限制                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 模型/价格/Responses/MCP恢复/VS Code共享合同 | 11 文件 218 项通过；目录 terms 检查增强后其 7 项再次通过                                                                                  |
| Codex schema/adapter/探针合同及相关模型合同 | 7 文件 95 项通过，另有上列真实原生进程回执                                                                                                |
| sandbox / 支持投影                          | 90 项通过，4 项既有平台跳过；本机真实能力命令准确返回 Docker daemon unavailable                                                           |
| VS Code Node 测试                           | 4 文件 21 项通过，未代表真实新 profile 安装                                                                                               |
| JetBrains                                   | 37 项通过，含实际 30 秒初始化等待及完整生产 Java/Kotlin SDK 编译                                                                          |
| 校准采样矩阵                                | Node 8 项通过，无付费样本                                                                                                                 |
| Memory                                      | 40 项通过、1 项既有 Windows 跳过；kernel Node 25 项通过；规模测量单列                                                                     |
| VERIFY / ownership                          | 最后一组 Windows 159 项通过、14 项 Linux-only 跳过；outcome report 30 项通过。Linux 专项 CI 分别记录，Windows skipped 不计 Linux 内核成功 |

定向 ESLint 仅检查新增/修改 CLI 代码的 `no-undef`、`no-unused-vars`，按原始基线区分既有问题；不是全仓 lint 通过证明。process spawn inventory 随最终源码重新生成。GitHub Actions 的 CLI CI / CLI Strict Sandbox、Codex、MCP、Memory 与 cgroup 专项必须对应实际提交，不转用本地测试或旧提交绿色状态。

| 实现提交                   | 内容                                           |
| -------------------------- | ---------------------------------------------- |
| `eaa3014a58`               | Codex schema / 真进程探针固定 0.160.0          |
| `355b23de08`               | 新模型、价格及漂移审查                         |
| `0a07882df7`               | 双 IDE 运行能力、身份与慢初始化修复            |
| `eb68107727`、`b85ec50aed` | MCP 真服务端、支持诊断、校准矩阵与隔离依赖修正 |
| `88efef197d`               | Memory 二级索引与规模测量                      |
| `0ad8af152e`               | 合并上述完成提交到 main                        |

## 7. 尚未关闭的验收

1. 获授权的模型/账号/费用额度与真实 usage/账单；明确模型服务身份，网关与官方端点分开。
2. 36 项独立预审验收器、真实任务与双 IDE/首次安装执行；固定分母不得删除缺失或失败样本。
3. Windows/macOS durable host、Windows ARM64 原始失败门，以及外部 Agent 逐请求治理证据。
4. 真人 NVDA/VoiceOver/Orca 听测、实际 8h/24h 观察、维护工时与批准后的性能 SLO。
5. CLOUD-02 完整云端连续工作的需求与验收范围；现有 self-hosted handoff 不自动升级为完整 resume。
6. 本轮准确提交的完整 CI 与后续如需发布时的 OIDC 门。源码提交、合并、CI 通过、公开发行是不同状态。

## 8. 发布候选与后续验证

用户已授权在功能与测试达标后发布。候选版本为 CLI `0.166.87`、VS Code `0.37.132`、JetBrains `0.4.150`；对应工程实现包含 `482c1b2727`。13 个子 npm 包源码相对 `v-npm-0-166-86` 没有变化，沿用已发布版本。发布流水线仍须先校验全部子包的公开制品、源码来源与 registry-only 安装，再通过 OIDC 发布 CLI，最后发布 IDE。

候选版本本地回归：VS Code 234/234；Java 21 定向测试和生产 SDK 编译通过；执行器、恢复与结果报告定向回归 87 项通过、2 项 Linux 测试跳过；发布工作流与命令生命周期回归 64 项通过。5 个相关 workflow 通过 actionlint（未运行 shellcheck/pyflakes），生成文件与 spawn inventory 检查通过。这些结果不替代准确提交的完整 CI；真实 cgroup2 恢复必须在 Linux 两架构实际执行后确认。

真实 cgroup2 专项现已通过：[Process Ownership Recovery #37258234311](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234311)，源码 `320301e6e7ff6dd0be42a0e62177ac2db9ce1fb1`，Node 22.12.0，Linux x64 / arm64 各 2 项通过。原始恢复回执：[x64](./cli/evidence/gap-2026-10-05/cgroup-recovery-x64.json)、[arm64](./cli/evidence/gap-2026-10-05/cgroup-recovery-arm64.json)。覆盖仍存活的脱离会话孙进程、清理后重新准入且不重放、旧记录拒绝、boot/inode 漂移及持久化失败保留后重试。测试修复了配置目录与 cwd 重叠，以及直接 target 受 `PDEATHSIG=SIGKILL` 保护时应检查存活孙进程的断言；生产保护未放宽。

`320301e6e7` 的 [CLI CI #37258234461](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234461) 在 Linux/macOS unit shard 2/4、Windows unit shard 8/16 均因同一个旧 Doctor 断言失败：测试未传活动会话能力，却预期 `READY`。已保留 `DEGRADED` 生产行为，更新 CLI 侧报告回归以覆盖未知能力、已确认回执与有效审批模式、不完整能力三种情况；本地 7 项报告测试和 14 项共享合同检查通过。该失败提交不满足发布门，修复提交必须重新取得完整 CLI CI / CLI Strict Sandbox 矩阵。
