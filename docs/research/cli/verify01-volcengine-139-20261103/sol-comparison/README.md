# Sol 成功与 DeepSeek 失败的证据对照

这里比较原始任务源码 `b2aa3aba082873570e85dce39b00754e5504ff37` 上的实际生成记录。Sol 来源为 [.133 完整轮 41117741513](https://github.com/chainlesschain/chainlesschain/actions/runs/41117741513)，全轮 39/45；DeepSeek 来源为 [取消输出测试上限的 41585306414](https://github.com/chainlesschain/chainlesschain/actions/runs/41585306414)。这不是相同 CLI 版本、协议和思考配置下的模型单变量实验。

| 样本 | Sol 请求 / 工具操作 | DeepSeek 请求 / 工具操作 | 实际验收差异 |
| --- | --- | --- | --- |
| verify-04 | 13 / 30，单次最多 6 个工具调用 | 24 / 22，单次 1 个工具调用 | Sol 五项测试通过并杀死两种缺陷；DeepSeek 六项测试自身通过，但只杀死第一种缺陷 |
| verify-07 | 15 / 32，单次最多 4 个工具调用，无压缩 | 37 / 35，单次 1 个，压缩一次 | Sol 五项测试通过并杀死两种缺陷；DeepSeek 三项测试自身通过，只杀死第一种缺陷 |
| first-run-darwin-cli | 13 / 24，写入一次、编辑四次，无压缩 | 16 / 16，全部为读取和搜索，压缩一次 | Sol 六项测试通过并杀死两种缺陷；DeepSeek 尚未写入候选即因无进展退出 |

**verify-04 的区别是覆盖条件。** Sol 同时验证请求级聚合费用、缓存读与缓存创建计入长上下文阈值：固定总 token，通过重新分配每次请求的缓存 token 跨过 272000 阈值，并核对实际费用。DeepSeek 保留了缓存计数和纯 input 的阈值边界，但未构造「缓存 token 使请求跨阈值」的条件，漏掉 `drop-cache-tokens-from-request-threshold`。第一种 `merge-short-and-long-request-price-buckets` 已被它杀死，不能称作完全没有有效测试。

**verify-07 的区别是调用路径和方向。** Sol 通过真实 transcript store 与 `readSessionTranscriptHistory` 验证旧页 `cursor`、增量 `after`、末尾继续追加、字节上限和游标篡改。DeepSeek 只通过 `createSessionTranscriptHistoryProjection` 测旧页回溯与 stale cursor，漏掉增量 `after` 的首行，因而漏掉 `skip-after-cursor-first-row`；它已杀死 `repeat-before-cursor-boundary`。两个样本的 Sol 与 DeepSeek 验收脚本摘要分别一致，因此这两种覆盖缺口不是换了一套检查脚本造成的。

**还有测试配置与 CLI 因素。** 原火山 broker 强制 `parallel_tool_calls:false`，Sol 请求省略该字段。相同轮数不等于相同工具工作量；此次修正为提供方默认，是否实际批量调用须以新 trace 为准。DeepSeek 首次启动还收到耗尽读取额度后仍重复给出的 recoveryRead，CLI 已修复该不可能执行的恢复提示。Sol 本身也有少量读取省略，不能把所有省略都称作缺陷；其这三个 trace 没有压缩，也没有陷入同类循环。

Sol 使用 CLI .133、Responses 和默认思考；火山旧记录使用 CLI .139、Chat Completions、thinking disabled。独立审查、轮数和输出限制也不同。以上证据足以指出具体配置偏差和候选覆盖缺口，尚不足以将总体差距全部归因为模型能力。

`comparison.json` 保存计数、原始请求配置、历史结果行、候选摘要和来源。Sol 两份原生生成 ZIP、两份独立验收 ZIP 及 DeepSeek verify-04 的生成 ZIP 均已按 GitHub 制品 SHA256 验证；三个 Sol 样本的 setup/check 回执摘要、脚本摘要、测试数和缺陷检查结果与原汇总逐项匹配。相关原始文件以 gzip 保留字节和原始摘要；DeepSeek 原始验收回执已在上轮完整归档并验证。新补测不会读取这里的候选或答案。
