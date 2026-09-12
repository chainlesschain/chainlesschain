# Claude Code / Codex 差距优化：第二批 G06 中文词法召回

> 日期：2026-09-12（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告 §6.4 G06](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)；前批：[G01/G02 实施记录](./CLAUDE_CODE_CODEX_GAP_IMPLEMENTATION_2026-09-12.md)<br>
> 本批起点：`34de841dc1f3f121fe9d564fb4116fefbcf6ec57`。共享仓库期间另有提交推进，验证针对工作区文件，不将其他人的改动计入本批，不以 HEAD 代替完整改动的 CI 证明。<br>
> 范围：关闭已复现的 canonical 中文句内关键词召回盲点，交付词法基线与治理回归。G06 的语义检索、生产效果与容量验收仍未完成；不是全部差距项完成或公开发布证明。

## 1. 结论先行

默认 canonical 记忆现在可以用 `确定性测试` 召回 `偏好使用确定性测试`，不要求预先补 tags/summary，也不回落到 legacy SQLite。实现复用共享 Kernel，CLI 持久记忆重启、搜索及模型上下文准备路径均增加了回归用例。

这一批选择连续多字 Han 片段匹配，不引入字典、ICU 分词、ngram 数组、向量模型或第二份持久索引。它修复确定性关键词反例，但不把同义词、改写问句或一般中文理解标为已支持。

## 2. 实现与兼容边界

主要实现：[memory-reducer.js](../packages/context-memory-kernel/lib/memory-reducer.js)。

| 规则           | 本批行为                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| 原有精确匹配   | 原 token 命中仍计一分，大小写归一化及英文/数字/下划线/连字符边界保留                                       |
| 中文关键词     | 至少两个 Han Unicode 码点的连续片段，可匹配更长 Han 片段内的原文子串                                       |
| 单汉字         | 只匹配完整 Han 片段，不扩展到任意句内单字；补充平面汉字也按一个码点处理                                    |
| 中英混合 token | 在 Han / 非 Han 边界拆分，各部分必须都命中；`Vue开发` 不会仅凭 `Vue` 召回 `Vue部署`                        |
| 搜索字段       | 仍为 category → tags → summary → content；混合部分可跨这些字段命中，不保证相邻或顺序                       |
| 多个查询 token | 保留原分数比例；空格分开的查询仍允许部分命中，不改成全词 AND                                               |
| 既有边界       | 保留前 2048 次 token 出现的截点，重复词也消耗该额度；不是前 2048 个不同词                                  |
| 计算优化       | 每次 rank 只编译一次查询；片段长度剪枝与最多 2048 项的重复片段 FIFO 结果复用，缓存满后淘汰旧项，仍继续搜索 |

例如 `get_user_id` 可以命中 `使用get_user_id读取用户`，`get_user` 不能；`gpt-5` 不命中 `gpt-50`，但仍会命中 `gpt-5.4`，因为点号分词是原有行为，本次不是模型名称解析改造。`确定性测试` 不匹配同义表达 `偏好可复现的检查`；`请说明确定性测试的方法` 也不会自动简化为关键词。

生产修改未调整 scope admission、allowed sinks、状态和过期过滤，未改写 tombstone/revision 生命周期或查询授权。排序权重仍为词法 0.65 + confidence 0.20 + importance 0.15；稳定排序、类别多样性和整条记忆 token 预算保持不变。

没有修改 MemoryRecord schema、持久化字节或记录 digest，也不需要重建索引。召回结果和分数变化时，**recall 结果 digest 可以变化**；不得据此假设新旧版本结果完全相同。CJS/ESM 均复用原有共享实现，本批不增加新的公共配置开关。

## 3. 可复现的词法对照

新增 [固定语料](../packages/context-memory-kernel/fixtures/lexical-retrieval-multilingual-v1.json)、[评测脚本](../packages/context-memory-kernel/scripts/lexical-retrieval-eval.mjs) 和 [评测契约测试](../packages/context-memory-kernel/test/lexical-retrieval-eval.test.js)。

固定 seed `20260912`、时间 `2026-09-12T00:00:00.000Z`，共 21 条人工合成记忆、25 条查询（17 条正查询、8 条负查询）。语料摘要：

```text
sha256:7aa904d411c7d1812a2426965e1fecf2a7518d87b7e5fc5c803574463e739122
```

| 指标                 | 旧 token-exact 词法基线 | 本批算法 |
| -------------------- | ----------------------: | -------: |
| Recall@1             |                0.352941 | 0.970588 |
| Recall@3             |                0.352941 | 1.000000 |
| Recall@5             |                0.352941 | 1.000000 |
| MRR（完整返回排序）  |                0.352941 | 1.000000 |
| 负查询发生误召回     |                     0/8 |      0/8 |
| 完整预期结果集合匹配 |                   14/25 |    25/25 |

Recall@k 是前 k 条中找回的相关记忆比例，再对正查询取平均，不是 hit rate；一个查询有两条相关记忆，因此 Recall@1 即使首条正确也只有 0.5。MRR 只平均正查询；负查询误召回率单列，分母是 8 条负查询。

基线把旧 tokenizer 的 token 编码成不透明 ASCII，通过**同一个 rank 和治理过滤器**排序，不复制一条可能缺 scope/sink 过滤的检索路径。测试逐一核对 525 个记忆—查询对的旧词法分数，并确认其他 scope、其他 sink、过期、归档、候选及删除记录在两臂均被排除。两臂使用可容纳全部记录的 limit/budget 和单一类别，避免编码后的长度或类别差异影响比较。

这是面向已知关键词反例的小型人工语料，不是独立留出集、真实用户效果、完整中文质量或与 Claude Code/Codex 的实测排行榜。脚本仅输出 JSON，明确标注 `synthetic:true`、`qualifiesForProduction:false`；不联网、不调用付费模型、不生成正式签名证据。

## 4. 验证记录

| 验证               | 结果与边界                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 新增词法单元回归   | 43/43 passed；含 Han/英文/代码标识符、混合词误匹配、Unicode 补充平面、2048 次边界、最大长度、缓存满后继续召回 |
| 合成评测契约       | 6/6 passed；已纳入 Kernel 的 `test/*.test.js`                                                                 |
| Kernel 完整组      | 最终 FIFO 版本 94/94 passed，0 failed/skipped，exit 0，16.10 秒；包含上述 43 项词法与 6 项评测契约            |
| CLI canonical 集成 | FIFO 优化前完整组 20/20 passed，96.72 秒；最终版本两条新增定向 2/2 passed，3.34 秒，未将前一整组冒充最终整组  |
| 格式与独立复核     | 新增 Kernel 文件、README、本文 Prettier 通过；修改范围 diff whitespace 检查通过；独立代码/文档复核完成        |

两条 CLI 新用例在旧算法下曾分别因关键词召回失败，在本批实现后通过。定向运行未执行的其他测试不计为通过；多个阶段重复运行也不累计成额外测试数。新增测试已归入现有 Kernel glob 和 CLI `test:context-memory-kernel`，工作流定义包含这两个入口，但本轮没有远端 CI 通过证据。

CLI 测试使用真实 `DurableJsonMemoryPort`、`CliCanonicalMemoryService` 及 `prepareCanonicalProviderContext`：重启后原句与关键词均可召回；跨作用域、错误 sink、过期、候选、删除均不泄露；只读召回不改持久文件；删除后重启仍无结果；模型上下文中记忆保持参考数据身份，不升级为系统指令。测试只准备模型上下文，不请求真实模型。

开发中最大长度测试曾发现新的正向 Unicode 重复正则会触发 `Maximum call stack size exceeded`，已改为单字符边界搜索。独立复核又发现中英交替长串重复扫描的性能回归，已加入长度剪枝和有界片段结果复用；新增对应回归后通过。未降低断言、放宽超时或用测试替身掩盖问题。

复跑命令（仓库根目录）：

```powershell
node --test packages/context-memory-kernel/test/*.test.js
node --test packages/cli/test-node/context-memory-kernel.node-test.mjs
node --test --test-name-pattern "Chinese lexical recall|Chinese substrings" packages/cli/test-node/context-memory-kernel.node-test.mjs
node packages/context-memory-kernel/scripts/lexical-retrieval-eval.mjs
```

## 5. 尚未完成与发布边界

- 本批是 **G06 词法阶段完成**，不是语义检索完成。真实改写、同义词、冲突记忆、跨语言等仍需扩充人工标注语料，并区分词法和语义增益。
- 最大 content 合同为 `4 * 1024 * 1024` **UTF-16 code units**，不是 4 MiB UTF-8；多汉字查询与长文本仍有查询片段数 × 文本长度的最坏扫描成本。已覆盖最大长度及重复片段反例，但没有生产容量、p95 或成本 SLA。
- 既有 `benchmark:quick` / `benchmark:release` 要求干净 candidate 工作树。本轮有其他未提交工作，不清理或绕过该门，也不把合成评测耗时写成正式容量 receipt；现有 quick 的短英文记录场景本身也不证明最坏中文性能。
- 本地执行环境为 Windows、Node `v22.22.2`。CLI 既有 symlink 子断言曾报告 Windows `EPERM` 不可用；整条测试通过不表示该平台分支已验证。
- 没有运行真实模型、完整 IDE 真宿主/三 OS 矩阵或目标部署验收；没有更新版本、提交、推送或发布。npm 发布仍要求精确 release commit 的规定 GitHub Actions 矩阵通过。

下一批可继续 G03 模型能力协议或 G05 插件作者评测；G06 的真实用户语料、语义候选和生产容量应作为独立验收继续跟踪，不用这份局部报告替代。
