# 费用语义与公开 SQLite 安装诊断（2026-10-11）

准确诊断源码 **`fcee60cd4cc29cc524f561264e8d9f2b26032894`** 的两项新增Actions均completed/success；本次零模型调用，没有第四轮付费采样。

- [费用语义校准 / 38117931229](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931229)：在冻结b2aa项目、Node22.12.0、无账户/断网/只读Docker中，第三轮原候选对四项实际计费错误均为**6pass/0fail**（全部survived）；工程六例正常**6/6**，四项错误分别造成**6、4、4、3项断言失败**（全部killed）。每轮基线**22/22**、源码恢复摘要一致。`calibrationPassed:true`、`candidateSemanticAccepted:false`、`engineeringControlAccepted:true`；校准成功不能回填模型题成功。忽略请求桶会使多调用进入unpriced分支、金额不计入，而非必然按合并总量计费。
- [公开安装 / 38117931353](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931353)：Ubuntu24.04 x64 / Node22.12.0、独立空HOME/profile/npm-cache，正常lifecycle安装public CLI**0.166.97**，发行源码**22ef588**八项字节匹配；registry metadata、npm install、cc db init、write、reopen五命令均exit0。core-db实际**native-cipher / better-sqlite3-multiple-ciphers 11.10.0**，CLI vault实际**better-sqlite3 12.11.1**，两者真实写入、关闭及新进程**PID2508→2519**重开/更新均通过，无WASM fallback。两个已加载.node分别2623080/2118144字节，摘要见原始probe。此结果只补齐该Linux公开安装诊断，不代表正式五阶段首次旅程、其它OS/GUI、签名provenance或人工验收。

另一本机WSL运行在安装前`git status`只读清洁检查的30秒期限内超时，`commands:[]`，没有开始npm/provider；原失败和os-release单独保留，不能归因于SQLite或用Actions成功覆盖。原Windows二进制在Linux报invalid ELF的早期基线也未改写。

合同测试Windows Node22.22.2与WSL Node22.12.0各**12/12**，零skip（相同12项不累加）；ESLint/Prettier/diff通过。原件共**125份gzip双摘要**：14份合同/源码、21份公开安装/WSL/API、90份费用reporter/候选/receipt/生成pack/API。六个normalized源码blob与fcee60准确提交一致，原候选4924字节SHA256仍为7f3b5c7f744e2829b226ea2eecf15b522beb5ca6c67b29bb57f9b34eed4ecdba。Astra只读复核未发现阻塞；AI复核不代替独立人工。

原件索引：[合同与源码](./contracts/manifest.json)、[公开安装及本机前置失败](./public-install-actions/manifest.json)、[费用语义原件](./pricing-actions/manifest.json)。

[准确提交的矩阵回读原件](./ci-readback.json)另存API原始结构；不计入上述125份gzip。

准确fcee60的Actions回读时点为**2026-10-11T06:30:12.939Z**；CLI/Strict/完整36题Docker尚未全矩阵完成，不借用旧SHA的成功。

| 工作流                                                                                                                          | 状态 / 结论         | job计数             |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------- |
| [CLI Strict Sandbox / 38117931218](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931218)                   | queued / null       | success=3，queued=2 |
| [VERIFY01 Docker Review Pack / 38117931299](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931299)          | queued / null       | queued=6            |
| [CLI CI / 38117931406](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931406)                               | queued / null       | queued=65           |
| [VERIFY01 Public Install Diagnostic / 38117931353](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931353)   | completed / success | success=1           |
| [VERIFY01 Pricing Semantic Diagnostic / 38117931229](https://github.com/chainlesschain/chainlesschain/actions/runs/38117931229) | completed / success | success=1           |

同SHA重复push Docker run38117926343在六job均queued时取消，保留PR run38117931299；这只是去重。后续纯文档提交不把该矩阵转移到新SHA。

正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0**、$99、旧计划指纹和截止窗口保持。独立人工预审/外部review锁、可靠账单或硬额度、目标GUI/辅助技术、8h/24h/SLO、Windows/macOS durable/owner-only及完整native review仍开放；原模型verdict与候选未重写。本轮没有合并或发行。
