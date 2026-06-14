# PDH Weibo Mode B — 真机 E2E checklist (Win-first)

> 状态: v1 (Phase 7.4.3, 2026-05-26)
> P7.4.1 + P7.4.2 ship 后真机验证起点
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> **共享 scenarios**: `docs/design/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E.md` §3 (本文档跨平台 scenario 不重复)
> **schema 探测 prereq**: `docs/design/PDH_Weibo_DB_Schema_Probe.md` (P7.3 user-driven adb + frida)

## 0. 为啥 Weibo Mode B 风险最高?

[`docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`](./PDH_Social_Multipath_Local_Collection_Plan.md) §6.2: Weibo Mode B = **"零公开资料 → 从零逆向"**。Bilibili 有完整 decompile / Toutiao 有字节系 SDK 泄露，但 Weibo Android 客户端老但封闭，公网搜不到 schema 备份。

P7.4.1 v0.1 ship 时**全靠 best-guess** — 假设 `weibo.db` + 7 张候选表名 + 各列 PRAGMA-defensive picker。三种真机结果分支:

1. **明文 SQLite 走通** → 直接出数据 ✓ (期望流，§6 推 0.6 概率)
2. **`file is not a database`** → SQLCipher 加密。v0.1 自动 surface "**likely-sqlcipher**" banner + P7.3 §3.4-3.6 frida 指针 → v0.2 跟 (§6 推 0.3 概率)
3. **`source-db-missing`** → DB filename 不在候选列表。跑 P7.3 §3 探测找真名 → v0.2 加入 candidate list (§6 推 0.1 概率)

真机 E2E 的目标是**走完三条分支**确认 v0.1 → v0.2 transition 全部 user-actionable，不是 dead-end。

## 1. 准备清单 (Win 桌面 + Android 真机)

### Weibo-specific 项 (Toutiao + Douyin 通用项见上游 doc §1)

| 项 | 验证命令 |
|---|---|
| 设备已 Magisk root | `adb shell su -c "id -u"` 返 `0` |
| 微博官方版 APK 已装 (NOT 国际版/极速版/Lite) | `adb shell pm list packages com.sina.weibo` 命中 |
| 微博 App 已登录 + 发过 / 看过 3+ 微博 | post / favourite tables 有数据 |
| (可选) 收藏 1+ 微博 + 关注 1+ 用户 | favourite + follow tables 有数据 |
| chainlesschain Android 已 sideload + Weibo path A 登录过 | uid saved 到 `WeiboCredentialsStore` |

**Weibo-specific 易踩坑**:

- **uid 长度差异大**: 早期账号 6-7 位（2010 前），现代账号 10 位。`WeiboRootCredentialsStore.saveWeiboAccount` 设 floor=6 数位防 SUB cookie 串入。
- **`com.sina.weibo` vs 国际版/极速版/Lite 包名不同**: 官方版 `com.sina.weibo` / 国际版 `com.weico.international` / 极速版 `com.sina.weibolite` / Lite `com.weibo.lite`。v0.1 只支持官方版。
- **post 表名歧义**: 微博的"微博条目"在 db 里可能叫 `status` / `mblog` / `weibo` / `feed` / `home_status` — 5 个候选都试。
- **mid vs id 双 identifier**: 微博 mblog 有内部数字 `mid` 跟 web 上的字符串 mid 形式。v0.1 优先取 numeric `mid`。
- **收藏不带文本**: 部分版本 favourite 表只存 `status_id`，文本要 join statuses 表才出。v0.1 OK 出 status_id 即可（vault 后续可 enrich）。
- **attention vs friendships 表名**: 关注用户列表早期叫 `attention` / `friend`，新版本可能改 `friendships` / `subscription`。defensive findTable 4 候选。

## 2. 入口

chainlesschain Android App → PersonalDataHub → "本机数据" tab → **内容平台** section → 微博 card → "本机 root" 按钮（右下角小号 button，主按钮 "同步" 仍走 path A m.weibo.cn cookies）

UI button mapping:

| Card 按钮 | 行为 |
|---|---|
| 同步 | path A (cookies + m.weibo.cn HTTP) |
| **本机 root** (本文档) | Mode B (su + databases/*.db) |
| 退出登录 | path A logout (清 cookies + uid) |

## 3. Weibo-specific 验证场景

复用上游 doc § 通用 scenarios (NoCredentials / NoRoot / Schema drift / 单飞 / Banner discrimination)。下面只列 Weibo-specific 5 场景：

### 场景 W-1 — Path A vs Mode B 数据 fidelity 对比

**目的**: 验证 Mode B 抓到的 post/favourite/follow 跟 path A 近似一致（fallback 不是 alternative truth）

**前置**: 准备清单全绿 + path A 已跑过一次（vault 有 path A 写入的数据）

**操作**:
1. 记录 path A 最新一次同步的 `postCount` / `favouriteCount` / `followCount` (banner 上)
2. 等 5 分钟，确保 db 完全持久化
3. 点 "本机 root" 触发 Mode B
4. 记录 Mode B 的同样三个 count

**通过条件**:
- |Mode B post − path A post| ≤ 30 (db 缓存历史比 server 短一些 OK)
- |Mode B favourite − path A favourite| ≤ 5
- |Mode B follow − path A follow| ≤ 10
- **vault dedup 验**: `cc audit social-weibo --kind post` 命令同步两次后总数应 ≈ path A 一次结果，**不是** path A × 2 (events.id 的 `post-<mid>` / `fav-<statusId>` / `follow-<uid>` 共享 id 让两路径在 vault 层 dedup)

### 场景 W-2 — 明文-or-SQLCipher 决策分支 (v0.1 → v0.2 transition)

**目的**: 验证 v0.1 在三种 db 状态下的 user-facing 行为

**情况 A — 明文 SQLite 走通**

**操作**: 点 "本机 root"

**通过条件**:
- banner: `本机 root: 已同步 N 微博 / N 收藏 / N 关注 (total X)`
- Mode B v1.0 闭环 ✓

**情况 B — `file is not a database` (SQLCipher)**

**操作**: 点 "本机 root"

**通过条件**:
- banner: `本机 root: likely-sqlcipher — file is not a database — 可能是 SQLCipher 加密 (P7.3 §3.4-3.6 frida hook path 解锁 v0.2)`
- **关键**: banner 必须明确指 P7.3 §3.4-3.6（不要含糊的"可能加密"）— 这是 v0.1 → v0.2 transition 的 user-actionable 路径

**后续**: 跑 `docs/design/PDH_Weibo_DB_Schema_Probe.md` §3.5 SQLCipher frida hook → 拿 key → 升 v0.2 加 `WeiboFridaInjector` (mirror WeChat 12.10)

**情况 C — `source-db-missing` (DB filename 不在候选)**

**操作**: 点 "本机 root"

**通过条件**:
- banner: `本机 root: source-db-missing — 微博 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 weibo.db / mblog.db / feed.db / user.db / home_feed.db / weibo_pro.db / status.db。请运行真机 schema 探测 (P7.3 §3) 把实际文件名加入候选列表。(uid=N)`
- banner 必须列出 v0.1 试过的 candidate list — 让 user 知道**为啥**没找到，下一步该跑啥

**后续**: 跑 `docs/design/PDH_Weibo_DB_Schema_Probe.md` §3 PowerShell `adb shell su -c "ls /data/data/com.sina.weibo/databases/"` → paste 真名进 `WeiboRootDbExtractor.DB_FILENAME_CANDIDATES` → 升 v0.2

### 场景 W-3 — Post + Favourite + Follow 三 kind 全到位

**前置**: Weibo 账号 ≥ 3 条 post + ≥ 1 个 favourite + ≥ 1 个 follow

**操作**: Mode B 同步 → 看 vault

**通过条件**:
```powershell
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db `
  "SELECT kind, COUNT(*) FROM events WHERE adapter='social-weibo' GROUP BY kind;"
```
- 应见 3 行：`post=N` / `favourite=M` / `follow=K`，N+M+K ≥ 5
- **不应见** `kind='search'` — search 是 sqlite-mode legacy only，snapshot 模式不接 (mirror `VALID_SNAPSHOT_KINDS`)

### 场景 W-4 — DB filename 探测回填 (P7.3 §4 paste-back 闭环)

**目的**: 验证场景 W-2 情况 C 触发后 P7.3 探测 → v0.2 fix → 重测的全链路

**前置**: 场景 W-2 情况 C 真发生过（user 看到 source-db-missing banner）

**操作**:
1. 跑 `adb shell su -c "ls /data/data/com.sina.weibo/databases/" > weibo-db-list.txt`
2. 把 weibo-db-list.txt 内容 paste 进 `docs/design/PDH_Weibo_DB_Schema_Probe.md` §4
3. 看哪个文件最像 — 加进 `WeiboRootDbExtractor.DB_FILENAME_CANDIDATES`
4. 重 sideload chainlesschain Android
5. 再点 "本机 root"

**通过条件**:
- 二次同步走通（场景 W-1 path A vs Mode B 对比能跑）
- 或者命中下一坑（明文 → 走 W-2 情况 A，SQLCipher → 走 W-2 情况 B）

**关键**: 这个场景验证 v0.1 → v0.2 文档闭环 — banner 指出问题 → P7.3 doc 指出探测命令 → 探测结果回填代码 → 重测过

### 场景 W-5 — Weibo Lite / GIF / 国际版 → SourceDbMissing → defer v0.2

**前置**: 卸载 `com.sina.weibo` 官方版, **只**装 `com.sina.weibolite` (极速版) 或 `com.weico.international` (国际版)

**操作**: 点 "本机 root"

**通过条件**:
- banner `本机 root: source-db-missing — 微博 databases/ 内未找到候选 DB 文件`
- (这是正确行为 — 我们只支持官方版。极速/国际/Lite 需要单独 candidate list + schema 探测，defer 到 v0.2)

如果 user 确实想加极速版支持，跑探测：
```powershell
adb shell su -c "ls /data/data/com.sina.weibolite/databases/"
adb shell su -c "for f in /data/data/com.sina.weibolite/databases/*.db; do echo === \$f ===; sqlite3 \$f '.schema' 2>/dev/null | head -50; done"
```
然后把极速版 package + DB filename 加到 `WeiboRootDbExtractor.WEIBO_DB_REMOTE_DIR` (但要拆成 var 而非 const 因为 dir varies per package) — 推到 v0.2 commit.

## 4. 完工标记 (Weibo Mode B v1.0)

- [ ] 场景 W-1 path A vs Mode B count 差异 ≤ tolerance + vault dedup 验
- [ ] 场景 W-2 情况 A 明文走通（或 B SQLCipher banner 正确指 P7.3 §3.5，或 C source-missing banner 列 candidate list）
- [ ] 场景 W-3 post + favourite + follow 三 kind 全出，没有 search
- [ ] 场景 W-4 探测回填闭环 — banner 指 P7.3 doc 指探测命令 指代码回填 走通
- [ ] 场景 W-5 极速/国际版 → SourceDbMissing → 决定是否升 v0.2
- [ ] 通用 §3 scenarios (NoCredentials / NoRoot / 单飞 / Banner) 也走一遍

## 5. 跟 Path A m.weibo.cn 协调

| 路径 | 入口 button | 数据来源 | 网络依赖 | 验证 |
|---|---|---|---|---|
| **Path A (默认)** | "同步" | `m.weibo.cn` cookies + HTTP | ✓ 必需 | path A E2E doc |
| **Mode B (本文档)** | "本机 root" | `/data/data/com.sina.weibo/databases/*.db` | ✗ 离线 | 本文档 |

两路径写到**同一个** `social-weibo` adapter, 共享 schemaVersion=1, events.id 设计上 dedup 跨路径。**Mode B 是 path A 的离线 fallback / 高保密 alternative，不是替代品**。

## 6. 后续

- **P7.3 §4 真机 fill-in** — `adb shell su -c "ls databases/"` + frida hook 探测 → 更新 `DB_FILENAME_CANDIDATES` + column-candidate lists 反映真机实际
- **Weibo Mode B v0.2** — 加极速/国际/Lite 包名 + 各自 db schema 探测（如果场景 W-5 实际有人触发）
- **Weibo Mode B v2.0** — SQLCipher key 解出后加 `WeiboFridaInjector` (mirror WeChat Phase 12.10) — 仅 v0.2 走情况 B 时必要
- **跟 P7.1.0 / P7.2.0 共享**: Toutiao + Douyin + Bilibili + Weibo 四个平台的 schema 探测可以一次跑完（共享 adb su shell sqlite3 .schema dump 流程）

## 附录：规范章节补全（v5.0.3.108）

> 本文为 Mode B 真机 E2E checklist。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角。

### 1. 概述

见正文头部。PDH Weibo Mode B（本机 root SQLite fallback）真机 E2E checklist（Phase 7.4.3，Win-first）；含三分支决策（A 加固 / B frida / defer）。

### 2. 核心特性

本机 root DB 采集；5 Weibo-specific 三分支决策；Win-first。

### 3. 系统架构

adb su sqlite3 → 本机 DB → `social-weibo` adapter → vault；schema 探测见 `PDH_Weibo_DB_Schema_Probe.md`。

### 4. 系统定位

PDH Weibo Mode B 的**本机 DB 真机 E2E 验收 checklist**。

### 5. 核心功能

见正文场景 W-1~W-5：root 探测 / DB 解析 / 三分支决策 / vault。

### 6. 技术架构

root + adb su sqlite3；DB_FILENAME_CANDIDATES；v2.0 `WeiboFridaInjector`（mirror WeChat Phase 12.10，情况 B）。

### 7. 系统特点

三分支决策（path A 加固 / v2.0 frida / defer）；schema 探测 P7.3 fill-in。

### 8. 应用场景

无 cookie/网络时离线本机采集 fallback。

### 9. 竞品对比

Mode B vs C 路径（`PDH_Weibo_Real_Device_E2E.md`）。

### 10. 配置参考

root；DB_FILENAME_CANDIDATES + column-candidate（P7.3 §4 探测）。

### 11. 性能指标

本机解析随 DB 规模线性。

### 12. 测试覆盖

本文即 Mode B E2E checklist；schema 探测见 `PDH_Weibo_DB_Schema_Probe.md`。

### 13. 安全考虑

需 root；本机 DB 高敏感；SQLCipher；v2.0 frida 解 SQLCipher key。

### 14. 故障排除

走情况 B（DB SQLCipher 加密）→ v2.0 `WeiboFridaInjector`（mirror WeChat 12.10）。

### 15. 关键文件

`social-weibo` adapter（Mode B 三件套）；`PDH_Weibo_DB_Schema_Probe.md`；vault。

### 16. 使用示例

见正文 W-1~W-5 场景步骤。

### 17. 相关文档

`PDH_Weibo_Real_Device_E2E.md`、`PDH_Weibo_DB_Schema_Probe.md`、`PDH_Mode_B_RealDevice_Master_Checklist.md`。
