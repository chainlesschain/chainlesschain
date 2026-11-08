# 模型输入来源诊断

本页描述开发分支功能，尚未发行。公开 CLI / IDE 版本及准入范围保持原有记录。

查询已经持久化的 canonical 会话：

```bash
chainlesschain session show <session-id> --json --model-inputs --limit 50
```

查询只读，不重新调用模型。limit 为 1..200，默认 50，返回最新记录；total / truncated 说明会话记录是否超过查询上限。一次性 ephemeral 运行不会因此新增持久化记录。会话完整性失败时拒绝查询，不回退到旧数据库。

**如何阅读同一请求**

requestId 关联 logical-input 和各次 body-prepared。attempt 区分物理请求尝试；usageCallId 在已有用量边界覆盖时关联模型调用，但不证明真实账单。

planning.sources 说明规划选中或排除的来源摘要。ordinal 仅为该请求诊断数组序号，不是原始对话序号。sourceMapping.sources 通过相同 ordinal 连接来源；正文、文件路径、工具名称和原始 sourceRef 不写入该诊断。

logical-input 的 sourceMapping 分别列出 input 与 logical 位置。kind=message / tool 区分消息和工具定义，index 为相应请求数组位置。input 在签名投影前，logical 在实际投影后，因此包含宿主新增消息所带来的位置移动。一条来源可以包含 assistant 调用与多个工具结果。

changed 比较这些节点的规范化摘要。redactionTouched / injectionTouched 来自经过验证的签名投影路径，表示该来源是否被触及；不是逐来源处理次数。null 表示没有这项可信投影证据。derived:true 仅说明该 ContextItem 带有父摘要，不能推断父来源原文已发送；false 也不能排除更早的压缩。

body-prepared 的 sourceMapping 给出协议转换后的结构位置：

| protocol           | 转换位置                                                  |
| ------------------ | --------------------------------------------------------- |
| openai-chat        | messages、tools                                           |
| openai-responses   | 展开的 input 项、tools                                    |
| anthropic-messages | system 文本区间、消息及合并后的 tool_result 内容块、tools |
| ollama-chat        | 转换图片后的 messages、tools                              |

fragments.path 为受限 JSON Pointer。start / end 均为 null 时取完整节点；否则在 JSON 解码后的字符串上使用 UTF-16 code unit 的半开区间 [start,end)，不是 HTTP 字节偏移。多个 system 来源可指向同一个字符串的不重叠区间。

fragment.digest 是所取节点按对象键排序后的 JSON SHA-256；fragment.bytes 是该节点 JSON 序列化后的 UTF-8 字节数。它们不同于 bodyDigest：后者覆盖准备发送的完整 HTTP 正文字节，保留空白、键顺序等序列化差异。

status=mapped 只表示转换节点的来源关系已绑定；excluded 表示规划排除；omitted 表示协议转换没有为该来源留下输出节点。mapped 不保证原文逐字保留、没有截取或模型已经理解。

**覆盖边界**

logical-input 的 covered:true / reason:complete 只证明来源已绑定到该逻辑阶段，要求完整规划、实际输入和可信投影（启用时）一致；body-prepared 还要求协议登记与准备的正文相互匹配。最多保留 512 个来源和 4096 个请求位置；来源摘要截断时整体映射标为 mapping_limit，不以已保留的排除项冒充完整来源覆盖。

planning_unbound、projection_unbound、protocol_unmapped、body_unavailable、body_mismatch 都表示相应阶段没有完整映射。传输可以重新序列化相同 JSON；更改已登记的消息、工具或其他已覆盖输入根后，映射会变为未知。自定义 adapter、未知转换及没有新字段的旧日志均不能推断为已覆盖。

billingVerified 和 providerAcceptanceVerified 仍为 false。此视图用于定位来源遗漏和转换变化，不证明请求已被服务端接受、模型消费了全部输入、任务通过独立验收或账单准确。双 IDE 的新增来源明细展示及完整原生旅程仍待接入和验收。

[实现及验证记录](../research/cli-ide/implementation/cli-ide-model-input-mapping-progress-2026-11-08.md)
