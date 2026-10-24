> 主分支整合续行：用户已要求合并 CLI 和 IDE 修复后切换账号。下面 01:10 的交接是历史快照；当前准确状态以 Git、PR 和 `.work/cli-ide-recovery-20261023/active-release-state.json` 为准。17-suite 本地驱动实际触及 900 秒外层时限，不能当作通过；原测试进程已核验退出。新增 verify09 旧/新锚和三种表示的实际正负例已通过 56 个相关测试。CLI 缓存/I/O 与 IDE 修复已整合在 feature/cli-cache-io-recovery-20261024，必须等待准确源码的必需检查通过再完成远程合并及发布。尚未发布任何本轮版本。

# Codex 账号切换交接：CLI / IDE 修复与发布

更新时间：2026-10-24 01:10 UTC（北京时间 09:10）。这是工作交接，不是发布成功收据。

新会话先阅读本文，再读取根目录 `.work/cli-ide-recovery-20261023/active-release-state.json` 和本轮 `account-handoff-*.json`。不要仅根据根工作树 HEAD 选择发布源码。

## 用户目标和已有授权

持续修复、监控直至发布成功，CLI 和 IDE 优先，遇到问题可找 Astra。用户已明确授权“改好了就可以发布”“修改完毕后继续发布”，无需再次询问相同发布许可。切换账号的计划没有撤销这些授权，也没有要求取消检查。

严格顺序：必要的子 npm 包 → CLI → VS Code / JetBrains → 移动端 / PC。npm 只走既有 GitHub Actions OIDC，不能改为 token 或本地发布。准确最终提交必须通过完整三系统 CLI CI、Strict、SDK/Core 实际测试、Context，以及未降低标准的 Formal。不能用旧 SHA、部分矩阵、超时或取消的结果发布。

本轮尚未发布任何 npm、IDE 或产品版本，没有创建发布标签。36+9 验收仍为累计 **32/45**，剩余 **13**；`paidReady:false`、native `NOT_ADMITTED`、promotion `HOLD`。没有新增真实付费模型请求。

## 当前最重要的状态

1. 新性能修复在 **`C:/code/chainlesschain/.work/cc118-io`**，分支 `feature/cli-cache-io-recovery-20261024`，基于 `e4c66df637d8ace1d8426513e0b14f0f22e2e913`。**8 个文件修改尚未提交**，不要 reset、覆盖、删除或丢弃。
2. 17 组综合回归仍在运行。控制器 unified exec session **46453**；执行脚本 `.work/cli-ide-recovery-20261023/validate-cache-io-candidate.mjs`。输出目录：`.work/cli-ide-recovery-20261023/cache-io-local-validation/2026-10-24T01-02-30-791Z/`。应等待真实 `receipt.json`、`vitest.json`、`source-after.json`，核验 exitCode、所有结果及 before/after 字节一致；不能把“已启动”当通过。
3. **当前 active 发布 helpers 仍绑定 e4，不是新性能修复源。现在不要运行 publisher、创建 tag 或发布。** helpers 必须在新源码提交并完成全套准确提交门禁后再次按字段重绑和独立复核。
4. 根工作树 main `79b7d49841341eb4caf135414183c1311db58b75` 不是发布源。独立 IDE 源始终是 `376740e3f4bd5d46a741eb92e2c6618beb3c080f`，不要用 CLI 工作树覆盖它。

8 文件的原始完整副本（包括两个 untracked 新文件）、tracked patch 和三份代理交接记录已另行备份：`.work/cli-ide-recovery-20261023/account-switch-backup-2026-10-24T01-10-10-367Z/`。入口 `account-switch-latest.json` 指向带 hash 的 `checkpoint.json`。回归控制器最近观察 PID **17272**，Vitest PID **3540**；恢复前核当前进程及最终收据，不假设旧 session 一定可接管。

## 已修复的 VS Code 报错

报错：`Cannot settle completed tool rounds; refresh the session before continuing`。已真实离线 SSE 复现：持久化 user 输入带 `clientMessageId/inputDigest`，live conversation 没有，严格前缀比较误判自己的输入为并发修订。

e4 源已修复 conversation projection、tool-only omitted content、工具完成后的 retention settlement 和旧历史 lineage / migration；raw receipts、去重、严格 JSON、锁内 CAS 均保留。此前 CLI 相关本地 **484 pass**，VS Code **308/308**、VSIX verifier **17/17**。这些是本地补充结果，不是最终新源的发布资格。

IDE 同时保留有界错误码、真实已知阶段和进程诊断；未知持久化或输入状态会暂停用户开启的循环，不自动重放工具。

## 本轮新增的两项性能修复

旧候选 `0459a2bb4ad6e1e3dc4475a46aa2bd2fa2264b4b` 的 Windows Formal 在 20 warmup + 90 measured 后，第 111 个总 turn 超过原 60 秒。真实 ZIP `12539283250`、job `120693706534` 已归档，不能发布该源。

e4 本地诊断也在第 19 个 warmup 超时。loopback 响应均很快，主要时间发生在响应前后文件/历史处理；该本地诊断有共享主机和采样开销，不能冒充 Actions Formal 结论。

新源 `.work/cc118-io` 修复：

- 原 cold cache 分支清空所有 layout，从空缓存出发实际最多留一个 layout，导致 typed stores 来回全量 canonical 校验。改为同一 **112 MiB** 预算内的 compact raw/canonical UTF8 层和可选 parsed 热层，预留替换空间、按需 LRU、prefix pin、失败 finally 释放；新鲜身份、完整读取/hash、payload、签名、authority、expiry 和索引准入不放松。
- 默认 ArtifactStore 的前后 integrity 检查与自身读取共重复完整读三次。仅对仓库确切默认方法使用一次完整 bounded read；默认身份在 artifact-store 模块初始化时冻结。每个跳过点重新检查动态 storedPath / filesDir；自定义路径保持两次 hook 原顺序，且 pre fallback 会 latch 到 post。自身前后身份、大小、摘要和目录检查保留。

已同步 CLI README、根 CHANGELOG 和 CLI 内置 changelog 数据，未提前宣称目标版本已公开。

新源 8 文件的冻结 hash：上面综合回归目录的 `source-before.json`。关键源 hash：

- `evolution-artifact-ports.js`: `a3e8696e467a2644f7095a1d7bfbdb619a4de427072c5328747a2f6c1696eafe`
- `artifact-store.js`: `df0985d59dd607a80e570d61ea19955408209e4964a0504d5d968ec1c60eb7e5`

独立最终源码 review：同目录 `independent-windows-review.json`，SHA256 `ca91fa9efbb297f66039a0b6e6ad92c3a32b545c38eb3488ff3715d6584ccd39`。

缓存专项 **7/7** 已通过。真实六类索引形状各 4096 行的观测：常驻 `92,113,018` bytes，替换/失败预留峰 `107,435,774`，低于 `117,440,512`；二轮额外 canonical 0，append 仅新行 +1。它是合成扩展形状和实际私有函数/描述符窗口观测，不是 24k 份 artifact authority 认证、进程 heap 硬上限或 Formal。

预算收据：`.work/cli-ide-recovery-20261023/egress-review-recovery/cache-budget-audit-e4/typed-compact-budget-receipt.json`，SHA256 `ace7d868dc4c86c5a090bbaa54c971604e353c180766b16537509bf06640b0d8`。

I/O 首轮 ports suite 74 pass / 1 existing skip 是最后 latch 回归之前的结果；最终以 17-suite 综合收据为准。

## 仍在运行的远程检查（这些绑定 e4，不能资格新性能源）

CLI e4 分支 `feature/cli-tool-round-recovery-20261024`：

- CLI CI `40041440061`
- Strict `40041456161`
- Formal `40041474292`
- Context `40041629458`：已 3/3 success、原 artifacts/digest 已归档。

约 01:07 UTC：CLI 23 success、37 queued、6 running；Strict 5 success、1 queued。不要把这些旧快照当最新，继续读取原 API 归档。Formal 当时无已知失败、仍在运行。

独立 IDE 376：

- IDE Extensions `40040187046`：约 01:08 UTC 16/17 success，最后 JetBrains macOS 2024.2 正运行。
- ARM64 `40040197734`：完整 **11/11 success**；11 job logs + 10 artifacts + run logs ZIP 已归档完整。

IDE 归档根：`.work/ide-tool-gates-376740e3-20261024/`。ARM 完整收据 `40040197734/complete-archive-receipt.json`，SHA256 `8641b1a754ca0de9a2b26d2b40741b809862a61806f6c327ce2fd9b18dbbc7c7`。常规 workflow_dispatch 的 publish 步骤实际 skipped；job 名字含 publish 不表示已发布。

旧 0459 Formal `40035461160` 继续自然收集，**不要取消**。其 Linux scheduler 是 GitHub hosted runner lost communication，不能说已证 scheduler 断言 bug；Windows main 的 60 秒超时是真失败。c0 中间源各 run 已单次取消并归档；不要再发 cancel。

监控会话、启动脚本、归档入口和新快照由同目录 `account-handoff-linux.json`、`account-handoff-windows.json`、`account-handoff-formal.json` 补充。PTY session / agents 可能不能在新会话直接接管；先检查实际本地进程与 GitHub run，再决定是否只恢复 GET-only collector，避免重复 dispatch。

## 发布 helpers 与未执行的后续

e4 helpers 已通过固定 hash 和独立 review 启用 17 文件，后续 active offline **109 Node + 15 PowerShell** 全通过。备份及收据：`.work/cli-ide-recovery-20261023/helper-activation-e4-2026-10-24T00-40-47-590Z/`。

启用后仅额外修正 `docs-followup/stage-docs.test.mjs`：历史 README 比较读取冻结 SOURCE_ROOT，不再误读 root main。active validation 已包含此修正。已向失败源 denylist 追加 0459 的真实证据，原条目保留；旧 proposal 中受保护文件 hash 因这次有据追加已过时，不要重跑旧 before 断言覆盖现状。

原 proposal 名为 `release-helper-rebind-c0e63e-proposal`，实际内容已经是 e4 / IDE376。不要按目录名误判源，也不要盲目重跑旧 rebind/record 脚本。下一轮要从当前 active bytes 生成新的字段级 proposal，保留历史收据、denylist、完整 72/6/3 矩阵和 Formal main+wrapper hash 绑定。

下一步顺序：

1. 等 17-suite 真正终态，核 source before/after；失败就修真实原因。`git diff --check` 和 8 文件 Prettier check 已通过。
2. 保留 8 文件，完成 runtime commit。用新干净准确 SHA 跑准备好的真实 CLI 诊断（不是 Formal）；不要从 e4 旧结果推断新源表现。
3. 整理 preparation / 原始本地证据，冻结最终发布 commit、push 独立 feature branch；该最终 SHA 重新跑完整 CLI / Strict / Context / SDK/Core / Formal。Formal 保持 all、7200 秒、20 warmup、1000 measured、60 秒单轮、10 秒 cleanup、15 jobs / 22 原 ZIP。
4. 全门禁通过后 fresh registry/tag collision/provenance preflight，OIDC 子包 Session Core `.23`、SDK `.16`（及确有变更的其他子包）先于 CLI `.118`；公开 bytes/provenance/独立安装核验后，再 IDE `.160` / `.177`。
5. IDE 公开后处理 Android CLI bundle refresh、binaries rollover、产品 `.141` 独立源码和完整产品/移动检查。14 个 npm 包目录必须与最终 CLI tag 的 Git tree 一致。最后按真实公开收据更新根 README / 公共文档 / 网站。

新诊断控制器：`.work/cli-ide-recovery-20261023/egress-review-recovery/formal-evidence/diagnostic-io-local/` 的 `build-controller.mjs`、`launch.mjs`、`analyze-progress.mjs`；尚未执行，builder/launcher 强制干净准确 SHA、controller hashes、官方 Node 二进制 hash。备用 `parent-window-proposal.json` 只是只读方案，未实施，不能把它算入新源码或通过结果。

## 实际通道限制

GitHub 仓库没有配置 `VSCE_PAT`；既有 Open VSX + 可安装 VSIX 通道会继续。官方 Microsoft Marketplace 自动发布需要用户在 Actions secrets 配置，已有可选问题待答复；不要读取/输出密钥，不要因为尚未配置就阻塞其他已授权通道，也不能声称已配置或官方商店已上架。JetBrains upload pending approval 不等于公开成功。

## 工具和容易踩的坑

- 官方 Node：`C:/code/chainlesschain/.work/cli-ide-recovery-20261023/node-22.12.0/node-verified.exe`；SHA256 `b3b117a08ee61efee09e6fd523ab33c0c018da1b570bde08e4fd914dc1170ed6`。
- Vitest：`C:/code/chainlesschain/node_modules/vitest/vitest.mjs`；Prettier：`C:/code/chainlesschain/node_modules/prettier/bin/prettier.cjs`。
- gh：`C:/Program Files/GitHub CLI/gh.exe`；某些 PATH 找不到 gh 时用绝对路径。
- 新 `.work/cc118-io` 的依赖 junction 已配置，Session Core 链到新树；Koffi 已核 **2.16.3**。
- 原长名 `.work/cc118-cache-io-recovery` 的 checkout 因 Windows 长路径失败并自动清理。实际新树是 `.work/cc118-io`，使用命令级 `git -c core.longpaths=true` 完成检出；不要误入无 `.git` 的残留路径并把 root main 当修复分支。
- `.work` 一律相对于根 `C:/code/chainlesschain`，不是嵌套 worktree。不要遍历整个 `.work`，其中很大且有受保护 ACL。
- SSH 443 曾超时；已有 HTTPS credential-helper 成功方案，不输出 token，不修改全局 Git 配置。
- `.git` 写操作需工具 escalation，用户已有工作授权；不要把常规提交 / push 再变成重复确认。
- 当前 goal thread `01a16808-6dac-7783-b51b-2f48fbbcc068` 未 complete；账号切换计划没有显式暂停 goal。

新会话可直接发送：

> 请阅读 C:\code\chainlesschain\docs\research\cli\ACCOUNT_SWITCH_HANDOFF_2026-10-24.md，先核对正在运行的测试和保存的收据，保留 .work/cc118-io 未提交的 8 文件修复，继续修复并按子 npm 包 → CLI → IDE → 移动端 / PC 顺序发布；保持完整准确提交门禁，不要重复询问已有发布授权。
