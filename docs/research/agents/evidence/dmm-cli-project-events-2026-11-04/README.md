# DMM-07 桌面风险与动作事件订阅验证（2026-11-04）

实现独立原生授权的 v4 `goal.events` 连接、CLI 风险/动作事件观察器和 `goal-project-observer` 样例。本批基于 `main@5717128e51` 及同日上一批未提交的独立 CLI 状态订阅工作树；未发布或升级版本。

**12 个独立文件，204 项通过、0 失败、1 项既有 Windows 符号链接跳过**：[CLI/共享核心 134](./cli-tests.json)、[桌面主进程 64](./desktop-tests.json)、[Vue 6](./renderer-tests.json)。不与同日上一批或 2026-10-18 历史批次相加。源码/报告 SHA-256、命令和环境见 [汇总](./summary.json)。

从 `packages/cli` 运行：

```powershell
node node_modules/vitest/vitest.mjs run __tests__/unit/cli-project-goal-events.test.js __tests__/unit/cli-goal-events.test.js __tests__/unit/plugin-goal-extension.test.js __tests__/unit/cli-goal-evidence-host.test.js __tests__/unit/cli-goal-extension-host.test.js __tests__/unit/project-goal-evidence-reader.test.js __tests__/integration/cli-goal-events.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-cli-project-events-2026-11-04/cli-tests.json
```

从 `desktop-app-vue` 运行：

```powershell
node ../packages/cli/node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs src/main/task/__tests__/project-goal-cli-bridge.test.js src/main/task/__tests__/project-goal-ipc.test.js src/main/task/__tests__/project-goal-external-drafts-ipc.test.js src/main/task/__tests__/project-goal-auth-session.test.js --reporter=json --outputFile=../docs/research/agents/evidence/dmm-cli-project-events-2026-11-04/desktop-tests.json
node ../packages/cli/node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs src/renderer/components/projects/__tests__/project-goal-cli-connection-panel.test.ts --reporter=json --outputFile=../docs/research/agents/evidence/dmm-cli-project-events-2026-11-04/renderer-tests.json
```

真实边界：SQLite、Windows 私有 DACL、HMAC HTTP、SDK 准入和持久插件信任/同意。联调在真实 `query_only=ON` 下读取风险检查与动作回执，使用 `total_changes()` 证明未写库。真实 CLI 子进程通过 v4 凭据接收新风险事件，断连后报连接失效并退出；子进程只将安全存储位置重定向至临时目录。协议测试拒绝旧能力、跨路由/方法、重复 nonce、额外正文、错误目标/schema、畸形回执、超大/伪造响应，并取消已到达服务端的 HTTP 读取。

替身边界：Electron 窗口、原生对话框、认证上下文和 Vue UI 为替身；CLI 单元测试使用可控快照制造撤权、快照变化、回执倒退和在途取消。尚未运行真实 Electron/IDE GUI、独立业务成效或远端三平台发行矩阵。

本机环境：Node 22.22.2、Vitest 4.1.10。桌面初次在沙箱内运行因真实 ACL 校验失败，获准在沙箱外运行相同代码后通过；未削弱 ACL 校验。缺失的 Vue 测试依赖安装到 Windows Temp，桌面局部 junction 指向该依赖目录；仅重定位 Happy DOM 的 import hook 解决缓存 Vitest 的包解析。首次环境初始化未运行 Vue 用例；最终报告为成功执行的 6 项。未修改项目 dependency manifest/lockfile，正常完整依赖安装环境不需要该定位 hook。

命令清单、帮助及补全一致性、固定 renderer IPC 清单、Prettier 与差异检查通过。npm pack dry-run 核对事件客户端/宿主、样例、CLI 命令及帮助均进入包；没有发布制品。

当前语义为最新持久证据的有界轮询。观察时间不等于业务提交时间，最新一次风险检查及最近 20 条回执无法替代完整历史；512 次连接读取上限或 15 分钟 lease 可提前结束订阅。无持久游标、历史重放或恰好一次保证；IDE 事件界面及整体 DMM 验收仍需继续。
