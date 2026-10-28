# CLI / IDE 差距优化第十批：Codex 多版本与重启恢复验证

日期：2026-10-28。承接[差距复核第 4.6 节](./cli-ide-codex-claude-gap-review-2026-10-27.md#46-外部-codex区分默认支持协议探针和生产准入)及[第九批兼容清单](./cli-ide-codex-compatibility-progress-2026-10-28.md)。第九批提交为 `55ca39571d`；本批实现与探针修正分别位于 `7380521c61`、`949ab64b75`。最终本地验证绑定准确源码提交 `949ab64b758b24155c0382c9dd34185b1110df84`，运行时工作区干净。

## 本批完成

- [兼容清单](../../packages/cli/src/lib/codex-app-server-support.js)新增 `0.164.0` 探针配置，保留 `.160`，从原来的单版本改为显式版本选择；未配置的版本在加载 schema 或启动进程前被拒绝。
- 从 npm 安装固定版本的官方 CLI 到临时目录，核对版本输出，实际运行 `app-server generate-json-schema`。保存[未经修改的 `.164` 原始 schema 及来源](../../packages/cli/__tests__/fixtures/external-agent/codex-app-server-0.164.0-provenance.json)，包含 npm integrity 及文件 SHA-256。
- [既有 turn 探针](../../packages/cli/scripts/codex-app-server-turn-probe.mjs)和[schema 核验](../../packages/cli/scripts/verify-codex-app-server-schema.mjs)新增 `--version`，默认保留 `0.160.0`。每个版本只使用自己的固定 schema，仍逐字节比对生成结果。
- 新增[历史恢复探针](../../packages/cli/scripts/codex-app-server-history-probe.mjs)，在独立配置目录和工作区内启动、关闭并重新启动原生 Codex App Server。
- [兼容工作流](../../.github/workflows/codex-app-server-compatibility.yml)为 `.160` / `.164` × Linux / Windows / macOS 生成 6 个 schema / turn / 重启单元，保留原有 12 个实验版本基础单元。两种探针均进入版本及准确提交绑定的制品目录。

两个新探针版本都没有进入实验允许列表。App Server 实验模块继续默认关闭，生产入口仍使用 `codex exec --json`，生产准入未改变。

## 重启旅程如何核对

1. 在进程 A 中创建两个持久线程，各完成一次本地模拟模型请求，保存线程及 turn 身份。
2. 关闭进程 A，观察实际退出；以同一隔离配置目录启动进程 B。
3. 用每页 1 项读取线程列表，按回执中的线程来源及原工作区、provider 过滤，核对两线程均出现且不重复。
4. 先读元数据，再恢复主线程，核对模型、provider、工作目录、审批策略和只读沙箱设置。读取和恢复期间，模拟服务请求数必须保持为 2。
5. 读取原 turn；继续主线程一次，检查发给模拟服务的输入同时保留原用户输入及原助手输出，且不含另一线程的内容。
6. 再按每页 1 项读取 turn 列表，核对旧 / 新两个 turn 的身份、顺序、终态和助手输出；模型请求总数必须恰好为 3。最后关闭进程 B。

分页读取设置了页数上限，拒绝重复游标、重复身份、空的非终止页及异常响应，避免把残缺历史解释成完整结果。[分页回归](../../packages/cli/__tests__/unit/codex-app-server-history-probe.test.js)覆盖这些边界。

模拟服务只监听 `127.0.0.1`，按固定顺序接受三个场景，拒绝额外请求、Authorization 及过大请求体。子进程使用独立 HOME / CODEX_HOME、只读沙箱和合成模型，不转发账户凭据。历史探针不处理工具审批；既有 turn 探针只允许取消确定性测试命令，检查该命令没有产生标记文件。

## 实测结果

环境：Windows x64、Node `22.22.2`；两个版本分别安装到独立临时目录。源码、schema、二进制和原始通知均由[本地验证回执](./cli/evidence/codex-0164-history-2026-10-28/verification.json)及对应报告绑定。

| 检查                                        | Codex `0.160.0` | Codex `0.164.0` |
| ------------------------------------------- | --------------- | --------------- |
| 生成的四份 schema 与固定 fixture 逐字节一致 | 通过            | 通过            |
| 多线程事件交错、完成 / 失败 / 中断终态      | 通过            | 通过            |
| 取消工具审批且命令未执行                    | 通过            | 通过            |
| 已接受任务后强制断流，exec 回退次数为 0     | 通过            | 通过            |
| 关闭进程后恢复线程及设置                    | 通过            | 通过            |
| 线程列表及 turn 列表均实际续读游标          | 通过            | 通过            |
| 恢复不重放，继续请求保留原上下文            | 通过            | 通过            |
| 另一线程的内容不进入恢复后的上下文          | 通过            | 通过            |

原始报告：

- `.160`：[turn](./cli/evidence/codex-0164-history-2026-10-28/0.160.0/turn.json)、[重启与分页](./cli/evidence/codex-0164-history-2026-10-28/0.160.0/history.json)。
- `.164`：[turn](./cli/evidence/codex-0164-history-2026-10-28/0.164.0/turn.json)、[重启与分页](./cli/evidence/codex-0164-history-2026-10-28/0.164.0/history.json)。

每版本包含 5 次 turn 场景请求及 3 次历史场景请求，合计 16 次本地模拟服务请求，外部模型请求为 0。turn 探针的强制断流按预期终止进程；历史探针的两个进程均以退出码 0 关闭。

首轮历史探针在提交 `7380521c61` 上失败：测试把 `sourceKinds` 固定为 `appServer`，而真实线程回执返回 `vscode`，导致列表为空。提交 `949ab64b75` 改为使用回执中的来源值后通过。两个版本的首轮失败报告及原始通知保留在各版本的 `initial-7380521c61/` 目录，未计入通过结果。

| 本地检查                                                 | 结果                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 兼容清单、适配器、schema、turn、历史分页及稳定外部适配器 | 6 个套件，84 项通过，无跳过；[原始测试报告](./cli/evidence/codex-0164-history-2026-10-28/unit-results.json) |
| 工作流与生成文档                                         | actionlint、Prettier、文档一致性及 `git diff --check` 通过                                                  |
| ESLint                                                   | 临时目录安装 `eslint@9.39.5`、`@eslint/js@9.39.5`、`globals@16.5.0`，以仓库配置的逐字节副本执行，通过       |

仓库自身的 ESLint 安装仍缺依赖；本批使用隔离工具完成规则检查，没有改动项目依赖或 lockfile。此项与第九批当时无法启动 ESLint 的记录分别保留。

## 复现与待验收范围

先将指定上游版本安装到源仓库之外的临时目录，保持源码工作区干净。以下命令在仓库根目录执行，替换路径、准确 SHA 及版本：

```bash
node /tmp/codex-install/node_modules/@openai/codex/bin/codex.js app-server generate-json-schema --out /tmp/codex-schema
node packages/cli/scripts/verify-codex-app-server-schema.mjs --schema-dir /tmp/codex-schema --version 0.164.0
node packages/cli/scripts/codex-app-server-turn-probe.mjs --version 0.164.0 --commit-sha <exact-sha> --codex-js /tmp/codex-install/node_modules/@openai/codex/bin/codex.js --output /tmp/codex-evidence/turn.json
node packages/cli/scripts/codex-app-server-history-probe.mjs --version 0.164.0 --commit-sha <exact-sha> --codex-js /tmp/codex-install/node_modules/@openai/codex/bin/codex.js --output /tmp/codex-evidence/history.json
```

本次实际执行的是 Windows 原生版本；上方路径写法便于在 Linux / macOS CI 中复现，不能当作这两个系统已经运行的证据。

尚需同一准确提交的 GitHub Actions 三系统完整矩阵。真实 provider、长历史压力、同时间戳线程及并发历史变更的分页边界、正式付费 / native 组合也继续独立验收。本批本地协议结果不足以扩大允许列表、生产支持或发行声明。

通过 OpenAI Docs 技能实际读取[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)，核对固定版本生成 schema、恢复及游标分页合同；`0.164.0` 同时核对了 npm 的精确版本及包 integrity。本批使用固定版本，没有重新宣布上游最新版本，也没有触发发行。
