# 模型输入逐来源规划与投影计数（2026-11-08）

本批推进[差距复核第 2 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)的来源归因，代码提交 ce6df580b8a0e269386e2ce4de950396a1e9a8cf，分支 feature/model-input-source-attribution-20261108。CLI 会话查询可保留并读取新增来源明细和投影计数；双 IDE 当前白名单视图尚未展示这些新增明细。

**新增证据**

- planning.sources 使用已有 kernel item.digest 关联来源，不输出 itemId、路径、正文或原始 sourceRef。每项只包含诊断 ordinal、摘要、固定 kind、selected/excluded 和固定 reason。
- 来源状态描述投影前的规划决定。selected 不表示原始来源已逐字到达 provider；后续正文摘要和投影回执承担各自阶段的证据。
- 最多保留 512 项，优先保留 excluded，随后才是 selected；sourceCount 和 sourcesTruncated 保留完整数量边界，避免大量选中项占满额度后排除项不可见。
- 真正的 planner.dropped 不包含 kind，因此排除项类型为 unknown。ordinal 是诊断数组序号，不是原始对话位置。
- sourceDetailsCovered:false 时，sourceCount:0 表示没有覆盖的明细，不能判断没有来源。
- 可信 ingress 在验签读回后将 redactionCount / injectionCount 绑定到私有冻结 receipt。诊断只输出数字；缺少 receipt 的调用计数为 null，旧日志没有字段时保持兼容。
- 旧会话仍可由同一个 verified projection 读取。新来源信息也经过现有纯数据、白名单、计数和规模校验。

**本地验证**

| 验证                                  | 结果                   | 证据                                                                                          |
| ------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| 来源摘要、会话兼容、usage 边界        | 3 文件 46 项通过       | [报告](./evidence/model-input-source-20261108/model-input-source-tests.json)                  |
| 真实规划 / 签名 / HTTP                | 6 项通过、274 项未选中 | [报告](./evidence/model-input-source-20261108/model-input-source-real-tests.json)             |
| 新增 512 selected + 1 excluded 边界后 | 2 文件 19 项通过       | [最终边界报告](./evidence/model-input-source-20261108/model-input-source-boundary-tests.json) |

真实小预算请求中，排除来源摘要精确等于 kernel 对应 dropped.digest，原因是 input_budget，HTTP 正文没有旧来源而保留当前用户输入。真实验签输入中，测试密钥哨兵已脱敏，receipt.redactionCount 大于零，输出请求不再含该哨兵；计数未从 provenance 文本解析。

本批经过 Astra 只读审查。按审查建议优先保留排除项，并明确 unknown 类型和 ordinal 含义。提交钩子的 ESLint / Prettier / diff 检查通过；尚未取得本提交完整跨平台 Actions 回执。

**剩余范围**

目前只证明规划阶段逐来源选择与排除，以及投影阶段的全局处理计数。尚未建立每个来源到投影后消息位置、provider 协议转换后内容的完整映射，不能将全局计数归到某个具体来源，也不能据此判定模型任务成功或账单正确。双 IDE 的新增明细展示、独立任务验收和工具/宿主/验收环境的完整失败归因仍待推进。原始内容默认不公开，正式付费准入及历史成绩未改变。
