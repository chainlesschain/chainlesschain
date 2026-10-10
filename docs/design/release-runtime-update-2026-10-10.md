# CLI / IDE 发行与 Windows 取证设计增量（2026-10-10）

## 核对范围与发行身份

2026-10-10 公开回读：CLI **0.166.96**、Agent SDK **0.2.14**、Open VSX **0.37.140**、JetBrains **0.4.158** 已公开，两个 IDE 均推荐 CLI `0.166.96`，准确发行提交 `da91e730d8`。Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64** 保持独立版本；产品 **v5.0.3.140** 仍来自 `f733f92cb9`。源码核对至 `main@2650447476`。本轮改善并发权限设置、JetBrains 审批卡片布局与失败诊断，补齐 Windows 私有工具链和清理取证；正式 36+9 评测保持 NOT_RUN，完整 native review 保持 NOT_ADMITTED，自动晋升 HOLD。

本页按 Git 增量 `1e5477aebe..2650447476` 核对，合并记录为 [PR #425](https://github.com/chainlesschain/chainlesschain/pull/425)。已发行源码与文档核对主线分别记录；SDK 的本轮变化为测试启动诊断及签名源码身份，生成运行时输出未变。

| 制品                               | 公开版本                | 身份与配对                                            |
| ---------------------------------- | ----------------------- | ----------------------------------------------------- |
| npm CLI                            | 0.166.96                | `v-npm-0-166-96` → `da91e730d8`                       |
| Agent SDK / Python SDK             | 0.2.14 / 0.2.9          | JavaScript SDK 先于 CLI 经既有 OIDC 发布；Python 独立 |
| Open VSX                           | 0.37.140                | 同一发行提交；推荐 CLI 0.166.96                       |
| JetBrains Marketplace              | 0.4.158                 | 已批准、公开列出且可下载；推荐 CLI 0.166.96           |
| Session Core / Memory Kernel / PDH | 0.3.18 / 0.1.8 / 0.4.64 | CLI 使用精确依赖，先核对公开子包                      |
| 桌面 / Android / iOS               | v5.0.3.140              | 独立产品提交 `f733f92cb9` 与独立安装制品              |

历史 `.95` 的 OIDC 在 SDK 完整源码树复用检查处停止，CLI 未发布。测试诊断虽然没有改变 tarball 运行时输出，仍改变 SDK Git 子树，因此升级 SDK 至 `0.2.14` 后重新执行全部准确提交门。保留失败标签和原件，发行顺序为子包 → CLI → IDE。

## 并发设置与锁的生命周期

`settings-loader.cjs` 的 `addRule` 常规同步文件锁路径（未注入 `settingsAuthority`）在成功释放后让出 32ms 的竞争窗口，使用 5ms 起始退避、25ms 退避基值上限，另加至多 5ms 抖动。注入 authority 时走独立的 `mutateSettingsPermissionSource` 分支，不使用这组参数。原有两秒获取截止、原子发布、严格 owner 身份及同步权限撤销继续生效。

`with-file-lock.js` 发现现存锁时减少候选目录的反复创建/删除。释放过程中只有共享错误后、尚未发布 release marker 的同一目录和 owner 才可在原截止内重试，最多三次；目录替换、身份不可读或所有权丢失均失败闭合。此重试不能将未知写入状态解释为成功。用户遇到竞争应等待现有写者结束后重试，不能删除活跃锁。

## JetBrains 审批卡片与宿主诊断

新增 `ChatCardsLayout.refresh`：审批卡片变化时同时重新校验 cards 与 JScrollPane 外层分配高度的容器，并 repaint，避免滚动视图校验停在 validate root 后卡片没有获得可见高度。变化覆盖 `ConversationView` 的卡片添加、移除和恢复路径。

`UiEventDiagnostics` 及 UI 失败采集保留实际组件、布局与菜单派发信息。测试将弹窗 Enter 收据绑定到选定动作，并用稳定 frame/rootpane 读取调用标量收据；这是测试取证，不授予 UI 命令执行权限。升级后需重启宿主并用 Doctor 核对实际 CLI 路径与版本。VS Code 本轮主要同步配对版本和 vendored SDK 源码标记；既有交互能力继续由 CLI 权威状态控制。

## Windows 工具链与进程清理证据

当前源码补齐冻结工具链准备、私有 esbuild leaf、Windows Node runtime 胶囊、worker 终止身份、Job 安全约束、custodian crash 和清理恢复诊断。`windows-native-evaluator.js` 绑定源码、运行时、胶囊与清理 settlement；`windows-sandbox.cs` 增加对应原生诊断，helper EXE/DLL 同步生成。`scripts/windows-node-private-v4-result.mjs` 核对 worker 终止调用与身份，拒绝包括 `terminationCallError` 不为零在内的不一致证据。

私有诊断与真实失败原件用于定位问题，不能自动成为持久任务恢复或完整 native review 的生产准入。Linux `cc agent process-ownership recover` 仍只核对并清理旧 cgroup，不恢复原任务；Windows/macOS durable authority、受保护 journal、服务自身恢复及 WFP 仍待验收。

## 上游模型目录审查

`model-catalog-review.js` 将上游版本身份绑定官方稳定 Codex CLI release JSON，拒绝 draft、prerelease、无效 tag 或不匹配官方 `html_url` 的 JSON；仍兼容具有明确 `Codex CLI x.y.z` 标题的 HTML 快照。`scripts/review-model-catalog.mjs` 保留有界上游字节和成功/漂移/解析失败报告。模块还核对本地能力与费率目录；漂移要求人工审查，不会自动启用模型。实际模型性能、账号可用性与费用需各自证据。

## 发布门与验收边界

准确发行提交 `da91e730d802b7c9dcdc075b222ecc257021e552` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166593) 为 71/71，[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166296) 为 5/5；[IDE 宿主门](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166401) 为 18 成功、1 非标签后验证条件跳过，[ARM64 宿主门](https://github.com/chainlesschain/chainlesschain/actions/runs/38012166408) 为 10/10。随后 [npm OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/38019727506)、[Open VSX](https://github.com/chainlesschain/chainlesschain/actions/runs/38021103046) 与 [JetBrains](https://github.com/chainlesschain/chainlesschain/actions/runs/38021102825) 发布完成。条件跳过不计为通过。

原归档 JetBrains `pending` 是审批前的历史快照；本轮追加公开 API/制品回读，保留历史字节。源码合并后的文档头曾出现非必需 Windows Scheduler smoke lease-loss 失败，根因未确认，lease guard 阻止了效果创建；准确发行提交的通过记录不覆盖这一后续失败。

| 验收对象                                       | 当前状态                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| 精确发行门、公开包、IDE 配对                   | 本轮已回读；计数继承原 Actions，文档任务没有重跑产品矩阵      |
| 正式 36 tasks + 9 firstRuns、$99、observations | NOT_RUN                                                       |
| 冻结 Windows 反例矩阵                          | 211 = 194 pass / 16 fail / 1 skip；6 检出 / 4 存活 / 4 未运行 |
| 完整 native review                             | NOT_ADMITTED                                                  |
| RRSI 真实效果实验 / 自动晋升                   | NOT_RUN / HOLD                                                |
| 官方账单、独立人工/辅助技术、8h/24h/SLO        | 尚未完成                                                      |

## 关键文件与关联指南

- `packages/cli/src/lib/settings-loader.cjs`、`with-file-lock.js`、`model-catalog-review.js`。
- `packages/cli/src/lib/process-execution-broker/windows-native-evaluator.js`、`windows-sandbox.cs`。
- `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatCardsLayout.java`、`ConversationView.java`；`UiEventDiagnostics.java`。
- [发行证据原件](https://github.com/chainlesschain/chainlesschain/tree/73f5a3550d87db724f0c539223e671fd3ea6d1e1/docs/research/cli/evidence/gap-2026-10-05/release-0.166.96/final-release)。
- [本轮升级与故障排查](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-10.html)、[发布与升级](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)。
- [10 月 8 日设计快照](release-runtime-update-2026-10-08-latest.md)保留当时的版本与实验范围。
