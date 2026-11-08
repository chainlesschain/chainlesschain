# 固定源码 Memory 查询与恢复测量

源码 `3116842b0fdc5d5c6c747a404bf37b18fb8206c9`，Windows / Node24.12.0。原查询进程（会话44586）退出0，报告complete=true，1K/10K/100K × cold/hot/rebuild/corrupt各100次，共1200样本；独立审计逐条匹配全量参考，返回20条，重算p95与报告一致。原始报告与最终独立审计保留本目录。

100K冷/热/重建/损坏恢复p95分别400.745/50.711/4759.601/3950.877ms。冷/热低于原建议1s/200ms目标。本机测量不是跨平台、完整Memory或生产准入证明；事件循环、内存、Stop、混合、组合及真实IDE仍按各场景单独验收。共享工作站，不能声称隔离负载。

后续PowerShell队列会话66005退出1，原因File.Replace的null备份路径在当前Windows环境非法，尚未开始下游测量。旧状态及日志保留.tmp，不覆盖。真实BGE三入口烟测随后退出0并确认源码前后不变。新的Node队列会话74479从Stop开始，后续mixed/compound顺序运行；本目录不将队列已启动视为完成。

Stop measurement: 600 samples independently audited, source digests matched, process exit 0. There were 580 actual aborts and 20 successful completions before the 10ms deadline. No late successful completions, retained locks or authority changes. 100K validate-disk delivery/acknowledgement p95: 0.693/1.444ms. This covers local disk-backed listing only. Mixed/compound and native IDE or semantic-worker Stop remain separate acceptance items.

Mixed measurement: 300 rounds and 2400 worker results independently audited after process exit 0. mixed100.json.gz is the lossless raw report; its uncompressed SHA-256 matches mixed100-audit.json. Source digests, eight-way overlap, gapless generations, same-round deletion visibility and worker close records were checked. Full record/event comparisons execute in the benchmark. 100K read/lock-wait p95: 1816.706/1333ms. Compound measurement remains running separately.

Offline raw-sample verification: node docs/research/cli/evidence/memory-3116842b-2026-11-08/verify-evidence.mjs. It checks integrity, query p95, cancellation and worker/generation evidence. Historical source hashes are preserved; current-source equivalence and wider acceptance remain separate.

Compound measurement completed: 900 raw entry digests, oracle/generation/cursor bindings, p95 values and cleanup/source stability independently audited after exit 0. compound100.json.gz is lossless; its uncompressed digest matches compound100-audit.json. 100K category/tag/continuation p95: 492.568/507.993/498.497ms. Load context is unspecified and performanceAccepted remains false. The offline verifier now checks all 900 compound samples as well.
