# PDH Mode B Phase 7 — Plan & 5-Platform Feasibility Audit

> 状态: v1 (Phase 7.0, 2026-05-25)
> 关联: [[pdh-multipath-phase-b0-scaffold]] / [[pdh-sign-provider-phase-6a]]
> 上游方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6
> 上游 trap: [[android-wechat-collector-phase-12-10]] / [[android-qq-collector-phase-13-5]]

## 0. 这是什么 / 为什么

Phase 6e 收尾后 — PC + ADB C path 5 平台齐 ship (Bilibili / Weibo / Xhs / Douyin / Toutiao / Kuaishou)，但**仍依赖 PC**:
- 用户必须有 Win/Mac/Linux 桌面 + `adb` + USB 线
- 移动场景下没法跑（手机离开桌面就废）

**Mode B (APK 内 root)** = Android App 内嵌 root + cohort 拷贝 + db 直读，**真正脱离 PC 闭环**。已 ship 的 3 个 ref impl:
- WeChat (`pdh/social/wechat/*`) — SQLCipher + frida-inject (Phase 12.10)
- QQ (`pdh/messaging/qq/*`) — XOR-IMEI 算法解，无 frida (Phase 13.5)
- Douyin (`pdh/social/douyin/DouyinRoot*.kt`) — 明文 SQLite + abrignoni DFIR (Phase 2b)

Phase 7 = 把 Mode B 推广到剩 5 个平台 (Bilibili / Weibo / Xhs / Toutiao / Kuaishou)。

## 1. 现状审计

### 1.1 已有共享接口 (Phase B0 — `pdh/social/common/`)

| 文件 | 用途 | 复用率 |
|---|---|---|
| `LocalRootCollector.kt` | `snapshot(): LocalSnapshotResult` 接口 + sealed result class (Ok / NoCredentials / NoRoot / NoDbKey / ExtractFailed / Failed) | 100% — 直接 implements |
| `BaseRootCredentialsStore.kt` | `<Plat>Credentials` 持久化模板 (uid / lastSync / lastErr + EncryptedSharedPreferences) | 80% — per-plat 加自己字段 |
| `DbCohortCopier.kt` | `su -c cp` + WAL/SHM 三件套并发安全拷贝 | 100% — 直接 inject |
| `RootShellRunner.kt` | `su -c <cmd>` + MIUI silent-fail 检测 + isSuAvailable | 100% — 直接 inject |

### 1.2 各平台 Path A 已有资产 (本 phase NOT 触碰)

每个平台都有完整的 path A (cookie + Web API + 可选签名)，**Mode B 是补充不是替代**:

| 平台 | path A 资产 | Mode B 增量 |
|---|---|---|
| Bilibili | LocalCollector + ApiClient + JsBridge (v4) | RootDbCollector + RootDbExtractor + RootCredentialsStore |
| Weibo | LocalCollector + ApiClient | Same 3 files |
| Xhs | LocalCollector + ApiClient + SignBridge (X-S) | Same 3 files |
| Toutiao | LocalCollector + ApiClient + SignBridge (_signature) | Same 3 files |
| Kuaishou | LocalCollector + ApiClient + SignBridge (NS_sig3) | Same 3 files |

### 1.3 已 land Mode B Ref Impl 对照

| 平台 | DB 加密 | Schema 来源 | frida 需要 | Phase | LOC |
|---|---|---|---|---|---|
| WeChat | SQLCipher | 内部逆向 (sqlite3_key_v2 hook) | ✓ (key derivation hook) | 12.10 | ~1500 |
| QQ | SQLCipher | 内部逆向 + XOR-IMEI 算法 | ✗ (纯算法) | 13.5 | ~800 |
| Douyin | **明文 SQLite** | abrignoni DFIR ([github](https://github.com/abrignoni/DFIR-SQL-Query-Repo/blob/master/Android/TIKTOK/TikTokMessages.sql)) | ✗ | 2b | ~600 |

**关键: 明文 SQLite (Douyin 模式) 远简单于 SQLCipher (WeChat 模式)** — frida 才是大头工作量。

## 2. 5 平台 Mode B 可行性评估

### 2.1 评估维度

每平台 4 个维度打分 (1=易, 5=极难)。总分越高 = 工程量越大 + ROI 越差。

| 维度 | 说明 |
|---|---|
| **DB 位置** | `/data/data/<pkg>/databases/` 标准位置 还是隐藏路径 |
| **加密** | 明文 / SQLCipher / 自研加密；frida 需要度 |
| **Schema 公开度** | 公开取证文献 / 0-day 逆向需求 |
| **反爬强度** | 应用层 anti-frida (libmsaoaidsec.so / 自检自杀) |

### 2.2 5 平台对照表

| 平台 | 包名 | DB 位置 | 加密 | Schema 公开度 | 反爬 | 总难度 | 推荐? |
|---|---|---|---|---|---|---|---|
| **Bilibili** | `tv.danmaku.bili` | `/databases/biliCommunity.db` 等 | **明文** | **高** ([B站](https://github.com/2bllw8/bilibili-android-decompile) decompile 公开) | 低 | **2/5** | ⚠ 但 path A 太好 — **plan 推 SKIP** |
| **Toutiao** | `com.ss.android.article.news` | `/databases/<uid>_<dbname>.db` | **明文** (字节系共用框架, 推论自 Douyin) | 中 (abrignoni TikTok 类比) | 中 (字节通用 frida 检测但无 libmsaoaidsec) | **3/5** | ✓ **推荐 v1.0** |
| **Weibo** | `com.sina.weibo` | `/databases/weibo.db` (推测) | **未知 — 真机探测决定** | 低 (无公开文献) | 中 (自实 sqlite-wrapper) | **4/5** | ⚠ 需 schema 探测 phase 前置 |
| **Xhs** | `com.xingin.xhs` | `/databases/` 未确认 | **可能 SQLCipher** (libshield.so) | 极低 (零公开) | **高** (libshield.so 反 frida) | **5/5** | ⚠ ROI 差 — **defer v2.0** |
| **Kuaishou** | `com.smile.gifmaker` | `/databases/` 未确认 | 可能自研 | 极低 | **极高** (libmsaoaidsec.so + 多重 anti-frida) | **5/5** | ⚠ defer v2.0 |

### 2.3 推荐执行顺序 (从易到难)

```
P7.1 — Toutiao (v1.0)        ≈ 3 周 — DB 明文 + 字节系共用 → Douyin 模板复制
P7.2 — Bilibili (v1.0 可选)  ≈ 2 周 — 公开 decompile + 明文，但 path A 已最优 (ROI 差但工程量小)
P7.3 — Weibo schema 探测      ≈ 1 周 — frida hook SQLiteOpenHelper 一次性 dump CREATE TABLE
P7.4 — Weibo Mode B (v1.5)    ≈ 3 周 — 基于 P7.3 schema 实现
P7.5 — Xhs Mode B (v2.0)      ≈ 4-6 周 — libshield.so bypass + 零 ref 逆向
P7.6 — Kuaishou Mode B (v2.0) ≈ 4-6 周 — libmsaoaidsec.so bypass + 零 ref 逆向
```

**v1.0 目标**: P7.1 Toutiao + P7.2 Bilibili (可选)
**v1.5 目标**: P7.3 + P7.4 Weibo
**v2.0+**: P7.5 Xhs + P7.6 Kuaishou (defer 到反爬 SDK 公开 bypass 出现)

## 3. Per-platform 子方案

### 3.1 P7.1 Toutiao Mode B (推荐 v1.0 首发)

**目标**: pure-Kotlin (无 frida) 解 `com.ss.android.article.news/databases/` 明文 SQLite

**前置研究** (P7.1.0):
- adb 真机 root 进 `/data/data/com.ss.android.article.news/databases/` 看文件清单
- 期望表 (类比 abrignoni Douyin 模板):
  - `read_history`: item_id / title / read_time
  - `collection_article`: group_id / save_time
  - `search_history`: keyword / search_time

**实现** (P7.1.1):
- `ToutiaoRootCredentialsStore.kt` — uid + lastSync + lastErr (基于 BaseRootCredentialsStore)
- `ToutiaoRootDbExtractor.kt` — su shell + DbCohortCopier + 3 表 SELECT + JSON 输出
- `ToutiaoRootDbCollector.kt` — implements LocalRootCollector，编排 credentials → extract → record
- Hilt module 注入
- HubLocalViewModel 加 "本机 root 同步头条" action (与 path A "本机 root" 同存)
- 50+ JVM unit tests (mockk SQLite + extractor + collector)

**Mode B 输出 → 复用 social-toutiao snapshot adapter** (与 path C 一致，schemaVersion=1)。

### 3.2 P7.2 Bilibili Mode B (v1.0 可选)

**前置**: plan §6.4 explicit 说 "**不做**" — path A (SESSDATA cookie + api.bilibili.com) 已最优。
**重新评估**: B 站 DB 在 [github decompile](https://github.com/2bllw8/bilibili-android-decompile) 有完整 schema。明文，工程量 ≈ 2 周。

**决策点**: 用户 in P7 期间是否启动？**默认 SKIP** (path A B+J 用 webview prefetch fetch 已稳，B 路径 ROI 太低)。如启动，模板同 P7.1。

### 3.3 P7.3 Weibo schema 探测 (v1.5 前置)

**单独 phase 因为零公开资料**:
- 真机 root + adb + frida → hook `android.database.sqlite.SQLiteOpenHelper.onCreate(db)`
- dump `db.rawQuery("SELECT sql FROM sqlite_master WHERE type='table'")` 完整 schema
- 归档到 `docs/design/Weibo_DB_Schema_Snapshot.md`
- 决定 Mode B feasibility (如果加密重 → defer; 明文 → P7.4)

### 3.4 P7.4 Weibo Mode B (v1.5)

基于 P7.3 schema 结果：
- 如果明文 SQLite: 同 P7.1 Toutiao 模板，3 周
- 如果 SQLCipher: 加 WeChat-style key derivation hook，6 周 (defer)

### 3.5 P7.5 Xhs / P7.6 Kuaishou (v2.0+ defer)

两家 libshield.so / libmsaoaidsec.so 反 frida + 零公开取证资料。defer 到:
- (a) 反爬 SDK 公开 bypass 出现 (github / FreeBuf)
- (b) 我们有 4+ 周专项预算
- (c) path A 命中率持续衰退 (`pdh-sign-provider-phase-6a` E2E §8 rotation drill 触发)

## 4. 共享 Trap 清单 (consolidate)

从 WeChat / QQ / Douyin / B0 / ADB infra 5 套已 land 经验汇总：

### 4.1 SQLite + Cohort copy (适用所有 Mode B)

1. **WAL+SHM 必须一起复制** ([[android-wechat-collector-phase-12-10]] trap 7): `*.db` 单独拷会读到 stale 数据。`DbCohortCopier` 已抽出。
2. **`su -c cp` MIUI silent 失败** (WeChat trap 4): `Runtime.exec("su")` 在 MIUI 不返错就退。`RootShellRunner` 已 wrap + exit-code 检测。
3. **W^X 禁 filesDir exec** (WeChat trap 3): 任何要 chmod+x 的二进制必须放 `/data/local/tmp/`，不能 filesDir。`WeChatFridaInjector` 已示范。

### 4.2 SQLCipher (适用 WeChat / 潜在 Weibo / Xhs)

4. **`PRAGMA cipher_compatibility` 必须先于 key** (WeChat trap 6): 顺序反了直接 "file is not a database"。
5. **hex key 转 bytes 双路径** (WeChat trap 5): ASCII-hex 还是 raw-bytes 取决于 sqlite3_key_v2 args[2]+[3]，必探 [[wechat-frida-hook-audit-traps]]。

### 4.3 frida (适用 SQLCipher 平台 — Phase 7 暂不涉及但预备)

6. **frida-inject 14-20MB** (WeChat trap 2): 加 APK 体积。**P7.1 Toutiao 无 frida** 不踩，但 P7.4+ 必踩。
7. **spawn vs attach** ([[wechat-frida-hook-audit-traps]]): WeChat-style 进程 hook 走 spawn (拦截 init 时机)，QQ-style 算法解走 attach (随时跑)。

### 4.4 EncryptedSharedPreferences (适用所有 credentialsStore)

8. **MIUI 14 首创建失败** (WeChat trap 1): EncryptedSharedPreferences 首次访问可能 IllegalStateException，必 try/catch + fallback 重建 Master Key。`BaseRootCredentialsStore` 已 wrap。

### 4.5 Mode B → snapshot → adapter pipeline

9. **schemaVersion 同步**: Mode B 输出 JSON 的 `schemaVersion` 必与对应 `social-<plat>` Node adapter 的 `SNAPSHOT_SCHEMA_VERSION` 一致 (5 个 ADB collector 都是 1)。
10. **events.id 稳定**: Mode B `id` 字段格式必与对应 `social-<plat>-adb` snapshot-builder 一致 (e.g. `read-<itemId>`)。否则 vault dedup 失效，每次同步翻倍。
11. **originalId 必填**: [[pdh-adapter-originalid-required]] — adapter yield 必含。Mode B 走 snapshot inputPath 路径不需要 yield，但 raw_events 里 stableOriginalId 仍由 adapter 计算，不要在 Mode B 端预填。

### 4.6 测试

12. **JVM tests sufficient for v0.1**: 像 Douyin Mode B 一样，JVM mockk + in-memory SQLite 覆盖 80% — 真机 E2E 只测 last mile (su 可达 + 真 db 存在)。
13. **真机 E2E gate**: 必跑前提：root Android + 标准版 (NOT 极速版) App + 登录态 + 触发过 db 写入 (Xhs 必须开过一次主屏触发 sync_user.db etc)。

## 5. v1.0 推荐执行: P7.1 Toutiao 一家试水

**为什么先 Toutiao**:
1. **零 frida 依赖** — 字节系明文 sqlite (推论自 Douyin abrignoni), 工程量 3 周可控
2. **schema 接近 Douyin** — 复制 DouyinRootDbExtractor 模板改 SQL 即可
3. **path A 已稳** — Mode B 失败有 fallback (不会让用户没数据)
4. **测试容易** — 同 Douyin 走 JVM mockk SQLite，真机 E2E 1 场景搞定

**P7.1 sub-phases**:
- P7.1.0 — DB schema 探测 (用户 root 真机, adb shell ls + sqlite dump，~半天)
- P7.1.1 — ToutiaoRootCredentialsStore + Extractor + Collector 3 文件 + Hilt + 30 单测
- P7.1.2 — HubLocalViewModel 加 "本机 root 同步头条" action + UI button + 5 状态 banner
- P7.1.3 — 真机 E2E checklist Win-first 同 P6c.5 模板

**剩余 (P7.2-P7.6) 全 defer 到独立 session**, 不在本 phase 实现。

## 6. v1.0 完工标记

- [ ] P7.0 方案文档 ship (本文档)
- [ ] 用户决定 P7.1 Toutiao Mode B 启动 vs defer
- [ ] (如启动) P7.1.0 schema 探测 → archive
- [ ] (如启动) P7.1.1-3 ship + Win-first E2E pass
- [ ] P7.2-P7.6 决策推到下一个 session

## 7. 关联文件

- 共享基类: `android-app/app/src/main/java/com/chainlesschain/android/pdh/social/common/`
- Douyin ref impl: `android-app/app/src/main/java/com/chainlesschain/android/pdh/social/douyin/DouyinRoot*.kt`
- WeChat ref impl: `android-app/app/src/main/java/com/chainlesschain/android/pdh/social/wechat/*.kt`
- QQ ref impl: `android-app/app/src/main/java/com/chainlesschain/android/pdh/messaging/qq/QQ*.kt`
- 上游方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`

## 8. Shipped (2026-05-26 Closure)

> 原 §5 推 "P7.2-P7.6 全 defer 到独立 session"; user 在 P7.0 后选 **"Mode B 全面 5 平台"** override，本 session 全 ship。

### 8.1 Per-platform commit map

| Platform | v0.1 code | VM/UI wiring | E2E doc | Total LOC | Original plan recommendation |
|---|---|---|---|---|---|
| Toutiao | `4e328bc46` P7.1.1 | `7156ebae4` P7.1.2 | shared `a2be1e1d6` P7.1.3 | ~600 | ✓ v1.0 (字节系明文推论) |
| Douyin | (earlier P2b) | `7ae0f54b0` + `56afebbb5` P7.1.2b | shared with Toutiao | (existing) | ✓ v1.0 (abrignoni DFIR) |
| Bilibili | `0cbe4b0fe` P7.2.1 | `b41fd2a0f` P7.2.2 | `bfb4a9ac4` P7.2.3 | ~800 | ⚠ SKIP (path A 已最优), ship 作 fallback |
| Weibo | `1c877954f` P7.4.1 | `e3b6641c2` P7.4.2 | `8aef6419e` P7.4.3 | ~1700 | schema 探测 prereq, v1.5 |
| Xhs | `c1b601cfe` P7.5.1 | `2fad4bfa8` P7.5.2 | `9f37b10f8` P7.5.3 | ~1700 | ⚠ defer v2.0+ (SQLCipher + libshield.so) |
| Kuaishou | `b8fcbc47b` P7.6.1 | `cac364435` P7.6.2 ⚠ misattributed | `1046a4dfe` P7.6.3 | ~1750 | ⚠ defer v2.0+ (SQLCipher + libmsaoaidsec.so) |
| Phase 7.3 doc | — | — | `8b202c326` Weibo schema probe | ~200 | — |

**累计**: ~6700 LOC (Kotlin + JVM tests + E2E docs) over 18 commits.

### 8.2 Shipped feature inventory

- ✅ **Mode B button 6/6 platforms 全 wired** in `HubLocalScreen.kt` onSyncRoot dispatch — Toutiao + Douyin + Bilibili + Weibo + Xhs + Kuaishou.
- ✅ **Shared scaffold** (B0 `8051f4ae5`): `LocalRootCollector` interface + `BaseRootCredentialsStore` + `DbCohortCopier` (WAL+SHM cohort) + `RootShellRunner` (su gate) in `pdh/social/common/`.
- ✅ **6 per-platform** `*Root{CredentialsStore,DbExtractor,DbCollector}.kt` triples + `syncXxxRoot()` VM methods + per-platform 4 VM tests.
- ✅ **Defensive PRAGMA picker** in every Extractor (table-name candidates + column-name candidates) handles unknown schema drift across all 6 platforms (zero public refs for most).
- ✅ **likely-sqlcipher branch** in 4 platforms (Weibo / Xhs / Kuaishou — Toutiao / Douyin / Bilibili have明文 confidence; Weibo conditional): surfaces v2.0 transition pointer hint when SQLite open fails.
- ✅ **5 E2E docs** (Toutiao+Douyin unified + 4 per-platform Bilibili/Weibo/Xhs/Kuaishou) — Win-first PowerShell commands, expected-outcome distribution framing for defer-recommended platforms.
- ✅ **共 ~126 JVM tests** added (21 per platform × 6 + 4 VM tests × 6) — all schema-drift-tolerant.

### 8.3 Remaining work — all user-driven from physical Android device

Win dev box cannot exercise these; need rooted Android + adb access (and frida-server for v2.0):

1. **真机 schema 探测 fill-in** — P7.1.0 / P7.2.0 / P7.3 §4 / P7.5.0 / P7.6.0. Output goes back to update `DB_FILENAME_CANDIDATES` + column-name candidate lists per platform → v0.2 commit.
2. **Weibo v0.2** — depends on 真机 W-2 branch result: 明文 (extend candidate list) / SQLCipher (add frida injector mirror WeChat 12.10) / source-missing (探测 fill-in).
3. **Xhs v2.0** — frida + libshield.so neuter + SQLCipher key derivation hook. Est 4-6 weeks; needs persistent rooted Xhs device + frida-trace access. Plan original recommendation = defer.
4. **Kuaishou v2.0** — frida + libmsaoaidsec.so neuter + SQLCipher key derivation. **More complex than Xhs**: libmsaoaidsec is **dual-role** (NS_sig3 signing SDK + anti-frida guard), hook must not damage signing or path A also breaks. Est 4-6 weeks. Plan original recommendation = defer.
5. **6-platform 真机 E2E runs** — see `docs/design/PDH_Mode_B_RealDevice_Master_Checklist.md` for unified ~1-day execution plan.

### 8.4 Retrospective + traps captured

5 new traps surfaced during Phase 7 — all now in memory `pdh_mode_b_phase_7.md`:

1. **Parallel-session WIP rip-out 误判** (P7.4.2): `git diff` showed 200-line rip-out from parallel session; mistakenly applied dance to "restore". Parallel had actually self-corrected via `de790c8ee` KDoc fix. Restoration patch went stale. **Lesson**: check `git log --oneline base..HEAD` before applying backup patch.
2. **Backup-restore loses my just-committed edits** (P7.5.2): naive `cp backup back` after reset+edit+commit overwrote HEAD's new edits. **Lesson**: compute `diff(HEAD_OLD, backup)` delta and `git apply` on top of HEAD_NEW instead.
3. **Parallel session steals my commit** (P7.6.2): parallel ran `git add -A` while my P7.6.2 edits were unstaged → their `cac364435` NSIS commit bundled 412 lines of my Kuaishou Mode B wiring. **Lesson**: stage immediately after edits during multi-session work, no race window.
4. **Plan doc silently deleted** (this closure): `docs/design/PDH_Mode_B_Phase_7_Plan.md` created `90e7f659c` but missing in HEAD with no delete commit (force-push or rename race). Restored from git history. **Lesson**: critical design docs should have CI integrity check.
5. **`cc commit` 子进程 epoll_wait dead-wait** (pre-existing, encountered during testing) — see [[pdh_cc_subprocess_exit_and_vault_upsert]].
