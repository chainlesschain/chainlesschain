# Memory 组合冷查询与跨平台测量续作

日期：2026-11-08。承接[原差距评审](../plans/cli-ide-codex-claude-gap-review-2026-10-27.md)4.8及[按需倒排实现](./cli-ide-memory-lazy-progress-2026-11-08.md)。完整目标尚未完成，未发起产品侧模型请求。

## 本批交付

此前类别列表基准不能证明多个过滤字段首次建索引的成本。新基准通过真实 `CliCanonicalMemoryService.listPage()` 和默认 `validate-disk / bundle`，分别测量类别选择性高、标签选择性高、直接使用真实游标的首次冷续页。每个样本创建新Node进程，第一次业务调用即目标查询；初始化、导入、全量参考及进程启动均不计入查询耗时，操作系统文件缓存未清空。

夹具使用固定种子和彼此独立的字段分布，植入跨分片的并列排名、五类高优先级不合格记录及真实reducer生命周期事件。独立oracle在另一进程无参数读取完整authority，不导入生产过滤、比较器、游标解码或公共投影辅助函数。逐次核对完整公共结果、顺序、版本、摘要和续页存在性；另验证所有页无重复或遗漏、空条件、权限、墓碑和游标变化拒绝。

报告逐样本原子保存；样本齐全与整体完成分别标记，只有全量审计、身份复核及临时目录清理后才发布 `complete:true`。保留原始失败以及证据写入与清理的复合错误。记录Node二进制摘要、Kernel的ESM/CJS物理解析、关键源码和Git身份；静态依赖扫描明确不是完整闭包，第三方依赖没有冻结。

Memory专项Actions补入Linux、Windows、macOS的Stop、八进程混合读写删及组合冷查询，每个job核对准确源码，失败后上传已有部分回执。PR使用每格11次；手动完整矩阵使用100次，不把11次当作原计划的100次验收。原查询job继续覆盖冷、热、重建、损坏及全量参考对照。

## 已有验证与范围

- 新基准Node回归 **9/9**，覆盖独立oracle、真实生命周期、原子替换、写入/清理失败、证据拒绝覆盖及Git身份变化。
- 合并版本1K、每场景1次的功能预检退出0：三个首次冷场景、12组磁盘条件、3页74条完整分页及1482个事件的最终审计通过。它是与既有测量并行的功能预检，`sampleMatrixComplete:false`、`performanceAccepted:false`，不授予性能目标或生产准入。
- [原字节预检回执与摘要](../../cli/evidence/memory-compound-2026-11-08/README.md)保留当时 `06a5facd2` 加本批未提交文件的准确身份。
- [草稿PR #553](https://github.com/chainlesschain/chainlesschain/pull/553)已建立。`06a5facd2` 合并主分支 `6b8a39e27`，冲突解法同时保留默认关闭/撤权场景和本批GUI隔离/失败回执。正常提交门禁及桌面17项合同、类型检查通过；云端检查尚未计为通过。

## 合并前固定提交测量

独立工作树继续固定在 `727c64962`，55项Node合同通过；三档冷/热共600次逐次匹配全量参考，100K冷/热p95 **400.169/43.743ms**；两缓存模式三档共600次Stop全部取消、锁释放且无迟到成功。重建/损坏与300轮混合队列仍按终态核对，不把进行中的组记为通过。

该提交使用原8ms检查点。最新主分支已采用32次工作量主动让步；合并后源码不能继承上述提交身份。既有冻结候选与合并提交18个关键绑定中17个字节相同，混合脚本不同，仍只保留组件对照，不授予新SHA整套SLO。

## 完整运行入口与剩余工作

```powershell
node --test packages/cli/scripts/memory-compound-query-benchmark.node-test.mjs
node packages/cli/scripts/memory-compound-query-benchmark.mjs --counts 1000,10000,100000 --samples 100 --load-context isolated-measurement --output <新的报告路径>
```

三档三场景各100次共900个首次冷样本；应核对每组完整样本、独立oracle、最终审计、清理和源码稳定。`performanceAccepted` 继续为false；延迟观测、样本矩阵完成和批准的SLO是不同结论。

最终源码的完整三系统矩阵、真实IDE、语义质量、安装升级及生产准入仍待完成。无模型工程结果不增加历史真实任务通过数，不更改未知账单、正式付费readiness或发行门禁。
