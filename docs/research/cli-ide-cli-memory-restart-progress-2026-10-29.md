# 真实 CLI 压缩与独立进程恢复

日期：2026-10-29。第四十三批，承接[原生适配器恢复](./cli-ide-memory-process-restart-progress-2026-10-29.md)和[非持久宿主规则修复](./cli-ide-compaction-live-host-progress-2026-10-29.md)。直接修改 main，Microsoft 渠道继续暂缓。

| 项目               | 本批完成情况                      | 证据与边界                                                                                                                                                                                                                         |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际 CLI 入口      | **四条旅程通过**                  | 使用 bin/chainlesschain.js，经真实 argv、配置 / DB bootstrap、HTTP Ollama 适配器、read_file、默认自动压缩、JSONL 持久化与 --resume；普通 headless、stream 各覆盖 supersede / delete。未替换运行时 chatFn、bootstrap 或压缩器。     |
| writer 生命周期    | **退出 / 终止后才恢复**           | 普通 headless 自然退出 0；stream 首轮成功并结算后，确认仍在等待 stdin，再实际 kill 并等待 close。覆盖已结算空闲点，不覆盖请求进行中和任意写入窗口。                                                                                |
| 独立 Memory 更新   | **独立 mutator / reader 通过**    | seed、writer、inspect、mutator、reader、inspect 为独立 Node 进程。writer / mutator / reader PID 不同；原 revision 3，supersede 后 6，delete 后 8；新 provider plan 使用当前 revision。                                             |
| 恢复内容与隔离     | **当前记忆和文件上下文通过**      | 新进程看到 current，supersede 时另含 successor；old、其他 agent scope 和其他 provider sink 均未进入请求。项目规则及导入文件 Memory 读取新内容，不沿用旧基础上下文。                                                                |
| 幂等与用量         | **原回执不变，无重放**            | 原 compact event 的 hash 和 canonical data 逐字段相同；原全部事件 hash 是恢复后事件的前缀。每旅程恰好三次本机协议请求、三个唯一 started / settled call ID；无 unknown 用量或重复压缩。计数为夹具提供的已知用量，不是实际账单测量。 |
| 临时召回与持久历史 | **限定投影验证通过**              | 独立读取的 verified durable messages 在重启前后均不含召回、文件 Memory 和项目规则标记；没有声称擦除全部历史物理副本。                                                                                                              |
| 两版 Node 完整套件 | **各 4/4，零失败 / 跳过，退出 0** | Windows Node 22.12 / 22.22；1672 份 CLI、Kernel、core-env、session-core 来源 / 锁文件及新测试前后摘要一致。同样四条旅程跨 Node 重跑，不计为八种独立场景。                                                                          |
| 既有门禁接入       | **测试自动发现，云端未完成**      | 新 E2E 文件由现有 vitest.e2e.config.js 和三系统 CLI CI E2E 分片发现；不改平台矩阵、预算或来源审计。推送后须以新准确提交完成全部门禁，不把原 e7ab 的部分通过结果转移到新源码。                                                      |
| 生产改动与发行     | **无新增运行时代码，尚未发布**    | 本批增加测试 / 证据，保持 CLI .131 / Kernel .11 / IDE .169、.186 候选；pack 运行时代码和公开 .130 配对不变。新候选将使用独立、不可移动的验证引用等待完整门禁。                                                                     |

原探索失败保留：第一份夹具显式覆盖 systemPrompt，却预期内置 rules.md 仍被加载；移除覆盖后，8K 模型窗口因默认宿主 / 工具 / 输出预留而按 input_budget 丢弃可选 Memory。正式旅程使用现有 32K 模型目录项与两份各 200 行的真实文件制造输入压力，没有强制 planner 选择 Memory、调整预算、修改压缩触发器或使用 bare 模式。

本机服务仅实现确定性的模型协议响应，每次返回 input_tokens=10 / output_tokens=5；所有子进程使用精简环境，未继承真实 provider 凭据、Evolution 部署、NODE_OPTIONS、Vitest 模型适配器或外部 IDE 端点。真实模型语义质量、费用收益、双 IDE / 交互 REPL、三系统完整旅程及其他崩溃窗口继续验收。累计真实交付仍为 **34/45**，原 verify-11 未知请求未重放，NOT_PAID_READY / NOT_ADMITTED / HOLD 保留。

[本批证据](./cli/evidence/cli-memory-executable-restart-2026-10-29/review.json)保存每个子进程的实际 argv / PID / 退出码、原始协议请求及 stdout / stderr、前后 canonical 回执、Memory revision、用量行、完整来源摘要和两个探索失败；gzip 归档逐一核对压缩 / 解压 SHA-256。

本批源码已随 `7a5d38d151d437f94f8c223dec1fbca52a44da5b` 提交并推送 main；验证引用 `ci-cli131-7a5d38d151d4` 指向该准确提交，创建后不重定向。该引用不匹配仓库任何发布标签模式。独立 .131 journal 改为绑定此 SHA，旧 e7ab 候选标记 SUPERSEDED_BEFORE_PUBLICATION 并保留原门禁 / 回执，不移用旧源码的部分通过结果。

| 固定源码完整门禁         | Run ID                                                                                   | 回读状态    |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------- |
| CLI CI                   | [40825996255](https://github.com/chainlesschain/chainlesschain/actions/runs/40825996255) | queued      |
| CLI Strict Sandbox       | [40826001600](https://github.com/chainlesschain/chainlesschain/actions/runs/40826001600) | in_progress |
| Context Memory Kernel CI | [40826006659](https://github.com/chainlesschain/chainlesschain/actions/runs/40826006659) | queued      |
| IDE Extensions           | [40826012460](https://github.com/chainlesschain/chainlesschain/actions/runs/40826012460) | queued      |

四个工作流均按固定引用仅派发一次；IDE 明确 publish_vscode_marketplace=false。确认四份准确源码运行存在后，取消同 SHA / main push 自动产生的重复 CLI CI 40825988659 和 Strict 40825988560；保留固定引用的完整平台矩阵，没有删减任何用例或发行门禁。后续主线提交不会取消这组固定引用验证。初次 Git 原子推送发生连接重置，远端读回确认 main 仍为 4d4478、标签不存在，才以 HTTP/1.1 重试；两引用成功到达后才开始工作流派发。原失败与核对过程保留。

[固定引用、派发及重复验证清理回执](./cli/evidence/cli-memory-executable-restart-2026-10-29/immutable-validation.json)另存独立 journal、请求响应、准确 run ID 与 read_file 实际成功结果；四项完整门禁尚未全部完成，没有发布子包、CLI、IDE 或客户端。
