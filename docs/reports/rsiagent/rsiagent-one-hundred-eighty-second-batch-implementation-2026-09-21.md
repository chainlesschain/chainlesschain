# 第一百八十二次工程实施：LLM State Bus 事件回执最小披露

## 本批目标

关闭 LLM State Bus 的通用 `dispatch()`、直接 `emit()` 和 `forwardFrom()` 会把来源任意 payload 原样广播给所有同事件订阅者，并把未知自定义事件名写入统计结果的缺口。

## 实施结果

- 七类标准状态事件统一投影为冻结的 `CC_LLM_STATE_EVENT` 回执，只包含固定 `code`、`component` 与白名单 `event`；provider/model、prompt、预算、暂停原因、时间戳、Error 和来源扩展字段不再跨订阅者传播。
- `emit()` 本身覆盖同一投影边界，调用方无法绕过 `dispatch()` 直接广播任意对象；`forwardFrom()` 继续保留既有桥接和解绑合同，但来源 payload 在进入总线时即被丢弃。
- 未知事件只收到固定 `unknown` 回执，dispatch 统计也只累计 `unknown`，不再把 tenant 自定义事件名变成可读取的动态键。
- 单会话失效仅保留缓存精确删除所需的 `sessionId`，要求 1–128 位受限字符；reason 与 timestamp 被删除。对象 getter、Proxy 异常、非 plain object 和越界/非法标识不会被展开或发布。
- 全局失效改为无业务 payload 的固定回执；现有 Session Manager 仍能清空全部缓存，单会话路径仍能按受限 ID 精确失效。

## 回归与门禁

- State Bus 与运行时隐私定向回归：2 test files、28 tests passed。
- 完整主 LLM 回归：46 test files、621 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- State Bus 是单进程全局单例，尚未按 tenant 建立独立实例或订阅作用域；本批通过删除业务 payload 降低跨订阅者披露，但生产多身份生命周期、身份切换撤销与 tenant HMAC 仍需接线。
- Session Manager 的缓存仍以裸 `sessionId` 索引，缺少 actor/tenant 复合键；真实 Electron 多窗口、多身份切换和缓存失效 E2E 尚未完成。
- Agent Orchestrator 与 Session Manager 自身的普通日志和二次公开事件不属于本批 State Bus 投影范围，仍需按其各自调用边界继续审计。
