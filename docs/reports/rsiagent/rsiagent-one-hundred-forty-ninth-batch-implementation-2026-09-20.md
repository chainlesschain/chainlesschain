# 第一百四十九次工程实施：LLM Core 成功回执白名单投影

## 本批目标

补齐 LLM Core IPC 只收敛失败出口、成功结果仍透传 provider 和 Agent 任意对象的缺口：renderer 应继续取得回答文本、必要 token 信息、模型列表和 embedding 数值，但不能取得 tool call 内部结构、provider 原始响应、Agent 私有结果、成本扩展或 prompt 优化对象。

## 实施结果

- 新增独立 `llm-ipc-success-projection`，所有对象只读取 plain enumerable data property；Proxy、accessor、类实例和未知字段不会被展开。
- `check-status` 只返回 available、provider、受限模型列表、固定 error 及可选 model；模型条目只允许 id、name、size 与 modified_at，endpoint 和任意 provider metadata 不再返回。
- `query`、`query-stream`、`chat-with-template` 与普通 `chat` 统一投影为回答文本、标准 assistant message、有限 model/token/usage 字段。provider message 中的 tool calls、raw response、租户成本和任意附加字段被删除。
- 多 Agent 快速路径不再返回完整 `agentResult` 或 agent identifier，只保留回答、有限 usage 及是否实际路由的布尔状态。缓存命中路径使用同一成功投影。
- prompt 优化详情改为 `promptOptimized` 布尔回执；RAG 引用限制数量并只投影 id、title、200 字符摘要和非负 score。
- stream chunk 事件只发送 chunk 与 fullText，不再附带 conversationId 或任意扩展对象。
- embeddings 只接纳最多 65,536 维的有限数值数组，Gemini 风格对象仅保留 embedding、model 和有限 usage；模型和文档数组逐元素读取 data descriptor，索引 accessor 不会执行。
- 文本、标识符、模型数量、引用数量和 embedding 维度均设有明确上限；越界或非法结果在既有固定 IPC 失败边界内失败关闭。

## 回归与门禁

- Core 成功/失败隐私、治理与通用 IPC 定向回归：4 test files、82 tests passed。
- 完整 LLM 主进程回归：36 test files、546 tests passed、15 tests skipped。
- 覆盖 status、query、stream event/completion、model list、template、embedding、普通 chat、multi-agent 与 cache hit，验证 provider/Agent 私有附加字段不进入序列化结果。
- 覆盖 accessor 与 Proxy 负例，确认 getter 未执行且 usage 不从 Proxy 读取。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- 回答文本、流式文本、RAG 摘要、模型名和 embedding 是相应 UI 功能的预期数据，本批只限定结构和规模；Core IPC 的 renderer sender、DID tenant、用途与字段级读取授权仍未接入。
- 辅助 IPC 的数据库行、统计、成本、stream complete，以及 selector 成功结果仍按原合同返回，尚未统一使用字段白名单与 renderer 授权。
- `llm-manager` 成功/策略事件和直接方法 rejection、Volcengine Tools 成功 payload、context/session/memory/Manus 等其他模块仍待收口。
- tenant HMAC、身份切换撤销、真实 Electron/preload/provider E2E 与生产日志保留/访问控制仍未完成。
