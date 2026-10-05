# CLI / IDE 2026-10-05 差距实施状态

> **当前续做**：第 11、12 节记录 prepare/finish、双 IDE 采集、跨平台诊断和显式 Linux controlled-host；第 13 节记录准确工程提交 `f289a08844` 的 MCP 三系统、真实 IDE 六宿主矩阵全部通过及退出生命周期修复。下面各轮的分支、授权、源码摘要和发布叙述保留历史含义。当前候选未发布，正式 36+9 样本仍为 `NOT_RUN`。

> 对应：[CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-10-05.md)、[IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-10-05.md)。本表记录后续实现，不覆盖原审计快照，也不把局部测试升级为发布或真实模型验收。
>
> 实施从 `8458a0a5027d1a844e382f8ad5624894745d1ef1` 开始。已完成的独立提交于 `0ad8af152ea80903a1315e6acfe7f65bdbf64e70` 合并到 `main`，保留此前 `66db4bce8a` 的发行证据文档。用户要求后续直接在主分支修改；本轮没有发布 npm/IDE 包、修改生产模型默认值或调用付费 provider。

> 最新集成基线为 `0337b334b3`。用户此前要求等待上一轮发布，该发布现已完成；用户最新明确授权“提交发布吧”。第 9 节为本轮验收工程，第 10 节记录新候选及准确提交的发布验证；本地测试不替代发布门，正式 36+9 样本仍未运行。

## 1. 逐项状态

“工程完成”指实现及所列局部回归完成。真实 provider、完整 Actions 矩阵、实际 IDE 和人工验收分别列出，不共用通过标记。

| ID                           | 本轮交付                                                                                                                       | 尚需的证据或范围                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL-03                     | 精确增加 GPT-6.1 Sol / Sonnet 5.5；修正 Opus 5.5 缓存读价格；Responses 路由、reasoning 与输出上限校验、每请求价格/预算共享合同 | 真实官方端点的 stream/tool/reasoning、账户 usage 和账单核对尚未运行；自定义网关继续保留能力假设                                               |
| MODEL-04                     | 已审查模型 fixture、目录漂移检查脚本、每周及手动官方 changelog 审查工作流；发现漂移要求审查，不自动启用新型号                  | CI 执行结果与未来上游新版本审查仍需持续维护；检测到上游发行不等于已验证所有新模型                                                             |
| PERF-03                      | 权威 manifest 绑定的分片二级查询索引、过滤下推、稳定游标、损坏重建；Memory 列表和 recall 接入                                  | 本地 1K/10K/100K 测量与三系统工作流已提供；无已批准延迟 SLO，不宣称性能门通过                                                                 |
| VERIFY-02                    | 冻结 CLI suite、36 项 setup/check、42 个反例与证据导入；续接双 IDE prepare/finish、全量基线/diff 和真实 UI driver，见第 11 节  | Linux Docker pack 整包运行、独立人工审阅及正式 provider 样本仍开放；native 三系统验收不能由容器替代，36+9 仍 NOT_RUN                          |
| PLATFORM-02                  | 支持投影及历史 native 六目标 unsigned 验证；新增显式 `agent controlled-host` 接通预 provision Linux 权限域，见第 12 节         | Windows/macOS durable 存储、网络撤销与崩溃恢复后端仍缺实现；默认 CLI 不自动注册；unsigned 历史回执不等于本轮发布准入                          |
| CODEX-02                     | 固定 schema 及真原生进程探针升级至 0.160.0；交错线程、取消、失败与准入后断线保持无 fallback                                    | 真进程使用 synthetic loopback Responses，未验证真实 provider；生产 allowlist 仍最高 0.154.0，不扩大治理准入                                   |
| BRIDGE-02                    | 显式 Linux delegated cgroup2 恢复路径：发 launch frame 前附加 supervisor，持久化内核对象身份，kill/空组 fence 后保存恢复回执   | `320301e6e7` 的真实 Linux x64/arm64 专项已通过，见第 8 节；旧 PID-only 记录仍不可恢复，默认路径不自动解除 quarantine，不扩大为同 UID 对抗隔离 |
| PERF-02                      | 校准器增加两模型 × 中文/代码/emoji/工具 schema 覆盖合同，逐请求去重和缺失项报告；冻结采样矩阵                                  | 无新付费 usage 样本；事实保真、任务成功率和估算器校准尚未完成，不凭 fixture 调整 bytes/4                                                      |
| MCP-02                       | `f289a08844` 的官方 stdio/HTTP、响应丢失恢复及 GET/SSE 周期推送三系统 CI 全部通过，见第 13 节                                  | 外部账号/OAuth 仍未验证；参考服务器的真实进程测试不等于外部服务账号验收                                                                       |
| MAINT-02                     | 定价 terms 校验与 Responses reasoning 逻辑各自统一，删除重复消费者实现                                                         | 未记录独立维护工时/回归成本，不能声称已证明维护收益；不做无边界 runtime 大拆分                                                                |
| IDE-READY-02                 | 双 IDE Doctor 消费实际活动会话的 init/输入回执/请求与有效模式，显示最低与推荐版本；未知能力保留 degraded                       | 局部 JS/Java 合同和 SDK 编译已通过；当前提交的新真实 IDE 宿主旅程另行验收                                                                     |
| IDE-ONBOARD-02               | JetBrains resolver、onboarding、手动更新复用严格首行 CLI 版本身份，失败时清除旧缓存                                            | 真实全新 IDE 中 gcc/PATH/managed fallback 安装旅程仍待采集                                                                                    |
| IDE-COLD-02                  | JetBrains 有界初始化改为 120 秒；区分初始化超时、保存输入超时和进程失败；超时取消本次提交，迟到 init 不补发                    | 已有实际 30 秒延迟 pure-class 回归；不是实际 IDE 冷启动延迟统计                                                                               |
| VERIFY-IDE-02                | 双 IDE 真实采集/重启 driver、跨平台诊断与严格退出确认；`f289a08844` 的六宿主两阶段矩阵全部通过，见第 13 节                     | provider、公开安装、真人听测、8h/24h 与获批 SLO 仍需实际证据；确定性 peer 和 IntelliJ 最低 API 诊断不计正式样本                               |
| CLOUD-02                     | 保留现有 self-hosted handoff 与 `resume:not-implemented` 合同                                                                  | 条件项，完整云端 resume 的需求未确认；不把 detached background handoff 描述为跨机器云会话恢复                                                 |
| NET-02 / BRIDGE-01 / RELEASE | 原有治理和准确提交的 OIDC 发布门继续保留                                                                                       | 本轮不扩大外部 Agent 执行治理或跨平台持久撤销声明；未执行发布，不沿用历史 SHA 成功作当前发布凭据                                              |

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

本轮已补齐 36 项验收器生成规格和宿主证据导入合同，详见第 9 节。尚无独立人工审阅、完整容器执行、正式 observations、账户账单和真实 GUI/首次运行采集；总体仍为 `NOT_RUN` / `INSUFFICIENT_EVIDENCE`。本轮没有付费执行授权，也没有把 dry-run 或 fixture 加进固定分母的实测结果。

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
2. 36 项验收器的完整执行及独立人工审阅、双 IDE 驱动的三系统实测、正式任务与首次安装执行；固定分母不得删除缺失或失败样本。驱动工程接线见第 11 节。
3. Windows/macOS durable host、准确候选提交的 signed native 发布门，以及外部 Agent 逐请求治理证据；历史 unsigned 六目标验证已通过，见第 9 节。
4. 真人 NVDA/VoiceOver/Orca 听测、实际 8h/24h 观察、维护工时与批准后的性能 SLO。
5. CLOUD-02 完整云端连续工作的需求与验收范围；现有 self-hosted handoff 不自动升级为完整 resume。
6. 本轮准确提交的完整 CI 与后续如需发布时的 OIDC 门。源码提交、合并、CI 通过、公开发行是不同状态。

## 8. 发布候选与后续验证

本节保留此前候选及验证历史。上一轮已发布 CLI `0.166.87`、VS Code `0.37.132`、JetBrains `0.4.150`；其源码及 Actions 证据不作为第 10 节新候选的发布门。此前等待发布的要求现已由用户明确的提交发布授权替代。

用户已授权在功能与测试达标后发布。候选版本为 CLI `0.166.87`、VS Code `0.37.132`、JetBrains `0.4.150`；对应工程实现包含 `482c1b2727`。13 个子 npm 包源码相对 `v-npm-0-166-86` 没有变化，沿用已发布版本。发布流水线仍须先校验全部子包的公开制品、源码来源与 registry-only 安装，再通过 OIDC 发布 CLI，最后发布 IDE。

候选版本本地回归：VS Code 234/234；Java 21 定向测试和生产 SDK 编译通过；执行器、恢复与结果报告定向回归 87 项通过、2 项 Linux 测试跳过；发布工作流与命令生命周期回归 64 项通过。5 个相关 workflow 通过 actionlint（未运行 shellcheck/pyflakes），生成文件与 spawn inventory 检查通过。这些结果不替代准确提交的完整 CI；真实 cgroup2 恢复必须在 Linux 两架构实际执行后确认。

真实 cgroup2 专项现已通过：[Process Ownership Recovery #37258234311](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234311)，源码 `320301e6e7ff6dd0be42a0e62177ac2db9ce1fb1`，Node 22.12.0，Linux x64 / arm64 各 2 项通过。原始恢复回执：[x64](./cli/evidence/gap-2026-10-05/cgroup-recovery-x64.json)、[arm64](./cli/evidence/gap-2026-10-05/cgroup-recovery-arm64.json)。覆盖仍存活的脱离会话孙进程、清理后重新准入且不重放、旧记录拒绝、boot/inode 漂移及持久化失败保留后重试。测试修复了配置目录与 cwd 重叠，以及直接 target 受 `PDEATHSIG=SIGKILL` 保护时应检查存活孙进程的断言；生产保护未放宽。

`320301e6e7` 的 [CLI CI #37258234461](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234461) 在 Linux/macOS unit shard 2/4、Windows unit shard 8/16 均因同一个旧 Doctor 断言失败：测试未传活动会话能力，却预期 `READY`。已保留 `DEGRADED` 生产行为，更新 CLI 侧报告回归以覆盖未知能力、已确认回执与有效审批模式、不完整能力三种情况；本地 7 项报告测试和 14 项共享合同检查通过。该失败提交不满足发布门，修复提交必须重新取得完整 CLI CI / CLI Strict Sandbox 矩阵。

## 9. 本轮验收工程补充

本节工程源于 `85f2f14aa1c36169e9f362eaaf733fde561a906c` 工作区，并集成此前发布证据及文档更新。这里的局部回执不提供新候选准确提交的 CI 或发布证明；冻结计划、账号授权、预算、窗口及 36+9 分母不变。

### 9.1 36 题实际 setup/check 生成器

新增 `packages/cli/scripts/verify01-review-pack.mjs`、`verify01-review-specs.mjs` 和 `verify01-review-runtime.mjs`。为全部 36 个任务生成 72 个字节摘要锁定的自包含脚本、`review.json`、`review.sha256`、`pack.json`。脚本只导入 Node builtins，runtime 和规格内联，验收时不再加载可变的仓库 helper。生成器从冻结 Git blobs 锁定原有测试支持文件，不预装答案，不覆盖已有 review 目录，也不产生 observations。

35 个源码题包含 42 个行为反例；Astra 独立核对其冻结源匹配唯一性、基线路径及所有变体的 JavaScript 语法。验收运行原有回归及候选交付测试；候选必须实际执行非空断言，禁止 skip/todo，反例必须以断言失败被识别，加载/语法失败不能冒充有效反例。锁定的纯 JSON Vitest 配置使用 `--configLoader native`，避免 Vite 默认 bundle 向只读 `/review` 或 `/workspace/node_modules/.vite-temp` 写入临时配置；该路径的实际容器验证仍开放。第 34 题的 check 会调用真实 fingerprint 和空 observation 报告，核对退出码 2、36+9 missing 与费用 null，尚未取得该题容器执行回执。冻结项目早于计划目录，计划作为锁定的 evaluator 输入放在只读 `/review`，不能假定冻结 checkout 已有计划文件。

该 pack 的实际运行范围明确为 **Linux Docker**，要求外部锁定镜像 ID 并在每阶段确认 Node 22.12.0。依赖安装使用 lockfile 和 `npm ci --ignore-scripts`；测试容器断网、去除 capabilities、根文件系统及项目/review 挂载只读，不转发账号凭据或 `NODE_OPTIONS`。执行器另通过 `argv[2]` 传入外层任务 deadline，pack 为清理预留 40 秒，不足余量即拒绝启动；容器内另有 coreutils `timeout`，避免 evaluator/client 意外终止后没有内部时限。正常超时仍须确认 `docker rm --force` 清理，异常取消后的即时 fence 不由设计或 fixture 冒充实证。变体在独立任务工作区临时替换并最终还原；原始命令 stdout/stderr 保存在 review root 的 `acceptance-evidence`，stdout verdict 引用其字节摘要。**不是 Windows/macOS native 验收，也不是容器防同 UID 攻击认证。**

本机 Docker Desktop Linux engine 在普通及批准后的只读 `docker info` 检查均返回 HTTP 500；没有重启、修改 Docker 或干扰其他发布。故 72 个脚本及 42 个反例尚未在真实容器里整包执行，不能宣称验收全部通过。AI/Astra 代码审查不等于独立人工签核；生成的 `pack.json` 保留 `executionStatus:NOT_RUN`、`independentHumanReview:false` 和 `productionAttested:false`。

### 9.2 双 IDE 原始协议与首次安装导入

VS Code 和 JetBrains 的 `AgentChatSession` 新增可选 `onProtocolRecord`，记录独立 session generation、连续序号、时间及深拷贝的 input/output/exit。输入记录表示尝试写入；只有真实 `input_accepted` 才表示 CLI 接受。observer 报错不影响产品输入/泵，缺号会被导入拒绝；退出采集检查 stdout 已 drain，不将强制终止转换为成功。默认没有 observer、文件写入或界面开关。

新增 `packages/cli/scripts/verify01-host-import.mjs` 和 `src/lib/eval/verify01-host-evidence.js`，复用既有 Eval history 与 outcome，不另建评测统计系统。核对外部锁定的 capture/review/plan 摘要、样本与双 SHA、冻结 OS/host/runtime/model/mode 声明、原始输入回执与终态、已 drain 的退出、成功样本完整 tab/reload 及文本一致性、实际 check 进程和每个变更文件的完整前后正文。唯一成功终态、exit 0 且无 signal 才可作为成功执行；显式失败保留失败，缺成本保持 null。针对生产存在的仅含 `error` 的持久化错误，允许保留实际 UI 有序前缀，仍校验已完成的错误显示且始终计失败，不编造重载恢复；并非所有错误旅程均已实测。完整 CLI 首次旅程另绑定真实 invocation/stream/exit；安装早停只导入五阶段回执和失败，不杜撰 Eval run。

导入命令只读取已有材料并输出 history/observations/report，不启动模型或宿主，不自动保存正式样本。字节锁定无法认证本机身份、公开安装、账号或账单，因此 `identityVerified`、`installationVerified`、`billingVerified`、`productionAttested` 均为 false。完整格式和操作要求见[宿主采集说明](./cli/verify01-plan-2026-10-04/HOST_CAPTURE_README.md)。当前完成的是会话核心采集接口和只读导入合同；实际 GUI driver 的注入、真实 UI 操作和公开安装采集仍开放，不将 pure-class/JDK pipe 测试称为真实 IDE/provider 验收。

### 9.3 平台证据校正与验证范围

[native 六目标回读](./cli/evidence/native-validation-readback-0fc-20261005.json) 已记录 `0fc6e7a0c24db14975408a1cdf40ad0eba6f25ca` 的 [Native Validation #37198920226](https://github.com/chainlesschain/chainlesschain/actions/runs/37198920226)：Linux、macOS、Windows 各 x64/arm64 的 unsigned 产物均在对应真实宿主通过，包含 Windows ARM64。该证据 `signed:false`、`releaseEligible:false`，不能作为本轮工作区的发布门。`updater-journal-diagnostic-03980.json` 仍只作诊断，不替代原 deadline 或生产门。

本轮局部验证环境为 Windows x64、Node 22.22.2，JetBrains 使用真实 Temurin 21.0.12.1。最终 JS 定向回归 6 文件 **108 项通过**，包含 72 个生成脚本的实际语法检查及真实嵌套 Vitest 正反例；Java 会话 **14 项通过**，生产 Java/Kotlin SDK 编译成功。结果保存为[工作区验证回执](./cli/evidence/gap-2026-10-05/verify01-workspace-validation.json)。该文件显式 `dirty:true`，没有干净实现 SHA，也没有模型样本；本地 Node 不等于冻结目标 Node。格式、定向 lint 和 spawn inventory 是局部工程检查，不是全仓测试、完整 CI 或发布准入。先前一例嵌套子进程非 JSON 输出及后续通过记录也在回执中保留，未确认其根因，不凭重跑将本地结果升级为发布门。

本轮仍未关闭：完整容器运行与人工签核、三系统实际 GUI driver/公开安装、获授权模型任务及账单、真人 NVDA/VoiceOver/Orca 听测、8h/24h 维护观察、性能 SLO、跨平台 durable host 与完整云端 resume 的条件性需求。可执行工程交付和这些外部验收分别保留状态。

## 10. 本轮提交发布与回执

本轮发行版本为 CLI `0.166.88`、VS Code `0.37.133`、JetBrains `0.4.151`，双 IDE 推荐版本同步为 `0.166.88`。子包源码相对已发布 `v-npm-0-166-87` 无变更，沿用现有精确依赖版本并重新检查公开可获取性。

发布准备验证：CLI 定向 8 文件 145 项通过；为支持 CI 浅克隆，生成器单测改用受控 synthetic Git blobs，仍断言精确冻结 SHA、3 条路径及全部 72 脚本内的字节摘要，真实语法检查和嵌套 Vitest 不 mock，修改后 6 项再次通过。生产生成器仍读取冻结 Git blobs，没有退回 HEAD。operator scripts 属于仓库工具，不在 npm `files` 中；公开 CLI 包包含 Eval/host evidence 核心。

VS Code 234 项通过；JetBrains 28 项与生产 Java/Kotlin 编译通过。本地首次增量编译的 Doctor 仍内联旧 `0.166.87`，已用 javap 确认；完整 `--rerun-tasks` 后通过，未改生产断言或停止共享 daemon。13 个子包精确 registry tarball 已取回并核对 SHA512/SHA1，依赖范围一致，见[子包复审](./cli/evidence/gap-2026-10-05/release-0.166.88/child-package-audit.json)；这不替代 workflow 的 pack 比较与干净安装门。

本轮发布已完成：源码固定为 `7db17a12e15cc92cd7d84f8087141a9521cec5c3`，CLI `0.166.88` 经 OIDC 发布及公开字节/provenance 回读成功；VS Code `0.37.133` 在 Open VSX 公开，JetBrains `0.4.151` 已公开上架。准确提交的 CLI CI（attempt 3，67 个任务成功）、CLI Strict Sandbox 三系统完整矩阵、IDE 与 ARM64 门均成功。先校验公开子包，再发布 CLI，公开回读后才发布双 IDE。完整工作流链接、失败重跑历史、制品摘要及 CLI 前置安装回执见[本轮发行证据](./cli/evidence/gap-2026-10-05/release-0.166.88/README.md)。发布不关闭第 7、9 节所列真实验收，36+9 仍为 `NOT_RUN`。

首次候选 `4f120306418207ba3c06d6d1a9726f0d1c437cba` 的 [Linux unit shard 3/4](https://github.com/chainlesschain/chainlesschain/actions/runs/37278010296/job/111659302382) 在 changelog artifact parity 单项失败：版本和根 CHANGELOG 已升级，但提交的 `src/data/changelog.json` 仍是旧版本。该 job 419 个文件、9,212 项通过，1 项失败，13 项跳过。已用正式生成器补齐 bundled changelog，相关 3 文件 17 项本地通过；该失败 SHA 未发标签；修复提交 `7db17a12e15cc92cd7d84f8087141a9521cec5c3` 随后重新通过完整矩阵并发布，见上文回执。

## 11. 实际宿主采集与验收执行接线

本节续做开始于 `4f12030641`，工作分支为 `feature/cli-ide-gap-capture-20261005`；验证期间 HEAD 含已单独提交的 bundled changelog 修复 `7db17a12e1`，本节新增实现仍为工作区变更。此前“真实 GUI driver 尚未接入”的工程缺口现已补充实现；正式 provider/公开安装/人工验收仍逐项保留证据要求。第 8、10 节的发布授权与候选记录属于此前工作，本节不将它们作为新源码的发布回执。

### 11.1 完整的宿主任务准备与收尾

新增 `verify01-host-capture.mjs` 和 `src/lib/eval/verify01-host-capture.js`，复用 CLI 执行器的 Git blob checkout、全文件扫描、依赖流式指纹、完整 diff 和确切 reviewed 进程执行。prepare 核对真实 platform/arch/Node、冻结任务及外部 review 摘要，创建新工作区并执行 setup；before 正文置于任务目录之外，使用分片索引和逐正文摘要锁定。finish 使用同一个任务 deadline，读取实际 driver 的 `protocol.json/ui.json`，扫描全部变更、拒绝依赖与未审阅路径变动、执行 check，再调用现有 host-import 生成 Eval/outcome 材料。

不覆盖首次尝试目录，不把失败重跑抹去；实际 check 退出状态、stdout/stderr、全量 diff 和缺失费用都保留。正式样本目录不会自动写入。现有 Linux Docker review pack 仍拒绝 Windows/macOS；为这些平台运行任务需要独立的 native review。操作说明见[宿主采集说明](./cli/verify01-plan-2026-10-04/HOST_CAPTURE_README.md)。

### 11.2 双 IDE 面板与两阶段 UI driver

VS Code 只有在显式 relay token 和采集目录同时存在时才注入协议 writer，记录真实会话 generation、输入尝试、输出和 drain 后退出；正常启动不开启采集。独立 driver 操作 composer/tab 控件，绑定 session、canonical 原文和实际 DOM 文本；launcher 使用指定 VSIX、隔离 profile 和同一任务 deadline。终态后关闭 stdin，使用真实退出回执；重启阶段恢复同一 profile 中的结果且不重发输入。

JetBrains 的 `ConversationView` 注入默认禁用的 `Verify01ProtocolCapture`；Remote Robot driver 保存原始协议与实际 UI 操作，初始阶段结束后由同一 sandbox 重开 IDE。恢复要求新 IDE 进程、相同 profile/session、相同 canonical 和渲染文本。显式错误保留实际完成的 UI 前缀。Gradle 支持既有冻结工作区和隔离 home；本地 Gradle 插件安装不作为 Marketplace 安装证据。

### 11.3 官方 MCP stdio 补验

扩展既有 `mcp-reference-interop.mjs` 和三系统专项 workflow，新增隔离 stdio worker，直接启动锁定的官方 `dist/index.js stdio`；不复制或替换服务端实现。worker 使用独立临时 home/trust/lifecycle 状态及最小环境，不继承 provider 凭据，显式授权仅绑定该参考进程。实际调用 echo、simple-prompt 和动态资源，等待 MCP disconnect 及 worker exit 0；异常退出执行本次进程树清理。

Windows x64、Node 22.22.2 的[实际参考服务端回执](./cli/evidence/gap-2026-10-05/mcp-reference-stdio-windows-workspace.json)已通过，包含入口/transport/源码字节摘要，显式 `source.clean:false`。原 HTTP 响应丢失场景也通过：上游真实完成工具后注入 404，恢复连接、保留 unknown outcome，自动重放次数为 0。服务端 GET push、外部 OAuth/账号和本次准确提交的完整三系统矩阵不在此回执内。

### 11.4 本地验证与未关闭项

CLI 三文件 **51 项通过**，覆盖实际临时 Git 仓库、未跟踪文件排除、真实 setup/check 子进程、完整正文 diff、依赖或未审阅修改拒绝、前置正文/状态篡改、耗尽 deadline、失败 check、未知费用和陈旧任务目录。VS Code 全部 unit **241 项通过**，最终采集/relay/初始化子集 **36 项通过**（与全量重叠，不相加）；writer 使用真实 Node 管道验证连续记录与 drain 后退出。JetBrains core **17 项通过**，最终 Gradle 命令复用有效测试缓存；Temurin 21.0.12.1+1 生产 Java/Kotlin 与修改后的 Remote Robot 驱动编译成功。

Windows x64 的真实 VS Code **1.132.0 + 已安装本地 VSIX 0.37.133** 两阶段旅程已通过。实际面板选择 `acceptEdits`，唯一输入获得接受回执，完成 6 项 UI 动作，子进程实际 drain 后 exit 0，新 Extension Host 复用真实 profile 恢复同 session/canonical/DOM 文本且不启动新 agent。原始材料在 [VS Code 诊断目录](./ide/evidence/gap-2026-10-05/verify01-host-diagnostics/vscode/diagnostic-result.json)，源码摘要和局部测试汇总见[本轮工作区回执](./cli/evidence/gap-2026-10-05/verify01-host-workspace-validation.json)。可用 `test:verify01-diagnostic` 复跑；运行始终显式使用确定性本地 peer，不是正式 provider 题目、公开安装认证或真实模型质量测量。

Windows x64 的真实 **IntelliJ Community IC-242.20224.300 + 本地插件 0.4.151** 两阶段旅程也已通过，实际 IDE 使用 JBR 21.0.3+13-b509.4。新 IDE 进程保留同一 profile/tab/session/savedRowId，唯一输入、实际 drain 后 exit 0、6 项 UI 动作齐全；重启前后原始协议摘要不变且无运行 child。见 [JetBrains 诊断材料](./ide/evidence/gap-2026-10-05/verify01-host-diagnostics/jetbrains/diagnostic-result.json)。该次为确定性纯文本 peer；历史渲染标题/后缀按精确结构核对并单独保留，正文逐字比较，不能外推到所有 Markdown 渲染或真实模型质量。

真实宿主诊断发现并修复了 Windows 路径盘符大小写误拒、JetBrains Robot 泛型返回值的错误类型推断以及历史标题混入正文比较的问题。最终证据检查还发现 Gson 默认省略协议中的显式 null，现已保留并以深相等断言核对汇总与原始 JSONL；另一次测试夹具因 canonical 目录在仓库内被正确拒绝，已移动到系统临时目录，没有放宽原保护。失败迭代保留在回执中。当前源码格式、定向 lint、spawn inventory 检查通过；局部结果不替代准确提交的完整 Actions 矩阵。

仍需真实证据的项目：36+9 正式 provider/首次安装样本及账单、全部 review pack 实际运行与独立人工签核、三系统实际宿主矩阵、NVDA/VoiceOver/Orca 真人听测、8h/24h 观察与获批 SLO。Windows/macOS durable host 和外部 Agent 逐请求治理仍未扩大支持；CLOUD-02 的完整跨机器 resume 继续为需求条件项。正式任务 `NOT_RUN` 不因驱动代码或 fixture 回归通过而改变。

## 12. 跨平台诊断入口与 Linux 命令接线

### 12.1 可复用的双 IDE 诊断

将先前仅在 `.work` 中的 Windows JetBrains 脚本整理为仓库内 `packages/jetbrains-plugin/scripts/verify01-diagnostic.mjs`。支持 Windows batch 安全参数、POSIX 进程组、限时构建准备、共享任务 deadline、实际子进程退出确认、Robot 端口占用拒绝和失败材料保存。使用现有 fixture CLI 与生产 canonical store，明确不调用模型。VS Code 入口增加相同的独占归档与独立证据核对；归档保留协议/UI/日志，不复制 IDE profile 的 socket/锁文件。

新增 `VERIFY01 Host Diagnostics` workflow，Node 22.12.0 下覆盖 Linux、Windows、macOS 的 VS Code 1.132.0 与 IntelliJ 2024.2 六个真实宿主诊断 job；VS Code 三平台使用同一打包 job 的 VSIX。该 workflow 不发布制品、不使用模型凭据，也不将 fixture 写入冻结样本。IntelliJ 2024.2 用于最低 API 宿主诊断，不能替代正式样本的 2025.2。

Windows 的新 JetBrains 入口已通过实际初始运行与重启恢复；VS Code 新归档入口也已通过，两者均为 9 条原始协议、唯一输入、6 项 UI 动作、drain 后 exit 0。首次 VS Code 后置检查把 `ui.ndjson` 误计为第二个协议 generation；现将其作为 UI 原始日志与 `ui.json` 深比较，保留首次失败和新尝试，不改写失败回执。进程/归档测试 Windows **11 项通过**；WSL1 + Node 22.12.0 **10 项通过、1 项 Windows 专项跳过**，包括实际父子进程超时清理。跨平台 launcher 的实现和本地两系统检查不等于三系统 GUI 矩阵已经通过。

源码与原始材料摘要见[本轮诊断回执](./cli/evidence/gap-2026-10-05/verify01-portable-workspace-validation.json)；[VS Code](./ide/evidence/gap-2026-10-05/verify01-portable-diagnostics/vscode/diagnostic-result.json)与[JetBrains](./ide/evidence/gap-2026-10-05/verify01-portable-diagnostics/jetbrains/diagnostic-result.json)各自保留真实材料。该回执显式绑定 dirty 工作区，不是发布门。

提交前复审进一步收紧诊断清理：VS Code 增加独立外层 deadline、IPC 取消与同进程组清理；POSIX 确认整个组消失，Windows 长运行 IDE 的 owner 若先退出则拒绝确认清理。新增真实“leader 已退出、后代忽略 TERM”及外层不响应取消的反例。最终 harness 在 Windows **15 项通过、1 项 POSIX 专项跳过**，WSL1 **14 项通过、2 项 Windows 专项跳过**；上段 GUI 回执保留加固前源码摘要，新的 GUI/CI 验证须另行绑定，不覆盖旧回执。macOS 临时目录使用 realpath 保留协议 writer 的无符号链接约束。原始归档在 `.gitattributes` 中禁止换行归一化，保护字节摘要。

### 12.2 显式 Linux controlled-host

新增 `cc agent controlled-host`，必须提供预先 provision 的绝对 launch descriptor、context 和 docker-egress settings；当前工作区必须与既有权限域身份一致。`--check` 只报告身份及配置，显式 `backendAvailabilityProbed:false/backendExecutionVerified:false`；`--prompt` 固定 `dontAsk`，先检查沙箱可用性，再读取显式凭据并调用既有 headless runner，所有已打开的 host 均在退出时关闭。入口不自动 provision、补造丢失 ledger 或接受父命令的权限绕过参数。操作说明见 [NET02 controlled-host](../cli/NET02_CONTROLLED_HOST.md)。

Windows/macOS 的 durable host 仍有真实实现缺口：现权限域依赖 Linux 固定 dirfd、`/proc/self/fd` 与持久提交；Docker egress 依赖本地 Unix daemon 和同宿主 UDS；崩溃后恢复依赖 Linux cgroup 内核身份。Windows 当前为匿名 Job/AppContainer，未实现 WFP 持久后端；macOS 为静态 Seatbelt/单次 MCP launcher。不能删除平台检查或把已有单次清理视为持久撤销。本次新增入口只扩大显式 Linux 产品接线。

Windows 相关四文件 **43 项通过、3 项 Linux 专用跳过**。WSL1 / Node 22.12.0 的[新入口 15 项实测](./cli/evidence/gap-2026-10-05/controlled-host-linux-workspace.json)全部通过；既有 permission runtime **2 项**与 authority domain 真实子进程/worker/崩溃恢复聚合测试 **1 项**也通过。首次 Linux 测试因 Vitest 转换实例与原生 CommonJS 的 WeakMap 品牌不相同而拒绝 writer；现使用既有官方 writer 的真实子进程验证 revision 更新，未修改生产品牌校验。此项验证权限来源及动态更新，不证明 Docker 后端运行。

### 12.3 验收边界

官方 MCP server-everything 2026.8.31 / SDK 1.32.0 在 WSL1 Linux x64、Node 22.12.0 完成[真实 stdio 与 HTTP 回执](./cli/evidence/gap-2026-10-05/mcp-reference-stdio-wsl1-workspace.json)：tool/prompt/resource 通过，响应丢失后保持 unknown outcome、自动重放为 0。该环境不是完整 Linux Docker 宿主。Docker Desktop 启动后仍返回 daemon HTTP 500，现有 Ubuntu 为 WSL1；未转换发行版或更改虚拟化配置。

正式冻结预算为任务 **$72** 加首次运行 **$27**，合计上限 **$99**；本轮没有调用付费 provider。36+9 正式样本、公开安装与账单、全部 review pack 实际执行和独立人工签核、真人听测与长时观察仍开放。Linux-only review pack 不能直接用于 Windows/macOS native 验收；这些状态不随工程诊断通过改变。新测试与实际 CI 结果分别记录，不复用旧源码摘要冒充新提交验证。

## 13. 真实矩阵反馈与退出生命周期

本轮工作在 `feature/cli-ide-gap-capture-20261005`，对应 [draft PR #405](https://github.com/chainlesschain/chainlesschain/pull/405)。此前工程提交为 `3b51c51bf1` 与 `32fcd3b20f`。以下区分准确提交的 CI、后续工作区修复及正式验收，不把已失败的尝试覆盖为成功。

### 13.1 官方 MCP 三系统闭环

`32fcd3b20f5c7840026336bf4d1ded6e0898d2b7` 的 [MCP Reference Interoperability #37292293347](https://github.com/chainlesschain/chainlesschain/actions/runs/37292293347) 三个 job 全部成功：Linux x64、Windows x64、macOS arm64，均为 Node 22.12.0。锁定官方 server-everything 2026.8.31 / SDK 1.32.0，真实 HTTP 与官方 stdio 入口完成 tool/prompt/resource、disconnect 和 worker exit 0；注入响应丢失后保留 unknown outcome，自动重放为 0。

原始三份回执与 artifact 元数据见 [CI 回读](./cli/evidence/gap-2026-10-05/mcp-reference-ci-32f/readback.json)。各回执显式绑定干净提交和源码字节。此处关闭的是该提交的 stdio/HTTP 三系统矩阵；GET/SSE 服务端推送、外部账号与 OAuth 未由该次结果覆盖，也不构成新候选发布门。

后续 `f289a08844132538571e254c7d9ec9e4bf2b0fdd` 增加真实 GET/SSE：透传官方 GET 流，经公开 `resources/subscribe` 和 `toggle-subscriber-updates` 启动官方五秒资源更新计时器。要求工具 POST 已返回后，周期通知仍分别出现在独立 GET 原始帧和生产客户端 `resource-updated` 事件；再真实 unsubscribe 并关闭计时器。未改官方服务端或生产客户端。[Windows / Node 22.22.2](./cli/evidence/gap-2026-10-05/mcp-reference-get-sse-windows-workspace.json) 与 [WSL1 / Node 22.12.0](./cli/evidence/gap-2026-10-05/mcp-reference-get-sse-wsl-workspace.json) 本地回执均通过，相关协议/elicitation 回归 **20 项通过**。随后 [MCP CI #37295879127](https://github.com/chainlesschain/chainlesschain/actions/runs/37295879127) 的 Linux x64、Windows x64、macOS arm64 三个 job 全部通过；[完整原始回执](./cli/evidence/gap-2026-10-05/mcp-reference-ci-f289/readback.json)均绑定干净 `f289a08844`，逐项包含 GET 200、两条通知、POST 返回后周期事件、unsubscribe 与计时器关闭。外部账号/OAuth 仍开放。

### 13.2 宿主矩阵发现的真实问题

[VERIFY01 Host Diagnostics #37292293399](https://github.com/chainlesschain/chainlesschain/actions/runs/37292293399) 同一提交的 Linux、Windows 双 IDE 四个 job 成功，两个 macOS job 失败。VS Code macOS 已安装 VSIX，但系统长临时目录使主进程 socket 超过 103 字节，实际 `listen EINVAL`；诊断现复用仓库既有 `makeFreshRunRoot` 短路径并取 realpath，保留采集目录无符号链接约束。JetBrains macOS 在前置进程测试失败，尚未进入 IDE：退出期间 `kill(-pgid, 0)` 返回 `EPERM`。现将它保留为“可能仍存在”，继续有界观察，仅 `ESRCH` 确认消失；持续 `EPERM` 仍失败，未放宽清理。

Windows 本地进一步发现 IntelliJ 启动探测 WSL 的链 `java → wsl → wsl → init`：直接 `taskkill /T /F` 返回 128，已记录创建身份的 `init` 在确认期限内仍存活。最初怀疑历史读取子命令，但进程创建时间与新增进程名否定了该归因；独立等待真实 history child close 后仍能复现，失败材料继续保留。未关闭发行版、修改虚拟化设置或把最终自行退出倒算成当时清理成功。

诊断现先记录 Windows OS 进程身份，调用 Remote Robot 请求 IDE 保存并正常退出，再确认根与全部已知后代消失；请求成功本身不证明退出。请求挂起会中止，根仍存在时可退回原强杀；根已退出但后代仍存活则拒绝通过。POSIX 记录进程组、实际信号及确认结果。`taskkill` 输出保存 Base64 原始字节，显示文本注明 UTF-8 有损解码，避免丢失中文系统的 OEM 输出。历史读取另有开始/真实 close 的关联 ID，按同一任务 deadline 等待，正式 provider driver 不依赖 fixture trace。

### 13.3 候选版本与验证边界

PR 的 publish-staleness 门发现 VS Code 源码变更未递增版本。候选已同步为 CLI `0.166.89`、VS Code `0.37.134`、JetBrains `0.4.152`，双 IDE 推荐版本、lockfile、README 和 bundled changelog 同步；这是候选准备，未发布或合并。版本更新后的 VS Code unit **244 项通过**，CLI changelog 三文件 **10 项通过**，JetBrains 版本/Doctor/协议采集 **17 项通过**并完成生产 Java/Kotlin 编译。

四文件诊断 harness 在 Windows **25 项通过、3 项 POSIX 专项跳过**，WSL1 **24 项通过、4 项 Windows 专项跳过**。覆盖正常退出、虚假退出 ACK、挂起请求、根先退且后代存活，以及持续/短暂 `EPERM`；随后目标 session 过滤新增一例，drain 六项与 owner-exit 回执一项在两系统分别通过，和前述统计重叠，不相加。

最终本地 Windows 的实际 VS Code `1.132.0 + 0.37.134` 与 IntelliJ `2024.2 + 0.4.152` 两阶段均通过；各有 9 条原始协议和 6 项 UI 操作。JetBrains 初始/重启两阶段均正常退出，实际 Gradle owner exit `0/null`，已知进程身份全部消失，`taskkill:null`。重启时空标签的历史查询 exit 1 单独保留，目标 session 历史查询必须成功，且所有启动的查询均须实际 close；不创建假会话消除错误。关闭诊断的 Gradle configuration cache 后正常结束构建也通过。原始成功/失败材料、源码摘要与范围见[七次尝试回读](./ide/evidence/gap-2026-10-05/verify01-lifecycle-diagnostics/readback.json)。本地 Node 22.22.2 和最低 API 宿主不等于冻结正式样本环境。

最终工程提交为 `f289a08844132538571e254c7d9ec9e4bf2b0fdd`，publish-staleness 门本地扫描 18 个包、0 个违规；已推送 PR #405。该提交的 MCP 三系统矩阵及 [IDE 矩阵 #37295879088](https://github.com/chainlesschain/chainlesschain/actions/runs/37295879088) 全部通过：IDE 包装 job 和六个宿主 job 均成功。六宿主均为 Node 22.12.0，各验证 9 条原始协议、唯一输入、6 项 UI 操作和重启恢复，三个 VS Code job 使用同一 VSIX 字节摘要。原始回执、artifact 身份及逐文件摘要见[六宿主 CI 回读](./ide/evidence/gap-2026-10-05/verify01-ci-f289/readback.json)。

| CI 平台（均 x64） | VS Code 1.132.0 / 0.37.134 | IntelliJ 2024.2 / 0.4.152 | JetBrains 初始退出                                                            | JetBrains 重启退出                          |
| ----------------- | -------------------------- | ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Linux             | 通过                       | 通过                      | graceful ACK 后有界 SIGTERM，owner exit 143，进程组消失已确认                 | 自然退出 0，无回收信号，进程组消失已确认    |
| Windows           | 通过                       | 通过                      | graceful ACK 后有界 taskkill，taskkill exit 0、owner exit 1，已知身份全部消失 | 自然退出 0，taskkill:null，已知身份全部消失 |
| macOS Intel       | 通过                       | 通过                      | graceful ACK 后有界 SIGTERM，owner exit 143，进程组消失已确认                 | 自然退出 0，无回收信号，进程组消失已确认    |

CI 初始阶段的强制回收状态按原值保留；IDE owner 退出状态与已 drain 的 CLI 协议 exit 0 分别记录，不宣称六宿主都自然退出。本地 Windows 两阶段正常退出的证据仅适用于该本地尝试。上述 CI 使用确定性 peer，IntelliJ 2024.2 是最低 API 诊断宿主，不等于冻结的正式 2025.2 环境、公开安装验收或 provider 实测。专项矩阵通过也不替代 CLI CI、CLI Strict Sandbox 等准确发布提交的完整门。

当前仍需独立完成：正式 36+9 provider/首次安装样本、账号与账单、Linux Docker review pack 整包执行及人工签核、Windows/macOS native reviewed 验收与 durable 后端实现、真人辅助技术听测、8h/24h 观察及获批性能 SLO。完整跨机器云 resume 仍为需求条件项。上述项目没有被 fixture、Astra 代码审查或局部 CI 标为完成。
