# PDH Bilibili Mode B — 真机 E2E checklist (Win-first)

> 状态: v1 (Phase 7.2.3, 2026-05-26)
> P7.2.1 + P7.2.2 ship 后真机验证起点
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> **共享 scenarios**: `docs/design/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E.md` §3 (本文档跨平台 scenario 不重复)

## 0. Plan §6.4 推 SKIP — 为啥还 ship?

[`docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`](./PDH_Social_Multipath_Local_Collection_Plan.md) §6.4 explicit 说 Bilibili Mode B "**不做**" — path A SESSDATA cookie + `api.bilibili.com/x/web-interface/history/cursor` 已是最优。

P7.2 ship 是 user "Mode B 全面 5 平台" 显式 override，作为 path A 不可用 (api.bilibili.com 风控 / 无网 / cookie 过期但 db cache 还在) 时的 **fallback**。生产场景下大概率不会触发。

真机 E2E 的目标不是验证 Mode B 是首选路径，而是验证 fallback 在需要时能工作。

## 1. 准备清单 (Win 桌面 + Android 真机)

### Bilibili-specific 项 (Toutiao + Douyin 通用项见上游 doc §1)

| 项 | 验证命令 |
|---|---|
| 设备已 Magisk root | `adb shell su -c "id -u"` 返 `0` |
| B 站官方版 APK 已装 (NOT 国际版/HD/Lite) | `adb shell pm list packages tv.danmaku.bili` 命中 |
| B 站 App 已登录 + 看过 3+ 视频 | 历史记录 + db 写入 |
| (可选) 加过 1+ 收藏夹 + 关注 1+ UP | favourite + follow tables 有数据 |
| chainlesschain Android 已 sideload + B 站 path A 登录过 | DedeUserID saved 到 `BilibiliCredentialsStore` |

**Bilibili-specific 易踩坑**:

- **bvid vs avid 双 identifier**: B 站每个视频有两个 ID — 旧 `avid` (数字, `av12345`) 和新 `bvid` (字符串, `BV1xx411x7xx`). 2020-03 后 web/app 都默认 bvid。defensive 列表两个都试，写 snapshot 时 bvid 优先。
- **B 站官方版 vs 国际版/HD/Lite 包名不同**: 我们只读 `tv.danmaku.bili` (官方版)。`tv.danmaku.bilibilihd` (HD) / `com.bilibili.app.in` (国际版) / `tv.danmaku.bili.lite` (极简) 都不在候选列表。
- **历史记录可能跨多 DB**: 部分 B 站版本把视图历史放 `bili.db` 主表，新版本可能拆到 `history.db` 单独表。defensive findTable 先匹 4 个候选 (`history` / `view_history` / `play_history` / `video_history`)。
- **收藏夹 ≠ 默认收藏**: B 站 user 可以创建多个收藏夹 (`folder_name` column)。默认收藏夹叫"默认收藏"或"NULL"。snapshot 输出每条 fav event 含 folderName 字段供 vault 后续聚合。
- **关注 mid 跨 follow 表 + watch_later**: 候选表里只有 `follow` 系列，不读 "稍后再看" — 那是临时队列不视为关注。

## 2. 入口

chainlesschain Android App → PersonalDataHub → "本机数据" tab → **内容平台** section → Bilibili card → "本机 root" 按钮（右下角小号 button，主按钮 "同步" 仍走 path A SESSDATA）

UI button mapping:

| Card 按钮 | 行为 |
|---|---|
| 同步 | path A (SESSDATA cookie + api.bilibili.com + WBI 签名 + WebView prefetch) |
| **本机 root** (本文档) | Mode B (su + databases/*.db) |
| 退出登录 | path A logout (清 cookies + DedeUserID) |

## 3. Bilibili-specific 验证场景

复用上游 doc § 通用 scenarios (NoCredentials / NoRoot / Schema drift / 单飞 / Banner discrimination)。下面只列 Bilibili specific 5 场景：

### 场景 B-1 — Path A vs Mode B 数据 fidelity 对比

**目的**: 验证 Mode B fallback 抓到的数据跟 path A 抓到的近似一致 (是 fallback 不是 alternative — 不要变出第二份 truth)

**前置**: 准备清单全绿 + path A 已跑过一次（vault 有 path A 写入的数据）

**操作**:
1. 记录 path A 最新一次同步的 `historyCount` / `favouriteCount` / `followCount` (banner 上)
2. 等 5 分钟，确保 db 完全持久化
3. 点 "本机 root" 触发 Mode B
4. 记录 Mode B 的同样三个 count

**通过条件**:
- |Mode B history − path A history| ≤ 20 (db 缓存历史比 server 短一些 OK)
- |Mode B favourite − path A favourite| ≤ 5
- |Mode B follow − path A follow| ≤ 10 (db follow cache 可能落后)
- **vault dedup 验**: `cc audit social-bilibili --kind history` 命令同步两次后总数应 ≈ path A 一次结果，**不是** path A × 2 (events.id 的 `history-<bvid>` / `fav-<bvid>` 等共享 id 让两路径在 vault 层 dedup)

### 场景 B-2 — bvid vs avid 解析 (混合双 id)

**前置**: B 站账号有**老视频** (av) + **新视频** (bv) 都看过

**操作**: Mode B 同步 → 看 vault

**通过条件**:
```powershell
# 取最近 10 条 history events
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db \
  "SELECT json_extract(payload, '$.bvid'), json_extract(payload, '$.avid') FROM events WHERE adapter='social-bilibili' AND kind='history' ORDER BY occurred_at DESC LIMIT 10;"
```
- 应见两种数据：有 bvid 无 avid (新视频)，有 avid 无 bvid (老视频或解析丢)，少数 bvid + avid 都有 (db 双字段)
- 不应见 bvid='null' 或 avid=0 的 events (defensive 跳过逻辑工作)

### 场景 B-3 — Multi-folder favourite

**前置**: B 站账号至少有 2 个收藏夹（默认 + 1 自建）

**操作**: Mode B 同步 → 看 banner 跟 vault folderName 分布

**通过条件**:
```powershell
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db \
  "SELECT json_extract(payload, '$.folderName'), COUNT(*) FROM events WHERE adapter='social-bilibili' AND kind='favourite' GROUP BY json_extract(payload, '$.folderName');"
```
- 应见 ≥ 2 个不同 folderName (默认 + 自建)
- 默认收藏可能 folderName=NULL 或 "默认收藏" - 都接受

### 场景 B-4 — Path A 不可用时 Mode B 救场

**前置**: 模拟 api.bilibili.com 断网或风控 (DNS 阻断或断网手机)

**操作**:
1. 关 Wi-Fi + 数据
2. App 内点 path A "同步" → 应失败 (network error 或 timeout)
3. 立即点 "本机 root" → 应**成功** (纯本地 db 读)

**通过条件**:
- path A 失败 banner: "同步失败 — 网络错误" or 类似
- Mode B 成功 banner: "本机 root: 已同步 N 历史 / N 收藏 / N 关注"
- **关键**: Mode B 不依赖网络 — 这是它作为 fallback 的核心 user-experience 价值

### 场景 B-5 — P7.2.0 探测触发 (Bilibili 国际版/HD 不在候选)

**前置**: 卸载 `tv.danmaku.bili` 官方版, **只**装 `tv.danmaku.bilibilihd` (HD 版)

**操作**: 点 "本机 root"

**通过条件**:
- banner `本机 root: source-db-missing — B 站 databases/ 内未找到候选 DB 文件`
- (这是正确行为 — 我们只支持官方版。HD/国际/Lite/极简版需要单独 candidate list 跟 schema 探测，defer 到 v0.2)

如果 user 确实想加 HD 版支持，跑探测：
```powershell
adb shell su -c "ls /data/data/tv.danmaku.bilibilihd/databases/"
adb shell su -c "for f in /data/data/tv.danmaku.bilibilihd/databases/*.db; do echo === \$f ===; sqlite3 \$f '.schema' 2>/dev/null | head -50; done"
```
然后把 HD 版 package + DB filename 加到 `BilibiliRootDbExtractor.BILIBILI_DB_REMOTE_DIR` (但要拆成 var 而非 const 因为 dir varies per package) — 推到 v0.2 commit.

## 4. 完工标记 (Bilibili Mode B v1.0)

- [ ] 场景 B-1 path A vs Mode B count 差异 ≤ tolerance + vault dedup 验
- [ ] 场景 B-2 bvid + avid 混合解析无丢失
- [ ] 场景 B-3 multi-folder favourite 全部 surface
- [ ] 场景 B-4 path A 失败 Mode B 救场可用 — Mode B fallback 价值兑现
- [ ] 场景 B-5 HD 版 → SourceDbMissing → 决定是否升 v0.2
- [ ] 通用 §3 scenarios (NoCredentials / NoRoot / 单飞 / Banner) 也走一遍

## 5. 跟 Path A SESSDATA 协调

| 路径 | 入口 button | 数据来源 | 网络依赖 | 验证 |
|---|---|---|---|---|
| **Path A (默认)** | "同步" | `api.bilibili.com/x/web-interface/history/cursor` + WBI 签名 | ✓ 必需 | 上游 P6 / P3 docs |
| **Mode B (本文档)** | "本机 root" | `/data/data/tv.danmaku.bili/databases/bili.db` 等 | ✗ 离线 | 本文档 |

两路径写到**同一个** `social-bilibili` adapter, 共享 schemaVersion=1, events.id 设计上 dedup 跨路径。**Mode B 是 path A 的离线 fallback，不是替代品**。

## 6. 后续

- **P7.2.0** — 真机 schema 探测 (上文场景 5 触发的逻辑) → 更新 `DB_FILENAME_CANDIDATES` + column-candidate lists 反映真机实际
- **Bilibili Mode B v0.2** — 加 HD/国际/Lite/极简版包名 + 各自 db schema 探测 (如果有需求)
- **跟 P7.1.0 共享**: Toutiao + Douyin + Bilibili 三个平台的 schema 探测可以一次跑完（共享 adb su shell sqlite3 .schema dump 流程）

## 附录：规范章节补全（v5.0.3.108）

> 本文为 Mode B 真机 E2E checklist。为对齐项目文档标准结构，下列章节以 `见上文` / `见正文` 指引或简述方式补齐若干视角。

### 1. 概述

见正文头部。PDH Bilibili Mode B（本机 root SQLite 离线 fallback）真机 E2E checklist（Phase 7.2.3，Win-first）。Mode B 是 path A（C 路径 cookie/HTTP）的离线 fallback，不是替代品。

### 2. 核心特性

本机 root DB 采集；与 C 路径写同一 `social-bilibili` adapter（schemaVersion=1，events.id 跨路径 dedup）；Win-first。

### 3. 系统架构

adb su shell sqlite3 → 本机 DB → `social-bilibili` adapter → vault；DB_FILENAME_CANDIDATES + column-candidate。

### 4. 系统定位

PDH Bilibili Mode B 的**本机 DB 真机 E2E 验收 checklist**。

### 5. 核心功能

见正文场景：root 探测 / DB 解析 / 跨路径 dedup / vault。

### 6. 技术架构

root + adb su sqlite3；DB_FILENAME_CANDIDATES 探测；与 C 路径共享 adapter。

### 7. 系统特点

Mode B = 离线 fallback；与 Toutiao/Douyin schema 探测共享 dump 流程（P7.1.0）。

### 8. 应用场景

无 cookie/网络时的离线本机采集 fallback。

### 9. 竞品对比

Mode B（本机 DB）vs C 路径（`PDH_Bilibili_C_Path_Real_Device_E2E.md`，主路径）。

### 10. 配置参考

root；DB_FILENAME_CANDIDATES + column-candidate lists。

### 11. 性能指标

本机解析随 DB 规模线性。

### 12. 测试覆盖

本文即 Mode B E2E checklist；schema 探测 P7.2.0 fill-in。

### 13. 安全考虑

需 root；本机 DB 高敏感；SQLCipher 加密落盘。

### 14. 故障排除

DB 文件名 / schema 变 → 更新 DB_FILENAME_CANDIDATES（P7.2.0 schema 探测）。

### 15. 关键文件

`social-bilibili` adapter（Mode B 三件套）；vault。

### 16. 使用示例

见正文 adb su sqlite3 dump 与场景步骤。

### 17. 相关文档

`PDH_Bilibili_C_Path_Real_Device_E2E.md`（主路径）、`PDH_Mode_B_Phase_7_Plan.md`、`PDH_Mode_B_RealDevice_Master_Checklist.md`。
