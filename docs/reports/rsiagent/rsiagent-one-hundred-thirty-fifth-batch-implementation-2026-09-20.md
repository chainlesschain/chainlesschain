# 第一百三十五次工程实施：LLM Manager 日志与失败事件最小披露

## 本批目标

收敛 `llm-manager` 对 provider/model、prompt/message、token/成本、用户标识和 caught Error 的普通日志，并阻断 query/chat/stream 失败事件把原始输入及 Error 广播给监听器。

## 实施结果

- 新增 Manager 专用隐私边界，69 处诊断与失败事件调用只接受固定 component、白名单 event/operation。
- `llm-manager` 已删除直接通用 logger/console 及 `error.message` 读取；模型回退、压缩、预算、类别路由和标签/摘要流程不再记录动态业务值。
- `query-failed`、`chat-failed`、`chat-stream-failed`、`stream-failed` 只发送固定 code/component/operation receipt，不再包含 prompt、messages 或 Error。
- `checkStatus` 捕获异常时返回固定 unavailable message/code，不再回显客户端或网络错误文本。
- Provider fallback、authority 连续性、共享 tracker/cache 与 prompt compressor 行为保持现有合同。

## 回归与门禁

- Manager、category routing 与 governance 回归：4 test files、119 tests passed。
- 新增 Manager 源码门禁和白名单事件测试，未知动态 event/operation 固定降级为 `unknown`。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- Manager 的 provider/model/budget 等成功或策略事件仍按现有合同广播，直接方法 rejection 仍保留上游 Error 语义；renderer/其他调用方的最小披露尚未全部完成。
- Core/辅助 IPC 的成功 payload，以及 selector、context/session/memory/Manus 等其他 LLM 模块日志与错误通道仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
