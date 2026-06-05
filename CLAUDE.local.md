# CLAUDE.local.md — Personal Development Context

> Private, gitignored. Personal dev environment config and current session state.
> **Rule**: 详情入 memory 文件（见 MEMORY.md）+ git（`git show <hash>`），本文件只保 **commit pointer + 状态 + 剩余项**。一行一票，禁实现散文。

## Development Environment

- **OS**: Windows 10 Pro for Workstations | **Node**: `node -v` | **Ollama**: http://localhost:11434 | **Qdrant**: http://localhost:6333

## Current Work Focus (v5.0.3.98)

> Status calibrated vs git log `075d443e8..HEAD` (356 commits, v5.0.3.84→.98) on 2026-06-01.
> 2026-06-02 session HEAD `47b6993e7`，github = gitee = local 三端对齐。`git commit --only` 全程隔离并行 session race。

### Active — android-family-guard / "AI 陪学" (FAMILY Epic)

`:feature-family-guard` 模块 — 家庭守护 / AI 陪学 MVP。Design: `docs/design/` AI 陪学 v0.1 (`d0974b09c` 58 ticket / 7 epic / 9 周) + v0.2 (`677c5a193`)。**纯逻辑层（可单测、零设备）全 7 epic 挖尽**；剩余全部 device/UI/真机/PM 阻塞（Win 不可跑）。各 ticket prose 见 `git show <hash>` + memory `family_clock_skew_detection` 等。

**Landed（commit pointer）：**
- **Epic A 脚手架** FAMILY-01`ecf38daca` / -02`3119983bb` / -03`e8c5a5716` / -04`b55b65124` / -05`c76e9b8e6` / -06`f01a9bb6e` / -07`740883178` / -08`2b6fdc504` / -09`8c7a431f1`
- **Epic B 解绑/配对** FAMILY-10`e65409384` / -11`7d51d09ef` / -12`5c3f40536` / -13`c63ba3800` / -14`9323bf964` / -15`3fea44a20` / -16`200596dcb` / -17`0392ec081` / -18`cc668f73f` / -19`536466c9e`
- **Epic C telemetry** FAMILY-20`abd3a2cb7`+`a93f27b4e`+`533fb3e3c` / -21`505bca1d8`+`3378f8985`+`c04b068d2`(含 -25 level gate) / -22`14ea97633` / -23 PDH 5 collector`7861e84b0`+`780b1675c` / -24`306d5c11e` / -26`7e53a1820`+`459a61901`+`7936235df`+`c6cd3c38f` / -27`4416a302e` / -28`49b2ec866`。E2E 计划 doc `4f6cb0ad6`
- **Epic D 通话** FAMILY-30`5682b5bab` / -31`080eb0917` / -32`7d225b357` / -33`7f26235a7` / -34`f2a1ea610` / -36`5cf011103` / -37`785f215da`（5/7 land；剩 -35 真机）
- **Epic E SOS** FAMILY-40`a1e78043d` / -43`a2f928d0c` / -44`2030f1532` / -45`722553d27`
- **Epic F 围栏** FAMILY-50`1f1ba94cd` / -54`ec5a1b269` / -55`7d9f218f9`（纯逻辑层做透 3/7）
- **Epic G** FAMILY-60`891ee1d00` / -62`47b6993e7` / -63`c516b91f4`；TimeAuthority 接 3 约束点 `66aca301e`+`517e9c956`+`75965d32c`
- **A7 验签** `eb94d2f15`（LenientManifestVerifier）/ **A1 防改钟** `76f801c23`（桌面 responder + Android RpcClient/Module/Timer）；NoOp seam tracker doc / 推送厂商 checklist `bc8a190d8`
- **AI 陪学 M6 MVP** `c6313090a` — `:app/presentation/aistudy/` AiStudyScreen+VM/Module/Prompts/Llm/StudyProfileStore（双轨 学习/陪伴 chat）+ NavGraph `ai_study` route + FamilyShellScreen「AI陪学」卡接通；8 JVM 单测绿（3 Prompts + 5 VM，JDK17 复跑）。剩：错题本/学情报告 + 真机 E2E

**测试**：`:feature-family-guard` 337 tests（0 fail）+ Desktop 110 + web-panel 107，全绿（2026-06-01 复跑）。

**剩（device/UI/真机/PM 阻塞）**：Epic E 41/42/46（触发硬件/录音/UI）、F 51/52/53/56（位置 API/地图/真机电量）、D 35（MediaProjection 真机）、G 61/64/65/66/67（push vendor/法务/KYC/真机 E2E/dashboard UI）；FAMILY-23 collectors v0.2 真 HTTP fetcher + dry-run；各 NoOp seam 真实实装（:app/desktop，并行 session 域）；ParentTimeSource P2P（2 真机，user 选 defer）；全部真机 E2E。
> **注**：改 pdh/lib 发版时必 bump pdh ver + npm publish + Android USR_VERSION（traps #27/#28，CI gate pdh-bundle-staleness-check.yml 拦）。

### Recently Completed (post-v5.0.3.84，commit pointer)

- **AIChatPage.vue SFC 五步拆分 5183→2463 行** `3d32cf92d`/`4b7f0b490`/`721fa5eaf`/`f04bc44fe`/`7d491c3d3`。剩 conversation CRUD + 消息提交 (~1100 行，opportunistic 再切)
- **PDH AnalysisEngine intent routing 收口** `9feb30ff1`(sum-amount)/`19041fd67`(count)/`1e4770c76`(多币种)。memory `pdh-analysis-engine-intent-routing`
- **PDH RAG 接通 Android cloud** `e547f7bb5`+`1fa7ac574`+`789af8eab`+`ac11c4464`+`d03687450`
- **PDH 静态安全审计** `b8920618e`(+F2-F6)；**PDH Mode B Phase 7** 6 平台 in-APK + 反爬签名 v0.3（memory `pdh_mode_b_phase_7` / `pdh_websign_bridge_pattern`）
- **Desktop ChatPanel composable 拆分 4057→1483 行** `87e65c1f5`/`b5b04361d`/`af1cd91c3`/`9f549c6ad`/`0a30c6ad8`/`3775a8572`
- **Traps #21-#28 + CI gates**（handbook `docs/internal/hidden-risk-traps.md`）
- **.git slim Phase D/G** `d58c44b02`+`3fbbfa4f4`+`e8ae823b7`；gitee 2026-05-28 重新加回，hook 双推
- **Android quarantine stub 复活** KB-01..06 `4ec694a7e`/`0f1c37163`/`1a97eee67`/`bc971891f`/`7416d73a4` + PDH Vault Browser Compose UI test `d9151b1d6`
- **Older（pre-v5.0.3.84）**：iOS Phase 1-5 / iOS CI 真编译 v5.0.3.56→.61 .ipa shipped / PDH Social MockWebServer 4 platform 33 test / PDH Vault Browser Phase 16 / Android R8 precheck gate `04c6df65f`+`b7071cbaa`。全部 `git show` + 对应 memory 可恢复。
- **⚠️ 开放状态：production R8 minify 目前整体 disable 作兜底**（`e67ba5019` v5.0.3.91，CME 反复复发后关闭）。precheck `r8-fullmode-probe` 哪天转 success = AGP/R8 race 修了信号 → 跑 2-3 PR 验稳后照 memory `android_release_r8_minify_hotfix_chain` runbook 重开 minify 默认。

### Active / Next

- **下一个 V5→V6 port 未选**。8 高流量页已落。挑 port 前必两步 intake：(1) 读 V5 模板 top 60 行；(2) 验 `ipcMain.handle.*<channel>` 在 src/main 真实存在 + store action 真调 IPC
- **V5 SFC 拆分**：不预防性切；改功能时顺手切，commit 标 `(opportunistic split)`
- `cc pack --project`：Phase 0/1/2a/2b/3a/3b/3c/3d/3f/3g 全落地。**剩 Phase 3e**（macOS pack，需 CI 配额决策）。memory `cc_pack_project_phase_3c`

### Follow-ups

- **iOS 真机 E2E 38 场景 × 7 段**：`docs/design/iOS_Phase_6_0_RealDevice_E2E_Plan.md` v1.1。Mac+iPhone+真桌面，Win 不可跑。CLI 0.162.10 未 publish，defer 到下次 desktop release
- **Android Phase 2-6 androidTest infra landed** `0962323da`（:core-test-helpers + TestActivity + Fake bindings + HiltGraphSmokeTest）。剩 ~11 stub（AIConv 06/07/08 prod gap，memory `feature_ai_e2e_stub_prod_gaps`）+ 真机 emulator run
- **DB 加密翻 gate**（剩余阻塞收窄到 2 条人工 GUI）：A 层自动化全绿（L1+L3 45 + L2 真 SQLCipher 7，本机实测）。**B.1 real-safeStorage 探针** `9a7ea291a`（6 测试，真 Windows DPAPI 跑生产 KeyManager+migration，`npm run test:db-encryption-realstore`）补上 keychain 缺口；**B.2 PowerShell 手动 runbook** `3e4e0d03e`（`docs/internal/db-encryption-b2-powershell-runbook.md`）。B 从 8 场景收窄到只剩 2 条真·GUI：①装旧版→升级迁移 ②真断电中断（其余 A+B.1 已自动覆盖）。翻 `PHASE_1_5_DEFAULT_ON=true` 时同步改 `db-encryption-flag.test.js` shipped-gate=false 断言 + 跑 checklist。memory `did_private_key_at_rest_encryption`

## Architecture Status

> Recounted from source 2026-06-01 (git ls-files / grep, not running suites).

- **Desktop Skills**: 144 built-in — `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/*/SKILL.md`
- **Android REMOTE**: 25 `*Commands.kt` on disk (`remote/commands/`)；24 registered in `SeedRegistry.kt`（header self-stale "23 entries"，off by 1）
- **CLI Commands**: 138 — `packages/cli/src/commands/*.js` non-test
- **Test Count**: 30,000+ (last-known estimate: desktop ~28k + CLI ~19k + web-panel ~2k + core ~2k)
- **Store Tests**: 26 files — `desktop-app-vue/src/renderer/stores/__tests__/*.test.ts`

## Key File Locations

- Store tests: `desktop-app-vue/src/renderer/stores/__tests__/*.test.ts`
- CI config: `.github/workflows/test.yml`
- Tools modules: `desktop-app-vue/src/main/skill-tool-system/tools/`
- IPC validator: `desktop-app-vue/src/main/utils/ipc-validator.js`
- Skill handler tests: `desktop-app-vue/tests/unit/ai-engine/skill-handlers.test.js`

## Test Run Cheatsheet

```bash
# Store tests
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/
# Unit tests
cd desktop-app-vue && npx vitest run tests/unit/
# CLI all tests (5200+)
cd packages/cli && npx vitest run
# Batch run (max 3 files, avoid OOM)
npx vitest run file1 file2 file3
```

## Completed Milestones (hash appendix — `git show <hash>` for prose)

> Flat pointer list for already-landed work. Prose lives in git + linked memory. Newest-first.

**2026-06-05 session — 不足清单收口（安全/测试债/IPC）** — DB加密B.1 real-safeStorage探针(6测试真DPAPI)`9a7ea291a` / B.2 PowerShell手动runbook`3e4e0d03e`（docs/internal/db-encryption-b2-powershell-runbook.md，B收窄到2条人工GUI） / replay-attack安全测试stale-skip解封16个(`npm rebuild better-sqlite3`+运行时native gate)`0fb625521` / workflow-engine stub→真WorkflowEngine重写24测试`bcc154e5c`（发现引擎契约:handler必须async） / IPC降级可见告警 degraded-registry+14点note+汇总WARN+广播system:degraded-subsystems+查询通道+preload`6b9cfa254`，note错位修`07e1a0e07` / phase-modules stale计数刷新6→7+10→12`67066d111`。**验证排除**:U-Key"123456"=_simMode非生产 / DID私钥at-rest已fail-closed(memory stale) / #2被#1吸收
**2026-06-01/02 session A misc** — recount `6ed4154c2` / doc-site spike gitignore `38b07e18b`
**PDH content platform v0.3 sign 接通** — 头条 `dd7eac295`+`da2a24295` / 快手 `5c9468e82`（WebSignBridge）
**PDH §2.1 端侧 LLM MediaPipe (A3.3/A3.4)** — `6e5d1b45a` / `05f239a2ff` / `48e40562a8`(pivot) / `6fb00bbdf0`(dep audit)
**PDH Android in-app collectors** — QQ 13.5 `a72923b5a`（UI wire `a47b239df`）/ WeChat 12.10.3-6 `40121840c`+`86c491861`+`dcdd58265` / WeChat scaffold `0c8f42fc0`→`c13bcd31f`
**HubLocal 卡** — 12306 `3f1f7f8de` / 头条 placeholder `3aa55a9b4` / 快手 placeholder `74386d029`
**PDH Social MockWebServer 测试** — `95b4f432aa` / `8ffade0a84` / `cd66a0bc6` / `7f7d87b3f`
**PDH Vault Browser Phase 16** — `c7cff5a97` / `7c098cd6a` / `db2d6ab64` / `6b34ec10e` / `257840e9b` / `724ea2af4` / `a40ea3852` / fixtures `7e2328767`
**Bilibili cookie race + traps #19/#20** — `8633495a62` / `5d01065c24`+`e4451b3f79` / `f09aafa3f5`+`1080c4b077`
**R8 minify CME hotfix chain** — disable 兜底 `e67ba5019` / hotfixes `73b48632b`+`18e04a2e4`+`d3b888aaf`+`35ac41816`
**iOS Phase 5 AI Chat** — `da0542d1e`→`f2b1b72c1`
**iOS CI 真编译 v5.0.3.56→.61** — `e000057e9`→`9dfbc1b8e` / app target 0 错 `a8dc88b13` / .ipa shipped `43bb85c99`
**iOS Phase 1-4** — P4 Notification `45b485fdd`→`f4a1f761f` / P1 pairing scaffold `c30b415a8` / reproducer D2/D3/D6 `0f81e2aee`+`2deadcbbe`
**PDH 14.1 测试误诊** — `8f5d37fce`
**#21 P0 前置三项** — B.2 `b1c7cfd95` / B.6 `e24386d00` / A.3 `348896382`+`45a88270e`
**CLI CI sharding** — `1c9db161b` / `a86e05ab6` / `c4c4f0d8a` / `2d29bc615` / `b52c2f427` / `21a60f714` / `016df8a0d`→`0114aec48`
**V5 dead-page cleanup** — `5066a718d` / `0ab6e480e` / `539463b85`
**V5→V6 desktop page ports (8 baselines)** — MemoryBank `596f72bba` / Friends `b9cb7fb47` / vue-tsc `f324d0da0` / Settings `a75d1e129` / Projects P1b `2a2ff4018` / ChatPanel `1c31b7c64` / Projects D `da20057ed` / Community `70e00c11b` / DID `51f765429`
**V6 hard-flip & probes** — `caaddf530` / `72b826bdf`
**web-panel V5→Web ports** — Phase A `f37aa44d0`/`d1f22ce2d`/`c0e96c9e0` / Phase B `260787c99`→`bfeb8091f` / Phase D `a7909b8a6`
**B4 ASAR surgery (issue #8)** — `e11b46913`
**P1 SFC splits / Misc** — `33e9ffcf0` / `2f24d873a` / `9bceed0eb`
