# 110. Agent Platform 0.166.9 发布与运行时边界设计

> 状态：2026-08-29 已发布并完成公共注册表回读
> 精确源码：`222396f6a8429d4b862292a2572067a5cacb1003`
> 不可变标签：`v-npm-0-166-9`、`ide-vscode-v0.37.73`、`ide-jetbrains-v0.4.104`
> 公共制品：CLI `0.166.9`、Agent Protocol `0.1.6`、TypeScript Agent SDK `0.2.5`、Python Agent SDK `0.2.6`、Open VSX `0.37.73`；JetBrains Marketplace 仍为 `0.4.103`

## 1. 目标

本设计记录 `0.166.8` 源码候选最终由 `0.166.9` 公开承接时的边界，重点解决四类容易被错误合并的问题：

1. Git tag、npm/PyPI/Open VSX/JetBrains 制品与 Desktop/native 资格证据必须分别判断；
2. Graph 历史、HumanTask、审批、Team 与消息恢复必须共享耐久 authority，但不能让 UI 投影成为 writer；
3. Record & Replay 必须从“假执行器测试”升级为真实浏览器执行，同时保持网络、文件与内容泄漏失败闭合；
4. 可选 Codex App Server 兼容层只能接纳精确验证过的上游 patch，未知版本必须在 turn admission 前回退。

## 2. 发布身份矩阵

| 表面                 | 源码/标签                                | 公共状态                        | 结论                      |
| -------------------- | ---------------------------------------- | ------------------------------- | ------------------------- |
| CLI                  | `v-npm-0-166-9` → `222396f6a8`           | npm `latest=0.166.9`            | 生产推荐                  |
| Agent Protocol       | 包版本 `0.1.6`                           | npm 已回读                      | 公开                      |
| TypeScript Agent SDK | 包版本 `0.2.5`，`gitHead=222396f6a8`     | npm 已回读                      | 公开                      |
| Python Agent SDK     | `python-agent-sdk-v0.2.6` → `d3c20b4233` | PyPI `0.2.6` 已回读             | 公开；`0.2.5` 未发布      |
| VS Code              | `ide-vscode-v0.37.73` → `222396f6a8`     | Open VSX `0.37.73` 已回读       | 公开                      |
| JetBrains            | `ide-jetbrains-v0.4.104` → `222396f6a8`  | Marketplace 最新 `0.4.103`      | `0.4.104` 仅源码/标签候选 |
| Desktop/native       | 同一仓库源码                             | exact-SHA 签名 Skill 资格门成功 | 不等于公共安装包发行      |

所有文档和 UI 必须以公共 registry/Marketplace 的实际回读为安装口径。Git tag 存在、构建成功或上传成功都不能单独推导“用户已经可以安装”。

## 3. 运行时变更分层

```text
Graph authority
  ├─ durable event/snapshot history
  ├─ definition migration + retirement evidence
  ├─ HumanTask quorum + single-winner settlement
  └─ Team fairness + temporal message custody

Execution adapters
  ├─ Playwright real UI replay (isolated, network denied)
  └─ optional Codex App Server adapter (exact-version allow-list)

Product projections
  ├─ Desktop / Web / Android / iOS approvals
  └─ VS Code / JetBrains review surfaces

Release evidence
  ├─ CLI CI + Strict Sandbox + npm provenance/readback
  ├─ real UI replay + network-escape probe
  ├─ Codex compatibility matrix + JSONL fallback
  └─ signed Desktop Skill qualification
```

上层投影只能消费带 revision、attempt、operation、lease/fence 或 evidence digest 的数据并提交决定，不能从按钮状态、Webview 缓存或本地时间重建 authority。

## 4. Graph 迁移、退役与历史

`0.166.9` 承接的 Graph Kernel 变化包含：

- 固定 App Server/SDK 客户端可读取有界、metadata-only 的 event/snapshot history，用于 blocked-root、revision diff 与 time travel；
- definition migration 写入 N-1 备份、旧/新 digest、rollback digest、replay validation 与 exact source evidence；
- runtime retirement 要求 replacement reachability、historical-read 成功与 legacy writer 零成功观察，不再接受 prose-only 声明；
- cutover journey 固定队列时钟，避免测试或迁移证据因多个 wall-clock 采样产生不可复现差异；
- HumanTask 在等待人工决定时释放 Agent capacity，决定绑定 exact revision/attempt/operation，支持 quorum、职责分离与 cancel/decision compare-and-swap。

退役后的 runtime 只保留显式只读历史。未分类入口或仍尝试 mutation 的 legacy route 必须返回 canonical replacement，而不是隐式双写或“兼容成功”。

## 5. 审批结算

审批决定在 Desktop、Web Panel、Android、iOS、VS Code 与 JetBrains 间遵循同一 envelope：

```text
request(binding, revision, attempt, operationDigest, grantScope)
  → one decision wins CAS
  → duplicate / stale / cross-turn decisions are rejected
  → settlement event is projected read-only to every surface
```

可复用 grant 只复用 CLI 请求明确提供的 capability、scope、binding 与有效期，不能由 UI 扩权。HumanTask quorum 还要求 participant eligibility 与 separation-of-duty；达到票数不代表任何未绑定的决定都可结算。

## 6. Team 公平性与消息可靠性

Team scheduler 将 dependency/scope aging、priority donation、critical-path boost 与公平性 SLO 一起纳入选择。测试必须证明：

- 低优先级但持续等待的可运行任务最终获得服务；
- scope 冲突不会把不相关任务长期饿死；
- early aging service 不因采样窗口边界误报；
- 调度结果仍受 capacity、lease/fence、budget 与 write scope 约束。

Session/Team 消息采用至少一次投递与显式 ACK/custody 状态。temporal reliability gate 覆盖超时、重排、重复、迟到 ACK、holder 失权与恢复；消息正文不进入健康度和发布证据。

## 7. 真实 UI 回放隔离

`playwright-ui-driver.js` 在临时 Chromium context 中执行已经过审阅的步骤：

- 仅允许 `observe`、`click`、`type`、`select`、`assert`；
- selector、页面身份、步骤顺序与 capability 必须与审阅稿一致；
- filesystem、HTTP(S)、WebSocket 和未声明导航默认拒绝；
- ambiguous target、环境漂移、缺少 terminal evidence 或网络逃逸立即失败；
- 执行结束回收 page、context、browser 与临时状态。

回放 receipt 不保存 selector、输入值、页面文本、URL 或截图本体，只保存 domain-separated state/page/screenshot/target/receipt digest 与有界结构元数据。三平台门必须同时跑正向旅程和主动 network-escape probe；缺少任何平台 evidence 时 aggregate 失败闭合。

## 8. Codex App Server 兼容性

可选 adapter 以显式 upstream patch allow-list 准入。每个获准版本必须：

1. 在对应版本自身的安装环境生成 schema；
2. 在 Linux、Windows、macOS 验证 `initialize → initialized → thread/list` stdio 生命周期；
3. 不发起模型请求，不把网络可用性误当协议兼容性；
4. 同时证明生产 CLI 不依赖可选 adapter，稳定 `codex exec --json` fallback 可独立启动并投影 terminal result。

预发布版本、未列出的未来 patch、schema 不匹配或 lifecycle 失败都在 turn admission 前回退，不允许运行中热切换造成重复副作用。

## 9. Desktop 签名 Skill 资格

Desktop qualification producer 将构建、签名、安装、启动和 Skill journey 绑定到同一 exact SHA：

- macOS 使用最小 entitlements、after-sign notarization 钩子与继承策略；
- Windows/macOS/Linux 记录安装位置、签名身份与启动探针；
- 打包后的 Skill journey 验证 Handler、能力目录、Broker 与隔离 Worker 路径；
- aggregate 拒绝伪造、跨 SHA、缺平台或只含源码单测的证据。

该门说明“候选 Desktop 在受控 CI 中可构建、签名并运行对应旅程”，不说明公开下载渠道已经完成签名安装包的 fresh install、upgrade、rollback、notarization/updater 与长期遥测闭环。

## 10. 公共与源码边界

- `0.166.9@222396f6a8` 只授权与其 tag、包字节和通过门禁相匹配的公开制品；
- GitHub `main` 后续真实协作质量门与 ARM64 Robot 重试修复属于后续源码，不继承该发布身份；
- JetBrains `0.4.104` 标签不能覆盖 Marketplace `0.4.103` 的实际公开状态；
- npm CLI 包不包含 Desktop/native 应用字节；
- 前序 `0.166.5` 的 1,800 秒 App Server soak 不能改写成 `0.166.9` 自身的长期 soak。

## 11. 关键实现

- `packages/cli/src/lib/graph-kernel/retirement-evidence.js`
- `packages/cli/src/lib/graph-kernel/cutover-ledger.js`
- `packages/cli/src/lib/graph-kernel/runtime.js`
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`
- `packages/cli/src/lib/codex-app-server-adapter.js`
- `packages/cli/src/lib/approval-grant-ledger.js`
- `packages/cli/src/lib/policy-decision-event.js`
- `packages/cli/src/lib/agent-team/task-lease.js`
- `packages/cli/scripts/record-replay-ui-journey.mjs`
- `packages/cli/scripts/codex-app-server-compatibility.mjs`
- `desktop-app-vue/scripts/create-signed-desktop-skill-evidence.mjs`
- `desktop-app-vue/scripts/signed-desktop-skill-journey.mjs`

## 12. 权威验证记录

- CLI CI：GitHub Actions run `33228796205`
- CLI Strict Sandbox：run `33232869268`
- npm 发布与回读：run `33232869286`
- IDE Extensions：run `33230594120`
- Record Replay UI Journey：run `33228796228`
- Codex App Server Compatibility：run `33228796157`
- Desktop Signed Skill Qualification：run `33232869336`

后续版本必须在自己的 final exact SHA 上重新完成对应矩阵；不能引用这些 run 为新 SHA 提供发布授权。
