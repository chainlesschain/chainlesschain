# 第一百八十七次工程实施：旧 Context Engineering IPC 生产退役

## 本批目标

关闭 Phase 1 中 17 个没有 preload/renderer 消费者的旧 Context Engineering handler。它们与 canonical Context/Memory App Server 并行存在，未验证 renderer/身份/用途，共享进程级配置、任务和错误历史，并可返回任务正文、错误文本、文件路径、URL、SQL 查询及任意压缩对象。

## 实施结果

- Phase 1 删除 `Context Engineering IPC` 的唯一生产注册块，注册项从 22 个无条件模块降为 21 个；启动过程不再加载或注册 `context-engineering:*`/`context:*` 这 17 个通道。
- `context-engineering-ipc.js` 删除 Electron、ipcGuard、logger、17 个 handler、注册/注销函数及模块级 IPC 状态，不再具有建立 renderer 边界的能力。
- 现有集成脚本仍需复用 ContextEngineering、RecoverableCompressor 和 TokenEstimator，因此原路径保留为无 Electron 副作用的本地 helper；明确只导出四个构造/获取接口。
- Phase 合同新增退役断言：注册名称中不得重新出现 `Context Engineering IPC`，旧模块不得重新导出 register/unregister，并锁定唯一允许的 helper 导出集合。
- 集成脚本的 “IPC Handler Tests” 已改名为 “Legacy Local Helper Tests”，避免把直接函数调用继续表述为已存在的 IPC 能力。
- 固定 preload capability 清单随生产注册点重新生成，删除残留的 `context:compress` 条目；未新增兼容通道或替代 channel。

## 回归与门禁

- Phase 与 Context Engineering 定向回归：2 test files、94 tests passed。
- Context Engineering 本地集成脚本：22 tests passed、0 failed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批证明旧 renderer IPC 不再可达，不代表底层 `ContextEngineering`、`RecoverableCompressor` 或 Manus 主进程内部调用已经按 actor/tenant 隔离。
- canonical App Server context plan/compact 的真实 Desktop transport、DID/RBAC、正文最小披露、恢复和身份切换 E2E 仍需按 Context/Memory 路线验收。
- 本地 helper 仍为诊断脚本保留；待脚本直接迁移到核心模块后，可删除名称中遗留的 `-ipc` 文件。
- 若未来确需恢复 UI，不得重新开放旧 channel；应从 canonical App Server 能力派生最小、经授权的 preload API。
