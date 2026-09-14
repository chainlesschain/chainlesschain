# Claude Code / Codex 差距未完成项推进记录（2026-09-14）

> 实施基线：`e1397ca6046b35c97d170b1768f5462642ba4818`，本记录对应其上的未提交工作树。
> 本机环境：Windows，Node.js `v22.22.2`，npm `10.9.7`，Codex CLI `0.154.0`。
> 证据口径：本地代码、合同测试和真实本机 Codex App Server 协议探针；不等同于付费模型效果、生产部署或精确候选 SHA 的三平台发布认证。

## 1. 本轮结果

本轮继续推进原差距报告中仍可在仓库内闭合的 G04、G05、G06、G08、G10。其余未完成项依赖真实账号、生产身份/KMS、目标 OS、商店或双设备，保留为外部验收门。

| ID  | 本轮关闭的工程缺口                                                                                                           | 仍未关闭的验收门                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G04 | 将 Codex App Server `0.154.0` 加入 fail-closed 适配器和 Linux/Windows/macOS CI 矩阵；本机真实 schema 与 stdio 初始化探针通过 | 干净精确 SHA 的三平台矩阵、真实 turn/cancel/resume 旅程，以及是否接入产品主链的独立决策 |
| G05 | 增加 1–20 次重复采样、确定性平衡双臂顺序、Wilson/Newcombe 95% 区间、reviewer-owned holdout 与 CLI 参数                       | 固定付费模型实跑、独立模型 grader、发布提交上的正式门禁                                 |
| G06 | 增加由宿主提供、按 memory revision/digest 绑定的受治理语义候选与轻量 hybrid rerank；词法默认行为不变                         | embedding/index 宿主适配器、真实中英语料与冲突记忆评测、容量和三平台目标环境            |
| G08 | standalone Headless 的 deferred request/resolved/consumed/expired 权威事件、私有恢复投影、重连重放和一次性消费确认           | 独立子进程/真实客户端旅程、CLI/IDE/App Server 精确 SHA 三平台一致性                     |
| G10 | 为后台 Agent 分页增加内容无关、文件身份绑定的只读索引；缓存失效、损坏或竞态时回退权威全扫                                    | 精确 SHA 三平台 formal 容量曲线、SLO 决策、持久 Memory 索引及归档策略                   |

## 2. G04：Codex App Server 0.154.0

- 兼容矩阵只接受精确 `0.154.0`，`0.154.1` 继续失败关闭。
- CI 兼容矩阵现在为 4 个上游版本 × 3 个平台，并沿用精确 SHA、真实上游安装、逐项回执和聚合拒绝部分矩阵的现有门。
- 本机直接调用已安装的 Codex CLI `0.154.0`：schema 生成得到 305 个 JSON 文件，并找到 `initialize`、`initialized`、`thread/start`、`thread/list`、`turn/start`、`turn/interrupt` 六个必需方法；stdio 探针完成 `initialize → initialized → thread/list`，响应为 JSONL 且没有 `jsonrpc` header，stderr 为 0 字节。

本机探针只覆盖 Windows 的协议握手，不满足工作流要求的干净精确 SHA 三平台证据，也没有把实验适配器接入默认产品路径。

## 3. G05：可重复、可独立复核的插件 Eval

`cc plugin eval` 新增：

- `--samples <1..20>`：每个 task 的 control/candidate 重复执行；
- `--arm-order balanced|control-first|candidate-first`：默认按 suite digest 决定首臂并逐轮交替，避免未记录随机源；
- `--holdout <file>`：加载插件 payload 外的 reviewer suite，要求插件名和版本精确一致，任务 ID 不得与作者 suite 重复；
- suite 也可声明 `sampling.runs` 与 `sampling.armOrder`；命令行覆盖 suite 默认值；
- 报告记录每个样本、实际双臂顺序、累计 usage/cost，并给出两臂 Wilson 95% 区间与 Newcombe 差值区间。

Holdout 的字节 digest 独立进入报告，但不改变插件 payload digest。共享报告只记录 holdout 文件名和 digest，不泄露 reviewer 工作站的绝对路径。该接口能交付独立题集，不能自行证明 reviewer 或 grader 在组织流程上真正独立。

## 4. G06：治理先行的语义候选接口

Context/Memory Kernel 仍不执行 provider、embedding、文件或网络 I/O。宿主可在 `MemoryRecallRequest.semanticCandidates` 中提交：

```json
{
  "memoryId": "memory-1",
  "revision": 2,
  "recordDigest": "sha256:<64 hex>",
  "score": 0.91
}
```

Kernel 先对 canonical records 执行 lifecycle、expiry、scope 与 allowed-sink 过滤，再允许语义分数参与排序。语义证据必须绑定当前 revision 和 record digest；已准入记录的证据陈旧时返回 `revision_conflict`。未提供语义候选时，原词法筛选、权重、结果形状与排序保持不变；提供后以词法/语义较强者作为原 65% retrieval 分量。

这关闭的是安全的宿主接线缝，不是完整向量检索交付。真实 embedding/index、索引删除同步、用户语料和容量曲线仍需单独实现及验收。

## 5. G08：standalone Headless deferred 恢复

- deferred 问题以 requested/resolved/consumed/expired 四类 session authority event 落库；恢复投影只在私有 resume state 中携带问题与答案，公开 content-free snapshot 不泄露内容。
- 恢复 reducer 校验 session/binding/sequence，对错会话或错 binding 的回答忽略；最多保留 32 个状态。
- 回答必须先持久化 resolved 事件再进入待注入上下文；一次性注入必须先持久化 consumed 事件，持久化失败时保留答案供重试。
- 进程/管道关闭不把未答问题误记为 expired，支持后续恢复；真实 timeout/cancel 才尝试写 expired。
- 具备交互能力的重连会重新发出 `restored:true` 的原问题；关闭交互或旧 pipe 不接收未知事件，权威 pending 状态保持不动。

当前自动化以两次独立 host 调用和注入的持久投影模拟重启边界，尚不是两个真实 OS 子进程与真实客户端的端到端证据。

## 6. G10：后台 Agent 分页只读索引

- `.background-agent-list-index-v1` 只保存 `id`、`startedAt`、`status`，不保存 prompt、日志、session 内容或生命周期派生字段。
- inventory digest 绑定每个权威状态文件的名称、大小、纳秒 mtime/ctime、device 和 inode；文件替换、增删或状态写入会使缓存失效。
- 首次读取或缓存损坏时从权威 JSON 重建，并在读取前后再次核对 inventory；遇到并发写入竞态即放弃索引，由调用方执行原有全量权威扫描。
- 缓存有效时，分页先按只读摘要定位候选，再只读取形成 `limit + 1` 结果所需的权威状态；`listBackgroundAgents` 的非分页合同保持不变。

该优化已经减少重复分页的 JSON 解析数量，但尚未在 1k/10k 历史目录上产生精确 SHA 三平台 formal 曲线，不能据此声明达到生产性能 SLO。持久 Memory 仍是全文件读取，本轮没有将后台索引结论外推到 Memory。

## 7. 本地验证

已通过：

- Context/Memory Kernel 全包：97 tests；
- CLI G04/G05/G08 合并回归：7 files、61 tests（含 App Server/fallback、插件 Eval unit/CLI、Headless questions/resume）；
- session-host 私有 deferred 投影：1 passed，6 skipped（定向）；
- 后台 Agent 只读索引与分页/cursor：4 tests（定向）。

另完成 Codex CLI `0.154.0` 的真实 Windows schema 与 stdio 握手探针。多文件 Headless 合并执行曾出现 Vitest 进程不退出，因此最终证据采用各文件/定向隔离执行；单独的 Headless questions 全组正常退出。

## 8. 不能由本轮本地工作树替代的任务

以下项目必须在具备相应资源的目标环境继续执行：

1. G01/G03：真实身份、真实账号/模型、公开安装产物和指定 IDE 的完整模型任务；
2. G02/G04/G08/G10：合入后的干净精确 SHA，Linux/Windows/macOS 完整矩阵及产物聚合；
3. G05/G06：固定付费模型、独立 grader/holdout、真实用户语料和生产容量；
4. G07：不可绕过的域名级 egress 后端及平台特殊组合实机验证；
5. G09：生产 KMS/witness、人工审批、cohort 观察与 rollback 演练；
6. G11：商店回读、JetBrains 渠道、双设备断网重连/撤销及成功率和耗时。

在这些回执完成前，G01–G11 仍不能整体标记为 production-complete。
