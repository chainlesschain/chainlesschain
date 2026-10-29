# .131 冻结运行时的 Memory 100 次采样与原型复查

日期：2026-10-29。第四十四批，承接[合并索引优化](./cli-ide-memory-bundle-progress-2026-10-29.md)和[真实 CLI 独立恢复](./cli-ide-cli-memory-restart-progress-2026-10-29.md)。Microsoft 渠道继续暂缓。

本批未修改生产源码。Windows x64 / Node 22.22.2；测量时 main 为 c0783cea93，运行时 Git blob 与固定候选 7a5d38d151 一致，源码前后摘要稳定。默认仍为 validate-disk / bundle，每次读完并验证全部 frame 与选中 authority；下面只验证 category-7、limit 20 的列表，不代表所有语义 recall 或整个 Memory SLO。

| 记录数 | 热 p50 / p95（ms） | 冷 p50 / p95（ms）  | 本机 200ms 热 / 1s 冷目标 |
| ------ | ------------------ | ------------------- | ------------------------- |
| 1000   | 58.941 / 73.745    | 131.08 / 169.084    | 热满足；冷满足            |
| 10000  | 66.183 / 76.412    | 272.94 / 386.576    | 热满足；冷满足            |
| 100000 | 162.654 / 178.866  | 1592.828 / 2258.233 | 热满足；冷未满足          |

每格 100 次，共 600 次，逐次匹配同一夹具全量参考的完整结果摘要。冷指新 Node 进程，不清空 OS 文件缓存；计时排除进程导入和夹具构造。热查询每次仍打开一个 bundle，100K 另读取 19 个 authority shard、8,831,462 字节。热 peak RSS 包含父进程夹具，冷 peak RSS 包含 worker 导入及查询，事件循环最大延迟和内存原样保留；不将旧 11 次短样本与本次差异归因于单一代码改动，共用工作站并非受控性能实验。

| Stop 场景                | 取消数  | 投递延迟 p95（ms） | 确认延迟 p95（ms） |
| ------------------------ | ------- | ------------------ | ------------------ |
| 1000 / validate-disk     | 100/100 | 34.071             | 5.883              |
| 1000 / verified-memory   | 100/100 | 24.566             | 5.199              |
| 10000 / validate-disk    | 100/100 | 45.802             | 7.793              |
| 10000 / verified-memory  | 100/100 | 28.624             | 5.109              |
| 100000 / validate-disk   | 100/100 | 33.522             | 6.575              |
| 100000 / verified-memory | 100/100 | 26.637             | 5.054              |

600/600 次为 AbortError 取消，没有迟到成功；每次单独核对 authority lock 已释放，每组缓存模式前后比对 authority **manifest** 原字节。该检查不等于逐时刻核验所有物理分片；这是本机 10ms 定时器宿主测试，真实 IDE Stop 和全进程树继续单独验收。verified-memory 仅为另一个显式测量组，未成为默认。

一次独立冷 CPU 诊断为 1355.345ms，其中 bundle 读取 / 编译约 424.116ms，选中 shard 解码 / 验证约 833.767ms；19 个 shard 只读字节约 36.267ms。采样栈含 canonical.js 约 494ms、compileQueryIndex 约 273ms；区间包含关系重叠，不能相加，也不是 p95。热点主要是返回 20 条仍需完整规范化并验证约 7,400 条，而非单纯文件读取。

| 原型 / 复查       | 实际结果                                                                                                                | 决定                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 有界键序缓存      | 6105 组正向 JSON / digest 对照和 getter 顺序通过；轮换微基准约两成局部收益                                              | 未合入；没有完整查询收益或全兼容证明，不能声称达到冷 SLO                                           |
| 按需 posting 构建 | 八组查询和五个完整 Map 一致，六个 tags / sinks 无效值仍拒绝                                                             | 未合入；Astra 提出遗漏的 scopeKey 拒绝条件                                                         |
| 原型拒绝差异      | 12,000 层 scope 可被 JSON.parse 接受，原 compiler 的 JSON.stringify 拒绝；lazy 原型未请求 scope filter 时却返回一条结果 | 根代理独立复现，原型不得进入生产；这是直接 compiler 对照，不是伪造 authority bundle 的生产漏洞证明 |
| 后续结构方向      | Astra 建议研究小 authority 分片，或内部已解析 JSON 的专用规范序列化                                                     | 均未实现 / 验收；不能只改 bucketOf、替换原始 state 摘要、缩减验证或移用 .131 门禁                  |

未来小分片若采用 4096 authority 桶且保留 256 query frame，必须作为新存储协议处理 manifest / schema、frame binding、reconciliation、事件序号、发布 / 清理、迁移、容量与 cursor generation；首次迁移完整验证旧 authority 后才原子发布。估算验证量减少不是性能承诺，也不保证继续检测旧大桶内所有未选中记录的损坏。公共 canonical 的整数键、**proto**、继承 toJSON、getter 顺序、数组 holes / species / override 和英文排序均不可忽略。该方向未作为本批的已完成功能。

固定候选 ci-cli131-7a5d38d151d4 的 Strict Sandbox 40826001600 为 6/6 成功，Kernel 40826006659 为三系统 3/3 成功；CLI CI 40825996255 和 IDE 40826012460 仍未全部完成。一次 CLI 作业分页回读遇到网络超时，随后对同一 run 回读确认仍 queued，没有重派工作流。既有 npm-publish.yml 对受保护 Kernel / CLI 统一要求准确源码 CLI CI / Strict 准入，故当前仍不发布子包，不绕用 workspace-npm-publish、npm token 或本地发布。旧 ebc / 0d 两个 main push IDE 构建已核对祖先并取消，固定候选四项完整矩阵保留。

完整冷 SLO、同源码每场景 100 次重建 / 损坏 / 混合及跨平台、真实 IDE 和语义质量仍未完成。真实交付仍为 **34/45**，原 verify-11 未知请求未重放，NOT_PAID_READY / NOT_ADMITTED / HOLD 保留。[本批证据](./cli/evidence/memory-slo131-2026-10-29/review.json)含全部原始样本、CPU profile、原型及拒绝反例、Astra 只读审查、固定源码绑定、实际退出码与完整云端作业回读。
