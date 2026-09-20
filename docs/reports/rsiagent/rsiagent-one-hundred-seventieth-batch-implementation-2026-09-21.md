# 第一百七十次工程实施：LLM Core 身份、用途与字段授权

## 本批目标

为已完成成功字段投影的 LLM Core IPC 增加调用前授权，使回答、流式文本、模型目录、配置状态和 embedding 只能由实际 Desktop 主窗口的 main frame 在当前解锁 DID tenant 下按固定用途与字段范围访问。

## 实施结果

- 新增 `LlmCoreIpcAuthorization`，十个 Core 操作均具有固定 purpose 与冻结的输出字段集合；未知操作失败关闭。
- 每次请求必须同时命中实际主窗口 `webContents`、该窗口的 `mainFrame` 和现有 sender-origin guard。辅助窗口、subframe、foreign origin、缺失 frame 与伪 sender 均不能调用 Core。
- actor DID 与 tenant 只从主进程当前解锁 identity 获取；个人模式以 DID 作为 tenant，renderer 参数不参与身份或 tenant 绑定。
- 可选 purpose authority 在 manager、配置、模板、RAG、stream 或 embedding 业务方法之前接收 `{ actorDid, tenantId, senderId, operation, purpose, fields }`；拒绝、异常或非明确允许均返回固定 `CC_LLM_IPC_UNAUTHORIZED`。
- `llm-ipc` 生产注册链现从 Phase 1 注入 `didManager` 并组装授权器；测试只能通过显式注入的授权 stub 绕开真实窗口/identity 依赖。

## 回归与门禁

- 完整 LLM 回归：41 test files、592 tests passed、15 skipped。
- LLM IPC、治理连续性与 Phase 1 注册回归：3 test files、120 tests passed。
- 授权回归覆盖主窗口、DID tenant、个人 tenant、purpose/fields、辅助窗口、subframe、foreign origin、身份缺失、未知操作、policy 拒绝/异常和业务调用前失败关闭。
- Desktop 主进程构建通过。
- 相关 ESLint：0 errors（检查范围保留 25 条既有 `curly` warnings）。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- 当前生产未装配企业级 purpose policy；组织 RBAC、字段分级策略、身份切换中止与撤销传播仍需目标环境接线和验收。
- stream chunk 在授权后由主窗口发送；长请求期间的身份切换/窗口销毁竞态与 Electron renderer/preload E2E 尚未完成。
- Selector、stream controller、test-data、manager 方法和其他 LLM IPC 分组仍需各自的身份、用途与字段授权。
