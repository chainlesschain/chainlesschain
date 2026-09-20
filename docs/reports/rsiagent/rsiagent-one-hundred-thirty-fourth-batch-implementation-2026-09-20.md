# 第一百三十四次工程实施：LLM 辅助 IPC 失败最小披露

## 本批目标

收敛 LLM 聚合注册器及 alert、budgets、retention、stream、test-data、token 六个辅助 IPC 分组的日志与失败通道，阻断数据库内容、用户/模型标识、stream 异常和原始 Error 返回 renderer 或进入普通 sink。

## 实施结果

- 29 个辅助 IPC 操作统一使用 `CC_LLM_IPC_OPERATION_FAILED`，只保留固定 message/code/component/operation。
- 七个模块已删除直接通用 logger/console、原样 caught-error rethrow 与 `error.message` 读取。
- 读取型 alert/budget/retention 失败仍保持原有空数组/null fallback，但日志只经过固定隐私边界。
- 损坏的 alert JSON 列、聚合注册、数据清理、服务暂停/恢复与测试数据生成仅记录白名单事件，不携带动态业务值。
- `llm:stream-error` 事件只返回 controller receipt、固定 message/code，不再展开 controller 发出的任意错误对象。

## 回归与门禁

- LLM IPC、governance、Core/Selector/辅助分组隐私回归：5 test files、84 tests passed。
- Hostile Proxy Error 覆盖数据库、token tracker、cache、manager 与 stream 边界；源码门禁覆盖七个模块及全部静态事件名。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- 辅助分组的成功数据库行、统计、成本、stream chunk/complete 等 payload 仍按现有 UI 合同返回，尚未完成字段级 renderer 授权与最小披露。
- `llm-manager`、selector 业务实现、context/session/memory/Manus 等其他 LLM 模块和 renderer 日志仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
