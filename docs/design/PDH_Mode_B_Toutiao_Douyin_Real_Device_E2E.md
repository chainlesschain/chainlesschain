# PDH Mode B (Toutiao + Douyin) — 真机 E2E checklist (Win-first)

> 状态: v1 (Phase 7.1.3, 2026-05-26)
> P7.1.1-P7.1.2b 全 ship 后真机验证起点
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> 上游方案: `docs/design/PDH_Mode_B_Phase_7_Plan.md`
> 前序设计：`docs/design/PDH_Toutiao_C_Path_Real_Device_E2E.md`（path C 同模板）

## 0. 这是什么 / 跟 C 路径啥区别

Phase 7 把 **Mode B**（APK 内 root + 本地 SQLite 直读）推广到 5 平台，v1.0 先 ship Toutiao + Douyin（明文 sqlite，字节系框架推论 + abrignoni DFIR 参考）。

跟 C 路径（PC + ADB cookies + Web HTTP）相比 Mode B 的关键差异：

| 维度 | Path C (Phase 6c/6d) | **Mode B (Phase 7.1, 本文档)** |
|---|---|---|
| 是否需 PC | ✓ 需 USB + adb | ✗ 完全脱离 PC 闭环 |
| 是否需 root | ✓ (cookies 在 /data/data/) | ✓ (databases/ 直读) |
| 是否需联网 | ✓ Web HTTP 调 platform.com | ✗ 离线全本地 |
| 是否需签名 SDK | ✓ (_signature / __NS_sig3) | ✗ 不调远端 API |
| 数据来源 | Web API responses | App-internal SQLite tables |

Mode B 在 Android in-APK 跑 cc subprocess + su + DbCohortCopier + sqlite-jdbc-equivalent (Android SQLiteDatabase) → JSON snapshot → registry.syncAdapter()。**真机 root 是硬要求**；非 root 设备 sync 直接 NoRoot 短路。

**Win 优先**: 本文档命令是 Win PowerShell。Mac/Linux 用户 substitute path separator + adb syntax 同理可跑（Mode B 跑在 Android App 内，跟主机 OS 无关 — Win-first 仅限于 user 准备 + sideload + 真机 adb 调试）。

## 1. 准备清单 (Win 桌面 + Android 真机)

### 1.1 Win 桌面侧

| 项 | 验证命令 |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| Win 装 chainlesschain Desktop App (≥ v5.0.3.91) | 启动后菜单 PersonalDataHub 可见 |
| chcp 65001 (中文编码) | `chcp 65001` |
| (可选) Android Studio sideload chainlesschain APK | adb install -r app-debug.apk |

### 1.2 真机侧

| 项 | 适用 | 验证命令 |
|---|---|---|
| 设备已 Magisk root | Toutiao + Douyin | `adb shell su -c "id -u"` 返 `0` |
| MIUI/HyperOS: USB 调试第二开关 | 所有 root 操作 | `adb shell pm list packages -3` ≥ 1 |
| 头条**标准版** APK 已装 | Toutiao | `adb shell pm list packages com.ss.android.article.news` 命中 |
| **不是**头条极速版 | Toutiao | `com.ss.android.article.lite` 应**不**命中或不读 |
| 抖音正式版 APK 已装 | Douyin | `adb shell pm list packages com.ss.android.ugc.aweme` 命中 |
| 头条 App 已登录 + 点过 1 篇文章 | Toutiao | 主屏看到自己头像 + 历史栏有内容 |
| 抖音 App 已登录 + 触发过 IM 会话 | Douyin | 任何聊天会话存在 → `<uid>_im.db` 被写 |
| chainlesschain Android 已 sideload + 登录 | 所有 | App 启动 → "本机数据" tab 可点 |

**Mode B 易踩坑** (复用 [[pdh-mode-b-phase-7]] §4 trap 清单)：

- **极速版包名不同**: Toutiao 极速版 `com.ss.android.article.lite` ≠ 标准版 `com.ss.android.article.news`。我们只读标准版。UI banner 必含 "NOT 极速版" 提示。
- **<uid>_im.db 未生成**: 抖音 App 必须有过**真聊天会话**（即便发一条 hi 给好友）才会创建 IM db。新装且无任何对话 → `SourceDbMissing`。
- **WAL/SHM 未一起 copy**: `DbCohortCopier` 已封装（B0 scaffold）。如果手动 su cp 不带 -wal/-shm 直读会少最近事务的数据 → 部分数据卡 stale。
- **`/data/local/tmp/` 是唯一可写 exec 路径**: filesDir 在 SELinux W^X 下不能 chmod+x。Toutiao + Douyin Mode B 不用 frida-inject 所以这条不直接踩，但同 scaffold 的 WeChat / 未来 Xhs 会踩。

## 2. 入口 — Toutiao + Douyin 同 UI

两个平台 button 都在 chainlesschain Android App → PersonalDataHub → "本机数据" tab → 内容平台/社交内容 section 里：

| 平台 | Section | 主 button (path A) | **Mode B button (本文档)** |
|---|---|---|---|
| Toutiao | 内容平台 | "同步" 走 path A (cookies + passport endpoint + _signature 签名) | "本机 root" 走 Mode B (su + databases/*.db) |
| Douyin | 内容平台 | "同步" 走 path A (cookies + WebView prefetch) | "本机 root" 走 Mode B (su + <uid>_im.db) |

两按钮**互斥** — `globalSyncingAdapter` 同时只允许 1 个 platform 同步（path A 或 path B 都算）。同步中所有 button disabled。

## 3. 8 个验证场景

每场景标 [T]outiao / [D]ouyin / [B]oth 后跑哪个。

### 场景 1 [B] — Happy path 真出事件

**前置**: 准备清单 §1.2 全绿，账号有真实历史/会话数据
**操作 (Toutiao)**:
1. App → PersonalDataHub → "本机数据" → 找今日头条 card
2. 点 "本机 root" 按钮
3. 看 banner

**操作 (Douyin)**: 同上，找抖音 card

**通过条件 (Toutiao)**:
- banner: `本机 root: 已同步 N 历史 / N 收藏 / N 搜索 (total N)`
- card 显示 `lastSyncAt` 时间 + `lastSyncCount` 数字
- 无 errorMessage 红色

**通过条件 (Douyin)**:
- banner: `本机 root: 已同步 N 消息 / N 联系人 (total N)`
- 同 Toutiao 验 lastSync

**5 次跑取平均 (Toutiao)**:
```powershell
# Win 上无法直接驱动 Android UI 自动化。手动跑 5 次:
# 每次同步后看 banner total。期望:
#   - 5 次的 total 都接近 (差异 ≤ 5%, 因为快进 1 篇文章不会显著变化)
#   - 至少 1 次 read > 10 (账号有真实阅读历史)
```

**5 次跑平均 (Douyin)**:
- 期望 message + contact 都稳定（聊天 db 内容不易频繁变）

### 场景 2 [B] — NoCredentials 短路

**前置**: 清空 root credentials store:
```powershell
adb shell run-as com.chainlesschain.android sh -c "rm -rf shared_prefs/pdh_social_toutiao_root.xml shared_prefs/pdh_social_toutiao_root_plain.xml"
adb shell run-as com.chainlesschain.android sh -c "rm -rf shared_prefs/pdh_social_douyin_root.xml shared_prefs/pdh_social_douyin_root_plain.xml"
adb shell am force-stop com.chainlesschain.android
```
重启 App → "本机数据" tab

**操作**: 点 "本机 root" 按钮（任一平台）

**通过条件 (Toutiao)**: 黄色 warning banner `本机 root: 请先在路径 A 完成登录 (passport_uid 会自动用作 root uid)`

**通过条件 (Douyin)**: 黄色 banner `本机 root: 请先在路径 A 完成登录 (sec_user_id + uid 会自动用作 root uid)`

**关键**: banner 应**指向 path A 登录**作为前置 — Mode B 复用 path A 写入的 uid，user 不应被要求重复输入。

### 场景 3 [B] — NoRoot 友好提示

**前置**: 拔掉 root（或换非 root 测试设备），App 已登录 path A

**操作**: 点 "本机 root"

**通过条件**: banner `本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录` (红色 error banner OK; user 期望)

**变体**: 设备有 su 但 user 拒了 magisk root prompt → 同样 NoRoot

### 场景 4 [T] — Toutiao SourceDbMissing (P7.1.0 探测未跟)

**前置**: root + Toutiao App 登录 + path A 已跑过 (uid 已 saved)。**但**：v0.1 的 `DB_FILENAME_CANDIDATES` 列表硬编码 (`article.db`, `bdtracker_v3.db`, `applog_stats.db`, `tnc.db`, `favorite.db`, `history.db`)。如果真机 databases/ 里没有任何一个，sync 走 SourceDbMissing 路径。

**操作 (Toutiao)**: 点 "本机 root"

**通过条件 (NOT yet ran P7.1.0)**:
- 如果真机 ls databases/ 命中候选 → 走场景 1 (happy)
- 如果未命中（场景 4）：banner 应显式说 "请运行真机 schema 探测 (P7.1.0) 把实际文件名加入候选列表"

**P7.1.0 探测脚本** (跑一次填实际 DB filename + table schema 进 source code):
```powershell
# 1. 列 databases dir
adb shell su -c "ls /data/data/com.ss.android.article.news/databases/"

# 2. 对每个 .db 文件 dump CREATE TABLE 语句
adb shell su -c "for f in /data/data/com.ss.android.article.news/databases/*.db; do echo === \$f ===; sqlite3 \$f '.schema' 2>/dev/null | head -50; done"
```

把结果填进 `ToutiaoRootDbExtractor.DB_FILENAME_CANDIDATES` + 调整 `parseReadHistory` / `parseCollection` / `parseSearchHistory` 的 column-candidate 列表 → push P7.1.0 commit.

### 场景 5 [D] — Douyin SourceDbMissing (新装未聊过)

**前置**: root + 抖音正式版**新装** + 登录但**从未发过任何聊天消息**

**操作 (Douyin)**: 点 "本机 root"

**通过条件**:
- banner `本机 root: source-db-missing — <uid>_im.db not found...`
- 提示用户去抖音点开 IM tab 跟好友发一条消息（任何对话）创建 db 后再 retry

### 场景 6 [B] — Schema drift (表存在但 column 不全)

**前置**: 真机已跑过场景 1 happy path. v0.1 的 `parseReadHistory` defensive picker 期望 itemId 在 `item_id/group_id/id/_id` 中匹配。但如果字节系某个 minor 版本把 column 重命名为 `article_id`,defensive picker miss → 返 empty list + schemaDriftWarning。

**模拟方法**: 改 `ToutiaoRootDbExtractor` `pickCol` 列表故意去掉真名（dev mode test only）。

**操作**: 点 "本机 root"

**通过条件**:
- card 显 banner `本机 root: 同步成功但 0 events — DB 'article.db' 表 schema 可能漂移 (P7.1.0 探测待跟)`
- 不是 error 红色，是 warning 黄色
- diagnosticFields.schemaDrift 含 "read_history missing required columns" 类描述

**手动验** (没 dev mode 时):
```powershell
# 在 adb 端 dump audit raw_events 看 dropped
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db \
  "SELECT count(*) FROM raw_events WHERE adapter='social-toutiao' AND DATE(captured_at_ms/1000, 'unixepoch') = DATE('now');"
```

### 场景 7 [B] — 单飞 (path A 在跑时 Mode B 按钮 disabled)

**前置**: 真机 happy path 可跑

**操作**:
1. 点 path A "同步" 按钮
2. 在 sync 过程中 (isSyncing=true) **立即**点 "本机 root" 按钮

**通过条件**:
- "本机 root" 按钮 disabled (UI 灰)
- 即便 user 强按也无效（globalSyncingAdapter gate）
- path A 完成后 "本机 root" 恢复 enable

**注**: VM 层 sync mutation 在 `viewModelScope.launch` 内, 同步双调都过 gate; **真单飞靠 UI Button isSyncing-disabled** — 不要在测试里手动同步双调验 VM gate。

### 场景 8 [B] — Banner discrimination

**前置**: 同 1 path A + Mode B 都已跑过

**操作**: 看 card 上的 banner 内容

**通过条件**:
- path A 同步成功后 banner **不含** "本机 root:" 前缀
- Mode B 同步成功后 banner **必含** "本机 root:" 前缀
- 两者共用同一个 `SocialCardState.errorMessage` 字段但 user 通过前缀立即知道哪条路径出的结果
- 上次同步时间 (`lastSyncAt`) 是哪个 path 最后一次成功的（path A vs B 不分；user 看 banner 内容自判断）

## 4. 完工标记 (Toutiao + Douyin Mode B v1.0)

- [ ] 场景 1 [B] 跑 5 次 average events 稳定（差异 < 5%）
- [ ] 场景 2 [B] NoCredentials banner 含 path A 登录指引
- [ ] 场景 3 [B] NoRoot banner 红色 + Magisk 提示
- [ ] 场景 4 [T] SourceDbMissing 触发 → 跑 P7.1.0 探测 → 填实际 filename + schema → commit → 场景 1 不再走 SourceDbMissing
- [ ] 场景 5 [D] 新装无聊天 → SourceDbMissing → 发条消息 → retry → 场景 1
- [ ] 场景 6 [B] Schema drift 黄色 warning (不是 error) + diagnosticFields 含 reason
- [ ] 场景 7 [B] 单飞 UI button disabled 验证
- [ ] 场景 8 [B] banner "本机 root:" 前缀可见 + path A/B 区分

## 5. 跟 P6 (path C) E2E 共享 / 不同

| Phase | 同步入口 | E2E 难度 | 真机要求 |
|---|---|---|---|
| P6c.5 (Toutiao C) | `cc hub toutiao-adb-sync` Win 命令 | 中（需要 PC + adb） | root + Toutiao 已登录 |
| P6d.5 (Kuaishou C) | `cc hub kuaishou-adb-sync` Win 命令 | 中 | root + Kuaishou 已登录 |
| **P7.1.3 (Toutiao+Douyin Mode B, 本文档)** | App 内点 "本机 root" 按钮 | **低**（脱离 PC，纯 App 内闭环） | root + path A 已登录 |
| P6e (Bridge dry-run doctor) | desktop App 按钮 | 低（不需 phone） | 任何 Win + 桌面 App |

Mode B E2E **最轻**因为不依赖 PC 或网络 — user 在 Android App 内一键点按就跑。这是 Mode B 相对 Path C 的核心 user-experience 优势。

## 6. 后续 P7.x

- **P7.1.0** — 真机 schema 探测 (上文场景 4)，确认 DB filename + table schema 真名，更新 source code
- **P7.2 Bilibili Mode B** (v1.0 可选，plan §6.4 推 SKIP) — 同模板加 BilibiliRoot 三件套 + onSyncRoot wire
- **P7.3 Weibo schema 探测** (v1.5 prereq) — frida hook dump CREATE TABLE
- **P7.4 Weibo Mode B** (v1.5)
- **P7.5 Xhs / P7.6 Kuaishou Mode B** (v2.0+ defer，因 libshield/libmsaoaidsec.so anti-frida)

## 附录：规范章节补全（v5.0.3.108）

> 本文为 Mode B 真机 E2E checklist。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角。

### 1. 概述

见正文头部。PDH Mode B（Toutiao + Douyin）本机 root SQLite 真机 E2E checklist（Phase 7.1.3，Win-first），8 scenarios。

### 2. 核心特性

两平台本机 root DB 采集；8 scenarios；Win-first；schema 探测共享流程。

### 3. 系统架构

adb su sqlite3 → 本机 DB（Toutiao/Douyin）→ adapter → vault。

### 4. 系统定位

PDH Toutiao + Douyin Mode B 的**本机 DB 真机 E2E 验收 checklist**。

### 5. 核心功能

见正文 8 scenarios：root 探测 / DB filename + schema 确认 / 解析 / vault。

### 6. 技术架构

root + adb su sqlite3；DB_FILENAME_CANDIDATES + table schema；Toutiao/Douyin root 三件套。

### 7. 系统特点

P7.1.0 真机 schema 探测确认 DB filename + table 真名；P7.5/P7.6（Xhs/Kuaishou）因 libshield/libmsaoaidsec defer v2.0+。

### 8. 应用场景

Toutiao/Douyin 无 cookie/网络时离线本机采集 fallback。

### 9. 竞品对比

Mode B vs C 路径（`PDH_Toutiao_C_Path_Real_Device_E2E.md` / `PDH_Douyin_Real_Device_E2E.md`）。

### 10. 配置参考

root；DB_FILENAME_CANDIDATES + table schema（P7.1.0 探测）。

### 11. 性能指标

本机解析随 DB 规模线性。

### 12. 测试覆盖

本文即 8 scenarios Mode B E2E checklist。

### 13. 安全考虑

需 root；本机 DB 高敏感；SQLCipher 加密。

### 14. 故障排除

DB filename / schema 不符 → P7.1.0 真机 schema 探测更新 source code。

### 15. 关键文件

Toutiao/Douyin Mode B adapter（三件套）；vault。

### 16. 使用示例

见正文 8 scenarios 执行步骤。

### 17. 相关文档

`PDH_Mode_B_Phase_7_Plan.md`、`PDH_Mode_B_RealDevice_Master_Checklist.md`、`PDH_Toutiao_C_Path_Real_Device_E2E.md`。
