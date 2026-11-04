# DMM-07 持久事件游标与 CLI 重放验证（2026-11-04）

本批加入原生事务事件账本、独立 v5 历史授权和 `goal replay --checkpoint`。基线 `main@5717128e51` 加同日已有未提交工作树；保留 v4 最新快照及 IDE 观察行为，未提升版本或发布。

**19 个独立文件，399 项通过、0 失败、0 跳过**：[CLI/共享核心 336](./cli-tests.json)、[桌面 56](./desktop-tests.json)、[Vue 7](./renderer-tests.json)。不与此前批次相加。源码、报告与隔离包指纹见 [汇总](./summary.json)。

从 `packages/cli` 运行：

```powershell
node node_modules/vitest/vitest.mjs run __tests__/unit/project-goal-event-journal.test.js __tests__/unit/cli-goal-event-history.test.js __tests__/unit/project-goal-workflow.test.js __tests__/unit/project-goal-monitoring.test.js __tests__/unit/project-goal-evidence-reader.test.js __tests__/unit/project-goal-completion.test.js __tests__/unit/goal-usage-ledger.test.js __tests__/unit/project-goal-notifications.test.js __tests__/unit/plugin-goal-extension.test.js __tests__/unit/cli-project-goal-events.test.js __tests__/unit/cli-goal-events.test.js __tests__/integration/project-goal-process-recovery.test.js __tests__/integration/project-goal-workflow-process-recovery.test.js __tests__/integration/goal-extension-conversion-process.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-goal-event-replay-2026-11-04/cli-tests.json
```

从 `desktop-app-vue` 运行：

```powershell
node ../packages/cli/node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs src/main/task/__tests__/project-goal-event-history-ipc.test.js src/main/task/__tests__/project-goal-cli-bridge.test.js src/main/task/__tests__/project-goal-workflow-ipc.test.js src/main/task/__tests__/project-goal-external-drafts-ipc.test.js --reporter=json --outputFile=../docs/research/agents/evidence/dmm-goal-event-replay-2026-11-04/desktop-tests.json
node ../packages/cli/node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs src/renderer/components/projects/__tests__/project-goal-cli-connection-panel.test.ts --reporter=json --outputFile=../docs/research/agents/evidence/dmm-goal-event-replay-2026-11-04/renderer-tests.json
```

真实边界：原生 SQLite immediate 事务、query_only 与 total_changes、持久 HMAC 游标、Windows 私有 DACL、签名 HTTP 和真实 CLI 插件安装/信任/同意。风险、运行中及终态事件在对应业务事务保存；测试注入事件保存失败并独立查询实际任务/检查表，验证回滚。直接 journal 存储夹具验证保留窗口、去重身份、UTF-8 页面预算、删头/删行/篡改、跨目标/版本和旧库回退；这些存储夹具不当作真实业务样本。

崩溃旅程运行真实 CLI。仅重定位安全状态文件，并在输出回调后、检查点提交前的第三次原生读取设置持有进程的测试屏障。父进程独立确认已输出 20 条及原检查点 after 仍为 null，再强制终止存活子进程；重启 CLI 后输出相同事件 ID，成功推进检查点，再取剩余 5 条。屏障不参与生产逻辑；这是至少一次重放，不证明下游消费或恰好一次。

替身边界：Electron 窗口/原生确认/认证上下文和 Vue 环境为替身；CLI 单元测试使用可控授权源制造撤权、输出失败及检查点 CAS 冲突。主进程测试在获准的沙箱外运行真实 DACL；Vue 沿用同日 Temp 依赖与仅重定位 Happy DOM 的 import hook，未修改依赖清单/锁文件。最初新增测试使用了错误的 proposal 查询方法及未考虑领域错误包装，修正测试调用与预期后最终报告如上。

隔离包检查：真实 `npm pack --ignore-scripts` 生成 Session Core 与 CLI 本地归档。Session Core 在独立目录验证公共 export map、CJS/ESM helpers、真实风险事件写入和只读恢复，native SQLite 驱动由宿主提供；CLI 核对新实现、命令和帮助字节。GNU tar 初次将 Windows 盘符当作远端目标，改用 Windows System32 tar 后提取成功。包检查独立记录，不增加 399 项计数；未做 registry 安装或发布。

历史仅覆盖新代码接入账本的原生事务，保留最近 1000 条、每页最多 20 条并受 16 KiB 预算限制；旧客户端或其他执行域没有自动补录。游标不是权限，保留缺口或数据库回退不静默重置；变更身份/目标版本/插件声明须显式新检查点。IDE 历史恢复 UI、真实 Electron/IDE GUI、Linux/macOS 宿主、业务成效及准确候选提交的远端发行矩阵未运行。发行继续要求子包→CLI→IDE→移动/PC、OIDC 和全配置平台准确提交门禁。
