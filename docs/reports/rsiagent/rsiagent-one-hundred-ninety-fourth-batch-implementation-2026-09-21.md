# 第一百九十四次工程实施：旧 Permanent Memory 维护与高级 IPC 退役

## 本批目标

缩小 Permanent Memory 主进程模块中没有产品消费者的旧表面。生产注册函数仍包含日期、文件 watcher 与 embedding cache 统计维护入口；同文件还导出一组从未接入生产注册表的高级搜索、分析和语义分块 IPC，均缺少 renderer sender、身份、用途和输入边界。

## 实施结果

- 删除没有 preload、renderer 或内部消费者的 `memory:get-today-date`、`memory:start-file-watcher`、`memory:stop-file-watcher` 和 `memory:get-embedding-cache-stats` 四个生产 handler。
- 删除从未被生产调用的高级 IPC 注册/注销函数及 15 个高级搜索、分层检索、分析仪表板和语义分块 handler 实现。
- `permanent-memory-ipc` 只导出仍有生产调用者的 `registerPermanentMemoryIPC` 与 `unregisterPermanentMemoryIPC`。
- 保留的 15 个 renderer 消费通道由精确集合测试锁定，避免已退役维护或高级入口被无意重新暴露。
- Phase 1 的 Permanent Memory handler 元数据从错误的 7 修正为实际的 15。
- 清理高级写入口删除后不再使用的 legacy writer fence import，并把剩余无使用 Electron event 参数标为显式忽略。

## 回归与门禁

- Permanent Memory/Phase 定向回归：2 test files、56 tests passed。
- Context Memory 回归：3 test files、10 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 保留的 15 个通道仍需在 canonical/legacy manager 访问前校验实际主窗口、main frame、可信 origin、当前 actor DID/tenant 与固定用途。
- Daily Note、MEMORY、搜索、会话提取与索引请求仍缺版本化输入 schema、严格字节/集合边界和 Proxy/accessor 拒绝。
- canonical adapter 的成功结果仍可能直接返回内部 record、receipt、正文和搜索对象，尚未完成字段级最小投影。
- 旧 renderer 仍同时存在 `safeIpcInvoke` 与直接 `window.electron.ipcRenderer.invoke` 调用方式，类型合同和失败回执尚未统一。
- 真实 Electron 多窗口、身份切换、canonical authority、记忆搜索和写入 E2E 仍待完成。
