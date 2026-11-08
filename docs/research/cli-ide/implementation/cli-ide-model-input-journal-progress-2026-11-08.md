# 模型输入诊断的会话持久化与查询（2026-11-08）

本批继续[差距复核第 2 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)。代码提交 `5501891ee3c61728e1661fb6fee7c740c76aae8d`，分支 feature/model-input-diagnostics-20261108。前一批的 runtime 回调现在接入持久化 headless / REPL 会话，并提供经过完整性验证的 CLI 查询。

使用：`chainlesschain session show <id> --json --model-inputs`。`--limit 1..200` 控制返回的最新记录数量，默认 50；结果包含 total / truncated、事件 hash 和诊断摘要。该视图要求 canonical JSONL 会话及 --json，不能与历史、输入回执或其他分页视图混用。查询不会重放模型调用或退回 legacy 数据库。

**本批实现**

- 持久化宿主将核心模型的诊断回调追加为 model_input_diagnostic 会话事件。已有宿主错误标记覆盖同步和异步追加失败，失败时终止后续派发。
- 写入和查询都重新构造白名单摘要。未知字段不会写出原始正文，所有 providerAcceptanceVerified / billingVerified 都保持 false。
- 严格拒绝 Proxy、访问器、函数和自定义数组原型；ID 必须是原始字符串。防止通过隐式转换、toJSON 或 getter 将原文对象混入摘要。
- 查询复用 readVerifiedProjection，验证完整事件链及已有独立锚点，只保留最多 200 条尾部摘要。
- 补齐同一请求的真实 canonical plan → 可信签名 receipt → HTTP 正文证据。OpenAI、Anthropic 均核对实际规划摘要、三个签名摘要以及接收端 SHA-256 / UTF-8 字节数。
- 小预算场景通过真实 kernel 裁剪旧来源，诊断明确记录 input_budget:1，HTTP 正文保留当前用户请求且不含被裁剪旧来源。

**验证结果**

| 验证                               | 结果                                                  | 证据                                                                                                      |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 同请求三阶段及真实预算裁剪         | 6 项通过、274 项未选中                                | [真实组合测试](./evidence/model-input-journal-20261108/input-diagnostic-three-stage-tests.json)           |
| 真实会话写入、压缩后查询、篡改拒绝 | 通过                                                  | [最终宿主与查询测试](./evidence/model-input-journal-20261108/input-diagnostic-host-journal-tests-r3.json) |
| headless / REPL 接线与对象泄漏拒绝 | 同文件 6 项全部通过                                   | 上述报告；宿主测试注入核心循环以检查真实选项与会话写入                                                    |
| 原输入回执及持久化失败回归         | 3 文件共 11 项通过                                    | [报告](./evidence/model-input-journal-20261108/input-diagnostic-journal-tests.json)                       |
| 命令派生文件                       | 已生成并通过 manifest / help-index / completions 检查 | 新选项使用既有 session show，派生命令清单无差异                                                           |
| 提交门禁                           | ESLint / Prettier / diff 通过                         | 代码已提交推送，跨系统 CI 尚未取得完整回执                                                                |

初次宿主测试失败记录也保留：测试误用了 persist 而非 persistSession，并继承了工作区 hooks；随后测试工作区又包含权限 authority 目录，被真实安全边界拒绝。最终测试使用独立工作区、实际持久化选项及注入的成功 lifecycle hooks，没有放宽生产限制。

**验收边界与剩余项**

三阶段真实模型路径与宿主持久化接线分别得到直接验证；尚未执行双 IDE 的完整诊断查询/展示旅程，也未将它们作为独立模型任务验收。诊断能够证明准备的输入、裁剪与来源摘要，不能证明模型理解正确或实际账单准确。逐来源遗漏、投影脱敏、工具/宿主/验收环境的完整归因仍需推进；自定义 adapter 未产生日志时不宣称被覆盖。

本批没有发布软件包、扩展付费或 App Server 生产准入，也没有改变历史模型任务成绩。整份差距清单仍在实施中。
