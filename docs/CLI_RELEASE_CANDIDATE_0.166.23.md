# CLI 0.166.23 发布候选

状态：发布准备，不是已发布版本，也不是全绿证明。用户于 2026-09-06 已授权推送候选、执行 CI，以及全部门禁通过后的子 npm 包、CLI 发布；IDE 插件也已授权，但必须在 CLI 发布并验证公开安装后再验收发布。

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
3. 按现有依赖顺序先发布 `core-db@0.1.5`、`session-core@0.3.12`。这两个子包先打包、发布同一 tarball，再从公开 npm 下载并逐字节比较；即使精确版本已存在而跳过 publish，也必须比较通过。
4. 在没有 monorepo workspace 链接的干净目录，安装候选 CLI tarball，让其依赖只从 registry 解析；验证 `--version`、`agent --capabilities`、关键子包出口和数据库参数绑定。子包尚未公开时，此项不能提前宣称通过。
5. 以上通过后才发布 CLI；公开安装回读成功后，再更新 IDE 推荐版本及配套更新说明，完成插件验收并发布。IDE 不随 npm tag 自动发布。

新增 `verify-cli-registry-install.mjs` 验证干净安装的实际内部依赖版本、物理路径、无 workspace 链接，以及 lockfile 的公开 npm URL 和 SHA-512 integrity。工作流在 CLI publish 前保存 `cli-public-child-install.json`，并验证 Agent capability JSON 和新的 Session Core 出口。CLI 本身在这一步仍是不可变候选 tarball，不能将其误称为 CLI 已公开安装。

## 第一轮候选 CI 与修复记录

候选 `e19dda1148051f71591ee795bf79e4d2cfbdc81d` 的 [Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/33997804805) 三平台及 Context Memory Kernel CI 已通过，但 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/33997802210) 失败，不具备发布资格。

- Windows 的多份测试临时路径使用 JS realpath，与 ArtifactStore 原生真实路径校验不一致；统一测试夹具的原生路径解析，保留生产安全校验。macOS 撤销进程用例也改用物理临时路径，避免 `/var` 别名。
- Session Core 实际打包测试改为核对源码版本和 CLI 精确依赖，新增实际 `evolvable-artifact` 文件/出口检查，不再硬编码旧版 `0.3.11`。
- 快照增长竞态测试绑定本次 checkpoint 的 witness digest，不再任取目录里的第一份历史快照。
- Target Matrix 的内存 Ledger 夹具采用真实 Ledger 的引用排序规则，避免随机 artifact locator 导致恢复结果漂移。
- Skill writer 清单更新 Desktop 已切换到品牌化治理宿主委托的源码证据；清单仍只证明其声明的直接扫描范围，不代表全程序无间接写入。
- Canary 子进程失败补充 stderr 诊断，需由回归测试继续确认原因。

本地原生路径定向回归有 48 通过、2 失败、1 平台跳过：两项完整剪枝恢复分别耗时 63,586ms、66,463ms，超过原有 60 秒要求。未提高阈值或忽略失败；后续验证必须保留此记录并确认修复后的实际结果。其后 7 文件修复验证为 96 通过、1 项既有 process-producer 专用条件跳过，包括 Target Matrix、完整 Ledger、发布合同、新安装检查器、清单、真实子包打包及 Canary 进程用例。新修复会产生新 SHA，不能使用上述旧候选的绿色 Strict 结果放行。

## 旧 GitHub 失败与本轮处理

旧提交 `93bd25a1f8c7b282e9a834c00de5349ab1a3a07b` 的红色任务不会因本地测试通过而自动消失，也不能代表新候选结果。

- `CLI CI` 的版本提示测试混淆了最低兼容版与推荐版：本候选已修正预期并补充两类版本行为覆盖；没有提前改变 IDE 推荐版本。
- 旧 `CLI CI` 另有 Windows 单元任务失败与 macOS 跨进程恢复失败，需以新候选的完整结果复核，尚不能宣称全部修复。
- 旧 `CLI Strict Sandbox` Windows worker 异常退出，报告不完整，仍待新候选复核。日志里的 `bad.js` SyntaxError 是负面测试的预期错误输出，不是该 workflow 的源码语法修复项。
- 用户提供的 [CI Tests / Full Test Suite](https://github.com/chainlesschain/chainlesschain/actions/runs/33935598327/job/101222792540) 有 14,713 通过、1 失败、417 跳过：`api-tester` 扫描器只匹配 `ipcMain.handle`，被测试的 Hooks IPC 已改用 `hostIpcMain.handle`，所以没有生成 `testCode`。此处已定位，尚未修复或重新验收，不与 CLI 子包缺失出口混为一谈。

不得将此候选描述为“全部 GitHub Actions bug 已修复”。最终 CI 结果以精确提交的实际 run/job 记录为准。
