# 第一百九十五次工程实施：旧 Hooks Renderer IPC 生产退役

## 本批目标

退役没有生产 renderer 消费者的旧 Hooks IPC，同时保留 Plan Mode、Markdown Skills 与其他主进程组件依赖的内部 HookSystem。旧表面注册 13 个 handler，并把 hook 注册、状态和执行 payload 广播到所有窗口；固定 preload 实际只开放其中 4 个通道，renderer 代码没有调用者。

## 实施结果

- Phase 1 删除 Hooks IPC 注册，改为直接初始化内部 `HookSystem`，继续将同一实例传给 Plan Mode 与 Markdown Skills 并由 phase 返回。
- 删除 `hooks:list/get/stats/event-types/set-enabled/set-global-enabled/is-enabled/register/unregister/trigger/reload/cancel/cancel-all` 13 个 renderer handler 及专用 IPC 模块。
- 删除向全部 BrowserWindow 转发 registered、unregistered、status、execution 与 error payload 的 renderer 事件桥。
- 固定 preload capability 删除 `hooks:list`、`hooks:register`、`hooks:unregister`、`hooks:trigger`，精确通道数从 1,226 降为 1,222；renderer Hooks 通道类型和主进程旧 registrar 声明同步删除。
- Phase 1 无条件注册模块数从 17 降为 16，并新增合同验证内部 HookSystem 保留、renderer Hooks IPC 不再注册。
- API tester 的 IPC stub 生成回归改用仍在生产的 Logger IPC 样例，内置技能文档同步更新。
- Hooks 声明中的泛型 `Function` 替换为明确的 `HookMiddlewareHandler`，相关 ESLint 恢复为零警告。

## 回归与门禁

- Phase/preload/API tester 定向回归：3 test files、313 tests passed。
- Hooks 核心回归：7 test files、301 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,222 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 产品尚无替代的 Hook 管理 UI；未来如需 authoring ingress，应接入签名 deployment、candidate gate、actor/tenant/用途授权和严格输入 schema，而非恢复通用 IPC。
- 内部 HookSystem 的事件 payload、失败诊断、取消语义和多租户 owner 传播仍需继续审计。
- Hook 候选的生产 operator policy、独立 Eval/Review/Promotion authority、撤销传播与耐久审计仍需目标环境验收。
- 真实 Electron、签名 Hook 发布、Plan Mode/Skills 消费和隔离执行 E2E 仍待完成。
