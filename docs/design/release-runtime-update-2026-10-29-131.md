# CLI .131：独立验收、Memory 与运行时生命周期

## 公开发行与源码

本页核对 `main@83c281f4e8` 的文档和 Git 历史，生产发行源码为 `c9d0bab231850697df38f2d476c2dd974cbcb6c0`。此前 [.130 设计](./release-runtime-update-2026-10-29-130.md)保留其观察时点；其中的后续主线能力已由本次发行承接，不能把旧候选失败或旧测试结果改写为新提交成功。

| 渠道                  | 当前公开状态                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| CLI                   | `0.166.131`，GitHub Actions OIDC Trusted Publishing，独立公开制品与签名回读通过 |
| Context/Memory Kernel | `0.1.11`，先于 CLI 发布并核验下游依赖                                           |
| Open VSX              | `0.37.169`，推荐 CLI `.131`，公共 VSIX 与发行候选字节一致                       |
| JetBrains             | `0.4.186`，推荐 CLI `.131`，更新 `1206001` 批准、列出且未隐藏；公开 ZIP 已回读  |
| Microsoft Marketplace | 用户明确暂缓                                                                    |
| PC / mobile           | 独立既有 `v5.0.3.143`，本轮没有重新发布客户端                                   |

同一 c9d0 的 CLI CI `40848165518`、Strict Sandbox `40848165540`、Kernel CI `40848165418` 和 IDE Extensions `40848239212` 完整门禁成功。CLI CI 有 72 个成功 job、1 个跳过 job，Strict 为 6 个成功、Kernel 为 3 个成功、IDE 为 18 个成功和 1 个跳过；不能把可选渠道跳过说成实际执行。Kernel 首次发布后曾因注册表传播出现 `ETARGET`，同源码失败作业恢复成功，未改用 token 或本地发布。来源见[发布汇总](../research/cli/evidence/release131-public/publication.json)、[准确门禁](../research/cli/evidence/release131-public/gates.json)、[CLI](../research/cli/evidence/release131-public/cli.json)、[Open VSX](../research/cli/evidence/release131-public/open-vsx.json)和[JetBrains](../research/cli/evidence/release131-public/jetbrains.json)回执。

## Goal：冻结定义与独立检查

`0005a2b0d0` 引入显式 `--goal-condition "verify:<manifest.json>"`。宿主在第一次作者请求前冻结 manifest、checker 和声明依赖，保存定义及派发意图，再通过 process broker 以 argv、无 shell 和精简环境执行。全部检查须退出 0，并各输出与本次随机 invocation ID 对应的完整要求回执；单独退出 0、作者宣称完成、缺失产物或旧成功回执不能完成 Goal。

检查前后绑定源码与产物摘要、文件身份；恢复重验定义并重新检查当前候选。取消后的迟到成功无效；无法确认进程树清理时停止自动续跑并要求核对。原 `model:`、`exit-zero:` 条件保留各自语义，不自动升级为独立断言。

操作者仍须列全 checker 依赖并提供有效独立断言；Git 范围不包含被忽略依赖与工作区外环境。协议不证明任意恶意候选无法伪造输出，也不构成 checker 的完整隔离沙箱。固定负例通过不等于真实任务误报率。实现为 `packages/cli/src/lib/goal-verification-plan.js` 与 `goal-verification-command.js`，详细限制见[验收记录](../research/cli-ide-goal-verification-progress-2026-10-29.md)。

## Memory：身份、查询与恢复

`d740555ff6`、`109b99efa9`、`673c2520a8`、`ef92dad541`、`73bf0fc4f5` 分别承接查询取消、已验证目录身份保留、bundle 索引、Windows 文件身份和 recall 守卫。默认仍为 `validate-disk / bundle`：读取并验证全部 frame，再验证选中 authority；bundle 是派生索引，不替代原始 authority。数据与身份句柄按生命周期关闭，目录或文件替换不得复用旧验证。取消贯穿快照读取与语义候选等待，revision 改变使旧召回失效。

`7a5d38d151` 的四条实际 CLI 旅程通过真实 argv、配置 / DB bootstrap、本机 HTTP Ollama 协议、read_file、自动压缩、JSONL 与 `--resume`。普通 headless 自然退出，stream 在已结算且等待 stdin 的时点实际终止，然后由独立进程更新并读取 supersede / delete。恢复看到当前 revision 和规则，旧 scope / sink 不进入请求，原压缩回执不重写、用量不重放。模型是本机确定性协议夹具；不代表真实语义质量、账单、双 IDE 或任意崩溃窗口已验证。见[独立 CLI 恢复](../research/cli-ide-cli-memory-restart-progress-2026-10-29.md)。

性能证据与正确性分开：Windows x64 / Node 22.22.2，category-7、limit 20，每格 100 次的 100K 热 p95 为 **178.866ms**，冷 p95 为 **2258.233ms**，冷目标 1 秒未满足。冷指新 Node 进程，未清空 OS 缓存且排除导入及夹具构造。另有 **600 次 rebuild / corrupt** 查询结果摘要正确，但没有恢复耗时达标门槛或逐次全部 authority 字节独立哈希，不能宣布完整 SLO。后续混合补测 1K 完成，10K 记录至 90/100 后触发原 120 秒上限、exit 1，100K 未开始且无最终 JSON；保留未完成状态。见[采样范围](../research/cli-ide-memory-slo131-progress-2026-10-29.md)与[恢复及混合失败](../research/cli-ide-memory-recovery131-progress-2026-10-29.md)。

## 宿主目录、取消与压缩

| 实现与 Git 来源                  | 运行时合同                                                                                                                                         | 验收边界                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| MCP `e7a6f2585d` / `568dd09353`  | 父子与兄弟任务各自保存发现缓存；晚连接由宿主发布已准入目录，下一轮读取权限交集；schema 替换或来源变化撤销旧请求；前台子任务继承取消信号            | 真实本机 HTTP 握手与调用已有回归，真实账号、双 IDE、全跨平台重连以及资源 / prompt / 订阅动态继承另行验收 |
| Skills `01b42a147f`              | 下载 AbortSignal 贯穿宿主、签名与 resolver；不配合取消的迟到结果不能继续物化候选；Ledger 已开始提交时保留确认与恢复                                | 取消可能留下未激活不可变候选，不承诺已提交副作用回滚；本机 HTTP 不替代外部市场与原生 Stop                |
| 压缩 `a5617f05a3` / `11e698755c` | 压缩前后刷新项目规则与文件 Memory；非持久会话保留宿主基础消息的私有对象身份；hermetic 与子代理只标记自身可信基础消息                               | 复制或序列化文本不获得 host authority；基础消息继续受预算约束，刷新失败不得沿用过期规则冒充成功          |
| 临时 worktree `0d67a7d43b`       | awaited callback 的 AsyncLocalStorage scope 内，派发前拒绝无所有者的后台 shell / 子任务、延后调度与隔离 Skill；前台 callback 未结束时保留 checkout | 取消信号不等于退出；任意 shell 自 detach / daemon、完整后代树与全部崩溃窗口未完成                        |

详细证据：[MCP 晚连接](../research/cli-ide-mcp-live-catalog-progress-2026-10-29.md)、[Skills 下载](../research/cli-ide-skill-download-progress-2026-10-29.md)、[项目上下文](../research/cli-ide-compaction-context-progress-2026-10-29.md)、[非持久 host](../research/cli-ide-compaction-live-host-progress-2026-10-29.md)、[worktree 生命周期](../research/cli-ide-worktree-lifetime-progress-2026-10-29.md)。这些研究页中的“尚未发行”是各批次当时状态，当前公开状态以上述 c9d0 回执为准。

## 模型合同与发行工程

`b8dc60c431` 加入 Terra 精确 Responses profile、独立输入 / 输出限制及缓存写入 TTL 分项计费，并将实际返回用量传到会话、Eval 与恢复预算。缺失或不一致的写入分项使费用未知，不按零费用继续；默认推荐和已有模型配置不自动迁移。这是实现及模拟协议验证，不能推断真实账号可用、服务端 tokenizer 完全一致或账单节省，定价仍需按实际官方合同与用量核对。见[能力与费用来源](../research/cli-ide-terra-model-progress-2026-10-29.md)。

`98c4be4a76` 在不需要部署配置的冷 session 读取中延迟加载相关配置，避免连带导入完整依赖。`c9d0bab231` 令 Web Panel 生产构建显式使用 `NODE_ENV=production`，构建策略本身进入缓存摘要，并在 CI 分片前审计生产制品。此处是冷导入资源与可复现生产构建修复，不是所有 session 操作或 Memory 冷查询的性能达标声明。旧候选失败保留，最终 c9d0 使用自身完整门禁。见[冷 session RSS](../research/cli-ide-session-cold-rss131-progress-2026-10-29.md)与[生产构建](../research/cli-ide-web-panel-production131-progress-2026-10-29.md)。

## 真实验收与文档边界

跨版本合格产物维持 **34/45**：普通 **27/36**、首次安装 **7/9**，剩余 **11** 项。`.131` 续测计划已提交但尚未派发；发行、确定性回归与计划不能增加任务通过数。历史 `.129 verify-11` 不确定请求不因本轮发行变成成功或自动重放。正式付费 **NOT_PAID_READY**、native **NOT_ADMITTED**、自动晋升 **HOLD** 保留。

`docs/design/` 是设计权威源；站点同步、站点构建、服务器部署和公网回读分别记录，文档已更新不等于站点已上线。历史设计页保留原日期范围，当前架构入口与模块 78 / 98 / 106 / 108 指向本页。
