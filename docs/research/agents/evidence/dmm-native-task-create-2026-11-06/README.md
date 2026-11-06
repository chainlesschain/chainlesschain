# DMM-08/09 内置创建任务草稿验证

日期：2026-11-06。基线 `09843429a4`，工作分支 `feature/dmm-native-task-create-20261106`；未提交源码与本地测试，未发布。

[格式、语法、相对文档链接及差异检查](./checks.json)单独记录；原研究报告和实施进度中指向发行回执的两个错误相对路径已修正。

最终 **14 个不重叠文件、298 项通过，0 失败、0 跳过**，不与历史批次或中间复测相加：

| 报告                               | 文件数 | 通过 | 范围                                                                        |
| ---------------------------------- | -----: | ---: | --------------------------------------------------------------------------- |
| [CLI/共享核心](./cli-tests.json)   |      9 |  191 | 提议合同、实际 SDK/原生队列、创建动作、工作流、原连接限制及真实进程退出恢复 |
| [桌面主进程](./desktop-tests.json) |      3 |   63 | 创建/说明独立授权、原生确认与回执、旧工作流和文件采纳兼容                   |
| [Vue 组件](./renderer-tests.json)  |      2 |   44 | 创建任务类型选择、未知请求身份、预览类型核对、父面板接线与显式执行          |

创建任务先要求目标允许 `task.create` 并有当前原生风险来源，再经独立原生同意保存待审草稿。说明草稿原有插件身份与授权摘要保留，创建草稿使用另一授权摘要及代次，两类授权、计数和分页互不替代。SDK 只向受信宿主提供待审入队，未开放执行口；任务类型绑定草稿、转换、原生意图与请求摘要。CLI 实际能力表、v3 在线连接、v1 文件采纳和可安装组合包仍只开放说明提议。

实际 SQLite 检查确认前无任务变更，确认后新增一条 pending 任务，原风险任务保持不变；撤权后的终态回执仍可读，重开和重试不再写入。真实 Node 子进程在转换提交、原生意图、预览、动作提交及等待确认处退出，沿原身份恢复；未解决结果保留 unresolved/unknown，不自动重发。进程退出不代表机器断电测试。

测试使用隔离临时目录和合成个人项目。Electron 窗口、登录上下文、原生确认结果及 Vue API 为测试替身，未启动真实产品 GUI。Windows 原生 ACL 兼容测试先因缺少 Koffi 和沙箱父目录访问限制失败；恢复依赖后，经工具批准在沙箱外运行同一组三个主进程测试文件，使用真实 ACL 校验并通过。未修改产品 ACL 实现或替换权限判断。

环境：Windows x64，Node 22.22.2、npm 10.9.7、Vitest 4.1.10、better-sqlite3 12.11.1、Koffi 2.16.3、Vue 3.5.40、Vite 7.3.6、Vue Test Utils 2.4.11、happy-dom 20.11.1。依赖恢复到本地忽略目录，不更改仓库清单或锁文件；精确命令与文件 SHA-256 见 [summary.json](./summary.json)。

从仓库根目录运行核心与子进程回归：

```powershell
npm.cmd --prefix packages/cli test -- __tests__/unit/project-goal-extension-queue.test.js __tests__/unit/plugin-goal-extension.test.js __tests__/unit/cli-goal-capabilities.test.js __tests__/unit/project-goal-workflow.test.js __tests__/unit/task-create-action-service.test.js __tests__/unit/project-goal-external-drafts.test.js __tests__/unit/project-goal-drafts-transport.test.js __tests__/unit/cli-goal-draft-request.test.js __tests__/integration/goal-extension-conversion-process.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-native-task-create-2026-11-06/cli-tests.json
```

在 `desktop-app-vue` 目录运行主进程及组件回归：

```powershell
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs src/main/task/__tests__/project-goal-delivery-drafts-ipc.test.js src/main/task/__tests__/project-goal-workflow-ipc.test.js src/main/task/__tests__/project-goal-draft-imports-ipc.test.js --reporter=json --outputFile=../docs/research/agents/evidence/dmm-native-task-create-2026-11-06/desktop-tests.json
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs src/renderer/components/projects/__tests__/project-goal-extension-drafts-panel.test.ts src/renderer/components/projects/__tests__/project-goal-actions-panel.test.ts --reporter=json --outputFile=../docs/research/agents/evidence/dmm-native-task-create-2026-11-06/renderer-tests.json
```

[本地制品检查](./artifacts.json)另计：`npm pack --ignore-scripts` 生成的 Session Core 包中，三个实现文件及 README 与工作树逐字节一致；解包目录无 node_modules，可加载 CJS/ESM 提议合同、队列及转换模块。[核验脚本](./verify-package.mjs)接受 tarball 和解包 package 目录两项参数。没有执行完整隔离依赖安装或公开发布，包名中的 0.3.25 沿用本地 package.json，不代表同名公开包包含本批改动。

CLI/IDE 组合包创建入口、模型自动起草、真实 Electron/IDE GUI、独立业务样本、Linux/macOS、准确提交远端 CI、灰度与迁移回退尚未运行。本批完成的是内置桌面创建草稿与恢复链路，不能将整个 DMM-08/09/10 标为完成。
