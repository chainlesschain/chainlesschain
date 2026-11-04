# DMM-07 独立 CLI 状态订阅验证（2026-11-04）

实现 `goal watch`、只读事件宿主及 `goal-status-observer` 声明样例。基线 `main@5717128e51`；本批为未提交工作树的本地验证，未发布或升级公开版本。

[测试报告](./cli-tests.json)：**6 个互不重叠文件，107 项通过、0 失败、3 项 Windows 跳过**。新增事件宿主 28 项、真实 CLI 子进程旅程 1 项；其余为既有 SDK、面板、目录与安装生命周期回归。跳过的是既有 POSIX 符号链接用例，不将其记为通过；不与历史批次数字相加。

命令从 `packages/cli` 运行，使用工作区已有 Vitest 与 Node 22.22.2：

```powershell
node node_modules/vitest/vitest.mjs run __tests__/unit/cli-goal-events.test.js __tests__/integration/cli-goal-events.test.js __tests__/unit/plugin-goal-extension.test.js __tests__/unit/cli-goal-extension-host.test.js __tests__/unit/cli-goal-catalog.test.js __tests__/integration/cli-goal-panels.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-cli-status-events-2026-11-04/cli-tests.json
```

真实文件、SDK、受信/持久同意和策略发现均参与测试；单元测试通过包装事件投影制造输出前撤权、变更和取消竞态。子进程旅程运行实际 CLI bin，真实安装、信任、授予事件能力、订阅、暂停目标及禁用插件；只将安全状态文件位置迁至临时目录。验证事件不包含目标正文、订阅不改写源文件、禁用后退出及原目标保留。

命令 manifest、帮助索引与 shell completions 一致性检查通过，相关文件 Prettier 和 `git diff --check` 通过。`npm pack --dry-run --ignore-scripts --json` 清单包含事件宿主、样例及命令实现；仅验证打包清单，没有生成发行制品或进行 registry 发布。命令、宿主、依赖版本及源码/报告 SHA-256 见 [汇总](./summary.json)。

范围限制：仅独立文件目标的有界状态轮询，时间为观察时间；不保证观察两轮间的所有变化，不提供持久游标或历史重放。未新增桌面事件权限、风险/动作事件源或 IDE 事件界面。未运行 Electron/IDE GUI、真实业务效果评测或准确候选提交的三平台远端发行门；DMM-07 及整体计划仍有未完成项。
