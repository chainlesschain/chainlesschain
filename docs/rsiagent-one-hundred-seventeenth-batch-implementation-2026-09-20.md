# 第一百一十七次工程实施：Plugin 工具执行成功回执最小披露

## 本批目标

关闭 `plugin:execute-tool` 对 sandbox 任意成功返回对象的透传，避免工具输出中的内容、路径、token、内部 metadata 或可执行描述直接跨 IPC。

## 实施结果

- 新增 `projectPluginToolExecutionReceipt`，成功执行只返回 `{ success: true, executed: true }`。
- 普通与生产 lazy handler 仍等待 sandbox `executeTool` 实际完成，但主动丢弃其任意返回值。
- 回执不包含 plugin/tool ID、参数、结果摘要或原始输出，避免把敏感值转换为无 tenant HMAC 的可枚举指纹。
- 失败路径继续使用既有固定错误 code/message，不改变失败边界。

## 回归与门禁

- 普通/lazy IPC 测试让 sandbox 返回包含 secret 的对象，确认调用发生且 IPC 结果仅为固定回执。
- 投影单测固定成功回执结构，防止后续重新增加 `result` 字段。
- 针对性回归：3 test files、30 tests passed。
- ESLint：0 errors。

## 未完成边界

- 本批不提供工具结果正文；若未来确需输出，必须先定义类型化结果或经治理的 opaque artifact 领取流程。
- 数据导入导出与运行时注册扩展的查询/执行成功 payload 仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
