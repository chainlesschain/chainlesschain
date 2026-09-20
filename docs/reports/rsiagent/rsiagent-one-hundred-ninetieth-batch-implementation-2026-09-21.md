# 第一百九十次工程实施：旧 Resource Monitor IPC 生产退役

## 本批目标

关闭 Phase 1 中 13 个没有 preload/renderer 消费者的旧 Resource Monitor handler。该入口允许 renderer 读取系统与进程内存、磁盘信息和降级策略，提供任意目录执行磁盘检查，修改共享阈值与监控周期、触发 GC，并将资源状态广播到窗口。

## 实施结果

- Phase 1 删除 `Resource Monitor IPC` 的唯一生产注册块，无条件注册项从 19 个降为 18 个；启动过程不再加载或注册 13 个 `resource:*` 通道。
- 删除专用 `resource-monitor-ipc.js`，消除未授权的 renderer 系统信息读取、任意路径探测和全局资源控制边界。
- 保留内部 `resource-monitor.js`。图片处理与存储代码继续直接调用资源等级、降级策略和磁盘空间能力。
- Phase 合同新增退役断言：注册名称不得重新出现 `Resource Monitor IPC`，内部模块不得导出 IPC 注册函数，并锁定核心导出集合。
- 删除核心模块未使用的 `fs.promises` 导入，使相关静态检查无告警。
- 固定 preload capability 清单中不存在这些 `resource:*` 通道，因此无需兼容或替代 renderer channel。

## 回归与门禁

- Phase 与资源边界定向回归：2 test files、84 tests passed、1 skipped。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批关闭通用 renderer IPC，不代表内部磁盘检查的路径已经限制在受管目录。
- `resource-monitor.js` 仍使用进程级单例，跨 actor/tenant 的阈值和状态隔离尚未建立。
- 核心动态日志、Windows `wmic`/Unix `df` 行为与真实平台资源降级仍需进一步治理和 E2E 验证。
