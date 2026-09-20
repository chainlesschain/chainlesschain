# 第一百九十六次工程实施：旧 Plan Mode Renderer IPC 生产退役

## 本批目标

退役没有生产 renderer 消费者的旧 Plan Mode IPC，同时保留 coding-agent 权限门使用的内部 `PlanModeManager`。旧模块实际注册 15 个 handler，可直接改变和审批全局计划、读取历史与统计，并允许 renderer 在执行请求中提供 executor；固定 preload 只开放其中 5 个通道，renderer 代码没有调用者。

## 实施结果

- Phase 1 删除 Plan Mode IPC 注册，内部 `PlanModeManager` 改为直接初始化并幂等绑定共享 `HookSystem`。
- 删除 `plan-mode:enter/exit/get-state/get-current-plan/add-item/remove-item/mark-ready/approve/reject/execute/get-history/get-plan/get-stats/is-tool-allowed/get-summary` 15 个 renderer handler 及专用模块。
- 固定 preload capability 删除 `plan-mode:enter`、`plan-mode:exit`、`plan-mode:get-plan`、`plan-mode:approve`、`plan-mode:reject`，精确通道数从 1,222 降为 1,217。
- renderer `PlanModeChannel` 类型同步删除，避免类型系统继续宣称已退役入口可用。
- Phase 1 无条件注册模块数从 16 降为 15，并新增合同验证 manager 仍持有同一内部 HookSystem、renderer Plan Mode IPC 不再注册。
- coding-agent 自身的 plan mode 权限门和会话级入口不受影响，并由定向回归验证。

## 回归与门禁

- Phase/preload 定向回归：2 test files、60 tests passed。
- Plan Mode/coding-agent 权限门回归：2 test files、62 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 内部 `PlanModeManager` 仍是进程级单例，计划状态、历史和统计尚未按 actor/tenant/session 隔离。
- coding-agent 计划入口仍需继续审计 sender、身份、用途、输入 schema 与审批主体绑定。
- 计划审批、执行与工具 guard 尚未统一接入签名 deployment、operator policy、耐久审计和撤销传播。
- Plan Mode 状态没有生产级持久化、崩溃恢复或多窗口一致性合同。
- 真实 Electron、身份切换、计划审批、工具阻断与执行 E2E 仍待完成。
