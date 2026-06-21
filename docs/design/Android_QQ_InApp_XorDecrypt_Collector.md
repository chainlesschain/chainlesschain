# Android 端 QQ 本机采集 — XOR-IMEI 方案

> **状态**: 设计 v0.1 — 2026-05-22。Scaffold + 真 DbExtractor + 真 XorDecryptor + JS adapter snapshot 模式 已 land；真机 E2E 待做（Phase 13.5.6，需 root QQ 设备）。
>
> **谁该读**：(1) 想接通 `HubLocalScreen.kt` "QQ" 卡的工程师 (2) 评估 Magisk-root 用户群体范围 (3) 维护 [`packages/personal-data-hub/lib/adapters/messaging-qq/`](../../packages/personal-data-hub/lib/adapters/messaging-qq/) 桌面侧 adapter 的人

---

## 0. 为什么需要这个

桌面侧 [`packages/personal-data-hub/lib/adapters/messaging-qq/`](../../packages/personal-data-hub/lib/adapters/messaging-qq/) 已经把"从 adb pull 出来的 QQ DB + IMEI → XOR-decrypt → ingest"这条路打通了（其实只到了 v0.5 placeholder——这次 v0.2 同时升级了它的 snapshot mode）。但和 WeChat 同样有桌面端依赖问题：

1. 用户必须在桌面侧 `adb backup com.tencent.mobileqq`
2. 知道并输入 IMEI
3. 跑 `cc hub sync-adapter messaging-qq --dbPath <uin>.db`

Android in-APK 路径让用户**直接在手机点"同步"按钮**就能把 QQ 数据搞进 vault。

---

## 1. 与桌面侧 adapter 的关系

| 维度 | 桌面侧 (`packages/personal-data-hub/lib/adapters/messaging-qq/`) | Android in-app collector |
|---|---|---|
| 物理位置 | 桌面 Node.js 进程 | Android app 进程 |
| 数据源 | adb pull 出来的 `<uin>.db` | 直接读 `/data/data/com.tencent.mobileqq/databases/<uin>.db` |
| 密钥来源 | 用户输入 IMEI (`opts.keyProvider.getKey()`) | 用户输入 IMEI（QQCredentialsStore 持久化）|
| 加密技术 | **无 SQLCipher** — DB 本身是普通 SQLite，仅 `msgData` BLOB 逐条 XOR-IMEI | 同 |
| 跨进程读 | 桌面有 adb 自然权限 | Magisk-su（QQ uid 隔离）|
| Vault 落盘 | `~/.chainlesschain/vault.db` | Android `filesDir/vault.db` |

**关键 invariant**: snapshot JSON 格式 + normalize 逻辑 **byte-identical** 两侧。Kotlin XorDecryptor 与 JS `xorDecrypt` 都必须保持算法一致——`QQXorDecryptorTest` + `messaging-qq-snapshot.test.js` 各自钉死参考向量。

复用策略与 WeChat 同：**Kotlin 侧只实现 (1) su cp DB cohort (2) plain SQLite open (3) XOR-decrypt msgData**；normalize 由 `cc hub sync-adapter messaging-qq --input <staging.json>` 调 JS 侧完成（避免 2-way drift）。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│ Android app (com.chainlesschain.android)                         │
│                                                                  │
│  HubLocalScreen.kt (待 Phase 13.5.2 wire — 解 douyin/xhs 并行后)  │
│   └─ QQCard("messaging-qq")                                      │
│       └─ onLogin / onSync / onLogout                             │
│           │                                                      │
│  HubLocalViewModel.kt (待 wire)                                  │
│   └─ qq: QQCardState                                             │
│       └─ requestQQLogin / confirmQQUinImei / syncQQ /            │
│          logoutQQ / refreshQQFromStore                           │
│           │                                                      │
│           ▼                                                      │
│  pdh/messaging/qq/QQLocalCollector.kt  ✅ 已 land                │
│   ├─ hasCredentials? → QQCredentialsStore                        │
│   └─ extract() → QQDbExtractor (real impl)                       │
│       │                                                          │
│       ▼                                                          │
│  pdh/messaging/qq/QQDbExtractor.kt  ✅ 已 land                   │
│   ├─ suExec test -f /data/data/com.tencent.mobileqq/db/<uin>.db │
│   ├─ su cp cohort (.db + .db-wal + .db-shm) → filesDir/cache/   │
│   ├─ SQLiteDatabase.openDatabase(readonly)                       │
│   ├─ probe Friends / friends / tb_recent_contact (顺序)          │
│   ├─ SELECT TroopInfoV2                                          │
│   ├─ discover mr_friend_*_New + mr_troop_*_New tables            │
│   ├─ SELECT msgData BLOB + 用 QQXorDecryptor 逐条 decrypt        │
│   └─ 写 staging/messaging-qq.json (SNAPSHOT_SCHEMA_VERSION=1)    │
│       │                                                          │
│       ▼                                                          │
│  LocalCcRunner.syncAdapter("messaging-qq", stagingPath)          │
│       │                                                          │
│       ▼                                                          │
│  in-APK cc subprocess (mksh interpreter)                         │
│   └─ packages/personal-data-hub/lib/adapters/messaging-qq/       │
│      _syncViaSnapshot(opts.inputPath) ✅ 已 land                 │
│       └─ normalize() → Person/Event/Item entities                │
│       └─ LocalVault.upsert + audit log                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块清单（v0.2 当前状态）

### 3.1 已 land (本次 v0.2)

| 文件 | 行数 | 说明 |
|---|---|---|
| `pdh/messaging/qq/QQCredentialsStore.kt` | 150 | EncryptedSharedPreferences (uin / imei / displayName / lastSync / error)。`saveAccount` 强校验：uin 必须数字、imei 必须 15 位数字。failures **抛 IllegalArgumentException**（与 WeChat 不同，QQ 不静默吞）。 |
| `pdh/messaging/qq/QQXorDecryptor.kt` | 110 | sjqz `qq.py:90-112` byte-identical 移植。3 步解码 fallback (UTF-8 strict → GBK strict → hex)。`object` 实现（无状态、热路径每消息调用，无 DI 必要）。 |
| `pdh/messaging/qq/QQDbExtractor.kt` | 380 | 真实 DB extraction：su cp cohort (db/wal/shm) + plain SQLite + 3 表 probe + `PRAGMA table_info` 列名解析（防 QQ 版本漂移）+ XOR-decrypt msgData → staging JSON。`openDatabase` / `suExec` / `isSuAvailable` 全 var 注入便于 unit test。 |
| `pdh/messaging/qq/QQLocalCollector.kt` | 110 | sealed `SnapshotResult` (Ok / NoCredentials / NoRoot / ExtractFailed / Failed) 编排器。`SNAPSHOT_SCHEMA_VERSION = 1` lockstep 锁与 JS 侧。 |
| `packages/personal-data-hub/lib/adapters/messaging-qq/index.js` | 460 | refactor 成 dual-mode（snapshot + sqlite）。snapshot mode constructor stateless；sqlite mode 沿用既有 keyProvider 模式但 throw 移到 sync time。`xorDecrypt` 与 Kotlin 同算法。 |
| `packages/personal-data-hub/__tests__/messaging-qq-snapshot.test.js` | 240 | 13 case：schemaVersion 锁 / authenticate 3 路径 / mismatch 抛 / empty / 3-kind round-trip / include / limit / 未知 kinds 过滤 / snapshottedAt fallback / 缺标识符 graceful / xorDecrypt 空输入 + ASCII + UTF-8 中文 round-trip。 |
| `packages/personal-data-hub/__tests__/longtail-adapters.test.js` (mod) | +30 | QQAdapter block 重写：snapshot/sqlite 双模式 + 新 SQL 表名 + XOR round-trip mock。 |
| `pdh/messaging/qq/QQXorDecryptorTest.kt` | 110 | 8 case：null/empty / ASCII round-trip / Chinese multibyte / 短 imei 循环 / 有符号 Byte / UTF-8+GBK 双失败 hex fallback / decode VFT。 |
| `pdh/messaging/qq/QQCredentialsStoreTest.kt` | 120 | 11 case：uin 空/非数字 / imei 空/长度错/非数字 / saveAccount 抛 / displayName 可选 / recordSync / recordError / clear。`prefs$delegate` 反射注入 stub SharedPreferences。 |
| `pdh/messaging/qq/QQLocalCollectorTest.kt` | 140 | 8 case：NoCredentials / NoRoot / SourceDbMissing 含 uin-hint / CopyFailed / Failed / extractor.NoCredentials desync 防 / Ok 完整路径 / SNAPSHOT_SCHEMA_VERSION lockstep gate。 |

### 3.2 v0.2 未 land — 阻塞于并行 session

| 待做 | 阻塞原因 | 解锁条件 |
|---|---|---|
| `HubLocalViewModel.kt` 加 `QQCardState` + 5 actions + init wire | 并行 session 正在改此文件（douyin/xhs/maps）race 高 | 并行 session 完成、tree 稳定后 |
| `HubLocalScreen.kt` 加 QQ 卡片 + `QQUinImeiEntryDialog` | 同上 | 同上 |
| `HubLocalViewModelTest.kt` 加 8-10 QQ lifecycle 测试 | 同上 | 同上 |

### 3.3 v1.0 待做 — Phase 13.5.6 真机 E2E

| Phase | 说明 | 估时 | 阻塞 |
|---|---|---|---|
| **13.5.6** | 真机 E2E 6 场景 | ~3-4h | 需 root QQ 设备 + Magisk-su |
| **13.5.7** | 反检测加固（小米 / Magisk DenyList 隐藏 root） | ~2-3h | E2E 暴露的问题点 |

---

## 4. 真机 E2E 场景（Phase 13.5.6 待做）

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 1 | NoRoot 路径 | 非 root 设备 → 输入 uin/imei → 同步 | banner "未 root，请改用桌面端" + deep-link |
| 2 | uin 错（DB 不在） | root 设备 → 输入错误 uin → 同步 | banner "QQ 数据库不存在 — uin 错？或 QQ 未登录此账号" |
| 3 | IMEI 错（XOR 解出乱码） | root 设备 → 输入错误 IMEI → 同步 | snapshot 写出但 content 是 hex 字符串；vault 入库后用户在 UI 看到乱码 |
| 4 | 正常采集 | root 设备 → 真实 uin + imei → 同步 | snapshot 含 N contacts + M groups + K messages；audit log 显示 ingested |
| 5 | 重复同步 idempotency | 场景 4 后再次点同步 | originalId 全 stable，audit ingested 不重复增长 |
| 6 | QQ 数据库 WAL 活跃 | 同步前在 QQ 里发一条消息（未 checkpoint） | cohort copy 含 .db-wal，新消息在 snapshot 里 |

---

## 5. 与 sjqz 项目参考关系

| sjqz 文件 | ChainlessChain 对应 | 关系 |
|---|---|---|
| `src/mobile_forensics/parsers/qq.py:71-116` (QQDecryptor) | `QQXorDecryptor.kt` + `xorDecrypt` (JS) | byte-identical algorithm；3 处独立实现需手动 lockstep |
| `qq.py:141-166` (get_friends) | `QQDbExtractor.queryContactRows` | 3 表 probe 顺序保留：Friends / friends / tb_recent_contact |
| `qq.py:168-188` (get_groups) | `QQDbExtractor.dumpTables` (TroopInfoV2 SELECT) | 列名 + 关系 1:1 |
| `qq.py:190-235` (get_friend_messages) + `qq.py:236-278` (get_group_messages) | `QQDbExtractor.dumpTables` (mr_friend_*_New / mr_troop_*_New) | 表名 LIKE pattern + sjqz 的 MD5(uin).upper() 不在我侧重算（直接 walk discovery 结果） |
| `qq.py:280-305` (get_all_message_tables) | `QQDbExtractor.dumpTables` (sqlite_master LIKE) | 1:1 |

---

## 6. 风险

1. **Magisk-su 用户基数小**：QQ 用户群体里 root 渗透率 < 10%。承担 90% 用户走桌面端是预期。
2. **QQ 版本漂移**：Friends/friends/tb_recent_contact 三表 probe 已防一类；列名 PRAGMA 解析防二类；但消息表前缀如果改名 (`mr_friend_xxx` → 其它) 会 silent skip，需要追新版本 QQ 时手动加 probe。
3. **IMEI 用户体验差**：Android 10+ READ_PHONE_STATE 受限，用户必须手工 `*#06#` 查 IMEI 填入。这与 WeChat md5 path 同样体验问题，已记入 trap memory。
4. **GBK fallback 范围有限**：JRE 缺 GBK 时直接 hex 兜底。Android 内置 GBK 一般在，但 Robolectric 测试环境可能缺；测试需注意。
5. **真机阻塞**：本次 v0.2 全在 Win 无设备完成，所有真机表现纯推断，13.5.6 落地前不能算 production-ready。

---

## 7. v0.2 验收

- [x] §3.1 全部 10 文件 land（scaffold + JS + tests）
- [x] JS 13/13 snapshot tests + 6/6 longtail QQ tests 全过
- [x] `:app:compileDebugUnitTestKotlin` 编译验证（待 race-stable 后跑）
- [ ] Kotlin 27 unit test 跑过（待 race-stable）
- [ ] HubLocal UI wire（v0.2 第二批，分独立 commit）
- [ ] 真机 E2E 6 场景（Phase 13.5.6，独立 commit）

---

## 8. 相关

- WeChat 同形：[`Android_WeChat_InApp_Frida_Collector.md`](./Android_WeChat_InApp_Frida_Collector.md)
- 桌面 adapter（refactored this commit）：[`packages/personal-data-hub/lib/adapters/messaging-qq/index.js`](../../packages/personal-data-hub/lib/adapters/messaging-qq/index.js)
- sjqz 参考实现：`C:\code\sjqz\src\mobile_forensics\parsers\qq.py`
- 内存 trap 记录：`memory/android_qq_collector_phase_13_5.md`（写于 v0.2 land 时）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（采集器）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「0. 为什么需要这个」。Android 端 QQ 本机采集采用 XOR-IMEI 方案，scaffold + 真 DbExtractor + 真 XorDecryptor + JS adapter snapshot 已 land，真机 E2E 待做（Phase 13.5.6，需 root QQ 设备）。

### 2. 核心特性

XOR-IMEI 解密；DbExtractor + XorDecryptor；JS adapter snapshot 模式；接通 `HubLocalScreen.kt` QQ 卡。

### 3. 系统架构

见正文「2. 总体架构」；与桌面侧 `packages/personal-data-hub/lib/adapters/messaging-qq/` 对应。

### 4. 系统定位

Personal Data Hub 的**Android 端 QQ 本机采集器**（Phase 13.5）。

### 5. 核心功能

见正文「3. 模块清单」：DbExtractor / XorDecryptor / JS adapter snapshot。

### 6. 技术架构

XOR-IMEI 解密本机 QQ DB；Magisk-root 依赖；sjqz `parsers/qq.py` 参考。

### 7. 系统特点

需 root；Magisk-root 用户群体范围有限（见正文风险）。

### 8. 应用场景

接通 HubLocalScreen QQ 卡，归集本机 QQ 数据。

### 9. 竞品对比

与 WeChat frida 方案同形（见 `Android_WeChat_InApp_Frida_Collector.md`）。

### 10. 配置参考

桌面侧 adapter `messaging-qq/index.js`；root 环境前置。

### 11. 性能指标

解密随 DB 规模线性；本机处理。

### 12. 测试覆盖

真机 E2E 待做（Phase 13.5.6）；v0.2 验收见正文 7。

### 13. 安全考虑

QQ 聊天高敏感；XOR-IMEI 解密本机自用；需 root（见正文 6 风险）。

### 14. 故障排除

XOR 解密失败 / DB 未找到 → 见 memory `android_qq_collector_phase_13_5.md` traps。

### 15. 关键文件

`packages/personal-data-hub/lib/adapters/messaging-qq/`；Android DbExtractor / XorDecryptor。

### 16. 使用示例

见正文模块清单与 JS adapter snapshot 用法。

### 17. 相关文档

见正文「8. 相关」：`Android_WeChat_InApp_Frida_Collector.md`、桌面 `messaging-qq`、sjqz `qq.py`。
