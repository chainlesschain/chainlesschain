# PDH Xhs Mode B — 真机 E2E checklist (Win-first)

> 状态: v1 (Phase 7.5.3, 2026-05-26)
> P7.5.1 + P7.5.2 ship 后真机验证起点
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> **共享 scenarios**: `docs/design/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E.md` §3 (本文档跨平台 scenario 不重复)
> **defer-recommended platform**: Plan §6.5 推 defer v2.0+ — v0.1 ship 是 user-explicit "Mode B 全面 5 平台" override

## 0. 为啥 Xhs Mode B 风险最高?

[`docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`](./PDH_Social_Multipath_Local_Collection_Plan.md) §6.5 explicit 推 **defer v2.0+** for Xhs Mode B 因为:

1. **DB 几乎确定 SQLCipher 加密** — Xhs 是少数把本机 db 加密的 App (远比 Weibo 严)，没 frida hook 拿不到 key
2. **libshield.so 反 frida 高强度** — Xhs Android 客户端有自研壳 `libshield.so`，会 detect frida 注入然后 kill process 或 corrupt 数据；攻克需先 hook libshield 几个关键函数让它不检测
3. **公开资料几乎为零** — 不像 WeChat (Phase 12.10) 有 frida-hook agent 几年公网积累 / Bilibili 有完整 decompile / Toutiao 有字节系 SDK 泄露，Xhs 网上几乎搜不到 schema 备份或 hook 脚本

**v0.1 期望的真机结果分布**:
- ~70% 概率: `likely-sqlcipher` banner (SQLite open 立即 fail "file is not a database")
- ~20% 概率: `source-db-missing` banner (db filename 不在 v0.1 candidate list)
- ~5% 概率: SQLite open 通但 PRAGMA / 解析失败 (schema 极度漂移)
- ~5% 概率: **明文走通** (老版本或特定区域版可能不加密)

E2E 的目标**不是**期待 v0.1 跑通，而是验证**失败时的 user-facing 行为 + v2.0 transition pointer 是否清晰**。

## 1. 准备清单 (Win 桌面 + Android 真机)

### Xhs-specific 项 (Toutiao + Douyin 通用项见上游 doc §1)

| 项 | 验证命令 |
|---|---|
| 设备已 Magisk root | `adb shell su -c "id -u"` 返 `0` |
| 小红书官方版 APK 已装 (com.xingin.xhs) | `adb shell pm list packages com.xingin.xhs` 命中 |
| 小红书 App 已登录 + 看过 5+ 笔记 | liked / history tables 有数据 |
| (可选) 关注 1+ 用户 + 发过 1+ 笔记 | follow / notes tables 有数据 |
| chainlesschain Android 已 sideload + Xhs path A 登录过 | userIdStr (24-char hex) saved 到 `XhsCredentialsStore` |

**Xhs-specific 易踩坑**:

- **user_id 是 24-char hex 不是数字**: 跟 Bilibili/Weibo 数字 uid 不同，Xhs `user_id` 是 ObjectId-like 24-char hex (MongoDB 出身)。`XhsRootCredentialsStore.saveXhsAccount` 校验 `^[0-9a-fA-F]{24}$` 防 SUB cookie / 数字 uid 串入。
- **`com.xingin.xhs` vs 极速版/小红薯包名不同**: 官方版 `com.xingin.xhs` / 极速版 `com.xingin.xhsTrace`(可能) / 小红书 App Lite 包名待探测。v0.1 只支持官方版。
- **DB filename 公开度为零**: v0.1 候选 (xhs.db / redbook.db / notes.db / discovery.db / user.db / xhs_cache.db / red.db) 全是猜的；真机概率 0.5+ source-db-missing 触发 P7.5.0 探测。
- **note vs notes 表名歧义**: 候选表 5 个 (notes / note / user_notes / my_notes / publish_note)，但实际可能完全是其它名。
- **liked vs likes 表名歧义**: 候选 5 个 (liked_notes / liked / like_notes / user_liked / favourite_like)，实际可能拆多表 join。
- **libshield.so 对 v0.1 file-copy 无效**: libshield 跑在 Xhs **app process**；`su -c "cp"` 跑在 **separate process**，libshield 够不到。**libshield 只对 v2.0 frida 注入是阻碍**，v0.1 文件拷贝 + SQLite open 不受影响。

## 2. 入口

chainlesschain Android App → PersonalDataHub → "本机数据" tab → **内容平台** section → 小红书 card → "本机 root" 按钮（右下角小号 button，主按钮 "同步" 仍走 path A cookies + X-S 签名）

UI button mapping:

| Card 按钮 | 行为 |
|---|---|
| 同步 | path A (cookies + X-S 签名 + edith.xiaohongshu.com HTTP) |
| **本机 root** (本文档) | Mode B (su + databases/*.db) |
| 退出登录 | path A logout (清 cookies + userIdStr) |

## 3. Xhs-specific 验证场景

复用上游 doc § 通用 scenarios (NoCredentials / NoRoot / Schema drift / 单飞 / Banner discrimination)。下面只列 Xhs-specific 5 场景：

### 场景 X-1 — Path A vs Mode B 数据 fidelity (期待 path A 占主导)

**目的**: 验证 Mode B v0.1 即使能跑通，跟 path A 数据近似一致；**期待大概率走情况 B (SQLCipher) 走不通**

**前置**: 准备清单全绿 + path A 已跑过一次

**操作**:
1. 记录 path A 最新同步的 `noteCount` / `likedCount` / `followCount` (banner)
2. 等 5 分钟，确保 db 完全持久化
3. 点 "本机 root" 触发 Mode B

**通过条件 (3 种结局)**:

**A. 明文走通 (~5% 概率)**:
- banner: `本机 root: 已同步 N 笔记 / N 点赞 / N 关注 (total X)`
- 数据 fidelity: |Mode B note − path A note| ≤ 5 / |Mode B liked − path A liked| ≤ 30 / |Mode B follow − path A follow| ≤ 10
- vault dedup: `cc audit social-xiaohongshu --kind note` 同步两次 ≈ path A 一次 (events.id `note-<noteId>` 共享 id)

**B. SQLCipher 命中 (~70% 概率)**:
- banner: `本机 root: likely-sqlcipher — file is not a database — Xhs DB 几乎确定 SQLCipher 加密 + libshield.so 反 frida (v2.0 路径: frida + libshield neuter + key 派生 hook, 见 Phase 7 plan §6.5)`
- 这是**期待结果** — banner 明指 v2.0 路径

**C. source-db-missing (~20% 概率)**:
- banner: `本机 root: source-db-missing — 小红书 databases/ 内未找到候选 DB 文件 ... (P7.5.0)`
- 触发 P7.5.0 探测回填

### 场景 X-2 — likely-sqlcipher 路径详查 (期待结果)

**目的**: 验证 likely-sqlcipher banner 内 4 个 keyword 都 surface (`SQLCipher` / `libshield` / `frida` / `v2.0 路径`)

**前置**: 场景 X-1 走情况 B

**通过条件 (banner 含全 4 keyword)**:
- ✓ "SQLCipher" — 解释问题性质
- ✓ "libshield.so" — 解释为啥不能直接 frida
- ✓ "frida" — 解释 v2.0 工具链
- ✓ "v2.0 路径" 或 "Phase 7 plan §6.5" — 指向具体 next-step 文档

**v2.0 follow-up steps (本 phase 不做，记录 user 反馈用)**:
1. 拿 root Xhs 设备 (Magisk + frida-server)
2. 跑 frida-server 看是否被 libshield kill — 如果被 kill, 必须先 hook libshield ftw
3. 用 frida-trace 抓 `net.sqlcipher.database.SQLiteDatabase.openOrCreateDatabase()` 或类似入口，捕 key 参数
4. 把 key + algorithm + KDF iterations 加进 `XhsFridaInjector` (mirror WeChat 12.10)
5. v2.0 commit: 把 `XhsRootDbExtractor.openDatabase` 切到 `net.sqlcipher.database.SQLiteDatabase`

### 场景 X-3 — note + liked + follow 三 kind 全到位 (情况 A 走通时)

**前置**: 场景 X-1 走情况 A 明文 (走情况 B/C skip 本场景，等 v2.0)

**操作**: Mode B 同步 → 看 vault

**通过条件**:
```powershell
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db `
  "SELECT kind, COUNT(*) FROM events WHERE adapter='social-xiaohongshu' GROUP BY kind;"
```
- 应见 3 行：`note=N` / `liked=M` / `follow=K`，N+M+K ≥ 5
- **不应见** `history` / `like` / `favourite` 三个 kind (那些是 sqlite-mode legacy only，snapshot 模式不接，mirror `VALID_SNAPSHOT_KINDS`)

### 场景 X-4 — DB filename 探测回填 (P7.5.0 paste-back 闭环)

**目的**: 验证场景 X-1 情况 C 触发后 P7.5.0 探测 → v0.2 fix → 重测的全链路

**前置**: 场景 X-1 情况 C 真发生过

**操作**:
1. 跑 `adb shell su -c "ls -la /data/data/com.xingin.xhs/databases/" > xhs-db-list.txt`
2. `adb shell su -c "for f in /data/data/com.xingin.xhs/databases/*.db; do echo === $f ===; sqlite3 $f '.tables' 2>/dev/null; done" > xhs-db-tables.txt`
3. 把 xhs-db-list.txt + xhs-db-tables.txt 内容存档 (Plan §6.5 P7.5.0 fill-in)
4. 看哪个 .db 最像，加进 `XhsRootDbExtractor.DB_FILENAME_CANDIDATES`
5. 同步 sqlite3 PRAGMA 输出，看候选表名匹哪个 (notes / note / user_notes / ...)，调候选表 list
6. 重 sideload chainlesschain Android
7. 再点 "本机 root"

**通过条件**:
- 二次同步走通 (情况 A 走 X-3) 或命中下一坑 (情况 B 走 X-2)

**关键**: 这个场景验证 v0.1 → v0.2 文档闭环 — banner 列 candidate list → P7.5.0 探测 → 代码回填 → 重测过

### 场景 X-5 — 极速版/小红薯/小红书海外版 → SourceDbMissing → defer

**前置**: 卸载 `com.xingin.xhs` 官方版, **只**装极速版 / 小红薯 / 海外版

**操作**: 点 "本机 root"

**通过条件**:
- banner `本机 root: source-db-missing — 小红书 databases/ 内未找到候选 DB 文件`
- (这是正确行为 — v0.1 只支持官方版)

如果 user 要加变种支持，跑探测:
```powershell
adb shell pm list packages | findstr -i xhs  # 列实际包名
adb shell su -c "ls /data/data/com.xingin.xhsTrace/databases/"  # 假设极速版包名
```

## 4. 完工标记 (Xhs Mode B v0.1)

- [ ] 场景 X-1 走通 1 种结局 + banner 内容正确
- [ ] 场景 X-2 likely-sqlcipher banner 含 4 keyword (SQLCipher / libshield / frida / v2.0 路径)
- [ ] 场景 X-3 情况 A 走通时 note + liked + follow 三 kind 全出，不出 history/like/favourite
- [ ] 场景 X-4 探测回填闭环 — banner 列 candidate → P7.5.0 探测 → 代码回填 → 重测过
- [ ] 场景 X-5 极速版/海外版 → SourceDbMissing → 决定是否升 v0.2
- [ ] 通用 §3 scenarios (NoCredentials / NoRoot / 单飞 / Banner) 也走一遍

## 5. 跟 Path A X-S 签名协调

| 路径 | 入口 button | 数据来源 | 网络依赖 | 反爬影响 | 验证 |
|---|---|---|---|---|---|
| **Path A (默认)** | "同步" | `edith.xiaohongshu.com` + X-S 签名 + a1 cookie | ✓ 必需 | X-S rotate 每 4-8 周需更新 SignProvider | path A E2E doc |
| **Mode B (本文档)** | "本机 root" | `/data/data/com.xingin.xhs/databases/*.db` | ✗ 离线 | libshield.so 阻 v2.0 frida (v0.1 file-copy 不阻) | 本文档 |

两路径写到**同一个** `social-xiaohongshu` adapter, 共享 schemaVersion=1, events.id 设计上 dedup 跨路径。**Mode B v0.1 是低期望 fallback；真机大概率走 v2.0 frida + libshield neuter 路径**。

## 6. 后续

- **P7.5.0** — 真机 schema 探测 (上文场景 X-4 + X-5 触发的逻辑) → 更新 `DB_FILENAME_CANDIDATES` + column-candidate lists
- **Xhs Mode B v2.0** — frida + libshield neuter + SQLCipher key 派生 hook (走情况 B 时唯一可行路径)。预计 4-6 周，需 root Xhs 真机持续访问 + frida-trace + smali patch libshield
- **跟 P7.1.0 / P7.2.0 / P7.3 共享**: 5 平台 schema 探测可一次跑完 (共享 adb su shell sqlite3 .schema dump 流程)
