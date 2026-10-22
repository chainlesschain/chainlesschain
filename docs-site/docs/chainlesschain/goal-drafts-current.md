# CLI / IDE 与桌面目标草稿互通

> 2026-10-23 发布更新：CLI **0.166.117** 已通过 [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/39845469661) 发布到 npm，并完成公共制品、签名来源和独立安装回读。修复 Python/JavaScript 代码字面量被 Evolution ingress 误判为损坏 JSON、异常退出时遗漏已完成工具轮次结算，以及图片与文本预算混算和长工具输出截断的问题。Session Core **0.3.22** 与 Personal Data Hub **0.4.66** 已先于 CLI 发布。安装命令：`npm i -g chainlesschain@0.166.117 --registry https://registry.npmjs.org`。Open VSX **0.37.159** 尚未验证公开下载；JetBrains **0.4.176** 尚未发布。两者推荐 CLI **0.166.117**。[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release117-public/publication.json)。本次未新增真实模型任务验收；下方历史发行记录与限制继续保留。

## 概述

<!-- release112-status -->

2026-10-22 ???npm CLI **0.166.112**?Open VSX **0.37.155** ? JetBrains Marketplace **0.4.172** ????????????????? IDE ????? CLI **0.166.112**?

CLI ????? `35a2508d156152a61d74fbf8135fcfa1225fe235`????? CLI CI **71** ? job ? Strict Sandbox **5** ??? job ???????? [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/39661868416) ????? tarball ???? npm provenance ????run ??????Session Core **0.3.21** ?? CLI ???

?? IDE ?? `ide-vscode-v0.37.155`?`ide-jetbrains-v0.4.172` ??? `ae27ef6dfc8cf1e45bf084030816b02c77dc2a34`?[Open VSX ??](https://github.com/chainlesschain/chainlesschain/actions/runs/39673804362)???[JetBrains ?? attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/39676899944/attempts/2) ?????? macOS 2024.2 ????????????????JetBrains ??? `approve=true`?`listed=true`?`hidden=false`??? IDE ?????????? CLI ???????[??????](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release112-public/publication.json)?

???????????????? Ollama ????????????????????????? **31/45**??? **26/36**??? **5/9**???? **14** ?????? .112 ??????**NOT_PAID_READY**?**NOT_ADMITTED** ????? **HOLD** ???Microsoft VS Code Marketplace ?????? VS Code ???????? Open VSX VSIX????? **v5.0.3.140** ????????????????????????

已公开 CLI 0.166.112 与 Session Core **0.3.21** 包含目标目录、授权插件面板、离线请求、在线待审草稿与回执代码。以下命令仍需对应桌面连接与授权；日常安装见[升级指南](./cli-ide-update-2026-10-20)。

## 核心特性

- CLI 文件目标独立保存；桌面连接只开放明确选择的项目目标。
- 摘要与历史证据连接只读，待审草稿连接需要单独授权。
- 可以导出请求文件后在桌面逐份采纳，也可以授权在线保存待审草稿。
- 采纳或“已保存”只表示进入待审队列；修改任务仍需原生预览与逐次确认。
- 结果未知时保留请求引用，查询原请求回执，避免重复提交。

## 系统架构

桌面保存项目、授权、草稿、转换与任务动作回执。CLI 和 IDE 通过桌面生成的临时本地连接访问指定目标。在线待审连接与原有只读连接相互独立；关闭连接、撤销来源授权和撤销单份采纳分别影响对应的能力与记录。

## 配置参考

目标草稿能力自 CLI **0.166.107** 起提供；当前公开推荐安装 CLI **0.166.112**，需要 Session Core **0.3.21** 及匹配的 IDE / 桌面构建，Node.js **22.12.0+**、npm **10.0.0+**。共享契约出口已随 npm 公开，桌面授权与原生确认仍是互通前提。

先在桌面登录当前项目所有者账号，打开项目目标与风险建议面板，选择目标并创建所需连接。插件必须已安装、可信且已获所需能力同意。参数中的目标、插件、安装范围和来源 ID 必须来自当前面板；`user`、`project`、`local` 是不同的安装范围。

## 使用示例

先确认命令可用，再选择目标。以下使用 PowerShell；大写示例值需替换为实际内容，命令不调用模型。

```powershell
cc goal --help
cc goal catalog --limit 20 --json
cc goal catalog --connection .\goal-connection.json --json
cc goal panels GOAL_ID --plugin PLUGIN_NAME --scope user --connection .\goal-connection.json --json
```

离线移交：准备 UTF-8 的 `description.txt`，从桌面复制当前风险建议 ID，导出到尚不存在的文件。

```powershell
cc goal draft-request GOAL_ID --connection .\goal-connection.json --plugin PLUGIN_NAME --scope user --source PROPOSAL_ID --request-id request-001 --title "任务说明建议" --description-file .\description.txt --out .\draft-request.json --json
```

在桌面的草稿导入面板选择 `draft-request.json`，核对完整正文和来源后采纳。然后打开已保存草稿，生成当前预览，核对差异并完成原生确认。导出文件、采纳和创建预览是不同步骤。

在线提交：先导出插件来源请求，在桌面逐项核对并单独授权待审草稿连接；使用桌面返回的 v3 连接文件。

```powershell
cc goal draft-access --plugin PLUGIN_NAME --scope user --out .\draft-access.json --json
cc goal draft-sources GOAL_ID --connection .\draft-connection.json --plugin PLUGIN_NAME --scope user --json
cc goal draft-send GOAL_ID --connection .\draft-connection.json --plugin PLUGIN_NAME --scope user --source PROPOSAL_ID --request-id request-002 --title "任务说明建议" --description-file .\description.txt --record .\submission.json --json
cc goal draft-receipt GOAL_ID --connection .\draft-connection.json --plugin PLUGIN_NAME --scope user --record .\submission.json --json
```

`draft-send` 在发送前保存 `submission.json`。出现 `unknown` 或断连时保留该文件，用最后一条命令查询；已有引用只查询，不自动重发。`not-found` 只表示查询当时未找到，不能据此删除引用重新发送。IDE 插件管理面板也提供对应目标、面板、文件导出和待审提交入口，仍需相同桌面授权。

## 性能指标

目标目录及在线来源每页最多扫描 **20** 个候选；使用返回游标继续读取。说明正文最多 **8192 UTF-8 字节**，离线请求信封最多 **16 KiB**。这些是边界限制；尚无真实 GUI 延迟、任务成功率或业务效果改善结论。

## 测试覆盖

已验证授权、撤权、幂等、冲突正文、断连回执恢复、SQLite 事务及打包出口。在线批次记录 **52 个独立文件、943 项通过、3 项 Windows 符号链接用例跳过**，与其他批次重叠，不累计求和。登录、窗口和部分界面使用替身，不能视为真实 Electron / IDE GUI 验收或公开版本准入。

## 安全考虑

请求文件和插件标签属于不可信输入，digest 不证明插件代码身份。不要共享连接文件；连接含访问凭据。撤销待审来源后旧草稿和未执行意图失效，已完成动作保留按权限可读的历史。原生确认仍由桌面当前身份完成，CLI 或插件不能代为批准。

## 故障排查

- 找不到新命令：先通过 `cc --version` 确认实际调用 CLI `0.166.112`，再用 Doctor 核对路径；IDE 和桌面连接需匹配相应构建。
- 没有可用面板：检查目标所属存储、插件安装范围、信任和能力同意；只读摘要授权不包含历史证据或待审写入。
- 已保存但不能继续：来源、目标版本或授权已变化，回到桌面重新读取当前风险建议；旧结果不能覆盖当前状态。
- 来源授权过期或已撤销：重新核对并由桌面显式授权，原连接不会自动获得新权限。
- 提交结果未知：保留原引用并查询回执。勿换 request ID 重发；勿把未找到等同于从未保存。

## 关键文件

`packages/cli/src/commands/goal.js` 定义命令；Session Core 的 `project-goal-external-drafts.js` 与 `project-goal-draft-imports.js` 保存在线和离线草稿；桌面 `project-goal-ipc.js` 及目标面板执行原生审核；两个 IDE 的插件管理器提供相同操作入口。

## 相关文档

参见[项目目标与独立验收](./project-goals-current)、[组织项目](./organization-project-current)、[当前升级指南](./cli-ide-update-2026-10-20)和[本轮设计](/design/release-runtime-update-2026-10-20)。
