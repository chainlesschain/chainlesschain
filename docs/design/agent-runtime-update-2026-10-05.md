# CLI 与 IDE 运行时增量设计（2026-10-05）

本次设计核对以已提交 `main@feda6d1eeee84330a8c22e48b4fc98c419f833e8` 的代码和 Git 记录为基线。公开 CLI **0.166.88**、Open VSX **0.37.133**、JetBrains **0.4.151** 共同来自 `7db17a12e15cc92cd7d84f8087141a9521cec5c3`，两端 IDE 推荐 CLI `0.166.88`；源码 **0.166.89 / 0.37.134 / 0.4.152** 为后续候选，尚未公开发行。桌面与移动产品保持独立 `v5.0.3.138`。安装步骤见[发布与升级指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)。各专项结果保留其准确源码身份。

## 记忆查询索引与分页

公开 CLI 已包含 `88efef197d` 的 canonical Memory v2 查询索引和 `967a057625` 的快照分页。category、scope、state、tag、sink 及排序字段进入派生索引，不复制正文、证据或审计。manifest 同时绑定权威分片和索引的摘要、字节长度，写入随同一 manifest 发布。索引缺失或损坏时，从已验证权威分片重建，不信任文件 mtime；过滤在 limit 之前执行，recall 保持原 relevance 排序。

`967a057625` 将分页接入 `cc memory show --page --json` 与 `--cursor`。返回 `entries` 和 `nextCursor`；游标绑定存储路径、generation、过滤条件及稳定排序（importance 降序、updatedAt 降序、memoryId 升序）。续页保持相同 category 和 limit；存储代际变化或游标篡改时返回 `CONTEXT_MEMORY_CURSOR_INVALID`，调用方从第一页重新读取。默认 `show --json` 仍输出条目数组；legacy/shadow 模式拒绝分页。

升级旧 v2 存储保留权威正文、revision 与审计，但新 descriptor 会被不认识索引字段的旧 reader 拒绝。升级前备份，停止旧 writer；降级需要兼容快照。默认 shadow 不触发迁移。索引不是全文搜索，也不构成新的权限来源。

Windows x64 / Node 22.22.2 的本地 100K、category-7、limit 20 测量中，全扫 p95 为 14,160.960 ms，冷索引 2,416.313 ms，热索引 1,746.812 ms，重建 28,615.208 ms。每路径 11 次，冷查询使用新进程但未清空 OS 缓存；热查询仍需验证索引字节，重建可能持锁。该结果不是跨平台性能 SLO。原始测量见[查询索引回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/gap-2026-10-05/memory-query-index.json)。

## VERIFY-01 执行与结果采集

`482c1b2727` 接入 `cc eval --suite verify01`，执行前要求外部固定的 plan/review 摘要、项目准确提交及项目外的可信 reviewer 根。独立 setup/check 在有界任务工作区运行；执行材料保存原始进程输出和完整 diff，报告保留失败及 missing。36 个项目任务与 9 个首次安装样本的固定分母不能通过选择部分样本缩小。

公开版已接入冻结执行与审阅包生成；后续源码的 `verify01-host-capture.mjs` 提供 prepare/finish，配合原始协议 observer、双 IDE UI driver 和只读导入器。prepare 从冻结 Git blobs 建立全新工作区，执行受摘要锁定的 setup，保存状态摘要与总 deadline；实际 IDE 操作后 finish 核验材料并执行 reviewed check。首次安装另存安装、发现、认证、首条输入与首次成功阶段回执。它们不自动写入正式样本目录，失败和重试不得覆盖首次证据；费用缺失保留 `null`。完整参数见[宿主采集说明](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-plan-2026-10-04/HOST_CAPTURE_README.md)。

结果采集适配器复用 Eval history 与 outcome report；只读采集不是模型或 GUI 验收。observer 普通启动不启用，须显式配置受控 capture 目录；原始材料可能包含任务正文、工具及模型输出。导入核对 session/generation、唯一输入、接受回执、终态与退出，拒绝缺序、重复或外国 session，不把多轮重试拼成单样本。静态合同、AI 审查、无模型 dry-run 与本地测试不能替代独立人工签核、真实账号/账单或 8h/24h 观察。

## Docker 验收包的真实诊断

新增 `VERIFY01 Docker Review Pack` 工作流为 Linux 六分片真实容器诊断，固定 Node 22.12.0、实际 image ID、review/plan 摘要与任务 deadline，保留 generated setup/check、行为反例和原始输出。容器断网、去 capabilities，根及项目/review 挂载只读，不转发账号凭据或 `NODE_OPTIONS`；Linux pack 不能代替 Windows/macOS native review。

[首次运行 #37303181923](https://github.com/chainlesschain/chainlesschain/actions/runs/37303181923) 绑定 `07a383c906`，六个 job 均已执行且失败。读取的 shard 1 日志中六题为 `locked dependency installation failed`，未取得对应 check/反例成功证据；现有材料不足以确定安装失败根因。整包成功验收仍开放。即使确定性反例通过，也不等于正式样本、真实 provider、独立人工签核或发行准入。

后续 `feda6d1eee` 将 setup/check 容器绑定至操作者数字 UID/GID（`--user UID:GID`），并把身份写入回执；保留只读根、`cap-drop=ALL`、`no-new-privileges` 与 check 断网限制。`ae6adbe13c` 的[第二次六分片诊断 #37304444663](https://github.com/chainlesschain/chainlesschain/actions/runs/37304444663)同样失败；修复尚未取得完整成功证据，不能把运行中或排队状态标为通过。

## Linux 进程所有权恢复

恢复实现记录 cgroup 的 boot/inode/所有权身份；隔离记录、新启动准入和恢复动作都重新核对身份。监督器丢失后清理确认的遗留进程组，清理成功才允许新执行，不重放原命令。记录过期、身份漂移或持久化失败时继续拒绝准入，并保留可重试记录。它不扩大到未知进程或 Windows/macOS 的等价耐久恢复。

[Process Ownership Recovery #37258234311](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234311) 绑定 `320301e6e7`，Linux x64/arm64 各 2 项真实 cgroup2 测试通过，覆盖监督器死亡后仍存活的孙进程、清理后重新准入、无重放及失败后重试。专项结果只属于该提交和测试范围。

## IDE 会话能力与慢初始化

公开两端 IDE 已包含 `0a07882df7` 的 Doctor：先报告 CLI/插件版本与推荐配对，再依据实际会话记录判断能力。配置声明不能替代运行时观察；缺少会话证据时标记 degraded/unconfirmed，实际观察满足协议要求后才 confirmed。后续 `b883e14652` 与 `85f2f14aa1` 固定了对应回归与烟测断言。

初始化超过 30 秒时继续等待，最多 120 秒；期限内完成握手才按当前会话提交。超时保留文本和附件草稿并取消本次提交，迟到 init 不补发；过期会话不能消费新草稿。文件附件使用有界快照、验证后的文件身份及解码预算。IDE 读取 CLI 投影并提交审阅决定，不持有 CLI writer、Skill 路由、执行或发布权限。

## 模型合同与互操作探针

`355b23de08` 更新十月模型能力、上下文窗口及价格合同，漂移审查保留所读资料摘要；静态目录匹配不证明账号可访问、真实调用成功或账单已核对。校准矩阵区分模型服务身份与网关，尚无付费样本时不生成真实成本结论。

`eaa3014a58` 将外部 Codex app-server 的 Schema 与真进程探针固定到 `0.160.0`；受控 loopback provider 验证审批取消与断线无 fallback，不等于正式账号验收。`eb68107727` / `b85ec50aed` 使用未修改的官方 MCP server factory 与 SDK HTTP transport，工具已完成后由代理隐藏响应并注入 404，客户端恢复连接但保留 outcome unknown、自动重放次数为 0，下一次显式调用成功。外部 Agent 逐请求治理、真实服务费用和完整云端连续工作仍待验收。

## 发行与验收边界

`7db17a12e1` 的 CLI CI 全矩阵、CLI Strict Sandbox 全矩阵、IDE 与 ARM64 门已通过，按子 npm 包 → CLI OIDC → IDE 顺序发行；公开 tarball、provenance、VSIX 与 JetBrains 准确版本均已回读。CLI CI 和 VS Code 宿主首次失败及同 SHA 官方重跑仍保留，见[0.166.88 发行证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/gap-2026-10-05/release-0.166.88/README.md)。后续源码已合并，但没有随上述公开包发布。

最新候选仍必须完成自身准确提交的完整 CLI CI、Strict Sandbox 和 IDE 门。旧发行或专项成功不转移为候选发布资格。本次工作只部署静态文档与官网。

历史 unsigned native 六目标验证及后续 journal 诊断已在[实施证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-gap-implementation-2026-10-05.md)分开记录；它们不等于准确候选提交的签名 native 发行。真实 PM 效果、完整成本、真人辅助技术验收和自动 active Skill 晋升仍保持 HOLD。

## 后续源码：JetBrains CLI 发现与溯源

候选 `0.4.152` 每次重新探测实际命令。显式路径优先，无效时提示修正而不切换 managed；未配置时依次探测 `cc`、`chainlesschain`、`clc`、`clchain`，再检查 managed。版本合同检查首个非空行是否以可选 `v` 加三段数字版本开头，允许后续说明；系统 GCC/Clang 的 `cc` banner 不满足合同。这不是签名或包来源认证。

配置 revision 防止慢探测覆盖较新设置；onboarding、升级提示与手动更新共用探测，区分 CLI 缺失/路径无效和模型未配置。同一 IDE 进程修复命令或修改路径后重新探测。这些改动尚未进入公开 Marketplace `0.4.151`。

`3b91e37491` 为 Windows onboarding 诊断结果记录 HEAD、插件目录 dirty 状态和五个关键文件 SHA-256，另存插件 ZIP 摘要。脚本使用真实 IntelliJ 与本地命令 fixtures，检查同一进程的发现、路径修复与退出清理，明确不评估正式样本、provider 或公开安装。摘要覆盖指定文件及插件目录，不是全仓可复现构建或发行 provenance；尚无该新增旅程的已提交成功回执。

## 已通过的工程矩阵与开放项

`f289a08844132538571e254c7d9ec9e4bf2b0fdd` 的 [MCP 三系统矩阵 #37295879127](https://github.com/chainlesschain/chainlesschain/actions/runs/37295879127) 在 Linux x64、Windows x64、macOS arm64 全部通过。固定官方 server-everything 2026.8.31 / SDK 1.32.0，覆盖真实 stdio、HTTP GET/SSE、POST 返回后周期通知、unsubscribe 与计时器关闭；响应丢失后保留 unknown outcome，自动重放为 0。外部账号/OAuth 仍开放。

同提交 [双 IDE 六宿主 #37295879088](https://github.com/chainlesschain/chainlesschain/actions/runs/37295879088) 全部通过，Node 22.12.0，覆盖 9 条原始协议、唯一输入、6 项 UI 操作与重启恢复。VS Code 使用同一 VSIX 摘要，JetBrains 使用真实 IntelliJ 2024.2；协议来自确定性 peer，部分初始退出使用有界强制回收。证据只绑定该工程提交，不构成最新 HEAD 完整发布门、全部自然退出或正式 provider 验收。

后续源码另增加显式 Linux controlled-host 入口，复用官方 writer 和固定启动描述符，普通 CLI 不自动启用。跨进程/Worker 为 100 ms 轮询，清理成功后才发停止回执；Windows/macOS durable 后端仍有缺口。冻结 36+9 正式样本保持 `NOT_RUN`，零正式 observations、账单未测量；Docker 整包成功与独立人工签核、Windows/macOS native reviewed 验收、真人辅助技术听测、8h/24h 观察及获批 SLO 仍开放，完整跨机器云 resume 为条件需求。

## 相关文档

- [上一阶段运行时设计](agent-runtime-update-2026-09-26.md)
- [运行时实现与取舍](cli-runtime-current.md)
- [记忆命令](https://docs.chainlesschain.com/chainlesschain/cli-memory.html)
- [评估命令](https://docs.chainlesschain.com/chainlesschain/cli-eval.html)
- [IDE 使用指南](https://docs.chainlesschain.com/chainlesschain/ide-plugin.html)
