# 隐性风险陷阱手册（#6-#30）

> Internal engineering reference. 项目内每一次"代码能跑 / CI 全绿 / dev 没问题但生产 / 用户 / 下次重装炸"事件的总结。
>
> 编号 6-18 是历史顺序（1-5 在本文档创建前已沉淀于 CLAUDE.md 或个人 memory，未编号统一）。
>
> 触发条件 = 你打算改某文件 / 跑某命令 / 进某状态时，对应陷阱就该读。
>
> 内部链接里的 memory 路径指 `~/.claude/projects/.../memory/`（个人 / session memory），不是 git tracked。本文档是 git tracked 的、可分享的副本。

---

## 快速索引

**Status badge**（`#` 列前缀）：

- 🛡️ **CI gate 已 land** — 触发路径有 mandatory PR/pre-push 自动化拦截；handbook 是 backup 文档而非唯一防线
- *(无 badge)* — 仍靠手册 / SOP / `grep memory` 流程预防；漏读 = 复现陷阱

当前关闭率：**19 / 25**（#6, #7, #10, #12, #13, #15, #16, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #29, #30）

| # | 主题 | 触发条件（开工前必读） | 核心 memory |
|---|---|---|---|
| 🛡️ 6 | 文档同步陷阱 | 编辑 `docs-site/docs/design/**` 或 `docs-site-design/docs/**`；加新中文-named design doc。**自动化已 land** `.husky/pre-commit` step 0.5 (本地 mandatory) + `doc-sync-generated-copy-gate.yml` (PR mandatory) + `doc-sync-audit.yml` (PR advisory, 检 CJK 映射) | `docs_site_sync_unmapped_fallthrough.md` |
| 🛡️ 7 | npm 发版漏发 | 改 `packages/*/{lib,src}`；加新 `packages/*` 包；发版前。**自动化已 land** `scripts/lint-publish-staleness.mjs` + `publish-staleness-check.yml` (PR mandatory，覆盖 8 个非 PDH/CLI 的可发布 workspace 包，私有包跳过)。PDH + CLI 仍走 `pdh-bundle-staleness-check.yml` (#27/#28，更严，加 USR_VERSION + dep 传播)。 | `npm_publish_audit_and_dep_chain.md` |
| 8 | CI 假绿 mask | 改 `.github/workflows/*.yml`；大发版前；任何"明明应该失败但绿了"事件后 | `feedback_ci_false_green_audit_checklist.md` |
| 9 | 并行 session git race | 多 session 同时活跃；`git add .` / `git commit -a`；rebase / reset / autostash | `feedback_parallel_session_git_race.md` |
| 🛡️ 10 | lint-staged untracked sweep | worktree 含 `??` 状态文件 commit；改 CHANGELOG/README/package.json。**自动化已 land** `.husky/pre-commit` step 0.7 untracked 预警 + step 1.5 post-lint-staged sweep-victim 检测 (本地 advisory，配合 step 0 工作树快照) | `feedback_lint_staged_sweep_unstaged_files.md` |
| 11 | E2E web-shell opt-out 失效 | 写 / 维护针对 V5 baseline 的 E2E 测试；预写 app-config.json | `e2e_helper_web_shell_opt_out_trap.md` |
| 🛡️ 12 | Node 23 native-dep prebuild gap | `node -v` 显示 odd-numbered 版本；`npm install` 后启动 MODULE_NOT_FOUND；CI runner image 升级。Resolved 2026-05-26（`engines.node` 放宽回 `>=22.12.0`），但 **REGRESSED 2026-06-10**：`better-sqlite3-multiple-ciphers@12.9.0` 不再带 `node-v131`（Node23）prebuild + runner 升 `windows-2025-vs2026` 让 node-gyp 找不到 VS18。engines 未回 pin（Node 23 已 EOL，字段仅 advisory）。tracking [#26](https://github.com/chainlesschain/chainlesschain/issues/26)。**注意**：`upstream-watch.yml` run 永远 exit 0 + `continue-on-error` ⇒ ✓ 是 cosmetic-green，判实质结果见 **trap #30**。 | `node_23_native_dep_trap.md` |
| 🛡️ 13 | Desktop release npm workspace hoisting | `desktop-app-vue` 加新 dep；release 跑得通 dev 跑得通但用户装完启动崩。**自动化已 land** `scripts/audit-trap-fix-invariants.js` + `trap-fix-invariants-audit.yml` (PR mandatory，守 asar-surgery.js 的 WALKER_DROPPED_PKGS + extractAll + createPackageWithOptions + per-pkg inject loop + verification gate + module exports 6 个 building blocks)。B4 surgery 自身用 `WALKER_DROPPED_PKGS` allow-list；加新 dep 触发 walker drop 时手动 append 到该列表。 | `desktop_release_npm_workspace_hoisting.md` |
| 14 | Android in-app update 5 traps | 改 `UpdateChecker.kt`；改 `release.yml` Android 段；改 keystore；用户报"装不上新版" | `feedback_android_update_loop_immutable_apk.md` |
| 🛡️ 15 | better-sqlite3 Number→TEXT `"1.0"` trap | 写 SQLite TEXT 列；JS Number 绑定；`WHERE col = '1'` silent miss。**自动化已 land** `scripts/audit-sqlite-number-text-bind.js` 静态扫 + `sqlite-number-text-bind-audit.yml` (PR advisory，检 Number/parseInt/Math.round/unary-plus 绑到 INSERT/UPDATE/REPLACE 的 .run/.get/.all/.iterate 及 prepare(SQL).run() 链式) | `better_sqlite3_text_number_trap.md` |
| 🛡️ 16 | commit-msg hook scope regex 拒数字 | 写 commit message；想用 `feat(p2p)` / `feat(v6)` / `feat(b4)` 类带数字 scope。**已修** 2026-05-29 commit `a71a83b4d`：`.husky/commit-msg` regex `[a-z-]+` → `[a-z0-9-]+`；caps 仍拒。 | `feedback_commit_msg_hook_scope_regex.md` |
| 17 | Android remote file skill 接通 6 雷 | 加新 `RemoteCommandClient.invoke` 类 Android skill；接 Plan C signaling 路径 | `android_remote_file_skill_traps.md` |
| 18 | GitHub immutable releases burn tag | `gh release create` / `gh release delete`；release pipeline 失败救援；测试发版命名 | `github_immutable_release_tag_burn.md` |
| 🛡️ 19 | Android release-mode R8 minify 只在 CI 暴露 | 加新重 lib dep（Ktor / gRPC / SLF4J / 大反射）；发版前。**自动化已 land** `android-release-precheck.yml` (2026-05-26) | `android_release_r8_minify_hotfix_chain.md` |
| 🛡️ 20 | Post-onload JS-set cookie race in WebView capture | 加 / 改 `SocialCookieWebViewScreen.kt` 或任何在 `WebViewClient.onPageFinished` 抓 `CookieManager.getCookie()` 的代码；为反爬严格的平台（Bilibili / Weibo / Douyin / 小红书 / 抖音）做 cookie-based 登录采集。**自动化已 land** `scripts/audit-webview-cookie-race.js` 静态扫 + `webview-cookie-race-audit.yml` (PR advisory，识 postDelayed / Handler.post / delay(N) / LaunchedEffect / lifecycleScope.launch 等 defer 模式) | `bilibili_post_onload_cookie_race.md` |
| 🛡️ 21 | 手写 tar parser 漏 GNU `@LongLink` | 改 `LocalFilesystemBootstrapper.extractTarToDir` 或任何 in-app 手写 tar 解包；npm pack 出来的 tgz 路径 >100 字符。**自动化已 land** `scripts/audit-hand-written-tar-parsers.js` + `hand-written-tar-parser-audit.yml` (PR advisory，识 `typeFlag` ref 缺 `'L'`/`'K'` 字面量) | `android_cc_bundle_tar_gnu_long_name.md` |
| 🛡️ 22 | MediaPipe tasks-genai OUT_OF_RANGE → JNI abort → SIGABRT | 改 `MediaPipeLlmEngine.kt` / `LocalLlmServer.kt` 或加新端侧 LLM engine；端侧 LLM context 窗口语义混淆。**自动化已 land** `scripts/audit-trap-fix-invariants.js` + `trap-fix-invariants-audit.yml` (PR mandatory，守 estimateTokens + ctxBudget + safetyMargin + LlmInferenceException 4 个 building blocks) | `mediapipe_jni_out_of_range_abort.md` |
| 🛡️ 23 | bs3mc / bs3 ABI dual-load — Electron 39 (ABI 140) vs Node 22 (ABI 127) | 加 / 改 `packages/personal-data-hub/lib/adapters/**/*-reader.js` 任何 require SQLite native binding 走 Electron main + Node 测试双路径的 adapter。**自动化已 land** `scripts/audit-bs3mc-dual-load.js` + `bs3mc-dual-load-audit.yml` (PR advisory，识 `dbDriverFactory` 或 `this._driver`/`opts.driver` DI seam pattern) | `bs3mc_bs3_abi_dual_load_adapter.md` |
| 🛡️ 24 | Android Bootstrap `@Singleton` + instance Mutex 仍 race | 改 `LocalFilesystemBootstrapper` 互斥逻辑；多个 `Hub*ViewModel` 并发触发 `bootstrap()`；改 cc bundle extract 路径。**自动化已 land** `scripts/audit-trap-fix-invariants.js` + `trap-fix-invariants-audit.yml` (PR mandatory，守 companion object + Mutex() + withLock + .tmp + renameTo 5 个 building blocks) | `android_bootstrap_singleton_mutex_race.md` |
| 🛡️ 25 | SQLite partial-index `IF NOT EXISTS` 隐藏 schema drift | 改 `packages/personal-data-hub/lib/migrations.js` partial unique index 定义；改 `vault.js` UPSERT `ON CONFLICT ... WHERE`；老 vault 升级；user 报 "events=1 rawEvents=1308"。**自动化已 land** `pdh-partial-index-lint.yml` mandatory regex + advisory runtime schema-diff (2026-05-28) | `pdh_partial_index_if_not_exists_drift.md` |
| 🛡️ 26 | Legacy-GPU Chromium 130+ fail-fast 0xc0000602 — "installer 闪退" 假象 | 加 Electron `BrowserWindow` / 窗口启动逻辑；user 报 Windows "installer 装一会闪退" / app 启动崩 / Application Error `CoreMessaging.dll` `0xc0000602`；老 Intel/AMD GPU 驱动机型（≤2018 驱动）支持。**自动化已 land** `scripts/audit-trap-fix-invariants.js` + `trap-fix-invariants-audit.yml` (PR mandatory，守 _gpuRecoveryMarker + .launching/.gpu-disabled + disableHardwareAcceleration + crashRecovered 4 个 building blocks) | `gpu_crash_recovery_legacy_intel_driver.md` |
| 🛡️ 27 | 改 PDH lib / cc-cli.tgz refresh 后忘 bump `USR_VERSION` —— 真机缓存旧代码 | 改 `packages/personal-data-hub/lib/**` / `packages/cli/lib/**` 后；`node-runtime-bundle.yml` 跑完看到 `cc-cli.tgz` Bin 大小变化；user 报"装新版 Android APK 但 PDH 行为还是旧的"。**自动化已 land** `pdh-bundle-staleness-check.yml` `usr-version-bump-check` (mandatory) + `.husky/pre-push` step 0.5 (本地) (2026-05-28) | `android_usr_version_sentinel_cache.md` |
| 🛡️ 28 | 改 workspace package lib 后忘 bump version + publish — `cc-cli.tgz` 依赖 npm registry 实际仍是旧代码 | 改 `packages/personal-data-hub/lib/**` / `packages/cli/lib/**` 后 CI 跑 `node-runtime-bundle.yml` 出 tgz，但设备装新 APK 后 `adb shell run-as grep <new-symbol> .../lib/analysis.js` 0 命中；和 trap #27 经常叠加（USR_VERSION 也忘 bump）。**自动化已 land** `pdh-bundle-staleness-check.yml` `workspace-version-bump-check` (mandatory) + `npm-registry-availability-check` (advisory) + `.husky/pre-push` step 0.5 (本地) (2026-05-28) | `pdh_workspace_dep_npm_publish_stale.md` |
| 🛡️ 29 | 并行 session index-race「空树 / 批量删除」commit — 整 repo 被记成 deletion 推上两端 remote | 两个 Claude session 同时对同一 `.git` 写 commit（一方 `git commit --only` 会临时换 index，另一方此刻 `git add`/commit 捕获到近乎空的 index）；改 `.husky/pre-commit`。文件全程在磁盘上没丢，只是 commit 的 tree 错；lint-staged/typecheck 只看 added/modified，**纯删除 commit 静默过闸**，被 post-commit 双推 `--no-verify` 立刻推上 github+gitee。历史事故 `5f11fb9ae`(删 13331 空树) / `7bd9c62b8`(删 13348 只剩 4 文件)。**自动化已 land** `.husky/pre-commit` step 0.3 (本地 mandatory，>50 个 staged deletion 拦截，`ALLOW_BULK_DELETE=1` 放行) (2026-06-03) | `parallel_session_empty_tree_index_race.md` |
| 🛡️ 30 | CI watcher/probe 的 cosmetic-green —— job 永远 exit 0 + `continue-on-error` 让 ✓ 不代表实质通过 | 读任何"永远绿"的 watcher/probe workflow 结论（`upstream-watch` 等周期探针）；给某 step 加 `continue-on-error: true`；`gh run list` 看到 `conclusion: success` 就下"通过"结论。判实质结果要看**哪个条件 step 真跑了 / 被 skip**（require-check 被 skip = 上游 step 的 `outcome` 实为 failure），而不是顶层 conclusion。2026-06-10 实战：upstream-watch 显示 ✓，实为"expected-fail"分支跑了（trap #12 regressed）。**自动化已 land** `scripts/audit-cosmetic-green.js` + `cosmetic-green-audit.yml` (PR advisory，结构化识 continue-on-error step 的 `.outcome` 被 `if:` 分支但无 surface；intentional probe 用 `# cosmetic-green-ok:` 标记豁免) | `node_23_native_dep_trap.md` / `feedback_continue_on_error_silent_regression.md` |

**按维度归类**（一个陷阱可能属多类）：

```
Release / 打包   : 7, 13, 14, 18, 19, 26, 27, 28
Git / 并发       : 9, 10, 24, 29
CI / 测试        : 8, 11, 19, 23, 28
Toolchain        : 12, 16, 23, 28
Runtime / 数据   : 15, 20, 21, 22, 23, 24, 25, 26
Mobile 平台      : 14, 17, 19, 20, 21, 22, 24, 27, 28
Desktop 平台     : 13, 26
Docs             : 6

🛡️ CI / Hook gate 已 land : 6, 7, 10, 12, 13, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29
```

**4 个跨条共性**（所有陷阱都满足至少 2 条）：

1. **失败 silent**（无 error / 错误 misleading）→ 不会被常规测试 / CI 抓到
2. **dev vs prod 行为分裂**（或 session 1 vs session 2 / 桌面 vs 用户机分裂）→ 本地复现困难
3. **修法靠 SOP / checklist 不是代码** → 不能 "一次性彻底解决"，只能记忆
4. **触发条件具体**（改 X 文件 / 跑 Y 命令 / 进 Z 状态）→ 适合做"开工前 grep memory"

**使用方式建议**：

- 新 session 开始 + 看到本表对应触发条件 → 读对应章节 5 分钟
- 大发版前必跑：8（CI mask audit）+ 13（hoisting check）+ 18（draft-first 流程验证）三个 SOP
- 团队新人 onboarding 必读：6, 7, 9, 14, 18（覆盖最常踩 + 损失最大）

---

## 6. 文档同步陷阱（隐性风险）

**陷阱本质** — `docs-site/docs/design/**/*.md` 和 `docs-site-design/docs/**/*.md`（除 `index.md`）是**自动同步生成的副本**，不是 git tracked 源文件。直接编辑这些副本会：

1. 被下次 `sync-*.js` 脚本静默覆盖
2. `git status` 看不到（不在 tracked 范围）
3. 定位极其隐蔽，可能丢失数小时工作

**源文件真实位置**：

| 副本（❌ 不要改） | 同步脚本 | 真源（✅ 改这里） |
|---|---|---|
| `docs-site/docs/design/**/*.md` | `docs-site/scripts/sync-design-docs.js` | `docs/design/**/*.md`（项目根） |
| `docs-site-design/docs/**/*.md` | `docs-site-design/scripts/sync-docs.js` | 同上 |

**白名单例外**（每个 docs site 自管，可直接改）：
- `docs-site/docs/guide/**`（git tracked 源）
- 两站的 `index.md` 和 `.vitepress/`（在 sync EXCLUDE 里）

**衍生陷阱 — ROOT_FILE_MAP 缺映射 silent fall-through**：

- 两个 sync 脚本各自维护独立 `ROOT_FILE_MAP`
- 加新中文-named design doc 时，**两个 map 都得加**
- 缺映射 → silent 落入 `unknown-unmapped.md` 互相覆盖（前一个 doc 丢失，无报错）

**改设计文档 SOP**：

1. `git ls-files --error-unmatch <path>` 确认是否 tracked（非 0 退出码 = 你改的是副本不是源）
2. 若不是 → 找对应 `sync-*.js` 看 `sourceDir` 找真源
3. 改源 + 跑 `node <sync-script>` 让两份副本刷新
4. 加新 doc 还要同步加 ROOT_FILE_MAP 两处条目

**自动护栏**（2026-05-21 起）：`.husky/pre-commit` 加了 step 0.5 — 检测 staged 文件落在 `docs-site/docs/design/**` 或 `docs-site-design/docs/**`（除 `index.md`/`.vitepress/`）就**直接 reject** + 打印 SOP 提示。强制走源→sync→commit 路径。绕过用 `git commit --no-verify`（仅在确认源已对齐、副本只是 sync 输出的极特殊情况）。

**类似陷阱位置**：`desktop-app-vue/docs/api/generated/`、`packages/web-panel/dist/`（编辑前先确认是否生成产物）。

---

## 7. npm 包发版漏发（隐性风险）

改 `packages/*/{lib,src}` 或新加 `packages/*` 包时，发布常常静默漏发——dev 全绿、CI 通过、release 也"成功"，但 npm registry 上没有新版本，下游 `npm install -g` 拿到的还是旧码。

**两个独立根因**：

| 根因 | 失败模式 | 检测 |
|---|---|---|
| 本地 `version` 不 bump | 27 个 src commits 但 `packages/personal-data-hub/package.json` 版本号不变 → `npm publish` 走的还是已发布版本号 → 422 already exists，CI 当 idempotent 跳过 | `git log --oneline -- packages/<pkg>/lib packages/<pkg>/src \| head -30` vs `package.json` 的 version 字段 |
| `release.yml` 不含该包 | 新加的 `packages/<new-pkg>/` 根本没在 publish matrix / script 列表里 → 永远不会被发 | grep `release.yml` 看 publish 步骤是否枚举该包名 |

**衍生陷阱 — 依赖链 propagation**：

改了 `@chainlesschain/A`，但 `@chainlesschain/B`（依赖 A）的 `package.json` 没 bump → B 的 lockfile 还锁旧 A → 用户装 B 拿不到 A 的修复。

规则：A 改 + bump 后，所有 `dependencies` 含 `@chainlesschain/A` 的 consumer 包都必须跟 bump。

**SOP**（发版前必跑）：

```bash
# 1. 查最近 30 天每个 package 的 src commit 数 vs 当前 version 是否一致
for pkg in packages/*/; do
  changes=$(git log --since="30 days ago" --oneline -- "$pkg/lib" "$pkg/src" 2>/dev/null | wc -l)
  ver=$(jq -r .version "$pkg/package.json" 2>/dev/null)
  [ "$changes" -gt 0 ] && echo "$pkg: $changes commits, current=$ver"
done

# 2. 验 release.yml 枚举包名 vs packages/ 实际目录
diff <(ls packages/) <(grep -oP '@chainlesschain/[\w-]+' .github/workflows/release.yml | sort -u)

# 3. 发完核对 registry 真实状态
npm view @chainlesschain/<pkg> versions --json | tail -5
```

**实战触发**：2026-05-20 `packages/personal-data-hub` 27 src commits 漏发，下游 desktop app + CLI 都拿不到新 adapter 类。

---

## 8. CI 假绿 mask（隐性风险）

Workflow 全绿 ≠ 代码真编译过。多层"宽容"配置叠起来，能让真实失败一路 silent 漂到 release。最痛的是历史绿色基线是假的——你以为某个 Phase 已验证，回头发现根本没编过。

**4 种 mask 来源**（按隐蔽度排）：

| Mask | 失败模式 | 检测 |
|---|---|---|
| Job 级 `continue-on-error: true` | 整个 job fail 但 workflow 显示 success；3/3 OS 全挂 PR 仍可 merge | `rg 'continue-on-error:\s*true' .github/workflows/` |
| Pipe 级 `\|\| true` / `\|\| exit 0` | 编译错被 `cmd \|\| true` 吞掉；`xcodebuild \| xcpretty` 类格式化器会 silent drop 不识别的 error 行 | `rg '\|\|\s*(true\|exit 0)' .github/workflows/ && rg 'xcpretty\\\|fmt\\\|prettier' .github/workflows/` |
| 缺 `set -e` 的多行 `run:` | 第 1 行 fail，第 2-N 行继续跑，最后退出码 0 | `rg -A1 'run: \\\|' .github/workflows/` 找无 `set -e` 的多行块 |
| Stale scaffolding | Xcode 工程文件 / SPM Package.swift 引用根本不存在的 target，xcodebuild "found 0 schemes, success" | grep 工程文件里的 target 名 vs 真目录是否存在 |

**iOS Phase 1-5 实战教训**（2026-05-16，`e000057e9` → `9dfbc1b8e` 29 commits 收口）：

- `ios-build.yml` 同时有 job 级 `continue-on-error` + pipe 级 `xcodebuild | xcpretty || true` 双层 mask
- 加上 stale `create_xcode_project.rb` 不接 SPM target
- 结果：**8 个 Phase 1-5 commit 的 iOS CI 全显示 ✅，实际一行 Swift 都没编译过**
- 收口时拔双层 mask + 接 SPM wiring → app target 暴露 **412 个老 compile error**

**SOP — 大发版前 / 任何 CI 假绿事件后**：

```bash
# 5 rg 全树扫，任一非空都得审
rg 'continue-on-error:\s*true' .github/workflows/
rg '\|\|\s*(true\|exit 0\|:)' .github/workflows/
rg '\|\s*(xcpretty\|xcbeautify\|fmt)' .github/workflows/  # 静默格式化器
rg 'run: \|' .github/workflows/ -A 2 | grep -v 'set -e'  # 多行无 set -e
rg 'allow.failure\|soft.fail' .github/workflows/  # 别名变种
```

**自动化已 land**（commit `4e3ae4f57`）：`scripts/audit-ci-masks.sh` + `.github/workflows/ci-mask-audit.yml` 作 PR advisory gate。**但是 advisory ≠ blocking**——大发版前仍要人肉跑一遍 5 rg。

**合法 mask 白名单**（不算 false-green）：

- 矩阵里实验性 target（如 `experimental-windows: continue-on-error: true` 显式标注）
- Linter / advisory check 单独 job（不影响主 build 绿）
- Notification / artifact-upload 失败不应阻塞 build

---

## 9. 并行 session git race（隐性风险）

多个 Claude session 同时跑在同一个仓库（共享 `.git/`），任何一方的 `git add` / `commit` / `reset` / `rebase` / `checkout` 都会移动对方看到的 HEAD / index / worktree。错误的提交命令会把另一个 session 正在改的文件**静默拖进自己的 commit**，或者反过来——你以为提交的文件，被对方 `lint-staged --no-stash` 倒退给删了。最痛的是绝大多数失败模式没有报错，只是 commit 里多了/少了文件。

**5 种 race 模式**：

| 模式 | 失败结果 | 防御 |
|---|---|---|
| `git add .` / `git commit -a` | 扫到对方 modified 但 unstaged 的文件，全打包进你的 commit | **永远用** `git commit --only -- <显式路径>`（race-immune，只看路径不看 index）|
| `lint-staged --no-stash` + 对方并发 push | 对方 push 后你的 lint-staged 把 worktree reset 到 HEAD，**你 staged 但未 commit 的改动全丢，无报错** | pre-commit snapshot hook 已 land（`210f82074`），恢复用 `.git/last-precommit-snapshots.log` 里的 SHA |
| `git reset --hard <remote>/main` | 抹掉对方 staged 的 NEW files（untracked → 不在 reset 范围 ≠ 不在 worktree！staged-new 会丢）| `git fsck --lost-found` + `cat-file -p` grep 内容关键字命中 blob，写回 |
| `git rebase --autostash` 当对方 worktree 脏（MM 状态） | Win 上**无声 hang** + `.git/index.lock` 卡死，僵尸 git.exe 不退出 | 改用 `git merge-tree --write-tree` + `git commit-tree` plumbing（零触工作区），见 #9 增订 |
| 文档 sweep 类（CHANGELOG / README / package.json） | 你改了 README 没 stage，对方的 lint-staged `package.json` glob 把你的 README 一起扫进他们的 commit | 改完**立刻** `git add <file>`，缩短 unstaged 窗口到接近 0 |

**核心防御原则**：

```bash
# ❌ race-prone（看 index 状态）
git add .
git commit -am "msg"
git commit -a

# ✅ race-immune（只看显式路径，不看 index 当前状态）
git commit --only -- packages/foo/file.js docs/bar.md

# ✅ 改完立刻 stage，闭合 unstaged 窗口
edit file.js && git add file.js  # 一行内完成
```

**实战恢复 SOP**：

```bash
# 场景 A：lint-staged --no-stash 倒退后丢 modified
cat .git/last-precommit-snapshots.log | tail -5  # 找最近 snapshot SHA
git checkout <snapshot-sha> -- packages/foo/file.js
# untracked 新文件不在 snapshot 里 → 必须重写

# 场景 B：git reset --hard 抹掉 staged NEW files
git fsck --lost-found
git cat-file -p <dangling-blob-sha> | grep "你记得的关键字"  # 命中 1 秒
git cat-file -p <matched-sha> > path/to/file.swift  # 写回

# 场景 C：rebase hang + index.lock 卡死（Win）— 见 #9 增订
```

**CI 衍生陷阱**：`cancel-in-progress: true` 的 workflow 在多 session 高频 push 时会被**下一个 commit 在 19 秒内 cancel** 掉。判据：cancel 时间窗 < 30s 且来自同 branch = race 受害，不是你代码问题——直接重跑。

**双 remote push 场景**：`.husky/post-commit` 自动 push gitee + github。force-push（amend / rebase 后）**不会**自动跑，hook 探测到 rewritten HEAD 只打 warn。手动用 `git push --force-with-lease=main:<expected-sha>` 防覆盖对方 push。

**2026-05-19 Phase 5.5 实战**：另一 session `git reset --hard github/main` 抹掉本 session 4 个 staged NEW files。`git fsck --lost-found` + `cat-file -p | grep "Phase 5.5"` 1 秒命中 4 blob，全部写回。

### #9 增订 — Plumbing rebase（替代 `rebase --autostash`）

**场景**：你想把本地几个 commit rebase 到 `origin/main` 之上，但另一个 session 的工作区有 `MM` 脏文件，不能跑标准 `git rebase`（会 stash 它们的改动 → 出问题）。

**Plumbing 替代**（不动 worktree、不动 index、不动对方文件）：

```bash
# 1. 找出你的 commit 范围
BASE=$(git merge-base HEAD origin/main)
YOUR_COMMITS=$(git log --reverse --format=%H $BASE..HEAD)

# 2. 对每个 commit，用 merge-tree 算出 rebase 后的 tree（不写 worktree）
#    然后 commit-tree 写新 commit
PARENT=$(git rev-parse origin/main)
for c in $YOUR_COMMITS; do
  NEW_TREE=$(git merge-tree --write-tree --merge-base=$BASE $PARENT $c)
  MSG=$(git log -1 --format=%B $c)
  AUTHOR_NAME=$(git log -1 --format=%an $c)
  AUTHOR_EMAIL=$(git log -1 --format=%ae $c)
  AUTHOR_DATE=$(git log -1 --format=%ad $c)
  PARENT=$(GIT_AUTHOR_NAME="$AUTHOR_NAME" \
           GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
           GIT_AUTHOR_DATE="$AUTHOR_DATE" \
           git commit-tree $NEW_TREE -p $PARENT -m "$MSG")
  BASE=$c
done

# 3. 最后把 HEAD 指到新 chain 顶（仍不动 worktree）
git update-ref refs/heads/main $PARENT
# 注意：不要跑 git checkout / reset --hard，那会触工作区
```

**特点**：
- 整个过程零 `git checkout` / `git reset` / `git stash` / `git rebase`
- 对方 session 的 `MM` 文件完全没被碰
- `.git/index.lock` 不会被本流程持有（plumbing 命令操作 object DB 不操作 index）
- 失败可恢复：HEAD 没动直到最后一步 `update-ref`

**如果已经卡在 `.git/index.lock`（Win 上 rebase --autostash hang 的状态）**：

```powershell
# 1. 杀僵尸 git 进程
Get-Process git -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 强删 lock 文件
Remove-Item -Force .git/index.lock
Remove-Item -Force .git/HEAD.lock -ErrorAction SilentlyContinue
Remove-Item -Force .git/refs/heads/main.lock -ErrorAction SilentlyContinue

# 3. 检查 rebase 中间状态有没有残留
ls .git/rebase-merge/ -ErrorAction SilentlyContinue
ls .git/rebase-apply/ -ErrorAction SilentlyContinue
# 有的话 → git rebase --abort（这步不会动 worktree，只清 .git/ 状态）

# 4. 如果 autostash 已经创建（stash 列表里看得到）
git stash list | grep autostash
git stash apply stash@{0}  # 不用 pop，保留 stash 防再丢
```

**何时仍用标准 `git rebase`**（不动 plumbing）：

- 你**独占** repo（没其他 session 活跃）
- worktree 干净（`git status` 全绿）
- 在 macOS / Linux（Win `.git/index.lock` 卡死是 Win-specific 病）

---

## 10. lint-staged untracked sweep（隐性风险）

`lint-staged` 的 glob（如 `"*.{js,ts,vue}"` 或 `"package.json"`）行为有一个反直觉的非对称：**worktree 含任何 untracked 文件时 sweep 全部匹配文件**，而**纯 modified-tracked 状态时只处理 staged 文件**。结果：你 `git commit --only -- specific-file.js`，但 lint-staged 默默把另一个 session 还在改的、未 commit 的 .vue / package.json 一起跑了 prettier / eslint —— 改完它**不会**自动写回那些非 staged 改动，但格式化后的内容已经在文件系统里覆盖了对方未保存的工作。

**两个失败维度叠加**：

| 维度 | 触发 | 损失 |
|---|---|---|
| Sweep 维度（本条） | worktree 有 untracked → glob 扫所有匹配文件 | 对方 modified-but-unstaged 的文件被 lint-staged 改格式（diff 变了，可能 stash 救不回因 stash 本身就是改后内容） |
| `--no-stash` 维度（#9 已提精简版） | 配置含 `--no-stash`（速度优化） + 跑完前对方 push 进来 | lint-staged 跑完 reset 到 HEAD，你 staged 但未 commit 的改动**静默清零**，无报错 |

**两维度交集 = 数据丢失高发区**：你 staged 文件 A，对方刚 push 改了文件 B，你的 lint-staged 同时（1）格式化对方未 stage 的 B（2）reset worktree 抹掉你 staged 的 A。两个都 silent。

**commit 前必跑（race-immune 探针）**：

```bash
# 1. 看 worktree 状态全貌（不止 staged）
git status --porcelain
# 输出第 1 字符 = index 状态，第 2 字符 = worktree 状态
# ?? = untracked，会触发 sweep
# M_ / A_ = staged
# _M / _D = unstaged

# 2. 如有 ?? 行，先决定：要么 stage 进来，要么先 commit 不带 lint-staged
# 反模式：??  packages/foo/new-file.js
#         M  packages/bar/file.js
# 这状态下跑 lint-staged 会扫所有匹配 glob 的文件，包含未 stage 的 foo/

# 3. 如必须在脏 worktree 下提交某个具体文件，绕过 hook（一次性）
git commit --only -- path/to/file.js --no-verify
# 但 --no-verify 必须用户明确授权，CLAUDE.md 全局禁
```

**已 land 的防御**（commit `210f82074`，2026-05-18）：

```bash
# .husky/pre-commit 自动 snapshot 所有即将被 lint-staged 触碰的文件
# SHA 写入 .git/last-precommit-snapshots.log
# 恢复：
tail -5 .git/last-precommit-snapshots.log  # 找最近 SHA
git checkout <snapshot-sha> -- packages/foo/file.js
```

**snapshot 的覆盖盲区**：

- **untracked NEW files 不在 snapshot 里** —— 因为 snapshot 走 `git stash create`，stash 只抓 tracked。`git reset` 类失败导致 NEW files 丢，必须走 `git fsck --lost-found`（见 #9）
- **binary 大文件**（>100MB）可能被 git 自身拒 snapshot

**衍生 — 文档 sweep race**（实战高发）：

- 改 `CHANGELOG.md` / `README.md` / `package.json` 后**立刻** `git add`，闭合 unstaged 窗口
- 这三个文件几乎所有 session 都会顺手碰一下；任何 session 的 lint-staged `package.json` glob 都会扫到对方的 README 未 stage 改动
- "立刻 add" 不是洁癖，是 race 防御

**自检 SOP（5 秒）**：

```bash
git status --porcelain | grep -E '^(\?\?|.M|.D)' && \
  echo "⚠️ worktree dirty, lint-staged will sweep — stage or commit first" || \
  echo "✅ safe to commit"
```

---

## 11. E2E web-shell opt-out 失效（隐性风险）

V6 shell hard-flip 后（commit `caaddf530`，2026-04-26），`/` 路由默认重定向到 `/v6-preview`。开发期常用的 CLI flag / 环境变量 opt-out 通道**全部失效**——这些原本由 V5 启动逻辑读取，hard-flip 把判断点移到了 unified-config 加载阶段，启动时已读完。E2E 测试如果还按"传 `--v5` 或 `CC_USE_V6_SHELL=false`"启动，会**进 V6 shell 但断言写在 V5 DOM 上**，结果是 Playwright 选不到目标 selector → timeout → 测试报"页面没渲染"但其实页面渲染了，只是 V6 模板。

**为什么排查难**：

- 进程退出码正常（Electron 启动成功）
- 主进程日志没异常（V6 是合法路径）
- 截图能看到 UI（只是 UI 不是测试期望的那个）
- selector timeout 错误指向"等不到 V5 元素"，让人以为是 V5 渲染失败，去查 store / IPC / 路由配置——全是死路

**唯一生效的 opt-out 路径**：

测试启动前**预写** `app-config.json` 把 `ui.useV6ShellByDefault` 显式置 false。`unified-config-manager.js` 在 Electron `app.whenReady()` 之前读这个文件，是唯一在 hard-flip 判断点之前生效的入口。

```js
// E2E helper 必做（启 Electron 之前）
const path = require('path');
const fs = require('fs');

const configDir = path.join(
  process.env.APPDATA ||
  (process.platform === 'darwin'
    ? path.join(process.env.HOME, 'Library/Application Support')
    : path.join(process.env.HOME, '.config')),
  'chainlesschain-desktop-vue',
  '.chainlesschain'
);
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify({ ui: { useV6ShellByDefault: false } }, null, 2)
);
// 然后才能 spawn Electron / 跑 Playwright
```

**反模式（已知失效）**：

- ❌ `electron . --v5` —— 没有这个 CLI flag 解析
- ❌ `CC_USE_V6_SHELL=false electron .` —— 没有这个 env 读取
- ❌ 在 test setup 跑 `app.commandLine.appendSwitch` —— 时机太晚
- ❌ test 里 `await page.goto('/')` 再 `evaluate` 改 store —— 路由已 redirect

**对称提醒（V6 hard-flip 的测试影响）**：

- 新写的 E2E 默认应该针对 V6，没必要 opt-out。只有维护**老 V5 baseline 测试**才需要这个 helper
- V5 dead-page cleanup（2026-05-04，commit `5066a718d`）后某些 V5 路由甚至**不存在了**（`/did` `/community` `/friends` 等已删）。即使正确 opt-out 到 V5，导航这些路径也会 silent no-op + vue-router warn。这类 E2E 必须改针对 V6 路径

**诊断 SOP**（E2E 报 selector timeout 时先验路由）：

```js
// 失败时必 throw 含 diagnostic（不要 catch+warn+continue）
const url = await page.url();
const keys = await page.evaluate(() => Object.keys(window));
const html = await page.content();
throw new Error(JSON.stringify({
  url,                              // 看是不是 /v6-preview
  windowKeys: keys.slice(0, 30),    // 看 Pinia / Vue 实例挂没挂
  htmlSnippet: html.slice(0, 500),  // 看真实 DOM
}, null, 2));
```

如果 `url` 是 `/v6-preview` 而测试期望 `/`，opt-out 没生效，回去检查 `app-config.json` 预写有没有跑到。

**衍生 — cc ui WS gateway 测试**：

- 跨壳功能（V5 + V6 + web-shell + cc ui）一个 web-panel SPA 被两个 WS gateway 服务（desktop 的 + cc ui 的）。E2E 跑 `cc ui` 时不需要这个 opt-out（cc ui 默认就是 web-shell，不走 V5/V6 路由判断），但需要确认测的是 cc 那个 WS endpoint 而不是 desktop 的
- 测 workspace web-panel 改动用全局 `cc ui` 不行（global ships pre-packed assets）。改用 `node packages/cli/bin/chainlesschain.js ui`

---

## 12. Node 23 native-dep prebuild gap（隐性风险）

> **✅ Resolved 2026-05-26** — `.github/workflows/upstream-watch.yml` 周跑确认 `better-sqlite3-multiple-ciphers` ABI v131 prebuild 已 ship，`engines.node` 已从 `>=22.12.0 <23.0.0 || >=24.0.0` 放宽回 `>=22.12.0`（issue #23 / commit 见 git log）。本节保留**模式**——只要将来又有 odd-numbered Node ABI 在 native-dep 加 prebuild 前 ship，同样症状会再现。`upstream-watch.yml` 每周 Sunday 04:00 UTC 守门，从 green 转 red 时再考虑回 pin。

Node 23 是 odd-numbered（非 LTS），ABI 版本 `v131`。大量 native-dep（含本项目核心的 `better-sqlite3-multiple-ciphers`、`sqlcipher`、`@libp2p/*` C++ binding 等）**只为 LTS ABI 发 prebuild**（v127 = Node 22 LTS、v137 = Node 24 LTS）。`npm install` 在 Node 23 下走 source rebuild 路径，需要 node-gyp + Python + 完整 C++ toolchain，**任何一环缺就级联失败**——而失败信号往往埋在 npm warning 堆里，最终错误是 N 层下游的 `Cannot find module 'better-sqlite3-multiple-ciphers'`，让人去查依赖配置而不是 Node 版本。

**为什么排查难**：

- `node -v` 显示 v23.x，看起来"新就是好"
- `npm install` 退出码可能是 0（warnings 不是 errors）
- 真正的 build fail 在控制台滚过去几屏，被 npm 进度条覆盖
- 启动时报 `MODULE_NOT_FOUND`，stack 指向应用代码而不是装包阶段
- 切换 Node 22/24 立刻好——但很多人不会想到回退是因为"版本号高"

**触发场景清单**：

- 全新 clone + 全新 npm install
- macOS/Linux 用 nvm/fnm 自动切到 latest（默认 odd 版本）
- CI runner image 升级到含 Node 23 的版本
- Volta / asdf 读 `.tool-versions` 但仓库没钉版本
- Electron rebuild 阶段（`electron-rebuild` 走自己的 ABI 路径，雪上加霜）

**项目已有的硬保护**：

`package.json` 历史上曾锁：

```json
{
  "engines": {
    "node": ">=22.12 <23 || >=24"
  }
}
```

这会让 npm 在 Node 23 下**警告**但不阻止安装（npm 的 engines 默认是 advisory）。配 `.npmrc` 加 `engine-strict=true` 才会变 hard fail。2026-05-26 upstream prebuild 补齐后已放宽回 `>=22.12.0` —— 若后续 ABI 又出 gap，回贴这条锁就行。

**检测 SOP**：

```bash
# 1. 装包前先验 Node
node -v                          # 必须 v22.x 或 v24.x
node -p "process.versions.modules" # ABI: 127 (Node 22) / 131 (Node 23 ❌) / 137 (Node 24)

# 2. 真要排查 native rebuild 是否成功
ls node_modules/better-sqlite3-multiple-ciphers/build/Release/
# 看到 .node 文件 = 成功
# 空 / 不存在 = build 失败但被 npm 吞了

# 3. CI 也要钉死
# .github/workflows/*.yml 里 actions/setup-node@v4 必须显式 node-version: '22'
# 不能用 'lts/*' 因为遇到 odd-LTS 切换窗口可能拿到 23
```

**已踩过的衍生坑**：

- **B4 ASAR surgery + Node 23 叠加**（2026-05-07）：electron-builder 打包时用宿主 Node 编译 native dep，宿主装的 Node 23 让 prebuild 走 source 路径失败，最终 .exe 里塞的是 broken `better-sqlite3-multiple-ciphers`，安装能装但启动黑屏。修法：CI runner 钉 Node 22.12+，本地开发也按 engines 钉死
- **CLI workspace dep + Node 23**：`@chainlesschain/core-mtc` 等含 libp2p 间接依赖，Node 23 下 sqlcipher native 失败级联让整个 CLI 无法启动

**反模式**：

- ❌ "用 Node latest 试试"——native dep 区从来不要 latest，永远 LTS
- ❌ 用 `--ignore-engines` 强装——绕开 advisory 但不解决 ABI 不匹配
- ❌ Docker base image 写 `FROM node:latest`——容器里也会拿到 odd 版本
- ❌ 改 engines 范围让 Node 23 "通过"——治标，下次重装还是 broken

**正确恢复路径**（已经在 Node 23 上 broken）：

```bash
# 1. 装 Node 22 LTS
# Windows: winget install OpenJS.NodeJS.LTS 或 nvm-windows
# macOS: nvm install 22 && nvm alias default 22
# Linux: 用 distro 包管理器或 NodeSource

# 2. 全删 node_modules 重装（必须，否则 ABI v131 .node 文件残留）
rm -rf node_modules package-lock.json
npm install

# 3. 验
ls node_modules/better-sqlite3-multiple-ciphers/build/Release/*.node
```

**Lockfile 注意**：

- `package-lock.json` 不存 ABI 版本，删 lockfile 重装不会"自动选对版本"
- 但 lockfile 里钉了的 prebuild URL 是 ABI-specific 的；混 Node 版本装会让 lockfile 飘
- 团队成员都应该用同一 Node major 版本，避免 lockfile 翻来覆去重写

---

## 13. Desktop release npm workspace hoisting（隐性风险）

`desktop-app-vue` 是 monorepo workspace 成员（`packages/*` 兄弟），`npm install` 在 root 跑时会把**所有兄弟共享的依赖往上提到 root `node_modules/`**（npm hoisting）。dev 模式从 root 加载，`require('foo')` 找到 hoisted 版本——全绿。`electron-builder` 打包时**只从 `desktop-app-vue/node_modules/`** 抓文件进 `.asar`——hoisted 在 root 的依赖**根本不进安装包**，安装出来的 .exe 启动直接 `MODULE_NOT_FOUND`，但 dev 一切正常。最痛的是：bug 与 commit 解耦——某个无关 commit 改变了 hoisting 拓扑，下次 release 突然炸。

**两个独立故障层**（必须都修才能根治）：

| 层 | 失败机制 | 检测 |
|---|---|---|
| npm workspace hoisting | 依赖被 npm 提到 root，`desktop-app-vue/node_modules/` 看不到，electron-builder 漏抓 | `ls desktop-app-vue/node_modules/<dep>` 不存在 + `ls node_modules/<dep>` 存在 = 中招 |
| electron-builder walker nested-only | walker 只递归 `node_modules/<dep>/node_modules/<nested>`，对**顶层兄弟** package 完全无视。即使 hoisting 修了，4 个 walker-dropped 包（`call-bind-apply-helpers` / `side-channel-{list,map,weakmap}`）还是会漏 | 装好后 `asar list app.asar | grep call-bind-apply-helpers` 为空 = 中招 |

**Dev 跑得通 + release 跑不通**几乎 100% 是这俩之一（或两者）。

**已 land 修复**（B4 ASAR surgery，v5.0.3.39，commit `e11b46913`）：

- `scripts/asar-surgery.js` afterPack hook：打包后**手动注入** 4 个 walker-dropped 包到 asar header 的 `node_modules/<pkg>/` 顶层
- `asar: true` 翻回来（之前用 `asar: false` + 7 个 `extraResources` 兜底，文件数爆炸让 install 跑 1201s）
- **Result**：install 时间 1201s → 190.9s（−84% / 6.3× 加速），47% headroom 在 360s gate 之下

**新增依赖时的 checklist**（不踩同一坑）：

```bash
# 1. 加完依赖后立刻验 hoisting 行为
cd desktop-app-vue
npm install <new-dep>
ls node_modules/<new-dep>          # 必须本地有
ls ../node_modules/<new-dep>       # 看是不是 hoisted 到 root
# 如果只在 root 不在 desktop-app-vue/，asar 会漏

# 2. 试打个本地包验
npm run build:dist
node scripts/asar-list.js          # 或手动 asar list
# 验新加的 dep 在 .asar 里 node_modules/<dep>/ 路径下

# 3. 看 dep tree 有无 walker-dropped 嫌疑
# 这些类型容易漏：顶层只被 import 一次、且依赖了它的包用 dynamic require
npm ls <new-dep> --all
```

**B4 surgery 自身的 7 个 operational gotchas**（改 `scripts/asar-surgery.js` 前必看）：

1. **`filesystemCache` 必须 `delete cache[absPath]`**：electron-builder 缓存了 asar 内文件树，注入新文件后不清缓存 → 二次打包看不到注入
2. **`minimatch` 必须 `matchBase: true`**：default 模式下 `**/node_modules/foo` 不匹配 asar 内的 `node_modules/foo`
3. **Win junction `lstat` 不可靠**：surgery 走 `fs.cpSync` 时遇到 npm 创建的 junction（不是 symlink）`lstat().isSymbolicLink()` 返回 false，触发死循环复制
4. **devDep transitive prod-chain**：根 devDep 的 transitive 可能被 prod code import；裁 devDep 前先 `npm ls <dep> --prod`
5. **`cpSync` symlinks EPERM**：Win 上非管理员 mode 不能创建 symlink；用 `dereference: true`
6. **`winCodeSign` 自带 darwin dylib**：~50MB 死重，可在 surgery 里删（小心：未来跨平台签名工具可能要用）
7. **asar:false 文件数天花板**：用 `asar: false` 当兜底时，10w+ 小文件让 install 走 1200s+；不要回退到这个方案

**调试 SOP**（release 启动 MODULE_NOT_FOUND）：

```bash
# 1. 找到装包后的位置
# Win: %LOCALAPPDATA%\Programs\chainlesschain-desktop-vue\
# 看 resources\app.asar 或 app\

# 2. 列 asar 内容
npx asar list path/to/app.asar | grep <missing-module>
# 空 = 没打进去

# 3. 验 surgery hook 跑了没
# 打包日志里搜 "asar-surgery" 应该有 "injected N packages" 行
# 没看到 = hook 没触发，检查 electron-builder.yml 的 afterPack 配置

# 4. 验 hoisting 状态
ls desktop-app-vue/node_modules/<missing-module>
# 不存在 = npm install 把它提到 root 了，要么改 nohoist 要么 surgery 注入
```

**对称提醒 — workspace 新加 dep 的发版前提**（与 #7 npm 发版漏发相关）：

- CLI 加 `@chainlesschain/A` workspace dep 时，npm install 创建 symlink → 本地能跑
- `npm pack` 把 dep 写成**字面版本号**进 .tgz（不是 symlink）
- `npm install -g chainlesschain` 走真 registry lookup → 如果 `@chainlesschain/A` 那个版本还没发布 → 404 → install fail
- 规则：CLI 加 workspace dep 前，**先确认那个版本已 publish 到 npm**，再 merge CLI bump

---

## 14. Android in-app update 5 traps（隐性风险）

`UpdateChecker.kt` 走 GitHub Releases API 查最新 tag、下载 APK、调 PackageInstaller 装新版。这条链路有 5 个独立陷阱，**任何一个失败都让用户卡在"检查更新→无反应"或"下完装不上"**，且大多无前台报错（后台 catch 掉了或 PackageInstaller 默默拒装）。每一个都炸过线上。

**5 个陷阱**：

| # | 陷阱 | 失败模式 | 修法 |
|---|---|---|---|
| 1 | `startsWith` null NPE | `BuildConfig.VERSION_NAME` 或 release tag 在某些构建路径为 null，`current.startsWith("v")` 抛 NPE 被外层 catch 静默吞 | 显式 `current ?: return false` + 单测覆盖 null/空串/无 `v` 前缀三态 |
| 2 | versionCode / versionName 漏 bump | release tag 是 v5.0.3.47 但 `android-app/app/build.gradle.kts` 的 `versionCode` 没升 → `installed >= latest` 判定无更新 | 发版脚本同步 bump（已 land 自动化）+ release 前 grep `versionCode = .*` 与 tag 对账 |
| 3 | Ephemeral CI keystore | release.yml 每次跑生成新 keystore（没配 secret 或 secret 失效）→ 新 APK 签名与已装版本不匹配 → PackageInstaller 拒装 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 4 个 Android signing secrets 必须配死（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`）+ release.yml fail-fast 如果 secret 缺 |
| 4 | Ghost release | `gh release create` 创建后 assets 上传还在跑，但 Android 此时 poll 到 release → 下载 404 → 用户看到"检查到新版本"然后报错 | release.yml 必须 `--draft` 创建 → 全部 assets 上传完 → `PATCH draft:false` 一次性 publish；同时 mobile 端 update check **必须** wait `gh release view <tag> --json isDraft` = false |
| 5 | `gh dl` EOF mid-stream | CDN 偶发抽风让 GitHub Releases asset 下载在 80% 处断流，Android `OkHttpClient` 收到 EOF 但**不**抛 IOException（部分 buffer 模式下安静截断），APK 文件落地大小 < 期望 → PackageInstaller 报 `INSTALL_FAILED_INVALID_APK` | 下完必校验 `Content-Length` 头 vs 实际写入字节数；mismatch → 删 cache 重下；3 次重试上限避免死循环 |

**衍生 — keystore path convention**（v5.0.3.47 verified）：

```
android-app/app/build.gradle.kts:
  storeFile = file("keystore/<name>.keystore")   # 相对 module 根
android-app/keystore/<name>.keystore             # 物理位置
```

release.yml decode secret 到 `android-app/keystore/`，不是 `android-app/app/keystore/`（gradle 解析路径会找错地方，silent fail 用 ephemeral keystore 兜底 → 触发陷阱 3）。

**检测 SOP**（发 Android 版本前必跑）：

```bash
# 1. versionCode 与 tag 对账
tag=$(git describe --tags --abbrev=0)
gradle_code=$(grep -oP 'versionCode = \K\d+' android-app/app/build.gradle.kts)
echo "tag=$tag gradle_code=$gradle_code"
# 人脑判断 gradle_code 必须 > 上一个 release 的 versionCode

# 2. release.yml 所有必需 secret 都配
gh secret list | grep -E 'ANDROID_(KEYSTORE_BASE64|KEYSTORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD)'
# 必须 4 行齐

# 3. 发完验 release 不是 draft
gh release view "$tag" --json isDraft,assets | jq '{isDraft, assetCount: (.assets | length)}'
# isDraft=false + assetCount = 期望（含 arm64 / v7a / universal / aab）

# 4. 验 APK 真能装到已签名旧版本之上（不要从 fresh install 测）
# 在已装 v5.0.3.X 的真机上 sideload v5.0.3.X+1.apk
# 看 logcat: adb logcat | grep -i 'INSTALL_FAILED'
```

**Android downloads ride desktop tag**（与陷阱 4 相关）：

- `desktop-app-vue/docs-website-v2/src/data/release-sizes.json` 的 `ANDROID_TAG = releaseSizes.tag`，**与 desktop tag 同步**
- 改 release-sizes / mobile.astro 前：`classify()` 必须识 4 个 assets（`arm64-v8a` / `armeabi-v7a` / `universal` / `.aab`）
- 缺一个 asset → 官网下载页显示该架构"暂不可用"，但 release 里其实有，只是 classify 漏识

**反模式**：

- ❌ "测试发版用 ephemeral keystore 没事吧"——只要任何用户装过，下次 release 就装不上
- ❌ `gh release create` 不带 `--draft` → ghost release 必现
- ❌ 下载 catch 后 silent retry → 死循环 + 流量爆炸；必须有重试上限
- ❌ `BuildConfig.VERSION_NAME?.startsWith("v")` 用 `?.` 当 NPE 防御 → 返回 `null` 给后续比较，逻辑还是错

---

## 15. better-sqlite3 Number→TEXT `"1.0"` trap（隐性风险）

SQLite 用 "type affinity" 而非严格类型——列声明 `TEXT` 但实际存储类型由**绑定时的值类型**决定。JavaScript 所有数字都是 64-bit double，better-sqlite3 把 JS Number 绑到 TEXT 列时，**SQLite 把它存为 REAL 而不是 TEXT**。后续 `WHERE col = '1'`（字符串字面量比较）会让 SQLite 把存的 REAL `1.0` 转回字符串得到 `"1.0"`——和 `"1"` 不等——**查不到**。但你 `SELECT col` 看到的还是 `1`（数字显示），人肉对比觉得"明明就是 1，怎么查不到"，去查 WHERE 子句、collation、索引——全是死路。

**为什么排查难**：

- `SELECT col FROM table` 输出 `1`，看起来一切正常
- `SELECT typeof(col) FROM table` 才暴露真相，返回 `'real'` 而不是 `'text'`
- 单条记录手动 INSERT 字面量 `'1'` 查得到，但应用代码绑 JS Number 后查不到——同一张表行为不一致
- 失败是 silent miss（返回空结果），不是 error；上层逻辑当"不存在"处理
- 调试时 `console.log(value)` 显示 `1` 而不是 `1.0`，让人以为 binding 没问题

**5 处实战 fix 位置**（项目内已修）：

- `desktop-app-vue/src/main/skill-tool-system/tools/knowledge-handler.js` `_snapshotVersion`
- 同文件其余 4 处类似的 version / id / sequence 字段 binding

**修法（强制字符串绑定）**：

```js
// ❌ broken
stmt.run({
  noteId,
  snapshotVersion: Number(version),   // 绑为 REAL，列即使声明 TEXT
});
// 后续 WHERE snapshot_version = '1' 查不到，因为存的是 1.0

// ✅ correct
stmt.run({
  noteId,
  snapshotVersion: String(version),   // 强制 TEXT 绑定
});
// 存为 "1"，WHERE snapshot_version = '1' 命中
```

`String()` 包一层让 better-sqlite3 走 text 路径，SQLite type affinity 也按 TEXT 存，存的字面就是 `"1"`。

**检测 SOP**（diagnose existing data + 防回归）：

```sql
-- 1. 看现有数据真实存储类型
SELECT col, typeof(col), CAST(col AS TEXT) FROM your_table LIMIT 5;
-- typeof 应该全是 'text'；出现 'real' / 'integer' 说明历史写入时已 broken

-- 2. 修法（一次性数据修复）
UPDATE your_table SET col = CAST(col AS TEXT)
WHERE typeof(col) != 'text';
-- 但 CAST(1.0 AS TEXT) 在 SQLite 给 '1.0' 不是 '1'，仍 broken
-- 真正的迁移要逐行处理：
UPDATE your_table SET col = CAST(CAST(col AS INTEGER) AS TEXT)
WHERE typeof(col) = 'real' AND col = CAST(col AS INTEGER);
-- 仅当 REAL 真是整数值时安全
```

**对称提醒 — 不止 Number 一种 binding 坑**：

| JS 值 | 绑 TEXT 列实际存储类型 | 修法 |
|---|---|---|
| `Number(1)` / `1` / `1.0` | REAL（值 `1.0`） | `String(value)` |
| `true` / `false` | INTEGER（值 `1` / `0`） | `value ? '1' : '0'` 或 `String(value)` |
| `null` | NULL（不变） | 按业务需要，通常不变 |
| `undefined` | 抛 SQLITE_RANGE error | 显式 `?? null` |
| `Date` 对象 | 报 `unsupported type`（better-sqlite3 拒） | `.toISOString()` |
| `BigInt` | 取决于编译选项，默认抛 error | 走 `safeIntegers(true)` mode |

**反模式**：

- ❌ 改列声明 `TEXT` → `INTEGER` "让它接受数字"——绕开问题但破坏现有数据语义，且 version / id 类字段未来可能要支持非数字（如 `"v1"`、UUID），TEXT 是对的
- ❌ 应用层加 `WHERE col = ?` + `[Number(v)]` 让查询也走 REAL —— silent works，但混存 TEXT + REAL，下次有人写 `WHERE col = '1'` 又炸
- ❌ `parseInt(value, 10) + ''` 当 `String()` 替代——丢小数信息；如果 version 字段未来允许 `"1.2"`、`"v1"`，整个数据迁移又得重做
- ❌ 信赖 ORM 自动处理——better-sqlite3 不是 ORM，且即使 ORM 层（drizzle / kysely）做了类型映射，**raw query 路径绕开**

**衍生 — 跨 SQLite-engine 兼容性**：

- 标准 `sqlite3` npm 包（async）的 binding 行为与 `better-sqlite3` 不完全一致
- `better-sqlite3-multiple-ciphers`（项目用的加密版，与 #12 Node 23 prebuild gap 相关）继承 better-sqlite3 行为
- 切换 driver 时必须重跑数据完整性测试，type affinity 行为不保证一致

**单测覆盖建议**：

```js
// 任何写 TEXT 列的 handler 都该有这俩测试
it('binds version as TEXT, not REAL', () => {
  db.prepare('INSERT INTO notes (id, version) VALUES (?, ?)').run('n1', '1');
  const row = db.prepare("SELECT typeof(version) AS t FROM notes WHERE id = 'n1'").get();
  expect(row.t).toBe('text');  // 不是 'real'
});

it('WHERE version = string literal hits row after JS Number write', () => {
  handler._snapshotVersion('n1', 1);  // 走真实代码路径
  const row = db.prepare("SELECT * FROM notes WHERE version = '1'").get();
  expect(row).toBeDefined();  // 不是 undefined
});
```

---

## 16. commit-msg hook scope regex 拒数字（隐性风险）

`.husky/commit-msg` 用 Conventional Commits 校验提交信息格式：`<type>(<scope>): <subject>`。当前 scope 部分的正则是 `[a-z-]+`——**字符集里没有数字**。任何带数字的 scope 都会被拒：`feat(p2p)` / `feat(v6)` / `feat(b4)` / `fix(http2)` / `refactor(b2b)` 全 reject，错误信息是通用的"commit message format invalid"，**不指明具体哪一段炸**。

**为什么排查难**：

- hook 报错只说"format invalid"，不告诉你违规的字符在第几位
- type 部分（`feat` / `fix` 等）看起来没问题
- 反引号 / 中文 / 标点等明显违规更容易想到，数字这种"看起来字母"的字符不在嫌疑名单
- 团队约定文档里 scope 例子常带数字（`p2p`、`v6`、`b4`、产品代号），更没人意识到 regex 不允许
- IDE / CLI git client 提交后才报错，编辑器内没提示

**当前 regex**（`.husky/commit-msg`）：

```bash
# 大致结构（简化）
pattern='^(feat|fix|security|docs|refactor|test|chore|perf)(\([a-z-]+\))?: .+'
#                                                              ^^^^^^^
#                                                              scope 字符集 — 缺 0-9
grep -qE "$pattern" "$1" || {
  echo "commit message format invalid"
  exit 1
}
```

**已知 reject 实例**：

| 想用的 scope | reject 原因 | workaround（不改 hook 的话） |
|---|---|---|
| `feat(p2p)` | `2` 不在字符集 | `feat(peer)` / `feat(mobile)` |
| `feat(v6)` | `6` 不在字符集 | `feat(shell)` / `feat(ui)` |
| `feat(b4)` | `4` 不在字符集（B4 是 surgery 代号） | `feat(release)` / `feat(packaging)` |
| `fix(http2)` | `2` 不在字符集 | `fix(http)` / `fix(transport)` |
| `feat(mtc-v0-5)` | `0` / `5` 都不在 | `feat(mtc)` |
| `feat(ios-1-7)` | `1` / `7` 不在 | `feat(ios)` / `feat(pairing)` |

**实战影响**：项目本身的产品代号大量带数字（`v6`、`B4`、`MTC v0.5`、`iOS Phase 1.7`、`P2P`），最终约定形成"绕开数字"的写法：

```
✅ 已 land 的纯字母 scope
feat(mobile): ...
feat(android): ...
feat(desktop): ...
feat(cli): ...
feat(shell): ...
feat(plugin): ...
feat(hub): ...
```

数字版本号 / Phase 号往往挪到 subject 部分：

```bash
# ❌ scope 带数字 reject
feat(p2p-1.7): land iOS pairing real-device E2E

# ✅ 数字移到 subject
feat(ios): land iOS Phase 1.7 pairing real-device E2E
```

**两个选项 — 改 hook 还是绕**：

| 方案 | 工作量 | 风险 |
|---|---|---|
| 改 regex 为 `[a-z0-9-]+` | 1 行 + 1 commit | 历史 commit 已全部走"绕"模式，开放数字后团队风格分裂（旧 commit `feat(mobile)` vs 新 `feat(p2p)`）；约定漂移 |
| 维持现状，记忆"scope 纯字母" | 0 | 新人持续踩坑；产品代号带数字时不直观 |

**当前选择**：维持现状 + 文档化。理由：历史一致性 > 灵活性；项目内已有~1500+ commit 走纯字母路径，改了反而割裂。

**触发场景清单**：

- 写 commit 前给 scope 起名时，**默认假设**字符集没数字
- 看到别人 `feat(mobile)` 类似 commit，复用模板里的 scope name
- IDE 模板 / git commit message template 里硬编码 scope name，不靠现场决定
- husky allowlist type 已知是 `feat|fix|security|docs|refactor|test|chore|perf`——超出这 8 个 type 也会 reject（与 scope 是两条独立规则，别混淆）

**反模式**：

- ❌ `--no-verify` 绕过 hook——CLAUDE.md 全局禁，必须用户明确授权
- ❌ 把数字改成英文（`feat(ptwop)` 替代 `feat(p2p)`）——可读性更差
- ❌ 给 scope 加空格 `feat(v 6)`——括号内空格也违反 conventional commits
- ❌ scope 留空 `feat: ...`——合法，但失去归类信息

**检测 SOP**（写完 commit 信息预检）：

```bash
# 拒之前在 stage 阶段就验
msg='feat(p2p): land pairing'
echo "$msg" | grep -qE '^(feat|fix|security|docs|refactor|test|chore|perf)(\([a-z-]+\))?: .+' \
  && echo "✅ pass" || echo "❌ reject — check scope chars"

# 项目里如果有更复杂 hook（multi-line body / footer），跑实际 hook 文件
bash .husky/commit-msg <(echo "$msg")
```

**衍生 — type allowlist 同步更新**：

- 当前 allowlist：`feat|fix|security|docs|refactor|test|chore|perf`
- **缺**：`build` / `ci` / `revert` / `style`（Conventional Commits 标准型）→ reject
- 想加新 type 必须同步改 hook + 团队约定
- 加新 type 不是数字问题但与 scope 一同被 hook 拒，错误信息一样模糊

---

## 17. Android remote file skill 接通 6 雷（隐性风险）

Android 端新加 `RemoteCommandClient.invoke` 系列命令（file / clipboard / notification / screenshot 任一）时，需要同时跨越 4 个 Plan C 路径互锁雷 + 2 个 UX 坑。**任一未修，整条链路就断**——最坏情况调用方 30s 超时报 "Job was cancelled"，没有具体错误信号指向真因。2026-05-17 接通 remote file skill 时一晚踩齐，本条把组合拳记录下来防回归。

> 下面的 file:line 引用以提示思路为主，使用前需 `grep` 验证当前代码。

**4 个传输互锁雷**（必须**同时**修才能工作）：

**雷 1 — `P2PClient` chainlesschain:* skip guard 太宽**

```kotlin
// android-app/.../P2PClient.kt:538 附近（旧 guard）
if (raw.contains("\"type\":\"chainlesschain:")) return
```

`SignalingRpcClient` 用 `chainlesschain:*` envelope；后加的 guard 把所有 `chainlesschain:*` 一刀切，**连 `P2PClient.sendCommand` 自己发的命令的 response 也吞了**，`pendingRequests` 永远不 resolve → 30s 超时。修法：缩窄到只 skip `chainlesschain:command:request`，放行 `chainlesschain:command:response`。

新加 RPC client 前必 grep `chainlesschain:` skip 类 guard，确认 demux 不互相吃响应。

**雷 2 — Plan C 路径下 `P2PClient._connectionState` 永远 DISCONNECTED**

```kotlin
fun sendCommand(...) {
  if (_connectionState.value != ConnectionState.CONNECTED) return failure("Not connected")
  // ...
}
```

`P2PClient` 是为带 DID 认证 + permissionGate 的 trust 路径设计；Plan C（`RemoteOperateScreen` → signaling forward）**根本没调过 `P2PClient.connect()`**，state 一直 DISCONNECTED → 所有命令立刻失败。

**不要**用 `P2PClient.sendCommand` 当 transport。改用 `SignalingRpcClient.invoke(pcPeerId, method, params)`，`pcPeerId` 从 `PairedDesktopsStore.devices.firstOrNull()?.pcPeerId` 拿；模板看 `RemoteCommandClient.invokeTyped` 的 delegate。

**雷 3 — 桌面 `handleFileCommand` 是简陋 stub**

`desktop-app-vue/src/main/index.js` 里的 inline `handleFileCommand` switch 只有 `case "list"` + `case "requestUpload"`（后者会**弹 `dialog.showOpenDialog` PC 文件夹选择框**——用户体验灾难），其余 case 全部 `throw "Unknown file action: X"`。

Plan C 的 `routeMobileCommand` 是简陋 dispatch，跟正式的 `remote-gateway.commandRouter`（注册 14 个 namespace handler）**没接上**。

新加 PC 端 mobile-bridge 命令 namespace **不要复用**这个 inline switch。写专门的 handler（`android-<feature>-handler.js` 模式）然后让 `handleXxxCommand` delegate。

**雷 4 — `FileTransferHandler` 复用诱惑**

`remote-gateway` 注册的 `FileTransferHandler` 命名相似，容易当作可复用，但：

- `_resolvePath` 把所有 path 强制 prefix `app.getPath("userData")` → 浏览 `C:\Users\...` 一律 `Access denied`
- 字段命名跟 Android 不一致（`dirPath` vs Android `path` / `items` vs `entries` / `isDirectory bool` vs `type "directory"|"file"`）
- 是给某个 web-shell 子项目写的，**不是给 Android remote 用**

正确做法：Android remote 自己写 handler（`android-file-handler.js` 模式），**无 sandbox**（trusted paired mobile peer）+ 字段对齐 Android `FileCommands.kt` 的 `@Serializable` model。

**2 个 UX 坑**：

**雷 5 — checksum 算法不匹配 → repository 自删下载文件**

`AndroidFileHandler.requestDownload` 第一版返 `checksum: "sha256-prefix:abc..."`（头部 32KB SHA256），但 `FileTransferRepository.kt` 期望 `"md5:" + 完整 MD5`——对不上**立刻删本地文件** + 标 FAILED + 抛 "Checksum mismatch"。用户看到的：下载完了但文件没了。

协议没强制 checksum 格式 → handler 自由发挥踩雷。

修：对齐 `"md5:" + crypto.createHash("md5").update(buf).digest("hex")`（全量 MD5），或 `checksum: null` 让 Repository 跳过验证。**不要自创 prefix**。

**雷 6 — `getExternalFilesDir(null)` 用户找不到下载的文件**

老路径 `/sdcard/Android/data/com.chainlesschain.android.debug/files/downloads/` 在 Android 13+ scoped storage 下**普通文件管理器看不到**（要点 5 层 + 开"显示隐藏"）——app-private external storage 是个 dev-only 路径，对普通用户 = "文件下载失败"。

API 29+ 用 `MediaStore.Downloads.EXTERNAL_CONTENT_URI` insert 写公共 Download 目录（`/storage/emulated/0/Download/`），原生文件管理器 / 相册 / 阅读器都能直接看到；不需要 `WRITE_EXTERNAL_STORAGE` 权限。返给 UI 的 `content://` uri 直接喂 `Intent.ACTION_VIEW` 拉起系统 viewer。

**新加 remote skill checklist**（防回归）：

```bash
# 1. transport 选对了吗？
grep -n 'P2PClient.sendCommand' android-app/.../<NewSkill>Commands.kt
# 应该是 0 匹配；用 SignalingRpcClient.invoke 或 RemoteCommandClient.invokeTyped

# 2. envelope guard 没误伤新命令的 response
grep -rn 'chainlesschain:' android-app/.../P2PClient.kt
# 看 skip 规则是否只针对 request 不针对 response

# 3. 桌面端有专门 handler 不是 inline switch
ls desktop-app-vue/src/main/remote/handlers/android-*.js
# 新 skill 应该在这里有对应文件

# 4. 字段命名跨端对齐
# Android Kotlin @Serializable data class 字段名 ≡ JS handler 返回 JSON key 字段名
# 容易漏：camelCase 大小写 / 单数 vs 复数 / type-string vs boolean

# 5. 文件落地路径用户能看到（仅文件传输类）
grep -n 'getExternalFilesDir' android-app/.../FileTransferRepository.kt
# 应优先 MediaStore.Downloads.EXTERNAL_CONTENT_URI 路径
```

**反模式**：

- ❌ "复用现有 `FileTransferHandler`，命名都一样应该兼容"——上面雷 4 全套都吃
- ❌ skip guard 用宽松字符串匹配（`contains("chainlesschain:")`）——必踩雷 1
- ❌ 走 `P2PClient.sendCommand`（"看起来更正式"）——必踩雷 2
- ❌ 桌面 handler 直接 `throw` 未实现 case——前端 0 错误恢复，调用方只看到通用超时
- ❌ Android 端用 `getExternalFilesDir`——dev 测得通（adb shell 进去看就行），用户找不到 → 反馈"下载坏了"

**衍生 — Plan C 架构 reference**：

- Plan C = signaling-relay only（mobile → relay → desktop，无 WebRTC）
- Plan A = full WebRTC P2P
- Plan A.1 = WebRTC + xterm.js 远程终端（已 v5.0.3.54 闭环）
- 新 skill 默认走 Plan C（最简单 + signaling-relay + TURN 47.111.5.128 已部署）；Plan A 需要 trust 路径，工作量大

**stash trap 提醒**（与 #9 并行 session race 关联）：

接 remote file 那晚同时遭遇并行 session 把未 commit 改动 `git stash` 成 `WIP-other-sessions-2026-05-17`。看起来像 user "revert" 改动，实际没丢，`git stash list` 能找到。Untracked 新文件（如新 handler `.js`）**默认不进 stash**，仍在工作树。怀疑改动消失先 `git stash list` 看 `WIP-other-sessions-*`；`git stash apply stash@{N}` 比 `git stash pop` 安全（保留 stash 防误删）。

---

## 18. GitHub immutable releases burn tag namespace（隐性风险）

`chainlesschain/chainlesschain` 开启了 GitHub **immutable releases**（Repo Settings → Code, planning, and automation → General → "Enforce immutable releases"），通常出于 supply-chain provenance / SLSA-style 保证。这给 release pipeline 加了两条不直观的硬约束：

1. **任何 release publish 后，asset 不可再上传**——只 draft 可改
2. **删除任何 release 永久 burn 它的 `tag_name`**——以后没人能再用这个 tag 名（HTTP 422 — `tag_name was used by an immutable release`）

后者特别痛：不是 "24h 冷却"，是**永久**。GitHub UI 完全不警告，删除按钮没标注后果。一次"测试发布"用了真打算发的 tag 名 → 这个 tag 永远报废。

**为什么排查难**：

- 报错只在创建 release 时出现，且是单一 422，错误文案"used by an immutable release"很多人第一反应去找正在用这个 tag 的 release（找不到，因为已删）
- git tag 本身没事（`git tag -l` 还在），只是 GitHub Releases API 拒绝再绑定
- 修法是给 release 起新 tag 名（`v1.0.0` → `v1.0.0-mirror` / `-ga` / 类似后缀），用户看到的 release 名/URL 永久带这个后缀

**当前已知 burned tags**（不要再尝试）：

| Tag | 烧毁时间 | 替代 |
|---|---|---|
| `android-v1.0.0` | 2026-05-13 测 Android update channel parity | 真 release 在 `android-v1.0.0-mirror` |

新踩到一个就追加到这表，**不要忘记记录**——下次想"为什么这个 tag 报 422"时 grep 这里。

**完整 release 流程必须遵守的 4 条规则**（draft-until-complete pattern）：

**规则 A — 永远 draft-first**

```yaml
# release.yml 必须的三段式
1. gh release create <tag> --draft --target <sha>  # 创 draft（tag 还可救）
2. for asset in <assets>; do
     curl -X POST -H "Authorization: Bearer $(gh auth token)" \
       --data-binary @$asset \
       "https://uploads.github.com/.../assets?name=$asset"
   done                                            # 全部上传完
3. gh api -X PATCH "/repos/.../releases/$id" -f draft=false  # 最后一步 publish
```

如果中间任何一步失败：draft 还在 → **可以删 + 重创**（draft delete 不 burn tag）；但是 **publish 后任何 asset 缺失 = 切下一个版本号**，没有补救路径。

**规则 B — 失败清理必须删 release 在删 tag 之前**

```bash
# ❌ 反模式（顺序错）
git push github :refs/tags/v5.0.3.42                       # 先删 tag
gh release delete v5.0.3.42 --yes                          # 再删 release
# → 中间窗口 release 变 "orphan-tagged"，gh release list 看着混乱

# ✅ 正确顺序
gh release delete v5.0.3.42 --yes                          # 1. release 先（draft 不 burn）
git push github :refs/tags/v5.0.3.42                       # 2. tag 后
git tag -d v5.0.3.42                                       # 3. 本地 tag 清

# 关键：步骤 1 仅当是 DRAFT 状态时安全。已 published 的 release delete = tag burn
gh release view v5.0.3.42 --json isDraft
```

**规则 C — 强制移动 tag 仅当尚无 release**

```bash
# 探测
gh release view v5.0.3.42 2>/dev/null && echo "release exists, do NOT force-move" \
                                       || echo "safe to force-move"

# 仅当无 release 时
git tag -f v5.0.3.42 <new-sha>
git push github --force v5.0.3.42      # workflow 重触发
```

如果 release 已存在（即使 draft），force-move tag 会让 release 的 `tag_commit` 与远端 tag 不一致——GitHub UI 可能仍展示旧 commit 的 changelog。

**规则 D — `gh run rerun --failed` 用原 event SHA 的 workflow 文件**

> GitHub docs: "Re-running a workflow uses the same workflow file, secrets, and code that ran in the failed run, even if you have made changes to those files since."

意思：tag-push 触发的 release run，rerun 用**那个 tag commit 时的** `.github/workflows/release.yml`，**不是当前 main 上的**。你修了 workflow bug 然后 rerun → 修复**不会**生效。

**Workaround**：用 `gh workflow run release.yml --ref main -f version=vX.Y.Z` (workflow_dispatch) → dispatch 走 main HEAD 的 workflow 文件。代价：全平台重 build ~30-40min，丢弃原 run 的成功 artifacts。

何时 `--failed` rerun 仍然对：workflow 文件本身没问题，只是 transient 故障（network blip、signing race、runner flake）。

**create-release hang 救援 SOP**（>30min 无进展 = hung 不是慢）：

```bash
# 基线：v5.0.3.40 create-release 步骤 6min，v5.0.3.39 ~5min
# 如果跑 >30min 是 hung 状态，default job timeout 是 360min — 不救会浪费 4h+

gh run cancel <run-id>
# 等 status 变 completed (cancelled conclusion, ~30s)
gh run rerun <run-id> --failed
```

**注意**：`gh run rerun --failed` 要求 workflow 整体 `completed`。如果其他 job 还 `in_progress`（如 build-linux fail 但 build-windows 还在跑）→ rerun 拒绝："This workflow is already running"。必须等所有 job 完成才能 rerun。

**操作 footguns**：

- ❌ `gh release create v5.0.3.X --notes ...`（直接 published）→ 一旦 upload fail，整个 release 是废的，tag 也没了
- ❌ `gh release upload <tag> <new-asset>` on published release → 422
- ❌ `gh release upload <tag> <existing> --clobber` on published → 422（内部 DELETE 步骤 fail）
- ❌ `gh api --hostname uploads.github.com` → gh 前缀 `api.` → 试 `api.uploads.github.com` DNS fail。用 `curl` 直接上传
- ❌ `target_commitish: <historical-sha-not-at-branch-HEAD>` → 即使 `GET /commits/SHA` 200，Releases API 给 404。Workaround：先 `git tag X SHA && git push github X` 再创 release 不带 `target_commitish`
- ❌ "测试 release 用真 tag 试试看"——一次失误永久 burn
- ❌ `gh release create` 因 `workflow` scope 缺失 403 → 用 `gh api -X POST /repos/.../releases --input -`（底层 REST 只需 `repo`）

**绝对安全的测试 tag 命名**：

```
zztest-yyyymmdd-<n>     # 排序排到最后，明显不可用
junk-<purpose>          # 删了无所谓
sandbox-<feature>       # 用完就 burn
```

**CLI 版本陷阱**（与 #7 npm 发版漏发关联）：

- `publish-cli-precheck` 严格从 `packages/cli/package.json` 读 CLI npm 版本（**不能**从 `inputs.version`/tag 解析）
- tag 是 4 段（`v5.0.3.49`）vs npm 需要 3 段 semver
- CLI src 改动**必须**同步 bump `packages/cli/package.json`，否则 precheck 看到已发布 → `ALREADY_PUBLISHED=true` → cli-tests **跳过** → broken code 上 GitHub Releases tarball 用户视角
- 检测：`git diff <prev-tag>..HEAD -- packages/cli/src/` 有任何改动 → 必 bump

**ECONNRESET hardening**（已 land，post-v5.0.3.44 commit `0989d1ac4`）：

- release.yml 16 个 `npm install`/`npm ci` 调用全部走 3-attempt retry（15s / 30s backoff）
- `.github/actions/setup-node-deps/action.yml`（composite，4 site）+ `.github/scripts/ci-npm-retry.sh`（12 inline site）
- 单次 ECONNRESET 不再触发 rerun—— pre-hardening 时单字节网络 blip 烧 20-30min 等其他 job 完成才能 rerun

**正确 release flow 总览**：

```
1. git tag v5.0.3.X <sha>
2. git push github v5.0.3.X            # 触发 release.yml
3. workflow:
   a. build all platforms              # 失败 → --failed rerun（前提：workflow 文件无 bug）
   b. create-release --draft           # 失败 → 删 draft + force-move tag + 重 push
   c. upload all assets to draft       # 失败 → cancel + rerun (draft 还在)
   d. PATCH draft=false                # 失败 → draft 还在，可救
4. post-publish:
   - 缺 asset → 切下一版本（无补救）
   - workflow file bug 触发 → 用 dispatch 跑 main HEAD
```

---

## 19. Android release-mode R8 minify 只在 CI 暴露（隐性风险）

> **状态升级 (2026-05-26)** — `.github/workflows/android-release-precheck.yml` 已 land，每个改 `android-app/**` 的 PR 自动跑 `assembleRelease` + `bundleRelease`（job: `shipping-config`，**mandatory**）。"形态 A" Missing class 失败现在 PR 时就 catch，不再 burn release tag。配套 advisory `r8-fullmode-probe` job（continue-on-error）作 R8 上游 race 修复的 passive watchdog —— 一旦它 transitions 转绿就是信号可以翻默认。这条陷阱仍保留供"为什么以前老炸"的历史记录，但实操路径已自动化。

**陷阱本质** — Android debug build 走 `isMinifyEnabled = false`，**完全跳过 R8**；release build (`./gradlew :app:assembleRelease`) 才跑 `:app:minifyReleaseWithR8`。任何新引入的"重 lib dep"（Ktor / gRPC / SLF4J / 大反射 / 引用 `java.lang.management.*` 的 JVM-only lib）只在 release 模式才暴露 R8 失败。

新 lib commit 之后跑 `./gradlew assembleDebug` 全绿 + unit tests 全绿 + 真机 debug APK 跑得动 → **以为没事** → 直接打 tag 推 release → CI 跑 `:app:minifyReleaseWithR8` → 失败 → 整条 release pipeline 已经 `gh release create --draft` 成功了一半（desktop 全绿，Android 缺 4 个 asset），但 GitHub immutable releases 让这个 tag 永久 burn，要发 Android 必须再打个新 tag。

**为什么排查难**：

1. 失败延迟到 release CI 才出现（dev / CI debug 全绿）
2. R8 错误信息形态多样且 misleading：
   - `Missing class java.lang.management.ManagementFactory` — 看着像缺依赖，实际只需 `-dontwarn`
   - `R8: java.util.ConcurrentModificationException`（没行号没类名）— 像 R8 内部 bug，实际是 fullMode 触发，需要切 compat mode
3. `release.yml` 里 `create-release` 条件只 require **3 个 desktop build** 成功，Android 失败不阻塞 release 创建（best-effort 设计）→ "workflow conclusion=failure 但 release 已 published 缺 Android assets" 隐性现象
4. memory `feedback_android_tag_follows_desktop.md` 记录 Android 自更新走 desktop tag → release 缺 Android assets = Android 用户彻底无法收到这个版本的自更新（silent）

**SOP — 自 2026-05-26 起自动化**：

`.github/workflows/android-release-precheck.yml` 在每个 `android-app/**` PR 上跑 `assembleRelease + bundleRelease`（`shipping-config` job, mandatory, ~15 min on ubuntu-latest）。失败 → PR 不可 merge。

**本地手动验**（仍推荐在 dep-bump PR commit 前跑，加速反馈）：

```bash
cd android-app

# 1. 本地 release-mode 试 R8（5-8 min）
./gradlew :app:assembleRelease

# 2. 验产物存在
ls app/build/outputs/apk/release/*.apk

# 3. 通过后再 bump 版本 / tag
```

**R8 fullMode advisory probe** — 同 workflow 第二个 job (`r8-fullmode-probe`, `continue-on-error: true`) 用 `-Pminify.override=true -Pandroid.enableR8.fullMode=true` + sed 去掉 `-dontoptimize` 重启完整 R8。当前预期 fail（AGP 8.5.2 上游 CME 未修）。**probe 转绿即信号**：可以考虑翻默认（build.gradle.kts:121 / gradle.properties:77 / proguard-rules.pro:17）。

**两种 R8 失败的修法（按错误形态分流）**：

```
# 形态 A — Missing class X
ERROR: Missing classes detected while running R8.
ERROR: R8: Missing class java.lang.management.ManagementFactory
       (referenced from: io.ktor.util.debug.IntellijIdeaDebugDetector)
Missing class org.slf4j.impl.StaticLoggerBinder

→ 在 android-app/app/proguard-rules.pro 加：
  -dontwarn java.lang.management.**
  -dontwarn org.slf4j.impl.**
  -dontwarn org.slf4j.**
  -dontwarn <lib>.util.debug.**
  -keep class <lib>.** { *; }
  -dontwarn <lib>.**

→ R8 也会自动生成 app/build/outputs/mapping/release/missing_rules.txt
  可以直接 cat 那个文件抄进 proguard-rules.pro 一次性解决多个

# 形态 B — ConcurrentModificationException（无类名/无行号）
ERROR: R8: java.util.ConcurrentModificationException
> Task :app:minifyReleaseWithR8 FAILED

→ 是 AGP 8.x R8 full-mode 在大 Hilt+Ktor+SLF4J 合并 dex 时的 upstream bug
  (issuetracker.google.com/issues/238045415)
→ 改 android-app/gradle.properties:
  android.enableR8.fullMode=false
→ Trade-off: DEX ~3-5% 大，无 runtime perf 回归
```

**反模式**：

- ❌ "release.yml 里加 `sed` 改 gradle.properties 兜底" — 历史教训：v5.0.3.80 之前的 release.yml 注释写着 "Disable R8 full mode" 但 sed 只改了 `org.gradle.jvmargs` 完全没改 `enableR8.fullMode`，所以 release CI 永远跑 fullMode=true 直到 v5.0.3.81 才发现。**修法：改 source 文件 (gradle.properties)，让 CI + 本地一致。**
- ❌ "等下次 release 顺便修" — 缺 Android asset 这个 tag 就废了，Android 用户卡在老版本直到下次有完整 Android assets 的 release
- ❌ "只跑 unit test 就以为没事" — JVM unit test 走 mockable Android jar 不触 R8

**实战记录** — v5.0.3.80 → v5.0.3.82 hotfix 链（2026-05-22 → 23, ~4h）：

| Tag | 失败形态 | 修法 commit | 经验 |
|---|---|---|---|
| v5.0.3.80 | `Missing class java.lang.management.*` + slf4j `StaticLoggerBinder` | `c42aa603c5` 加 5 行 `-dontwarn` | A3 端侧 LLM 引入 Ktor 后**首次** release-mode build；本地 `assembleDebug` 没暴露 |
| v5.0.3.81 | `ConcurrentModificationException` | `14d574c046` `enableR8.fullMode=false` | release.yml 早有注释承诺 disable 但 sed 漏改 property |
| v5.0.3.82 | (全绿，首次完整 success) | — | 验证两个修法稳定 |

烧 3 个 immutable tag namespace + ~4h CI 时间，全部因为没在加 Ktor 时本地跑 `assembleRelease`。

**关联陷阱**：

- #14 Android in-app update — 缺 Android assets 时 UpdateChecker.kt 拉不到下载
- #18 GitHub immutable releases — burnt tag 不可复用
- memory `feedback_android_tag_follows_desktop.md` — Android 下载链跟 desktop tag

---

## 20. Post-onload JS-set cookie race in WebView capture（隐性风险）

**陷阱本质** — `WebViewClient.onPageFinished(url)` 在 `DOMContentLoaded` 后立即触发，但反爬严格的平台（Bilibili / Weibo / Douyin / 小红书 / 抖音）的**关键鉴权 cookie 由 `window.onload` 之后的 JS 写入**：发首页指纹请求 → 服务端返回 token → `document.cookie =` 写入。在 onPageFinished 当帧抓 `CookieManager.getCookie()` 会**抢跑这段 JS**，拿到一个看似登录成功（含 SESSDATA + DedeUserID）但缺反爬关键字段（buvid3 / bili_jct）的"半截 cookie"。

后果不是抛错，是**反爬服务端静默降级**：`api.bilibili.com` 不返回 `-412`（反爬拦截）或 `-101`（未登录），而是返回 `{"code": 0, "message": "0", "data": {"list": []}}` —— **success path with empty payload**。客户端 `apiClient.lastErrorCode == 0`、走 success 分支、把"4 个 API 都返回空"展示给用户，没有可操作的恢复提示。

**为什么排查难**：

1. **失败 silent**：HTTP 200 + JSON `code:0` + 空 list = 走 success 分支
2. **抓 cookie 时机依赖设备**：低端机 JS 慢、首页加载完到 buvid3 写入间隔可能 1.5-3s；高端机 < 500ms — 测试机可能抓到，用户机抓不到
3. **CookieManager 缓存让一次成功永远成功**：第一次抢跑失败后再次登录会读到缓存的旧 cookie；只有走 `removeAllCookies` + 重新走完整登录流程才能复现
4. **"登录成功"假象误导**：UI 显示 `已登录 UID:N` + `上次同步 X:Y`（cookie 含 DedeUserID 解析成功 + collector recordSync 写过文件），用户和开发都以为登录链路通了
5. **JVM unit test 完全测不到**：`view.postDelayed` 需要 Looper；Robolectric 跑 WebView 极重且不稳；这个 race 只能真机重现

**真机记录** — Xiaomi 24115RA8EC v5.0.3.84 2026-05-23：

> UI 提示「4 个 API 都返回空 — API 返回空 + 无错误码 — 可能 cookie 缺关键字段（bili_jct / buvid3）」。BilibiliApiClient `lastErrorCode = 0`，HubLocalViewModel fall 到「无错误码」分支。

**SOP — 任何 WebView cookie 采集前必跑的两步联动**：

```kotlin
// 1) 抓 cookie 前给 JS 一个执行窗口 — 至少 2000ms
override fun onPageFinished(view: WebView, url: String) {
    super.onPageFinished(view, url)
    if (!isLoginSuccess(url)) return
    view.postDelayed({
        CookieManager.getInstance().flush()
        val cookie = CookieManager.getInstance().getCookie(cookieDomain) ?: ""
        if (cookie.isNotEmpty()) onLoginCookie(cookie)
    }, 2000L)  // COOKIE_CAPTURE_DELAY_MS
}

// 2) 持久化前校验全部"反爬关键字段"，缺哪个用 sealed 返哪个
sealed class AcceptResult {
    object Ok : AcceptResult()
    data class MissingField(val name: String) : AcceptResult()
}

private val REQUIRED_FIELDS = listOf("SESSDATA", "DedeUserID", "bili_jct", "buvid3")

fun acceptLoginCookie(cookie: String): AcceptResult {
    val uid = extractUid(cookie)
        ?: return AcceptResult.MissingField("DedeUserID")
    val missing = REQUIRED_FIELDS.filter { parseCookieValue(cookie, it).isNullOrBlank() }
    if (missing.isNotEmpty()) return AcceptResult.MissingField(missing.joinToString(", "))
    credentialsStore.saveCredentials(cookie, uid, displayName)
    return AcceptResult.Ok
}
```

**反模式**：

- ❌ "抓到 cookie 立刻持久化" — 一旦写入 store，下次 sync 拿这个半截 cookie 用，silent fail；用户看到的全是「4 API 都空」/「同步 0 事件」毫无可操作信息
- ❌ "只校验 DedeUserID / SESSDATA 一两个字段" — `extractUid` 能从只有 SESSDATA + DedeUserID 的"半截 cookie"成功解出 UID，假象登录有效
- ❌ "为节省登录用户体验跳过 2s 延迟" — 2s 延迟可以配 banner "正在抓取登录态…"，比 silent empty 强 100 倍。低端机实测需要 1.5-3s
- ❌ "依赖 `CookieManager.flush()` 就够了" — flush 只把内存 cookie 写到磁盘，不会让 JS 跑得更快；JS 没执行的字段 flush 也读不到
- ❌ "针对 Bilibili 单独加延迟" — Weibo / Douyin / Xiaohongshu / 抖音都用 post-onload JS 写 cookie，统一 2s 延迟对它们无害且预防同类问题

**单测覆盖建议**（虽然测不到 `postDelayed`，但要锁住第二步）：

- `acceptLoginCookie returns MissingField buvid3 when only buvid3 missing`
- `acceptLoginCookie returns MissingField with comma-joined names when 多 field missing`
- `acceptLoginCookie returns MissingField SESSDATA when SESSDATA blank`（防 `extractUid` 仁慈通过的边界）
- VM 侧：`onLoginCookie buvid3-missing 给用户可操作 errorMessage`（含「重新登录」+「等首页加载完」）

**关联**：

- 设计文档：`docs/design/Bilibili_Cookie_Capture_And_Weibo_Sync_Timeout_Fixes.md`（含两步联动 + EntityResolver embedding timeout 替代方案否决理由）
- commit `2c8f41f97 fix(pdh-android): Bilibili cookie capture race + Weibo 120s timeout`
- memory `bilibili_post_onload_cookie_race.md`
- 相关：#15（silent SQLite 数据格式陷阱）— 同为 success-path silent fail 模式

---

## 21. 手写 tar parser 漏 GNU `@LongLink` 长名扩展（隐性风险）

**触发文件**：`android-app/feature-local-terminal/.../LocalFilesystemBootstrapper.kt` — 任何手写的 minimal tar parser 当 npm pack 输入路径 >100 字符即栽。

**陷阱本质**：

USTAR tar header 的 `name` 字段固定 100 字节 + `prefix` 字段 155 字节，对超过 255 字符或基名 >100 字符的路径必须用 GNU 扩展：先发一个 `typeFlag='L'` header（name 固定 `././@LongLink`），data 是下一 entry 真实路径 + NULL；紧跟的真 entry header 里 `name` 被截断到 100 字符。parser 必须识别 'L' typeflag，把 data 存进 pendingLongName，下一 entry 用它覆盖 header.name。

**修前 parser 的两种典型 silent failure**：

1. **`@LongLink` 当文件写**：parser 不识 typeFlag='L'，落到默认 `else -> regular file` 分支，把 long-name data 写到磁盘上一个叫 `@LongLink` 的文件（102 字节）。下一 entry 用 header 里 100-char 截断 name 当真实路径，文件落到 `bom-hand` 而不是 `bom-handling.js`。**Node `require('./bom-handling')` 找不到 → cc 子进程 exit 1 → 数据浏览全 0 → 用户以为"没采集到数据"，但 vault.db 里实际 2.9MB 真数据都在**。

2. **NULL terminator 残留**：即使加了 'L' handling，如果 `String(longBuf, ...)` 没剥末尾 NULL byte → File 路径含 NULL → libc `open(2)` 在 NULL 截断 → 文件落到错误位置。Java `File` API 把 NULL 当合法字符不抛异常，**测试断言 `File.isFile == false` 不报错只显示文件不存在**。Kotlin `String.trimEnd()` 不剥 U+0000（不属于 `Character.isWhitespace`）—— 必须用 `longBuf.indexOf(0)` 显式截断。

**为什么排查难**：

- 上层 wrapper `bootstrap-failed: rootDir must be verified to be directory beforehand` 是次生症状（`FileOutputStream` 对一个已存在的目录开写），离根因 N 层
- `ccModule.isDirectory` check 让"残留半解压"被识别为"已就绪"，APK 升级带新 fix 也不会重抽 —— 必须人工 `rm -rf` ccModule + marker 才能触发
- 早期 cc bundle 路径都 <100 字符，加 @aws-sdk 这类深 dep 才会突然爆雷；blame 指向引 dep 的 commit，但实际根因在年代久远的 tar parser
- 测试覆盖盲区：unit test 用短名 tar 入口都通过；只有跑真实 npm pack 输出才暴露

**SOP / checklist**：

- 改 tar 解析（或写新的）必须 cover 4 case：短名 file / dir / GNU 'L' / 同名 file+dir collision
- `pendingLongName` / `pendingLongLink` 在 'L'/'K' 分支里设置，**必须**在下一非-L/K entry 用完后立即 reset 为 null
- 'L' data 末尾 NULL byte 用 `indexOf(0)` 截断，不要依赖 `.trimEnd()`
- 文件 entry 写之前判断 `target.isDirectory`，是就跳过 + 仍 `skip(size)` 消费字节流（否则后续 entry 错位）
- 升级 cc-cli.tgz 后**必须** rm 一次设备上的 `$PREFIX/lib/node_modules/chainlesschain` + `$PREFIX/var/lib/cc/.bundled-version` marker，强制重抽（marker-version 没 bump 时 skip 路径会跑残留）

**反模式**：

- ❌ "GNU tar 现在没人用了" — npm pack 默认输出 GNU 长名 entry。`tar --format=ustar` 才禁用 GNU 扩展
- ❌ "依赖 commons-compress" — ~600KB dep 不值得为 90% 用例引入；手写 ~150 行覆盖
- ❌ "extraction 失败就让用户清 app data" — 这会把 vault.db 一起干掉；改写 `extractCcCliIfPresent` 在每次 bootstrap 都强制 deleteRecursively ccModule 才对（marker 改成 SHA256 of tgz 而不是 version 字符串就能自动 invalidate）
- ❌ "tar entry size=0 直接 skip 不读 data" — 这没问题；但 'L' typeFlag entry 的 size != 0（=真实路径长度），必须读完 data + padding

**单测覆盖建议**：

- `extractTarToDir`：短名 file / dir / GNU 'L' single / GNU 'L' multiple consecutive / file colliding with dir / `package/` prefix strip with long-name
- `TarBuilder` 工具类合成 USTAR bytestream（包含 'L' entry），不依赖外部 tar 命令；checksum + octal padding 严格按 spec
- 真实 cc-cli.tgz fixture 不入 git（太大）但 CI 跑端到端：build cc bundle → boot in emulator → assert `cc hub search --json` 返回 vault 行数 > 0

**关联**：

- commit `1a369359f fix(android-pdh-browser): cc bundle tar GNU LongLink + JVM coverage + handbook #21`
- memory `android_cc_bundle_tar_gnu_long_name.md`
- 相关：#10（lint-staged silent data loss）、#15（SQLite TEXT 隐性陷阱）— 共同点：success-path silent fail，无 stack trace，调试要从 N 层 wrapper 往下挖

---

## 22. MediaPipe tasks-genai OUT_OF_RANGE → JNI abort → 整进程 SIGABRT（隐性风险）

**触发文件**：`android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/MediaPipeLlmEngine.kt` + `LocalLlmServer.kt` —— 任何走 `com.google.mediapipe:tasks-genai` 的本机 LLM 推理路径，配合"上下文窗口配置 + prompt 长度"的两个边界条件。

**陷阱本质**：

MediaPipe `LlmInference` 把上下文窗口 (`setMaxTokens`) 烤进 native handle，且整个推理路径**没有可恢复的 Java 异常**——当 prompt token 数 > `setMaxTokens` 配额时：

1. native `LlmTaskRunner.nativePredictSync` 先抛 `IllegalStateException: Failed to predict sync: %sOUT_OF_RANGE: CalculatorGraph::Run() failed`
2. 紧接着 native 代码**不 clear pending exception** 就调 JNI `NewByteArray` 申请结果 buffer
3. CheckJNI 检测到 "JNI NewByteArray called with pending exception"
4. → `art::JavaVMExt::JniAbort` → `libc abort()` → SIGABRT → **整 app 直接崩**

Kotlin `try { ... } catch (t: Throwable) { ... }` 包裹 `generateResponse` **够不到** —— SIGABRT 在 Java 异常机制之上一层，进程已死。

复现场景（v5.0.3.84 实测）：Plan A 联系人 + 应用列表入 vault 共 ~1305 entities，问"我有几个联系人" 触发 PDH 上下文检索 → prompt 包含 facts JSON → 估算 ~5000+ token → MediaPipe session 配的 `setMaxTokens=512`（错误的 numPredict 映射）→ 一次 chat 就 SIGABRT。

**三处必须联动的真 bug（缺一个修不全）**：

| Fix | 位置 | 错误 |
|-----|------|------|
| A | `LocalLlmServer.handleChat` | `setMaxTokens = req.options?.numPredict ?: 512`。Ollama `num_predict` 是 **output budget**；MediaPipe `setMaxTokens` 是**总上下文窗口**（prompt+output）。语义错位 + 默认值过小 = 几乎所有 PDH 检索类问题秒崩 |
| B | `MediaPipeLlmEngine.ensureLoadedLocked` | session 缓存只按 `loadedModelPath`。MediaPipe 把 ctx 窗口烤进 handle (无 per-call override)，首次 chat 用 512 建好后，后续 `opts.maxTokens` 永远被忽略。即使 fix A 让 server 改传 4096，native session 仍是 512 → 仍 SIGABRT |
| C | `MediaPipeLlmEngine.chat` 进 native 前 | 没有 prompt-length guard。任何超长 prompt 都会让进程 SIGABRT，前端看不到错误，只看到 app 闪退 + relaunch |

**为什么排查难**：

- crash 不在 logcat 主 buffer，要 `logcat -b crash -t 1000` 才能拿到 Abort message。普通 `*:E` filter 只看到 `libc Fatal signal 6 (SIGABRT)` 不知道是哪儿
- 栈底最近的 Java 帧是 `LocalLlmServer.handleChat → MediaPipeLlmEngine.chat`，看着像 server 层 bug；实际根因在 native + 多个配置层错位累加
- MediaPipe 的错误信息 `%sOUT_OF_RANGE: CalculatorGraph::Run() failed` 里 `%s` 是 sprintf 未替换的占位符 —— 看着像"格式化失败"误导排查方向，其实关键字是 `OUT_OF_RANGE`
- fix A 单独修不够（B 让 session lock 512），fix B 单独修也不够（A 让 server 仍传 512），所以"我改了某一处验证还崩"会让人误以为修错地方
- 端侧 LLM 测试用 JVM mock 验证不到 native abort（mock 路径直接走 NoOpLlmInferenceEngine 不进 MediaPipe），CI 全绿真机首次崩
- 普通"调大 maxTokens 让模型回答更长"的直觉调优会绕过这个 bug 不修，因为开发者改的是 `num_predict` 而不是 `num_ctx`

**SOP / checklist**：

- 任何端侧 LLM engine（MediaPipe / llama.cpp / MLC / TFLite）的 chat() 入口**必须**加 prompt-length guard 在进 native 前 fail-fast，估算 `prompt.length / 4` 与 `ctxBudget - safetyMargin (128)` 比较，超了抛可恢复 `LlmInferenceException`，**不能**让 native 自己 OOM
- session/handle 缓存的 key **必须**包含所有"烤进 handle 时不可改"的参数（modelPath, maxTokens, GPU/CPU backend, …），任何变化都 close + 重建
- Ollama-compat HTTP server 映射 `num_ctx` 才对应 native 的 context window；`num_predict` 是 output budget，不要混。文件里加注释明确语义防后人改回去
- 改 native LLM 路径必须 `adb shell logcat -b crash` 抓真机 abort 栈，而不是只看 `*:E`
- JVM 单测 cover fix C 正反两例（超长 prompt 必抛 + 正常 prompt 不被误伤）—— guard 写在 ensureLoadedLocked 之前，pure-JVM 也能跑
- 切换不同 ctx 窗口（cloud LLM 8K vs 本机 LLM 4K vs 老模型 2K）时验证 session 真重建，不要假设 cache 会自动失效

**反模式**：

- ❌ "Java 异常一定能 catch 到" —— native abort 是进程级 SIGABRT，try/catch 在死亡之前根本没被执行
- ❌ "maxTokens 调大就行了" —— 没修 fix B 时, session 已经 lock 在小窗口
- ❌ "Ollama `num_predict` 和 MediaPipe `maxTokens` 名字像就一定同义" —— 完全不同，一个是 output 限额一个是总窗口
- ❌ "JVM 单测全绿就说明修好了" —— mock 路径不经过 native predictSync，必须 emulator/真机验
- ❌ "用 ProcessBuilder/JNI 隔离掉 MediaPipe" —— 单独子进程能避免主进程崩，但 IPC 复杂度太高；上游 fail-fast 才是最经济解

**单测覆盖建议**：

- `MediaPipeLlmEngineTest`：覆盖"超长 prompt（estTokens > maxTokens-128）→ 必抛 LlmInferenceException 含'过长'/'token'"以及"正常 prompt → 不被误伤（不会因 guard 抛 '过长'）"
- LocalLlmServer 路由层：MockEngine 验证 `setMaxTokens` 拿到的是 `numCtx` 而非 `numPredict`
- 真机 E2E（待 future）：emulator 上跑 1k+ entities PDH adapter snapshot → 问 LLM → 验证返回 `error` JSON 而非 process crash

**关联**：

- commit `3fa4a81d5 fix(pdh-android): MediaPipe OUT_OF_RANGE -> JNI abort 防 SIGABRT 三连修`
- memory `mediapipe_jni_out_of_range_abort.md`
- 相关：#21（手写 tar parser silent fail）—— 同样是"native 层失败 → 上层看不到 stack trace → 调试要从 N 层 wrapper 往下挖"；本 #22 更狠：连 stack trace 都得换 logcat buffer 才能拿到

---

## 23. bs3mc / bs3 ABI dual-load —— Electron 39 (ABI 140) vs Node 22 (ABI 127)（隐性风险）

**触发文件**：`packages/personal-data-hub/lib/adapters/**/*-reader.js`（chrome-db-reader / vscode-reader / 后续任何 require SQLite native binding 的 PDH adapter reader）。任何同时被 **Electron 主进程 runtime** 和 **Node vitest 测试** 加载、且依赖 `better-sqlite3-multiple-ciphers` 或 `better-sqlite3` 的代码路径。

**陷阱本质**：

monorepo 里 `node_modules/` 下两个 native binding 的 `.node` prebuild **永远只命中一种 NODE_MODULE_VERSION**——

| 包 | 当前 prebuild 命中 ABI | 兼容运行时 |
|---|---|---|
| `better-sqlite3-multiple-ciphers` (bs3mc) | ABI 140 | Electron 39 |
| `better-sqlite3` (bs3) | ABI 127 | Node 22 |

PDH adapter reader 同时被两条路径加载：

1. **Runtime path（Electron main 进程 sync 时）** → Electron 39 = ABI 140 → bs3mc 能加载，bs3 报 NODE_MODULE_VERSION 不匹配崩
2. **Test path（vitest 用 Node 22 跑 `__tests__/adapters/*.test.js`）** → Node 22 = ABI 127 → bs3 能加载，bs3mc 崩

只 require 一个 → 必有一条路径 silent fail。chrome / vscode adapter sync 全 0 events 或测试假阴，没人会怀疑 ABI（错误信息说"模块未自注册"或干脆静默）。

**最狡猾的二层坑**：`require("better-sqlite3-multiple-ciphers")` **不会**在 ABI mismatch 时抛 —— 返回的是 JS Database class，native `.node` 还没被 dlopen。只有 `new Database(...)` 才真触发 native 加载并抛错。所以只 try/catch 包 `require()` 的 dual-load 也是假的，必须实例化 in-memory DB 做 smoke test 才能识别。

复现（v5.0.3.84 实测）：
- `chrome-db-reader.js` 顶层 `const Database = require("better-sqlite3-multiple-ciphers")` → vitest 跑 `__tests__/adapters/browser-history-chrome.test.js` 在 Node 22 下 `Cannot find module` 或 `NODE_MODULE_VERSION mismatch`
- 换成 `require("better-sqlite3")` → vitest 绿，但 Electron 桌面 cc ui 真同步 silent fail 0 events
- 改成只 try/catch 包 require 的"dual-load" → 测试和 runtime 看着都过，runtime 加载时下一行 `new Database(historyPath)` 才报 `Module did not self-register`

**修法（已 land `4a29f25ed`）**：

```js
function loadDatabase() {
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try { cls = require(mod); } catch (_e) { continue; }
    // 关键：require() 不在 ABI mismatch 时抛，必须实例化才触发 .node 加载
    try {
      const probe = new cls(":memory:");
      probe.close();
      return cls;
    } catch (_e) { /* ABI mismatch — 试下一个 */ }
  }
  throw new Error("neither bs3mc nor bs3 loaded — both ABI-mismatched");
}
const Database = loadDatabase();
```

`chrome-db-reader.js` + `vscode-reader.js` 都需要这个模板；以后加任何"PC 桌面 sync" 路径的 reader（local-files 用 SQLite / Firefox 历史 / Brave …）都要复用。

**为什么排查难**：

- 错误信息分裂：`Cannot find module` / `NODE_MODULE_VERSION mismatch` / `Module did not self-register` / `Symbol not found` —— 四个不同 surface 上看不出是同一个 ABI 根因
- 测试侧绿不代表 runtime 行：vitest 用 Node 22 + bs3，Electron 用 39 + bs3mc，绿和行的判断在不同进程
- `require()` 不抛 → 即使包 try/catch 也漏；必须 instantiate 才能识别
- 同 monorepo 有 ~20 个 adapter 用 bs3mc 但大部分**只在 mobile-only / cc bundle 内**跑（QQ / WeChat / Telegram 等），它们不进 Electron，所以单 require bs3mc 看起来一直没事 → 让开发者误以为"加 reader 就 require bs3mc 即可"
- v5.0.3.84 之前 chrome / vscode adapter sync 在 Electron 真 silent fail 一段时间没人发现，因为没人能区分"adapter 真 0 数据" vs "ABI mismatch silent crash 返回 0"

**SOP / checklist**：

- 加新 PDH adapter reader 用 native SQLite → **必须**复制 `chrome-db-reader.js loadDatabase()` 11 行模板，**不要** top-level `const Database = require("better-sqlite3-multiple-ciphers")` 直 require
- 测试覆盖两边：(a) `npx vitest run __tests__/adapters/<your>.test.js` 在 Node 下能跑出真数据；(b) Electron 桌面 cc ui 真触发 sync 出 events（不是 0）。验证两条路径独立绿
- mobile-only adapter（cc bundle 里的 QQ / WeChat / 走 Android SQLite snapshot 的 messaging adapter 等）保留 bs3mc 直 require —— 不进 Electron 主进程，不需要 dual-load。判断标准：adapter 是否在 `desktop-app-vue/src/main/personal-data-hub/wiring.js` 注册到 sync 列表
- 桌面升 Electron 大版本 / Node 大版本时不需要改 reader 代码 —— dual-load 自动适配 ABI 翻新
- 发现 `0 events` 同步异常时第一步看 main process 日志有没有 "self-register" / "NODE_MODULE_VERSION"，而不是怀疑 adapter sync 逻辑

**反模式**：

- ❌ `const Database = require("better-sqlite3-multiple-ciphers")` 顶层直 require —— 测试或 runtime 至少一路炸
- ❌ `try { require("X") } catch { require("Y") }` 只 try/catch 包 require —— require 不抛 ABI 错；用错的 binding 下一行 new 时才崩，已经出 try 块
- ❌ "vitest 绿 + 没报错 → 修好了" —— 必须两条路径都验真数据，不只是不抛错
- ❌ "全 monorepo 统一 prebuild" —— prebuild 团队不可控（bs3mc 跟 Electron 节奏，bs3 跟 Node 节奏），不要试图同步它们；dual-load 解耦
- ❌ "`npm rebuild` 强重编一遍" —— Electron dev server 在跑时 .node EBUSY/EPERM，且会让另一边的运行时坏掉（见 [[bs3mc_electron_abi_sandbox_workaround]]）

**单测覆盖建议**：

- 现有 `__tests__/adapters/browser-history-chrome.test.js` / vscode 测试在 Node 跑过即覆盖 test path；runtime path 靠 Electron 桌面真 sync 验
- 未来如果加 `loadDatabase()` 模板做 cross-binding probe 用例，可单测 mock require + 验 `new(...)` 抛错时 fallback 到下一个 binding。当前已 land 的实现简单到不强求专测

**关联**：

- commit `4a29f25ed fix(pdh): dual-load bs3mc / bs3 防 Electron-Node ABI mismatch — chrome / vscode reader`
- memory `bs3mc_bs3_abi_dual_load_adapter.md`
- 相邻 trap：[[bs3mc_electron_abi_sandbox_workaround]] 是测试侧的同根问题（root bs3mc 给 Electron 编的让 Node 跑 vault FTS5 test 也炸），修法 sandbox 装独立 bs3mc。本 #23 是 runtime 侧 dual-load；两者合起来覆盖 ABI mismatch 的"runtime + 测试"全部展开
- #12（Node 23 native-dep prebuild gap）—— 机制相邻，都是 "Node 版本 vs prebuild ABI 错配"。本 #23 把同样问题推到 Electron vs Node 跨进程维度
- #15（better-sqlite3 Number→TEXT `"1.0"` trap）—— 同样是 bs3/bs3mc 家族的 silent surprise，但层次不同：#15 是 binding 写入语义，#23 是 binding 能不能加载

**增订 — desktop-app-vue vitest 套件被 `npm run dev` 留下的 Electron-ABI binary 整片打挂（2026-06-15 实战）**：

跑全量 `cd desktop-app-vue && npx vitest run` 时若先前跑过 `npm run dev`（或任何 `electron-rebuild`），`desktop-app-vue/node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node` 会停在 **Electron ABI 140**，而 vitest 用 **Node 22 = ABI 127** 跑 → 所有走 SQLite 的测试文件整片红。2026-06-15 一次全量跑 **238 failed**，全部集中在 11 个 `src/main/remote/__tests__/*-handler-*.test.js` + `tests/remote/handlers/storage-handler.test.js`，根因只有一条：

```
Error: The module 'better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 140. This version of Node.js
requires NODE_MODULE_VERSION 127.
```

**判它不是 bug 的关键**：失败文件 100% 是 SQLite-backed，且报错全是 `new Database()` 抛 ABI error 后的**级联次生信号** —— `TypeError: Cannot read properties of undefined (reading 'close')`（`db` 没初始化，`afterEach` 的 `db.close()` 炸）、`AggregateError`、`Test timed out in 30000ms`（DB 没起来 stream test 挂死）。换正确 ABI 后这 11 个文件 254 全绿（实测）。CI 在 Electron ABI 下跑，所以这套永远不会在 CI 红。

**恢复配方（不需要 Visual Studio —— 直接拉 prebuilt，不走 source 编译）**：

```bash
cd desktop-app-vue/node_modules/better-sqlite3-multiple-ciphers
# 1) 拉 Node-ABI 的 prebuilt（v127）→ 让 vitest 能跑 SQLite 测试
../.bin/prebuild-install --runtime=node --target=$(node -p process.versions.node)
# 2) 跑那 11 个文件 / 全量套件
cd ../.. && npx vitest run src/main/remote/__tests__/
# 3) **必须**还原成 Electron ABI（v140），否则桌面 app / 并行 session 的 npm run dev 启动崩
cd node_modules/better-sqlite3-multiple-ciphers
../.bin/prebuild-install --runtime=electron --target=$(node -p "require('electron/package.json').version")
```

- ❌ 别 `npm rebuild`：本机常无 MSVC（node-gyp `Could not find any Visual Studio installation`），且会编 root copy 不是 desktop copy；用 `prebuild-install` 拉预编包直接绕开 toolchain。
- ❌ 别在并行 session 跑着 Electron app 时切 ABI：会让对方 app 当场崩。验证完务必跑第 3 步还原（验收：`node -e "new (require('./lib/database.js'))(':memory:')"` 在还原后**应当**抛 ABI error，说明已是 Electron 二进制）。
- 与 [[bs3mc_electron_abi_sandbox_workaround]] 同根（测试侧 ABI 错配），但那条的修法是给测试装独立 sandbox bs3mc；本增订是临时跑桌面 SQLite 测试的 in-place 翻 ABI + 还原配方，适合只想确认"这堆红是不是真 bug"的场景。

---

## 24. Android Bootstrap race —— `@Singleton` + instance Mutex 仍并发, half-half extract（隐性风险）

**Slug**: `android_bootstrap_singleton_mutex_race`

**陷阱本质**：

`LocalFilesystemBootstrapper` 标 `@Singleton` + 用 instance `private val bootstrapMutex = Mutex()` 串行化 `bootstrap()` 调用。理论上 Hilt SingletonComponent 保证单实例，instance mutex 即 process-wide。**真机不是这样**：Xiaomi 2026-05-24 logcat 显示**同 PID 两个线程**在 14ms 内都进了 `Bootstrapping $PREFIX (target version 6)` 日志，意味着 `withLock` 没生效。

后果：两线程并发跑 `extractTarToDir(assets/cc-cli.tgz → $PREFIX/lib/node_modules/chainlesschain/)`：
- 一个完成 `wipeAndRecreate` + `writeStaticFiles` + 部分 extract 后另一个进来又 wipe；
- 文件写到一半被并发 wipe 删，新 tgz 的部分 entry 与**之前 APK 安装**留下的旧 entry 残留并存；
- 真机现场：`hub.js` 是 1286 行（=旧 cc CLI commit 6bb5eb826），`bin/` + `node_modules/` 是新 tgz 内容。
- 用户问 "几个联系人" → cc 子进程 exit 1 `error: unknown option '--max-facts'`（旧 hub.js 不识别新 flag）。

**为什么排查难**：

- `@Singleton` + instance mutex 在代码 review 看着 100% 对，没人怀疑 Hilt 真的吐了 2 个实例；
- `cc exit 1` 错信息**没有任何文件 hash 比对**线索，看起来像 PDH 路由 bug，实际是 extract 损坏；
- tgz 在 APK 内验证正确（unzip + tar -tzf 都对），让人以为 extractor 没问题；
- 第一次 reproduce 后 `rm -rf usr/lib/node_modules/chainlesschain/` 重 extract，**仍然是旧 hub.js** — 因为之前 APK 安装的 OLD bundle 在 `usr/` 其它位置（或被 deleteRecursive 没完全清干净）混进新 extract；
- 单测里 mock 永远不会复现 — race 只发生在 multi-thread + filesystem 真共享的 ART runtime；
- AGP 默认压不压 `.tgz` asset 还是个干扰项（无关，但容易误判方向）；
- adb logcat 默认看不到 `cc` 子进程 stderr（只过滤 `[PDH-ASK]` 行），exit code 1 + 无 stderr 让人以为 PDH 路由代码炸；用 `adb shell run-as ... node bin/chainlesschain.js hub ask "..."` 手动跑才看到真错。

**SOP / checklist**：

1. **bootstrap 互斥用 `companion object` 不要用 instance**：
   ```kotlin
   companion object {
       private val processBootstrapMutex = Mutex()  // 进程级保证
   }
   suspend fun bootstrap() = withContext(ioDispatcher) {
       processBootstrapMutex.withLock { bootstrapLocked() }
   }
   ```
   即使 Hilt 出 N 个实例，所有 instance 都共享同一 companion 字段。
2. **extract 用 atomic `.tmp + rename` pattern**：
   ```kotlin
   val tmp = File(parent, "chainlesschain.tmp")
   if (tmp.exists()) tmp.deleteRecursively() // 必断言 deleted=true
   extractTarToDir(gzIn, tmp)
   if (ccModule.exists()) require(ccModule.deleteRecursively())
   require(tmp.renameTo(ccModule))
   ```
   任何中途失败 ccModule 保持上次成功状态，绝不会半半坑。
3. **`deleteRecursively()` 必断言返回值**：File API 返回 `Boolean` 而非抛错；ignore 返回值 = 静默 leftover 旧文件混新 extract。
4. **bootstrap 日志加 instance hashCode + thread name**：
   ```kotlin
   Timber.tag(TAG).i("Bootstrapping ... instance=${System.identityHashCode(this)} thread=${Thread.currentThread().name}")
   ```
   下一次 race 重现可直接看出是否 multi-instance。
5. **多 ViewModel 同时调 bootstrap 时考虑加 first-launch debounce** —— HubLocal* 几个 card 各自 `viewModelScope.launch { bootstrapper.bootstrap() }` 是 race 源头。可改 `Flow<Result<Unit>>` shared cold flow 用 `stateIn(scope, SharingStarted.Lazily, ...)` 让所有 collector 共享一次 init。
6. **`@Singleton` ≠ "肯定只有一个实例"**：cross-module Hilt 在 feature module + app module 都 inject 同一类时，某些 classloader 路径下可能出多实例。**永远用 process-wide 锁原语，不要靠 DI scope**。

**反模式**：

- ❌ `private val mutex = Mutex()` + `@Singleton` —— Hilt cross-module 不保证；多 instance 各自有自己的 mutex
- ❌ `if (dir.exists()) dir.deleteRecursively()` 不验返回值 —— 旧文件残留无声混入新 extract
- ❌ extract 直接写到目标路径 —— 中途 fail / 并发 wipe 导致 half-and-half corruption
- ❌ "tgz 文件验证正确就以为 extract 也正确" —— extract pipeline 任何一步坏都同样症状
- ❌ 仅过滤特定 stderr tag (`[PDH-ASK]`) 写 logcat —— cc 子进程其他错全静默；至少 verbose mode 全 stderr 写日志方便诊断

**真机重现 + 验证**：

- 复现：先装一个旧版 APK 让 bootstrap 完成留下 1286-line hub.js → 升级 APK（带新 cc-cli.tgz 1462-line hub.js）→ 同时 trigger HubLocal 多 tab → 看 logcat 是否两个 Bootstrapping 日志 14ms 内连发 + 真机 `cc hub ask` 报 `unknown option`
- 验证 fix：装新 APK + 清 marker + 多 tab 并发 trigger → logcat 应该只有 ONE Bootstrapping + extract 完成后 `wc -l hub.js` = 1462

**相关 memory**: `parallel_claude_session_win_orphans`（也是 race / mutex 类陷阱）/ `android_cc_bundle_tar_gnu_long_name`（trap #21，cc bundle 半 extract 表现类似但根因 GNU LongLink）

---

## 25. SQLite partial unique index `IF NOT EXISTS` 隐藏 schema drift —— UPSERT `ON CONFLICT WHERE` 永久找不到匹配（隐性风险）

**Slug**: `pdh_partial_index_if_not_exists_drift`

**陷阱本质**：

SQLite `UPSERT` 的 `ON CONFLICT(cols) WHERE expr DO UPDATE` 在 prepare 阶段需要找到一个 unique index / constraint 定义**完全匹配**：列要 match，**WHERE 表达式也要 match**。如果某个早期 migration 用 `CREATE UNIQUE INDEX IF NOT EXISTS uniq_x ON t(a, b)`（没 WHERE）创建过该索引，后续 migration 试图用同样的 SQL 加上 WHERE 子句**重新建**，`IF NOT EXISTS` 静默 skip —— 索引名已占用，定义永不更新。结果新代码的 `ON CONFLICT(a, b) WHERE expr` 找不到匹配的 partial index，prepare 抛 `2nd ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`。

PDH `events / persons / places / items` 4 张表（commit `44c4188a8` 前）用 `IF NOT EXISTS` 建过 full unique index。后续 `putEvent / putPerson / putPlace / putItem` 的 SQL 改成 partial `ON CONFLICT (source_adapter, source_original_id) WHERE source_original_id IS NOT NULL DO UPDATE` —— 老 vault 上跑必报 "2nd ON CONFLICT" 错。错被 `_ingestRawBatch` 的 try-catch 吞，写 `audit_log` 不弹错，UI 看不到。**黄金诊断信号：`events` 表 1 行 vs `raw_events` 表 1308 行**。

**为什么排查难**：

- `IF NOT EXISTS` 是 silent 失败本质 —— migration 跑没报错，schema_version 正常 bump，但实际 schema 是旧定义；
- adapter.sync 的 try-catch 吞错让上层完全看不到 SQLite 错；
- raw_events 写入成功（因为它的 unique 约束在 commit `44c4188a8` 之前就已是 partial）所以"采集到了数据"假象成立；
- UI 报"数据浏览空 0" 让人怀疑采集 / WebView / 网络等无关方向，根因在 `putEvent` 的 ON CONFLICT 路径；
- 直接看 `migrations.js` 源码看不出问题 —— DDL 写得是对的，"我都加了 WHERE 子句啊"；要看真实 vault 的 `sqlite_master.sql` 才能锁定 drift。

**SOP / checklist**：

1. **改 partial unique index 必走 `DROP IF EXISTS` + `CREATE`（无 IF NOT EXISTS）pattern**：
   ```js
   db.exec(`DROP INDEX IF EXISTS uniq_events_source`);
   db.exec(`
     CREATE UNIQUE INDEX uniq_events_source
       ON events(source_adapter, source_original_id)
       WHERE source_original_id IS NOT NULL
   `);
   ```
   范例：`packages/personal-data-hub/lib/migrations.js` migration v4，4 张表各一对，幂等安全。
2. **测试必须**覆盖"模拟旧 drift → reopen → putEvent 不抛"路径。`freshVault()` 走完整 DDL 测不到 drift；要手工 `DROP INDEX uniq_x ON t(a,b)` + `CREATE UNIQUE INDEX uniq_x ON t(a,b)`（无 WHERE）+ 改 `_meta.schema_version` 回退 → reopen 让 migration 重跑 → 断言 `sqlite_master.sql` 含 `WHERE` + `putEvent` 不抛。
3. **`adapter.sync` 的 try-catch 不要静默吞错** —— `entityCounts.events = 0` 而 `rawCount > 0` 是强信号，syncReport 必须显式标 `entityCounts.events === 0 && rawCount > 0 → status = "warning"` 让上层早一点感知。
4. **再写 partial index 时 grep 整 repo `CREATE UNIQUE INDEX IF NOT EXISTS` 看是否有兄弟索引也漏掉 WHERE** —— 这次 4 张表都中招，可能后续表也会重蹈。
5. **老 vault 升级**：仅 schema migration 修不了 raw_events 历史 —— 已有 1000+ orphan raws 需手工 re-derive。配 `cc hub rederive [--adapter <name>]` 命令把 raw_events 重新跑 normalize+putBatch 写到 events 表。
6. **adapter `originalId` 必填**：drift 修了之后空 `originalId` 仍会触发 `WHERE source_original_id IS NOT NULL` 路径 skip → invalidCount 暴涨，相关检查见 memory `pdh-adapter-originalid-required`。

**反模式**：

- ❌ `CREATE UNIQUE INDEX IF NOT EXISTS` 后面跟 partial WHERE —— 老 vault 上的 full 索引永远不被替换
- ❌ 用 schema_version bump 来"标记"已迁移而不真实 DROP 老索引 —— migrate 函数不抛但实际 schema 没变
- ❌ try-catch 吞 `putEvent` 抛错只写 audit_log，不让 syncReport 标 error —— 用户看 UI 永远不知道
- ❌ migration 写的 DDL 和 `putEvent` 写的 `ON CONFLICT` 不在一个文件 —— 容易演进时一个改了一个忘
- ❌ 单测仅覆盖 freshVault 路径 —— 旧 vault 重开 + 重 migration 的真实场景测不到

**诊断快速键**：

```bash
# 在真机上
adb shell run-as <pkg> 'sh -c "cd files && PREFIX=\$PWD/usr HOME=\$PWD/home TMPDIR=\$PWD/usr/tmp PATH=\$PWD/usr/bin:\$PATH usr/bin/mksh usr/bin/cc hub stats --json"' | jq '.vault'
# events: 1, rawEvents: 1308 → 几乎肯定 partial-index drift

adb shell ... cc hub recent-audit --limit 30 --json | jq '[.[]|select(.action|test("adapter.sync.error|put_batch_failed"))][0:3]'
# "2nd ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" → 锁实
```

**修复路径**：

- 长期：migration v4 入 packages/personal-data-hub → CI 重打 cc-cli.tgz → APK 重打 → 用户重装 → bootstrap 强制重抽 ccModule
- 短期（这台设备）：`cc hub rederive --json` 把累积的 raw_events 重新 promote 到 events 表（不重新拉源数据，幂等可重复跑）

**关联 memory / commit**：

- memory: `pdh_partial_index_if_not_exists_drift`、`pdh_cc_subprocess_exit_and_vault_upsert`（commit `44c4188a8` 修 SQL 但漏 schema migration —— 是这次根因的种子）、`pdh_adapter_originalid_required`
- 共同模式：`android_cc_bundle_tar_gnu_long_name`（trap #21）—— 都是 `IF NOT EXISTS` / 默认参数让演进 silent 失败
- commit: `7af396405 feat(pdh): rederive + migration v4 — recover orphan raw_events from trap #25 partial-index drift`

**CI gate（hard fail）**：

- `.github/workflows/pdh-partial-index-lint.yml` 在 PR 触及 `packages/personal-data-hub/lib/{migrations.js,vault.js}` 时自动跑 `scripts/lint-pdh-partial-index.mjs`，检测任何 `CREATE UNIQUE INDEX ... (source_adapter, source_original_id)` 缺 `WHERE source_original_id IS NOT NULL` 的写法（含 string-concat 拆行 pattern）。
- 规则文档化在 lint 脚本顶部注释；测试在 `scripts/__tests__/lint-pdh-partial-index.test.mjs` (8 case)。
- 修法已具备模板：migration v4 explicit DROP+CREATE pattern（见上方 SOP 第 1 条代码块）。lint 失败时按那个 pattern 复刻即可。

---

## 26. Legacy-GPU Chromium 130+ fail-fast `0xc0000602` —— "installer 闪退" 实际是 app 首帧崩（隐性风险）

**Slug**: `gpu_crash_recovery_legacy_intel_driver`

**陷阱本质**：

Electron 39 / Chromium 130+ 的 GPU 进程初始化路径（Windows 上 `CoreMessaging.dll` + ANGLE/D3D11）对老 GPU 驱动有硬下限。**Intel Iris Pro 5200 + 2016-09 驱动**、HD 4000 / HD 5000 系列、AMD 同代 + 2017 前驱动的机型，GPU 子进程一启动就 `STATUS_FAIL_FAST_EXCEPTION (0xc0000602)` 整个 app 进程退出。**user 视角是 "installer 装一会闪退"** —— 因为 NSIS 装完成功，最后那步勾选的"启动 ChainlessChain"启动后 ~200ms 内崩，installer 窗口同时关闭看起来像 installer 本身崩了。

**为什么排查难**：

- 症状 misleading：错误归因到 installer / 下载文件 / 杀毒软件 / Win 版本，根因在 app 启动后的 GPU 进程；
- 没有任何 Electron / app log 落盘 —— 崩在 GPU 进程 init 早于任何 logger 接通；
- 唯一的诊断信号在 Windows Event Log `Application` 频道 `Application Error` (Event ID 1000)：`错误应用程序名称: ChainlessChain.exe ... 错误模块名称: CoreMessaging.dll ... 异常代码: 0xc0000602`。普通 user 不会看 Event Viewer；
- Defender 默认行为 + MOTW + 各种安全 hint 都跟症状对不上 → 容易钻牛角尖；
- Electron / Chromium GPU blocklist 不覆盖这种古董配置（Chromium 已 EOL Haswell GT3 GPU 路径，但 process abort 仍发生在 blocklist 检查之前）；
- regression 误判：user 报"之前版本没事"，实际任何 Electron 39 release 都中招；如果某个老版本"看起来能跑"通常是别的更早错误（PDH / vault / 启动卡死）让 GPU 崩没机会显现；
- dev box 一般装新驱动看不到 → CI 不能复现 → release 前抓不到。

**SOP / checklist**：

1. **诊断三步**（user 报 "installer 闪退"时强制走一遍）：
   ```powershell
   # (1) 是不是真 installer 问题？看 app 是否已落地
   Test-Path "$env:ProgramFiles\ChainlessChain\ChainlessChain.exe"
   # True → installer 装成功了，问题在 app 启动

   # (2) Event Log 找 0xc0000602
   Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddMinutes(-30)} |
     Where-Object { $_.Message -match 'chainless' } |
     Select-Object TimeCreated, @{N='Msg';E={($_.Message -split "`n")[0..5] -join "`n"}} | Format-List
   # 看到 0xc0000602 + CoreMessaging.dll → 锁实 trap #26

   # (3) GPU 驱动年龄
   Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate
   # DriverDate < 2020 + Intel HD/Iris 旧型号 → 强相关
   ```

2. **代码层 fix（已 land v5.0.3.95+）**：`desktop-app-vue/src/main/index.js` setupApp 起点加 GPU crash recovery（marker file 模式，跟 VS Code / Slack / Cursor 一致）：
   ```js
   // 启动前写 marker
   const marker = path.join(app.getPath("userData"), ".launching");
   const gpuFlag = path.join(app.getPath("userData"), ".gpu-disabled");
   let crashRecovered = false;
   if (fs.existsSync(marker)) {
     // 上次启动崩在 ready-to-show 之前 → 持久化 disable
     crashRecovered = true;
     fs.writeFileSync(gpuFlag, JSON.stringify({ reason: "previous-crash", at: new Date().toISOString() }));
   } else {
     fs.mkdirSync(app.getPath("userData"), { recursive: true });
     fs.writeFileSync(marker, String(process.pid));
   }
   if (crashRecovered || fs.existsSync(gpuFlag) || process.env.CHAINLESSCHAIN_DISABLE_GPU === "1") {
     app.disableHardwareAcceleration();
     app.commandLine.appendSwitch("disable-gpu");
     app.commandLine.appendSwitch("disable-gpu-compositing");
     app.commandLine.appendSwitch("disable-software-rasterizer");
   }
   // mainWindow.once("ready-to-show") 里删 marker（健康路径）
   ```
   关键：marker 删除位置必须是 **first-frame-painted**（`ready-to-show`）。早删（在 `app.whenReady()`）会让 GPU 进程仍未初始化完就误判健康；晚删（在用户首次交互后）会让正常启动也被误判成 crash。

3. **本机 workaround（没装到 v5.0.3.95+ 的 user）**：建一个带 `--disable-gpu` 参数的快捷方式：
   ```powershell
   $shell = New-Object -ComObject WScript.Shell
   $lnk = $shell.CreateShortcut("$env:USERPROFILE\Desktop\ChainlessChain (兼容模式).lnk")
   $lnk.TargetPath = "C:\Program Files\ChainlessChain\ChainlessChain.exe"
   $lnk.Arguments = "--disable-gpu --disable-gpu-compositing --disable-software-rasterizer"
   $lnk.WorkingDirectory = "C:\Program Files\ChainlessChain"
   $lnk.Save()
   ```
   注意：系统级 `C:\Users\Public\Desktop\ChainlessChain.lnk` 和 `C:\ProgramData\...\Start Menu\...\ChainlessChain.lnk` 改不动（需要 UAC）。用 user-level 路径绕过。

4. **回退路径**：user 想试新驱动后重新开 GPU → 删 `<userData>/.gpu-disabled`（Windows: `%APPDATA%\chainlesschain-desktop-vue\.gpu-disabled`）。

**反模式**：

- ❌ 推 user 重下 installer / 改杀毒 / 重装系统 —— 根因在硬件配置，重多少遍都崩
- ❌ 把 `app.disableHardwareAcceleration()` 直接 hard-code 给所有 Windows user —— 主流用户白白损失 GPU 加速性能
- ❌ marker file 删除位置选 `app.whenReady()` 或 `did-finish-load` —— GPU 进程崩在那之前但晚于这两个事件，marker 已被错误清掉导致下次启动不开 recovery
- ❌ 用 `process.crash()` 或 uncaught-exception handler 检测 GPU 崩 —— Chromium GPU 子进程 fail-fast 不抛 JS 异常，主进程在子进程退出后直接 `app.exit()`，handler 接不到
- ❌ 在 macOS / Linux 上也跑 marker 写盘 —— 跨平台冗余开销 + 这俩平台 GPU 路径不同，没必要

**诊断快速键**：

```powershell
# user 报"installer 闪退"时一键诊断
$installer = "$env:USERPROFILE\Downloads\ChainlessChain-Setup-*.exe" | Get-ChildItem | Select-Object -Last 1
Write-Output "Installer SHA: $((Get-FileHash $installer -Algorithm SHA256).Hash)"
Write-Output "App installed: $(Test-Path "$env:ProgramFiles\ChainlessChain\ChainlessChain.exe")"
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddHours(-1)} -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'chainless' } |
  Select-Object TimeCreated, @{N='Msg';E={($_.Message -split "`n")[0..4] -join "`n"}} | Format-List
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate | Format-List
```

如果三个信号都吻合（SHA 对得上 + app 装好了 + Event Log 看到 0xc0000602 + GPU 驱动 ≤2018）→ 100% trap #26。

**关联 memory / commit**：

- memory: `gpu_crash_recovery_legacy_intel_driver`
- commit: `d8dc212f1 fix(desktop): legacy-GPU crash recovery — disable HW accel after fail-fast 0xc0000602`
- 类似 silent-fail-on-first-launch 模式：trap #19 (Android R8 minify 只在 CI 暴露)、trap #13 (desktop release npm workspace hoisting) —— 都是 dev box 跑得通但 user 机第一次启动炸

**为什么不走 GPU blocklist 检测**：

Chromium 内置 GPU blocklist 对老 Intel 卡的 entry 通常 disable 某些 feature（WebGL2 / accelerated 2D canvas），但 process abort 发生在 blocklist 加载前的 GPU init bootstrap 阶段（DXGI factory / D3D11 device 创建），blocklist 来不及生效。marker file recovery 是唯一稳路 —— 它不依赖任何 GPU API 状态，纯外部行为驱动。

---

## 27. 改 PDH lib / cc-cli.tgz refresh 后忘 bump `USR_VERSION` —— 真机缓存旧代码（隐性风险）

**Slug**: `android_usr_version_sentinel_cache`

**陷阱本质**：

Android `LocalFilesystemBootstrapper` 用 `feature-local-terminal/build.gradle.kts` 里 `USR_VERSION` buildConfigField 跟设备上的 `$PREFIX/.bootstrap_version` sentinel 比对，**相等就跳过解压**（fast-path 缓存，避免每次启动重 extract 60MB tgz，常态启动 < 100ms）。但这意味着：

1. CI `node-runtime-bundle.yml` 跑完把 `cc-cli.tgz` refresh 后（包含最新 `packages/personal-data-hub/lib/` + `packages/cli/lib/` 内容）；
2. 如果**没**手动 bump `USR_VERSION`（例如 12 → 13），新 APK 装到设备上 sentinel 已经是 12 ≠ 12 不成立 → bootstrap 走 fast-path 跳解压 → `$PREFIX/lib/node_modules/chainlesschain/` 还是上次 APK 留下的旧 cc CLI；
3. user 立刻验证 PDH 新功能（比如本次的 entityFocus persons routing / searchPersons）→ cc 子进程跑的是旧 lib → 行为完全没变 → "我装新版了怎么还是出不来联系人？"

CI auto-commit 不会自动 bump USR_VERSION —— `node-runtime-bundle.yml` 只 refresh tgz 字节、libnode.so，写完 commit `[skip ci]` 走了。`USR_VERSION` 是手工 buildConfigField 字符串常量，**只能开发者在改 lib 同 PR 里自己 bump**。

**为什么排查难**：

- `gh run view <run>` 显示 CI 绿、auto-commit 也成功 push 到 main，`git diff` 看 `cc-cli.tgz Bin 62.3 → 62.9MB` 清清楚楚 —— 表面证据**全是"已生效"信号**；
- `git pull && ./gradlew :app:assembleDebug` 编译 0 错，APK 里 `assets/local-terminal/cc-cli.tgz` 真的是新版本；
- adb 装上去也不报错，应用启动也正常，HubLocal 各 tab 都加载；
- 第一次 reproduce 后 `adb shell run-as <pkg> ls usr/lib/node_modules/chainlesschain/lib/analysis.js` 看到代码是**旧的**才能锁实根因（但需要 root 或 debuggable APK 才进得去 `run-as`）；
- 不开 logcat 完全没线索 —— bootstrap fast-path 走的是默认 `Timber.tag(TAG).d("Bootstrap fast-path: version match $USR_VERSION")`，info 级别下根本看不到；
- "明明 cc-cli.tgz 字节变了！" → 因为 fast-path 根本没去读 tgz，只读 sentinel；
- 与 trap #24（Bootstrap singleton race）症状叠加时尤其难分辨 —— #24 是半 extract、#27 是零 extract，但 user 端表现都是"新代码没生效"。

**SOP / checklist**：

1. **`packages/personal-data-hub/lib/**` 或 `packages/cli/lib/**` 任一 PR 改了被 Android cc 子进程跑的代码 → 同 PR 必 bump `USR_VERSION`**。即使 PR 本身不碰 Android。Pre-commit gate 不会检（lint-staged 只看 staged 文件 lint，不做 cross-package dep 分析），靠人。
2. **CI auto-refresh `cc-cli.tgz` 后立刻 bump**：
   ```bash
   # 触发 CI
   gh workflow run "Node.js Runtime Bundle (Termux)" --ref main
   # 等完成 (~4 min)
   gh run watch <run-id>
   # 拉新 commit
   git pull github main --rebase
   # bump
   #   android-app/feature-local-terminal/build.gradle.kts
   #   buildConfigField("String", "USR_VERSION", "\"N+1\"")
   # commit + push
   ```
   两步流程，不要省第二步。
3. **bump 协议**：单调递增整数字符串。**不要**用语义版本（`"12.1"` 会让 sentinel 比对走字符串 equality，看着像 bump 实际任何 `.` 都判 ≠ 即 force re-extract 没问题，但下次有人改成 `"12.2"` 后再回 `"13"` 就完全乱了）。永远 N → N+1。
4. **真机验 bump 真生效**：
   ```bash
   # 装新 APK 后第一次启动
   adb logcat -s LocalFilesystemBootstrapper:* | grep -iE "version|fast-path|extract"
   # 期待看到: "Bootstrap version mismatch: device=12 target=13, re-extracting"
   # 如果看到 "Bootstrap fast-path: version match 13" 说明你打成 13 的 APK 之前装过，trap 隐身
   ```
   首装真机或 `adb uninstall <pkg>` 后再装是最干净的验证路径。
5. **PR 模板加 checklist 条目**（防自己 / reviewer 忘）：
   ```
   - [ ] 本 PR 改了 packages/personal-data-hub/lib/** 或 packages/cli/lib/** 吗？
         若是，是否 bump 了 android-app/feature-local-terminal/build.gradle.kts 的 USR_VERSION？
   ```

**反模式**：

- ❌ "CI 自动 commit 了 cc-cli.tgz，应该够了" —— CI 只 refresh tgz 字节，不改 USR_VERSION；
- ❌ 用 git short SHA / 日期戳当 USR_VERSION —— sentinel 比对是字符串 equality 没事，但人类直觉看 `"abc1234"` → `"def5678"` 不知道哪边新，bump 顺序乱；
- ❌ 改 lib 不 bump，靠 user `adb uninstall && install` 清 sentinel —— user 不会这样做，看 trap 表现就是"装了新版没用"；
- ❌ 与 trap #24 (Bootstrap race) 修法混淆 —— #24 改的是 mutex / extract atomicity，**不影响 sentinel 比对**；fast-path 命中阶段 #24 的修都还没跑；
- ❌ 把 USR_VERSION 改成"很大"想"一次到位"避免下次 bump —— 没用，下次还得 bump，且大数字让历史 burned-version 列表混乱（如果将来想出 sentinel 版本对应 lib 内容 commit hash 表）。

**关联 memory / commit**：

- memory: `android_bootstrap_singleton_mutex_race`（trap #24，互补 —— fast-path 跳过后才有 race / half-extract 风险）、`android_cc_bundle_tar_gnu_long_name`（trap #21，extract 阶段 GNU LongLink）
- 历史 bump：USR_VERSION 6 → 7（trap #21 land 2026-05-24）、12 → 13（本 trap land 2026-05-27 `91fe70bc1`）
- 类似 "sentinel-gated cache 改源数据忘 bump" 模式：trap #6 (docs sync 副本编辑) —— 都是 "源真改了但下游靠 sentinel / 比对判断不需要更新" 一类；区别在 #6 是 sync 脚本 silent 覆盖，#27 是设备 silent 走 fast-path。

---

## 28. 改 workspace package `lib` 后忘 bump `version` + publish —— `cc-cli.tgz` 依赖 npm registry 实际仍是旧代码（隐性风险）

**Slug**: `pdh_workspace_dep_npm_publish_stale`

**陷阱本质**：

`packages/cli` 在 `package.json` 把 workspace 内的 `@chainlesschain/personal-data-hub` 等包按**固定版本号**（如 `"0.3.7"`）依赖，而不是用 `workspace:*`。`node-runtime-bundle.yml` line 408-410 跑 `npm install --omit=dev --no-audit --no-fund --ignore-scripts --no-package-lock` **从 npm registry** 拉这些 deps（不是 workspace symlink），workflow 头部 line 406 还专门写了 "All @chainlesschain/* deps are published to npm registry as of 2026-05-19; no more file: rewrite gymnastics needed"。

后果：
- 改 `packages/personal-data-hub/lib/**` 后 git commit + push
- 触发 `node-runtime-bundle.yml` 重打 `cc-cli.tgz`
- workflow `npm install` 拉的是 `@chainlesschain/personal-data-hub@0.3.7`（npm registry 上的旧版）—— **跟你刚改的 workspace 代码毫无关系**
- 新 tgz 装到设备：`adb shell run-as grep <new-symbol> .../personal-data-hub/lib/analysis.js` → **0 命中**
- 表面证据全是"已部署"：commit pushed、CI 绿、APK 装好、cc-cli.tgz 字节变了（其它包改了）—— 但你的具体修没进 tgz
- 经常和 trap #27 (USR_VERSION sentinel) 叠加，让定位更难：先以为是 sentinel 没 bump → bump 后依然 0 命中 → 才想到是 npm publish 没跟上

**为什么排查难**：

- workflow comment 写了 "no more file: rewrite gymnastics needed"，看着像是已经搞定了 workspace ↔ registry 桥接，其实是默认所有人都会跟着 bump → publish
- `cc-cli.tgz` 字节大小变化（可能是其它包变化或 bs3mc rebuild 时序）会**伪装** PDH 代码也跟着进了
- `git log` 看到 `chore(android): refresh Phase 2.5 Node + cc CLI bundle [skip ci]` 像确认 "tgz 拿到了 main 最新内容" —— 但 main 上 `packages/cli/package.json` 的依赖版本号还是旧的就该回去查
- 真机调试每轮：`adb install -r` (1min) + `app restart` + bootstrap re-extract (5s) + user 提问 + 截 logcat (1-3min) ≈ **5min / 次**。盲改 USR_VERSION 反复装 10 次都不会奏效，因为根因在 npm registry 不在设备
- 2026-05-27 实战：浪费 **~3 小时** 在 USR_VERSION bump 6 次 + APK rebuild 6 次 + CI tgz refresh 4 次。最后 `adb shell run-as grep DEFAULT_EVENT_BUDGET_RATIO ... | wc -l` = 0 才发现问题在 npm publish

**SOP / checklist**（**改 workspace package `lib` 必跑**）：

1. **改 `packages/personal-data-hub/lib/**` / `packages/cli/lib/**` / 任何被 cc subprocess 跑的包源码 → 同 PR 必 bump 包版本 + 改 dep 引用**：
   ```bash
   # bump source package
   #   packages/personal-data-hub/package.json: "version": "0.3.7" → "0.3.8"
   # bump every downstream consumer
   #   packages/cli/package.json: "@chainlesschain/personal-data-hub": "0.3.7" → "0.3.8"
   #   (also check desktop-app-vue/package.json if it uses registry pin not "file:..")
   git add packages/personal-data-hub/package.json packages/cli/package.json
   git commit -m "chore(pdh): bump 0.3.7 → 0.3.8 + cli dep sync"
   ```

2. **必跑 `npm-publish.yml` workflow 把新版本推到 registry**：
   ```bash
   gh workflow run "npm-publish.yml" --ref main
   gh run watch <id>  # ~8-10 min
   npm cache clean --force  # npm view cache 会 stale
   npm view @chainlesschain/personal-data-hub@0.3.8 version  # 必须打印 "0.3.8" 而不是 E404
   ```

3. **再触发 `node-runtime-bundle.yml` 重打 cc-cli.tgz**：
   ```bash
   gh workflow run "Node.js Runtime Bundle (Termux)" --ref main
   gh run watch <id>  # ~4 min
   git pull github main  # CI auto-commits new tgz
   ```

4. **bump `USR_VERSION` + rebuild APK**（per trap #27）：
   ```bash
   # 改 android-app/feature-local-terminal/build.gradle.kts: USR_VERSION N → N+1
   git commit -am "..."
   cd android-app && ./gradlew :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
   ```

5. **装机后立即 grep 验证**（**不验证 == 不部署**）：
   ```bash
   adb shell 'run-as <pkg> grep -cE "<new-symbol1>|<new-symbol2>" files/usr/lib/node_modules/chainlesschain/node_modules/@chainlesschain/personal-data-hub/lib/analysis.js'
   # 必须 > 0；= 0 = npm publish 没跟上 / USR_VERSION 没 bump / 装错 APK
   ```

6. **trap #27 + #28 联合检查脚本**（建议 commit 一个 `scripts/verify-android-deploy.sh`，TODO）：
   ```bash
   #!/usr/bin/env bash
   PKG=com.chainlesschain.android.debug
   echo "Device sentinel: $(adb shell run-as $PKG cat files/usr/.bootstrap_version 2>/dev/null)"
   echo "APK USR_VERSION: $(grep USR_VERSION android-app/feature-local-terminal/build.gradle.kts | head -1)"
   echo "tgz embeds version: $(tar -xzOf android-app/feature-local-terminal/src/main/assets/local-terminal/cc-cli.tgz package/node_modules/@chainlesschain/personal-data-hub/package.json | grep version)"
   echo "Local lib version: $(node -p "require('./packages/personal-data-hub/package.json').version")"
   echo "npm registry version: $(npm view @chainlesschain/personal-data-hub version --silent)"
   # 这 5 个值应该相等 / 一致；任何 mismatch 就有问题
   ```

**反模式**：

- ❌ "改 lib 就直接 trigger `node-runtime-bundle.yml`" — workflow npm install 拉 registry 旧版，tgz 跟你的改无关
- ❌ 看 `git log` 有 `chore(android): refresh ... cc CLI bundle` commit 就认为新代码到了 tgz — 那个 commit 只证明 tgz 文件被刷新（可能是其它包变化），不证明特定 lib 改进入
- ❌ 跟 trap #27 解耦考虑 — 二者总叠加：lib 没 publish 即使 USR_VERSION bump 也只是 re-extract 旧 tgz；USR_VERSION 没 bump 即使 tgz 真带新代码也走 fast-path 不抽
- ❌ 用 `git log packages/personal-data-hub` 看到 commit 就以为发布了 — git tracked ≠ npm registry published
- ❌ 跑 `node -p "require('@chainlesschain/personal-data-hub/package.json').version"` 看本地 0.3.8 就以为 registry 也是 — workspace symlink 用本地，npm registry 是另一套
- ❌ 装机后只看 logcat `PDH-ASK askQuestion: q=...` 行 OK 就以为新代码生效 — 那行是 Kotlin 端 LocalCcRunner.kt 自己的 log，跟 cc subprocess 跑的 PDH lib 版本毫无关系；真验证必须 `adb shell run-as grep` 真文件

**关联 memory / commit**：

- memory: `pdh_workspace_dep_npm_publish_stale`、`npm_publish_audit_and_dep_chain`（更早期的 npm publish 普遍坑）、`android_usr_version_sentinel_cache`（trap #27，配套坑）、`npm_publish_pre_audit_version_bumps`
- 2026-05-27 实战 commit chain：
  - `f5d66debc` / `90343ff93` / `eb24c4d5d` / `3f31e2894` 改 lib + 加新功能（4 个 PR 进了 main 但 npm 上还是 0.3.7，所有 tgz 都没真带这些改）
  - `de1430e27` chore(pdh): bump 0.3.7→0.3.8 + cli dep sync ← 真正解锁的 commit
  - `492ebd3a6` hub-command test 加 retrieve-context（npm publish CI 1/19310 测试坏拦住了 publish，单独捎一刀）
  - `a41d50ebd` summarizePerson identifiers + 0.3.9 bump（第二轮 publish）
- 类似 "源真改了但下游拉的不是源" 模式：trap #6 (docs sync 副本编辑 / 源被静默覆盖)、trap #13 (desktop release npm workspace hoisting)、trap #27 (USR_VERSION sentinel)

---

## 30. CI watcher/probe 的 cosmetic-green —— job 永远 exit 0 + `continue-on-error` 让 ✓ 不代表实质通过（隐性风险）

**Slug**: `node_23_native_dep_trap`（实战触发）/ `feedback_continue_on_error_silent_regression`（job 级 mask 的姊妹坑）

**陷阱本质**：

某些 workflow **被设计成永远成功**（watcher / probe / 周期探针，如 `upstream-watch.yml`：它的目的是"上游一旦修好就开 issue"，所以最后一步永远 `exit 0`，不能让探测失败把 build 标红）。再叠加实质步骤上的 `continue-on-error: true`，于是顶层那个绿 ✓ **不携带任何"实质检查是否通过"的信息**。真正的结论被编码进了**哪个条件 step 跑了**（例如 "Open issue" 分支 vs "Log expected-fail" 分支），而不是 run 的 conclusion。

关键机制：

- `continue-on-error: true` 让失败 step 的 **`conclusion` = success** 但 **`outcome` = failure**（两者不同！）。下游 `if: steps.X.outcome == 'success'` 的 step 于是**被 skip**，但 job 整体仍然绿。
- 一个没有任何"非 continue-on-error 失败 step"的 job → 绿，即使有意义的工作全失败了。
- `gh run view --json jobs` 默认给的 step 表是 **`conclusion`（mask 后）**，不是 `outcome`。你只能从"下游 gated step 是 ran 还是 skipped"反推真实 outcome。

**为什么排查难**：

- GitHub UI 显示绿 ✓；`gh run list` 显示 `conclusion: success`。两者都对实质结果**撒谎**。
- `outcome`（continue-on-error 之前的真值）在默认 `gh run view` step 表里**根本不显示**，只有 `conclusion`。容易看着 step 表"全 success"就收工。
- 这个 mask 在 watcher/probe 里是**故意的、正确的**设计（探针不该让 build 红），所以它不是一个"要修的 bug"——你只需**正确地读它**。把它当 bug 去"修掉 continue-on-error"反而会让探针在真失败时把无关 build 标红。
- 2026-06-10 实战：手动重跑 `upstream-watch` "确认 green"，run 显示 ✓ → 差点据此回报"Node 23 已 OK"。实际是 install step `outcome=failure`（被 mask 成 conclusion=success）→ require-check **skipped** → "Log expected-fail（trap still in effect）"分支才是真跑的。trap #12 其实 regressed 了。

**SOP / checklist**（读任何"永远绿"的 watcher/probe run）：

1. **别信顶层 ✓**。先认出"实质 step"，再看它下游 `if: steps.X.outcome == 'success'` 的 step 是 **ran 还是 skipped**：
   ```bash
   gh run view <id> --repo <owner/repo> --json jobs \
     -q '.jobs[].steps[] | "\(.conclusion)\t\(.name)"'
   ```
   映射规则：一个 install step 显示 `success`、但紧随其后的 require-check **skipped** ⇒ install 的真实 `outcome` 是 **failure**（skip 只会发生在 `outcome != 'success'`）。
2. 找有没有一个 "expected-fail / still-broken / 兜底 log" 的 step——**它若跑了，就是 red-in-green**。
3. 实质失败时去 `--log` 里抓真因（本案：`prebuild-install warn ... No prebuilt binaries found` + `gyp ERR! find VS`）。
4. **自己写 watcher/probe 时**：让实质结论可见——写 job summary / `set-output` / 末尾加 `if: failure()` 的显式 step；或在确实想要真信号的地方**别加 `continue-on-error`**。若 job 必须按设计永远绿，就在 README / step name 里**大声写明"✓ ≠ 通过，看 X step"**。

**自动化已 land**（2026-06-10）：

- `scripts/audit-cosmetic-green.js`（零依赖，line-based 解析 `.github/workflows/*.yml`）+ `.github/workflows/cosmetic-green-audit.yml`（PR advisory，改 workflow / 改本脚本时触发，命中 upsert 一条 PR 评论，不 block）。
- **判定逻辑**（精度优先，区别于 trap #8 的 `ci-mask-audit.yml` 只 grep diff 里 `continue-on-error` 的*出现*）：一个 step 同时满足 ① `continue-on-error: true` ② 有 `id:` ③ 它的 `.outcome`/`.conclusion` 被后面某个 `if:` 分支引用 ④ 文件里**没有补偿性 surface** → 命中。
- **补偿性 surface**（命中即豁免，因为实质结果被人能看到）：`$GITHUB_STEP_SUMMARY` 写入 / `core.setFailed` / `::error` / `createComment`/`updateComment`（advisory PR-comment gate，如 ci-mask-audit / bs3mc-dual-load 都因此不被误报）/ **不在 continue-on-error step 内**的 `exit 1`（真把 build 重新标红）。⚠️ 关键：masked step **自己** run 里的 `exit 1` 被 continue-on-error 吞掉，不算 surface（脚本按 step 行范围排除）。
- **intentional probe 豁免**：文件级标记注释 `# cosmetic-green-ok: <reason>`（探针设计上就永远 exit 0，不该让 build 红）。`upstream-watch.yml` 没用豁免标记，而是**真加了** `if: always()` 的 `Job summary — substantive verdict` step 写 `$GITHUB_STEP_SUMMARY`（直接修根因：任何人看 run 立刻见 PASS/FAIL，不用再解码 step skip），既治本又让 gate 自然通过。
- baseline：扫 46 个 workflow，仅 `upstream-watch.yml`（加 summary 前）命中 2 处；加 summary 后 0 命中。合成 fixture 验证 bad（masked+branched+无 surface）命中、optout（标记）/ surfaced（createComment）/ refail（非 masked step `exit 1` 重红 build）均豁免。

**反模式**：

- ❌ `gh run list ... conclusion=success` → "绿了，搞定"（watcher 本来就永远 exit 0）
- ❌ 只看 step 表 `conclusion` 列、不核 `outcome` / skip 模式
- ❌ 为了让某 flaky step 不红，随手加 `continue-on-error: true` → 从此永远绿，真 regression 再也不会被发现
- ❌ 认为"job 绿 ✓"= 每个 step 的命令都成功了

**关联 memory / trap**：

- trap #8（CI 假绿 mask，更宽：**job 级** `continue-on-error: true` 把 3/3 OS 失败显示成 success）、trap #12（本案具体载体：upstream-watch Node 23 探针）
- memory: `feedback_continue_on_error_silent_regression`、`feedback_ci_false_green_audit_checklist`（`scripts/audit-ci-masks.sh` + `ci-mask-audit.yml`）、`node_23_native_dep_trap`
- 类似"信号被中间层吞掉"模式：trap #8（job 级 mask）、`feedback_xcpretty_swallows_xcodebuild_errors`（xcpretty 吞 xcodebuild 错误）

---

## 维护说明

- 新踩到的隐性陷阱按编号顺序追加（#19, #20, ...），不要插入到已有编号之间
- 每条至少包含：**陷阱本质**、**为什么排查难**、**SOP / checklist**、**反模式**
- "burned tags" / 其他实战记录类清单（如 #18 的 burned tags 表）踩到一个就追加一行
- 本文档存 `docs/internal/`（不是 `docs/`、不是 `docs-site/`），故意不被 sync 脚本扫到——确保只在仓库内可见，不发到公开 docs site
- 关联的个人 memory 在 `~/.claude/projects/.../memory/` 路径下，本文档引用它们的 slug 名供个人 session 查找；外部访问者只看本文档即可

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：隐性风险陷阱手册（#6-#30）。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
