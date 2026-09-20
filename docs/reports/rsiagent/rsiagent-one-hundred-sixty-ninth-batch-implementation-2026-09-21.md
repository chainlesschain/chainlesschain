# 第一百六十九次工程实施：Volcengine 工具成功回执最小披露

## 本批目标

关闭 Volcengine 工具成功路径向 renderer 或完成调用方透传 provider 扩展对象、工具参数/结果与完整消息历史的缺口，同时保留模型工具循环内部生成下一轮请求所需的数据。

## 实施结果

- 新增统一的 Volcengine 工具成功投影，只允许返回有界正文、有限 token 计数与有界模型标识；结果及 usage 回执冻结，任意 provider 扩展字段不会被复制。
- 投影只读取 plain own data，拒绝遍历 Proxy，也不执行 accessor；超长或非字符串正文失败关闭。
- Web Search、图像、知识库、Function Calling、MCP 和混合工具的 IPC 成功出口统一使用该投影，不再返回 `tool_calls`、`search_results`、`knowledge_results`、`finish_reason` 或任意原始 provider payload。
- 图像理解和完整 Function Calling 的客户端完成回执也使用同一投影；后者不再返回用户 prompt、assistant 中间响应和工具结果组成的完整 `messages` 历史。
- 知识库配置成功只返回固定 `{ configured: true }` 回执，不透传上传服务返回对象。
- 生产默认的 Volcengine 工具直连 IPC 继续由治理 ingress 失败关闭；可注入 client 仅用于验证未来受治理接线后的成功出口。

## 回归与门禁

- 完整 LLM 回归：40 test files、586 tests passed、15 skipped。
- 成功投影定向回归覆盖 provider 扩展字段、工具调用、搜索/知识结果、消息历史、Proxy/accessor 与固定知识库回执。
- Desktop 主进程构建通过。
- 相关 ESLint：0 errors（`volcengine-tools.js` 保留 6 条既有 `curly` warnings）。
- `git diff --check` 通过。

## 未完成边界

- 模型工具循环内部仍必须短期持有 provider 原始 tool-call 结构和受治理工具结果，生产环境还需验证内存生命周期、崩溃转储与保留策略。
- Volcengine 内置工具的治理 wire protocol、真实网络/provider 执行、企业用途 authority、身份切换/撤销和 Electron renderer/preload E2E 尚未完成。
- 其他 LLM manager 方法原始 rejection、stream/runtime 业务事件与剩余模块的成功/错误通道仍需继续收口。
