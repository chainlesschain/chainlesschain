# 第一百八十八次工程实施：旧 Message Aggregator IPC 生产退役

## 本批目标

关闭 Phase 1 中 10 个没有 preload/renderer 消费者的旧 Message Aggregator handler。该通用入口允许 renderer 提供任意事件名与任意消息正文，将数据转发到窗口，并能读取共享队列元数据、刷新或销毁全局实例、修改批次配置及改绑焦点窗口。

## 实施结果

- Phase 1 删除 `Message Aggregator IPC` 的唯一生产注册块，无条件注册项从 21 个降为 20 个；启动过程不再加载或注册 10 个 `aggregator:*` 通道。
- 删除专用 `message-aggregator-ipc.js`，消除未授权的 renderer 通用消息写入、全局队列控制、配置和窗口生命周期边界。
- 保留内部 `message-aggregator.js`。项目任务规划仍通过直接主进程调用，将固定的 `task:progress-update` 事件批量发送到既定 `mainWindow`。
- Phase 合同新增退役断言：注册名称不得重新出现 `Message Aggregator IPC`，并锁定内部聚合器仅导出实例、单例获取和销毁接口，不得重新导出 IPC 注册函数。
- 固定 preload capability 清单中不存在 `aggregator:*` 通道，因此无需兼容或替代 renderer channel。

## 回归与门禁

- Phase 与 Message Aggregator 定向回归：2 test files、62 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批关闭通用 renderer IPC，不代表使用内部聚合器的项目规划入口已经完成 actor/tenant 授权。
- 内部固定事件的 progress payload 仍需结合项目任务边界审计并验证最小披露。
- 全局聚合器仍以单例存在，窗口销毁、切换及并行项目隔离需要真实 Electron E2E 验证。
