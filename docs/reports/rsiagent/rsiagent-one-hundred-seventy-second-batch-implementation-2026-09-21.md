# 第一百七十二次工程实施：LLM Manager 事件回执最小披露

## 本批目标

关闭 `llm-manager` 成功和状态事件向任意 EventEmitter 订阅方广播 provider/model、prompt/messages、模型结果、预算明细、用户标识和上游扩展字段的缺口，同时保留状态失效与服务暂停所需的事件语义。

## 实施结果

- Manager 隐私边界新增公开事件白名单，11 类事件统一返回冻结的 `CC_LLM_MANAGER_EVENT` / component / event 回执；未知事件固定降级为 `unknown`。
- initialized/unavailable/provider-changed、query/chat/stream completed、budget-alert、service-paused/resumed 和 model-switched 不再携带原始 status、provider/model、prompt/messages/result、alert 或 userId。
- 受治理 chat 的延迟发布槽只保留布尔完成状态，不再在闭包中暂存完整 messages/result；非治理 chat 与函数工作流也使用相同固定完成回执。
- State Bus 的生产订阅方只依赖事件发生来失效缓存、清理执行或切换暂停状态，因此固定回执保留了现有控制语义；Manager 源码门禁逐类核对所有敏感事件调用均经过固定投影。

## 回归与门禁

- Manager、State Bus 与治理回归：4 test files、108 tests passed。
- 完整主 LLM 回归：41 test files、596 tests passed、15 skipped。
- 相关 ESLint：0 errors、18 条既有 `curly` warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 核心 Stream Controller 与辅助流桥接的事件/成功投影后续已由第一百七十三批收口；旧 `stream-controller-ipc.js`、test-data、selector 以及其他 LLM 模块的成功 payload、业务事件和订阅授权仍待处理。
- LLM State Bus 的通用 `dispatch`、session/global invalidation payload 和各订阅模块自己的二次广播不在本批结论内。
- 企业 purpose/RBAC、身份切换中止与撤销、真实 Electron renderer/preload/provider E2E、tenant HMAC 和生产日志访问治理仍需目标环境验收。
