# 第一百八十九次工程实施：旧 Progress Emitter IPC 生产退役

## 本批目标

关闭 Phase 1 中 12 个没有 preload/renderer 消费者的旧 Progress Emitter handler。该入口允许 renderer 创建、枚举、修改、完成、失败、取消、移除或清空共享进度任务，并可读取标题、描述、消息、metadata、错误、父子任务和精确时间。

## 实施结果

- Phase 1 删除 `Progress Emitter IPC` 的唯一生产注册块，无条件注册项从 20 个降为 19 个；启动过程不再加载或注册 12 个 `progress:*` 通道。
- 删除专用 `progress-emitter-ipc.js`，消除未授权的 renderer 共享任务控制与任务正文读取边界。
- 删除只验证已退役 IPC 表面的 `progress-emitter-ipc-bounds.test.js`；核心引擎的容量、ID/result 大小、终态清理、父子任务、节流和窗口转发测试继续保留。
- 工作流、视频和图片模块继续直接使用内部 `progress-emitter.js`，无需建立 renderer 通用写入口。
- Phase 合同新增退役断言：注册名称不得重新出现 `Progress Emitter IPC`，内部模块不得导出 IPC 注册函数，并锁定核心静态导出集合。
- 固定 preload capability 清单中不存在这些 `progress:*` 通道，因此无需兼容或替代 renderer channel。

## 回归与门禁

- Phase 与 Progress Emitter 核心定向回归：2 test files、71 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批关闭通用 renderer IPC，不代表工作流、视频和图片等内部调用已经传播 actor/tenant owner。
- 核心进度事件的标题、消息、metadata、result 和 error payload 仍需按实际消费者审计最小披露。
- 全局/模块级实例与窗口转发仍需真实 Electron 生命周期和并发任务 E2E 验证。
