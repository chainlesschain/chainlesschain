# PDH Kuaishou Mode B — 真机 E2E checklist (Win-first)

> 状态: v1 (Phase 7.6.3, 2026-05-26)
> P7.6.1 + P7.6.2 ship 后真机验证起点
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> **共享 scenarios**: `docs/design/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E.md` §3 (本文档跨平台 scenario 不重复)
> **defer-recommended platform**: Plan §6.6 推 defer v2.0+ — v0.1 ship 是 user-explicit "Mode B 全面 5 平台" override

## 0. 为啥 Kuaishou Mode B 风险与 Xhs 并列最高?

[`docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`](./PDH_Social_Multipath_Local_Collection_Plan.md) §6.6 explicit 推 **defer v2.0+** for Kuaishou Mode B 因为:

1. **DB 几乎确定 SQLCipher / 自研加密** — 快手在加密强度上跟 Xhs 同档（远比 Bilibili/Weibo/Toutiao 严），没 frida hook 拿不到 key
2. **libmsaoaidsec.so 反 frida 极高强度** — 快手 Android 客户端有自研 NS_sig3 签名 SDK `libmsaoaidsec.so`，同时是反 frida 守护进程；攻克需先 hook libmsaoaidsec 几个关键函数让它不检测
3. **公开资料几乎为零** — 跟 Xhs 类似，公网搜不到 schema 备份或 hook 脚本

**v0.1 期望的真机结果分布** (与 Xhs 镜像对称):
- ~70% 概率: `likely-sqlcipher` banner (SQLite open 立即 fail "file is not a database")
- ~20% 概率: `source-db-missing` banner (db filename 不在 v0.1 candidate list)
- ~5% 概率: SQLite open 通但 PRAGMA / 解析失败 (schema 极度漂移)
- ~5% 概率: **明文走通** (老版本或特定区域版可能不加密)

E2E 的目标**不是**期待 v0.1 跑通，而是验证**失败时的 user-facing 行为 + v2.0 transition pointer 是否清晰**。

## 1. 准备清单 (Win 桌面 + Android 真机)

### Kuaishou-specific 项 (Toutiao + Douyin 通用项见上游 doc §1)

| 项 | 验证命令 |
|---|---|
| 设备已 Magisk root | `adb shell su -c "id -u"` 返 `0` |
| 快手官方版 APK 已装 (com.smile.gifmaker, NOT 极速版 com.kuaishou.nebula) | `adb shell pm list packages com.smile.gifmaker` 命中 |
| 快手 App 已登录 + 看过 10+ 视频 | watch / play_history 表有数据 |
| (可选) 收藏 1+ 视频 + 搜过 1+ 关键词 | collect + search 表有数据 |
| chainlesschain Android 已 sideload + Kuaishou path A 登录过 | uid (numeric) saved 到 `KuaishouCredentialsStore` |

**Kuaishou-specific 易踩坑**:

- **官方版 `com.smile.gifmaker` vs 极速版 `com.kuaishou.nebula`**: 包名完全不同（不是简单 `.lite` 后缀）。v0.1 只支持官方版；极速版用户走 path A。
- **DB filename 公开度为零**: v0.1 候选 (kwai.db / kuaishou.db / gif.db / video.db / feed.db / user.db / history.db) 全是猜的；真机概率 0.5+ source-db-missing 触发 P7.6.0 探测。
- **NS_sig3 签名跟 Mode B 无关**: NS_sig3 是 path A 发 HTTP 请求时的签名，由 libmsaoaidsec.so 提供。Mode B 直接读 db 文件不发 HTTP，**不需要** NS_sig3。但 libmsaoaidsec 同时是反 frida 守护，对 v2.0 frida-注入路径是阻碍。
- **watch vs play_history 表名歧义**: 候选表 5 个 (play_history / watch_history / video_history / history / watched_photo)，实际可能完全是其它名甚至跨多表 join。
- **search 表行数远少于 watch/collect**: 用户大多滑动浏览不主动搜索，LIMIT_SEARCH=500 已是 over-provisioned；预期真机 search 行数 < 50。
- **libmsaoaidsec.so 对 v0.1 file-copy 无效**: libmsaoaidsec 跑在 Kuaishou **app process**；`su -c "cp"` 跑在 **separate process**，libmsaoaidsec 够不到。**libmsaoaidsec 只对 v2.0 frida 注入是阻碍**。

## 2. 入口

chainlesschain Android App → PersonalDataHub → "本机数据" tab → **内容平台** section → 快手 card → "本机 root" 按钮（右下角小号 button，主按钮 "同步" 仍走 path A cookies + NS_sig3 签名 GraphQL）

UI button mapping:

| Card 按钮 | 行为 |
|---|---|
| 同步 | path A (cookies + NS_sig3 签名 + GraphQL HTTP visionFeedRecommend/visionProfilePhotoList/visionSearchPhoto) |
| **本机 root** (本文档) | Mode B (su + databases/*.db) |
| 退出登录 | path A logout (清 cookies + uid) |

## 3. Kuaishou-specific 验证场景

复用上游 doc § 通用 scenarios (NoCredentials / NoRoot / Schema drift / 单飞 / Banner discrimination)。下面只列 Kuaishou-specific 5 场景：

### 场景 K-1 — Path A vs Mode B 数据 fidelity (期待 path A 占主导)

**目的**: 验证 Mode B v0.1 即使能跑通，跟 path A 数据近似一致；**期待大概率走情况 B (SQLCipher) 走不通**

**前置**: 准备清单全绿 + path A 已跑过一次

**操作**:
1. 记录 path A 最新同步的 `watchCount` / `collectCount` / `searchCount` (banner)
2. 等 5 分钟，确保 db 完全持久化
3. 点 "本机 root" 触发 Mode B

**通过条件 (3 种结局)**:

**A. 明文走通 (~5% 概率)**:
- banner: `本机 root: 已同步 N 观看 / N 收藏 / N 搜索 (total X)`
- 数据 fidelity: |Mode B watch − path A watch| ≤ 30 / |Mode B collect − path A collect| ≤ 5 / |Mode B search − path A search| ≤ 10
- vault dedup: `cc audit social-kuaishou --kind watch` 同步两次 ≈ path A 一次 (events.id `watch-<photoId>` 共享 id)

**B. SQLCipher 命中 (~70% 概率, 期待结果)**:
- banner: `本机 root: likely-sqlcipher — file is not a database — Kuaishou DB 几乎确定 SQLCipher 或自研加密 + libmsaoaidsec.so 反 frida (v2.0 路径: frida + libmsaoaidsec neuter + key 派生 hook, 见 Phase 7 plan §6.6)`
- 这是**期待结果** — banner 明指 v2.0 路径

**C. source-db-missing (~20% 概率)**:
- banner: `本机 root: source-db-missing — 快手 databases/ 内未找到候选 DB 文件 ... (P7.6.0)`
- 触发 P7.6.0 探测回填

### 场景 K-2 — likely-sqlcipher 路径详查 (期待结果)

**目的**: 验证 likely-sqlcipher banner 内 4 个 keyword 都 surface (`SQLCipher` / `libmsaoaidsec` / `frida` / `v2.0 路径`)

**前置**: 场景 K-1 走情况 B

**通过条件 (banner 含全 4 keyword)**:
- ✓ "SQLCipher" — 解释问题性质
- ✓ "libmsaoaidsec.so" — 解释为啥不能直接 frida（与 Xhs 的 libshield.so 对偶）
- ✓ "frida" — 解释 v2.0 工具链
- ✓ "v2.0 路径" 或 "Phase 7 plan §6.6" — 指向具体 next-step 文档

**v2.0 follow-up steps (本 phase 不做，记录 user 反馈用)**:
1. 拿 root Kuaishou 设备 (Magisk + frida-server)
2. 跑 frida-server 看是否被 libmsaoaidsec kill — 如果被 kill, 必须先 hook libmsaoaidsec 关键 syscall (ptrace / readlink / 进程名扫描) ftw
3. 用 frida-trace 抓 `net.sqlcipher.database.SQLiteDatabase.openOrCreateDatabase()` 或快手自研 db open 入口，捕 key 参数
4. 把 key + algorithm + KDF iterations 加进 `KuaishouFridaInjector` (mirror WeChat 12.10)
5. v2.0 commit: 把 `KuaishouRootDbExtractor.openDatabase` 切到 `net.sqlcipher.database.SQLiteDatabase`

**Kuaishou v2.0 vs Xhs v2.0 差异**: libmsaoaidsec 同时是 NS_sig3 签名 SDK + 反 frida 守护，**hook 不能误伤签名功能**（否则 path A 也挂）。比 Xhs libshield (纯反爬守护) 更精细。

### 场景 K-3 — watch + collect + search 三 kind 全到位 (情况 A 走通时)

**前置**: 场景 K-1 走情况 A 明文 (走情况 B/C skip 本场景，等 v2.0)

**操作**: Mode B 同步 → 看 vault

**通过条件**:
```powershell
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db `
  "SELECT kind, COUNT(*) FROM events WHERE adapter='social-kuaishou' GROUP BY kind;"
```
- 应见 3 行：`watch=N` / `collect=M` / `search=K`，N+M+K ≥ 5
- **不应见** `profile` kind (Mode B v0.1 skip — profile derive from credentialsStore not DB; path A visionProfilePhotoList covers)
- **search 行数预期 < 50** (用户大多滑动浏览不主动搜索)

### 场景 K-4 — DB filename 探测回填 (P7.6.0 paste-back 闭环)

**目的**: 验证场景 K-1 情况 C 触发后 P7.6.0 探测 → v0.2 fix → 重测的全链路

**前置**: 场景 K-1 情况 C 真发生过

**操作**:
1. 跑 `adb shell su -c "ls -la /data/data/com.smile.gifmaker/databases/" > kuaishou-db-list.txt`
2. `adb shell su -c "for f in /data/data/com.smile.gifmaker/databases/*.db; do echo === $f ===; sqlite3 $f '.tables' 2>/dev/null; done" > kuaishou-db-tables.txt`
3. 把 kuaishou-db-list.txt + kuaishou-db-tables.txt 内容存档 (Plan §6.6 P7.6.0 fill-in)
4. 看哪个 .db 最像，加进 `KuaishouRootDbExtractor.DB_FILENAME_CANDIDATES`
5. 同步 sqlite3 PRAGMA 输出，看候选表名匹哪个，调候选表 list
6. 重 sideload chainlesschain Android
7. 再点 "本机 root"

**通过条件**:
- 二次同步走通 (情况 A 走 K-3) 或命中下一坑 (情况 B 走 K-2)

**关键**: 这个场景验证 v0.1 → v0.2 文档闭环 — banner 列 candidate list → P7.6.0 探测 → 代码回填 → 重测过

### 场景 K-5 — 极速版 (com.kuaishou.nebula) → SourceDbMissing → defer

**前置**: 卸载 `com.smile.gifmaker` 官方版, **只**装 `com.kuaishou.nebula` (极速版)

**操作**: 点 "本机 root"

**通过条件**:
- banner `本机 root: source-db-missing — 快手 databases/ 内未找到候选 DB 文件`
- (这是正确行为 — v0.1 只支持官方版。极速版包名完全不同需要单独 candidate list)

如果 user 要加极速版支持，跑探测:
```powershell
adb shell pm list packages | findstr -i kuaishou  # 列实际包名
adb shell su -c "ls /data/data/com.kuaishou.nebula/databases/"
```
然后把极速版包名 + 各自 db filename 加到 `KuaishouRootDbExtractor.KUAISHOU_DB_REMOTE_DIR` (但要拆成 var 而非 const 因为 dir varies per package) — 推到 v0.2 commit.

## 4. 完工标记 (Kuaishou Mode B v0.1)

- [ ] 场景 K-1 走通 1 种结局 + banner 内容正确
- [ ] 场景 K-2 likely-sqlcipher banner 含 4 keyword (SQLCipher / libmsaoaidsec / frida / v2.0 路径)
- [ ] 场景 K-3 情况 A 走通时 watch + collect + search 三 kind 全出，不出 profile
- [ ] 场景 K-4 探测回填闭环 — banner 列 candidate → P7.6.0 探测 → 代码回填 → 重测过
- [ ] 场景 K-5 极速版 → SourceDbMissing → 决定是否升 v0.2
- [ ] 通用 §3 scenarios (NoCredentials / NoRoot / 单飞 / Banner) 也走一遍

## 5. 跟 Path A NS_sig3 签名协调

| 路径 | 入口 button | 数据来源 | 网络依赖 | 反爬影响 | 验证 |
|---|---|---|---|---|---|
| **Path A (默认)** | "同步" | GraphQL `kuaishouzt.com` + NS_sig3 签名 + kpf/kpn headers | ✓ 必需 | NS_sig3 rotate 每 4-8 周需更新 SignProvider | path A E2E doc |
| **Mode B (本文档)** | "本机 root" | `/data/data/com.smile.gifmaker/databases/*.db` | ✗ 离线 | libmsaoaidsec.so 阻 v2.0 frida (v0.1 file-copy 不阻) | 本文档 |

两路径写到**同一个** `social-kuaishou` adapter, 共享 schemaVersion=1, events.id 设计上 dedup 跨路径。**Mode B v0.1 是低期望 fallback；真机大概率走 v2.0 frida + libmsaoaidsec neuter 路径**。

## 6. 后续

- **P7.6.0** — 真机 schema 探测 (上文场景 K-4 + K-5 触发的逻辑) → 更新 `DB_FILENAME_CANDIDATES` + column-candidate lists
- **Kuaishou Mode B v2.0** — frida + libmsaoaidsec neuter + SQLCipher key 派生 hook (走情况 B 时唯一可行路径)。预计 4-6 周，需 root 快手真机持续访问 + frida-trace + 不误伤 NS_sig3 签名功能 (这是 Kuaishou 比 Xhs 更复杂的地方)
- **跟 P7.1.0 / P7.2.0 / P7.3 / P7.5.0 共享**: 5 平台 schema 探测可一次跑完 (共享 adb su shell sqlite3 .schema dump 流程)
- **Phase 7 完工标记**: Kuaishou Mode B v0.1 ship 后, **5 内容平台 Mode B 全有 button + E2E doc** (Toutiao + Douyin + Bilibili + Weibo + Xhs + Kuaishou = 6 platforms). Phase 7 主线 complete; 剩 user-driven 真机 fill-in (P7.1.0 / P7.2.0 / P7.3 §4 / P7.5.0 / P7.6.0) + v2.0 frida 路径 (Xhs / Kuaishou)。

## 附录：规范章节补全（v5.0.3.108）

> 本文为 Mode B 真机 E2E checklist。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角。

### 1. 概述

见正文头部。PDH Kuaishou Mode B（本机 root SQLite fallback）真机 E2E checklist（Phase 7.6.3，Win-first）；v0.1 ship 后 6 内容平台 Mode B 全有 button + E2E doc，Phase 7 主线 complete。

### 2. 核心特性

本机 root DB 采集；Win-first；libmsaoaidsec dual-role caveat（v2.0 frida 路径预留）。

### 3. 系统架构

adb su sqlite3 → 本机 DB → `social-kuaishou` adapter → vault。

### 4. 系统定位

PDH Kuaishou Mode B 的**本机 DB 真机 E2E 验收 checklist**。

### 5. 核心功能

见正文场景 K-1~K-5：root 探测 / DB 解析 / vault。

### 6. 技术架构

root + adb su sqlite3；DB_FILENAME_CANDIDATES；v2.0 frida + libmsaoaidsec neuter + SQLCipher key hook（情况 B）。

### 7. 系统特点

libmsaoaidsec 既反 frida 又承 NS_sig3 签名（dual-role，比 Xhs 更复杂）；v2.0 frida 4–6 周。

### 8. 应用场景

无 cookie/网络时离线本机采集 fallback。

### 9. 竞品对比

Mode B vs C 路径（`PDH_Kuaishou_C_Path_Real_Device_E2E.md`）。

### 10. 配置参考

root；DB_FILENAME_CANDIDATES + column-candidate（P7.6.0 schema 探测）。

### 11. 性能指标

本机解析随 DB 规模线性。

### 12. 测试覆盖

本文即 Mode B E2E checklist；schema 探测 P7.6.0 fill-in。

### 13. 安全考虑

需 root；本机 DB 高敏感；SQLCipher；libmsaoaidsec 反 frida。

### 14. 故障排除

走情况 B（DB 加密 / 反 frida）→ v2.0 frida + libmsaoaidsec neuter（不误伤 NS_sig3）。

### 15. 关键文件

`social-kuaishou` adapter（Mode B 三件套）；vault。

### 16. 使用示例

见正文 K-1~K-5 场景步骤。

### 17. 相关文档

`PDH_Kuaishou_C_Path_Real_Device_E2E.md`、`PDH_Mode_B_RealDevice_Master_Checklist.md`、memory `pdh_mode_b_phase_7.md`。
