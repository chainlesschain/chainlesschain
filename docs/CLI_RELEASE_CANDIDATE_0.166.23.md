# CLI 0.166.23 发布候选

状态：发布准备，不是已发布版本，也不是全绿证明。用户于 2026-09-06 授权独立候选分支推送 GitHub 和执行 CI；npm、IDE 发布及发布 tag 尚未授权。

## 候选边界

- 功能基线：`2f20f4defb4be613546815a696fc483046cdc4ee`。
- 发布分支：`release/cli-0.166.23`；原 `main` 工作区及其未完成的 candidate quarantine 改动保留，不纳入本候选。
- 候选版本：CLI `0.166.23`，Core DB `0.1.5`，Session Core `0.3.12`。2026-09-06 registry 完整版本列表确认这三个版本均未占用；正式发布前还须重新确认。
- CLI 后端变更见根目录 `CHANGELOG.md` 的 `cc CLI 0.166.23` 条目。IDE 推荐 CLI 仍保持已公开发布的 `0.166.22`；不提前改成未发布版本。
- Workbench 工厂和受治理持久化能力已实现，不等于用户部署已配置可信身份、权限、签名及真实宿主，不承诺升级即可消除 unavailable。

## 子 npm 包实际 payload 审计

2026-09-06 对基线的 13 个相关包（10 个 CLI 运行时依赖，以及发布配套的 Core Settlement、Agent SDK、Agent Protocol）逐一执行本地 `npm pack --ignore-scripts` 与 registry 精确版本下载。检查 registry tarball 的 SHA-512 integrity，安全解包后比较文件集合与文件内容；仅对有效 UTF-8 文本归一化 CRLF。Agent SDK 先由本候选源码实际完成 ESM/CJS 构建再打包，不使用旧工作区的 dist。

| 包（均为 `@chainlesschain/`） | 已发布版本 | 结论                                                |
| ----------------------------- | ---------- | --------------------------------------------------- |
| core-db                       | 0.1.4      | 必须先发 0.1.5：`lib/database-manager.js` 已变化    |
| session-core                  | 0.3.11     | 必须先发 0.3.12：新增文件及出口、两项运行时源码变化 |
| core-env                      | 0.1.2      | payload 一致，不重发                                |
| shared-logger                 | 0.1.1      | payload 一致，不重发                                |
| core-config                   | 0.1.2      | payload 一致，不重发                                |
| core-infra                    | 0.1.1      | payload 一致，不重发                                |
| core-mtc                      | 0.2.3      | payload 一致，不重发                                |
| core-multisig                 | 0.1.4      | payload 一致，不重发                                |
| core-settlement               | 0.1.2      | payload 一致，不重发                                |
| context-memory-kernel         | 0.1.0      | payload 一致，不重发                                |
| personal-data-hub             | 0.4.59     | payload 一致，不重发                                |
| agent-sdk                     | 0.2.8      | 重建后 payload 一致，不重发                         |
| agent-protocol                | 0.1.8      | payload 一致，不重发                                |

Core DB 差异是未带前缀的 SQL 命名参数规范化。Session Core 新增 `lib/evolvable-artifact.js` 及 `./evolvable-artifact` 出口，另有 `lib/index.js`、`lib/structured-evolution-memory.js` 更新。沿用旧版号会被发布工作流跳过，导致 public install 缺少所需实现，因此已同步升级包版本、CLI 精确依赖和相关 lockfile。

原始本地审计报告及 tarball 保留在执行机器的临时证据目录 `cc-child-payload-016623-zizqoq/report.json`。这是候选基线的审计记录；后续若再改子包源码，必须重新审计，不能沿用此表。

## 发布硬门禁与顺序

本轮候选工作区定向验证：Core DB 5 文件 85 通过、Session Core 26 文件 556 通过、CLI 发布合同与版本提示 3 文件 52 通过，合计 34 文件 693 通过，无失败或跳过。命令清单、help index、shell completions 校验通过，离线 changelog 已生成；`--version`、`agent --capabilities`、Workbench 帮助命令正常退出。这些是本地补充证据，不代替完整 CLI CI 或实际部署验收。

两个新版子包已打包并在独立临时目录安装，不含 workspace 链接，验证精确版本、`evolvable-artifact` 出口、结构化 Memory 模块和真实 sql.js 未带前缀命名参数读写通过。安装输入是本地候选 tarball；这不是“新版本已从公共 registry 安装成功”。CLI 当前打包检查也不是最终发布产物，正式工作流仍须构建 Web Panel 并生成不可变 tarball。

1. 将候选提交推送 GitHub，只执行 CI，不创建会触发发布的 tag。
2. 最终完全相同的 SHA 必须通过 `CLI CI` 和 `CLI Strict Sandbox` 全部已配置 Linux、Windows、macOS 检查。`CLI CI` 的三平台 `verify-cli` 已加入 Core DB 与 Session Core 的独立完整测试；失败或未执行均不可视为完成。
3. 获得正式 npm 发布授权后，按现有依赖顺序先发布 `core-db@0.1.5`、`session-core@0.3.12`，确认 registry 的精确版本、实际 tarball 与所需出口可用。
4. 在没有 monorepo workspace 链接的干净目录，安装候选 CLI tarball，让其依赖只从 registry 解析；验证 `--version`、`agent --capabilities`、关键子包出口和数据库参数绑定。子包尚未公开时，此项不能提前宣称通过。
5. 以上通过后才发布 CLI；公开安装回读成功后，再更新 IDE 推荐版本及配套更新说明，完成插件验收并另行发布。

## 旧 GitHub 失败与本轮处理

旧提交 `93bd25a1f8c7b282e9a834c00de5349ab1a3a07b` 的红色任务不会因本地测试通过而自动消失，也不能代表新候选结果。

- `CLI CI` 的版本提示测试混淆了最低兼容版与推荐版：本候选已修正预期并补充两类版本行为覆盖；没有提前改变 IDE 推荐版本。
- 旧 `CLI CI` 另有 Windows 单元任务失败与 macOS 跨进程恢复失败，需以新候选的完整结果复核，尚不能宣称全部修复。
- 旧 `CLI Strict Sandbox` Windows worker 异常退出，报告不完整，仍待新候选复核。日志里的 `bad.js` SyntaxError 是负面测试的预期错误输出，不是该 workflow 的源码语法修复项。
- 用户提供的 [CI Tests / Full Test Suite](https://github.com/chainlesschain/chainlesschain/actions/runs/33935598327/job/101222792540) 有 14,713 通过、1 失败、417 跳过：`api-tester` 扫描器只匹配 `ipcMain.handle`，被测试的 Hooks IPC 已改用 `hostIpcMain.handle`，所以没有生成 `testCode`。此处已定位，尚未修复或重新验收，不与 CLI 子包缺失出口混为一谈。

不得将此候选描述为“全部 GitHub Actions bug 已修复”。最终 CI 结果以精确提交的实际 run/job 记录为准。
