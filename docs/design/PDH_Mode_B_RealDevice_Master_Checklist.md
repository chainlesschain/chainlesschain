# PDH Mode B — 6-platform 真机回归 master checklist

> 状态: Phase 7 closure (2026-05-26)
> 关联: [[PDH_Mode_B_Phase_7_Complete]]
> 一次 session 跑完 6 platforms 的统一计划，估时 ~1 天 user effort + 1 rooted Android device

## 0. 为啥统一跑

6 个 platform 的 E2E doc 各自独立 (Toutiao+Douyin 1 个 + 4 个), 但所有平台共享:
- 同一台 root Android device
- 同一个 adb session
- 同一种 cohort copy + SQLite open 流程
- 同样的 path A vs Mode B fidelity 对比 pattern

串起来 1 天搞定比拆 6 次切换上下文省时间。

## 1. 准备清单 (one-time, ~30 分钟)

### 1.1 硬件 + 环境

| 项 | 验证命令 |
|---|---|
| Win10+ 桌面 with adb + ChainlessChain dev env | `adb version` / `node --version` |
| Android phone with Magisk root | `adb shell su -c "id -u"` 返 `0` |
| Phone USB-debug 开 + 已 connect | `adb devices` 看到 phone |
| ChainlessChain Android 已 sideload (latest debug APK) | `adb shell pm list packages com.chainlesschain.android` 命中 |
| ChainlessChain Desktop 不必跑 (Mode B 全离线) | n/a |

### 1.2 6 platforms 准备 (~15 分钟 install + login per platform; 可并行做其他 setup)

| Platform | Package name | 准备 | 验证 |
|---|---|---|---|
| Toutiao 今日头条 | `com.ss.android.article.news` | 安装官方版 + 登录 + 看 3+ 内容 + 收藏 1+ | `adb shell pm list packages com.ss.android.article.news` |
| Douyin 抖音 | `com.ss.android.ugc.aweme` | 安装官方版 + 登录 + 看 5+ 视频 | `adb shell pm list packages com.ss.android.ugc.aweme` |
| Bilibili 哔哩哔哩 | `tv.danmaku.bili` | 安装官方版 (NOT HD/Lite/国际) + 登录 + 看 3+ 视频 + 收藏 1+ + 关注 1+ UP | `adb shell pm list packages tv.danmaku.bili` |
| Weibo 微博 | `com.sina.weibo` | 安装官方版 + 登录 + 发/看 3+ 微博 | `adb shell pm list packages com.sina.weibo` |
| Xhs 小红书 | `com.xingin.xhs` | 安装官方版 + 登录 + 看 5+ 笔记 + 关注 1+ | `adb shell pm list packages com.xingin.xhs` |
| Kuaishou 快手 | `com.smile.gifmaker` | 安装官方版 (NOT `com.kuaishou.nebula` 极速版) + 登录 + 看 10+ 视频 | `adb shell pm list packages com.smile.gifmaker` |

### 1.3 ChainlessChain Android path A 登录全 6 platforms

打开 ChainlessChain Android → PersonalDataHub → "本机数据" tab → 对每个 platform card:
1. 点 "登录" → SocialCookieWebViewScreen 弹起
2. 在 WebView 内完成账号登录 (cookies + uid 自动 scrape)
3. 点 "同步" 跑 path A 一次 → 验证 path A 工作

完成后 6 个 card 都应 show 已登录状态 + 有 lastSyncAt 时间戳。

## 2. Phase A — Schema 探测 fill-in (~半天 user effort, 一次跑完 5 platforms)

> P7.1.0 / P7.2.0 / P7.3 §4 / P7.5.0 / P7.6.0 合并跑

### 2.1 一键 dump 所有 6 platforms db 结构

```powershell
# Win PowerShell
$platforms = @{
    "Toutiao"   = "com.ss.android.article.news"
    "Douyin"    = "com.ss.android.ugc.aweme"
    "Bilibili"  = "tv.danmaku.bili"
    "Weibo"     = "com.sina.weibo"
    "Xhs"       = "com.xingin.xhs"
    "Kuaishou"  = "com.smile.gifmaker"
}

$outDir = "$env:TEMP\pdh-schema-probe-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

foreach ($platform in $platforms.Keys) {
    $pkg = $platforms[$platform]
    Write-Host "=== Probing $platform ($pkg) ==="

    # ls databases/
    adb shell su -c "ls -la /data/data/$pkg/databases/ 2>&1" | Tee-Object "$outDir\$platform-ls.txt"

    # For each .db: tables + magic header
    adb shell "su -c 'for f in /data/data/$pkg/databases/*.db 2>/dev/null; do echo === \$f ===; xxd -l 16 \$f | head -1; sqlite3 \$f \".tables\" 2>/dev/null; done'" | Tee-Object "$outDir\$platform-tables.txt"
}

Write-Host "`nResults in: $outDir"
explorer $outDir
```

### 2.2 分类 db 状态 (3 种 outcome)

对每 platform 输出，看哪个 .db 文件最像有内容 + 是否能用 sqlite3 打开:

| Outcome | 识别 | 下一步 |
|---|---|---|
| **明文 SQLite + 候选 db 名命中** | xxd 显示 `SQLite format 3` magic + 候选 db filename 在 v0.1 candidate list 内 + .tables 输出多个表名 | 跳到 §3 Mode B 同步实测 |
| **明文 SQLite + 但 db 名不在候选** | xxd 显示 `SQLite format 3` magic + db filename NOT in candidates + .tables 有内容 | 把实际 db 名加进对应 `<Platform>RootDbExtractor.DB_FILENAME_CANDIDATES` 顶部 + recompile + sideload。然后 §3。 |
| **SQLCipher 或自研加密** | xxd 显示**非** `SQLite format 3` magic (随机字节) + sqlite3 .tables 报 "file is not a database" | v0.1 走 likely-sqlcipher banner; **不跑 §3 Mode B 同步**。记结果 → v2.0 frida 路径 (Xhs / Kuaishou) |

### 2.3 探测产物归档

- Mode B v0.2 commit: 把 §2.1 输出 paste 进对应 `docs/design/PDH_<Platform>_Mode_B_Real_Device_E2E.md` §4 fill-in section
- Memory: `pdh_mode_b_phase_7.md` 加一行 schema 探测结果 (每 platform 一行: "Toutiao: article.db ✓ / liked: collection_article" 等)

## 3. Phase B — Mode B 同步实测 (~半天 user effort, 6 platforms 串行)

> 对 §2 走 outcome "明文" 的 platforms 跑此 phase; 走 "SQLCipher" 的 skip 直接记 v2.0 待办

### 3.1 通用 Mode B 同步流程 (每 platform 重复)

打开 ChainlessChain Android → PersonalDataHub → "本机数据" tab → platform card → 点 "本机 root" 按钮:

**通过条件**:
- banner 显示 "本机 root: 已同步 N XX / N YY / N ZZ (total X)" (per-category 计数)
- `lastSyncAt` 更新

**失败 banner 解读**:
| Banner 文本 | 意义 | 下一步 |
|---|---|---|
| `本机 root: 请先在路径 A 完成登录` | path A 没登录 | 跑准备清单 §1.3 |
| `本机 root: 设备未 root` | Magisk 没装或 su 不可用 | `adb shell su` 测 root 状态 |
| `本机 root: source-db-missing — ... v0.1 仅尝试 X / Y / Z` | DB 名不在候选 | §2.2 outcome B 流程 |
| `本机 root: likely-sqlcipher — ... v2.0 路径` | DB SQLCipher 加密 | §2.2 outcome C / 等 v2.0 |
| `本机 root: 同步成功但 0 events — ... schema 可能漂移` | DB 打开 OK 但 PRAGMA 没匹中候选表 | §2.1 输出看实际 .tables 调候选 |

### 3.2 Path A vs Mode B fidelity 对比 (每 platform 通过 Mode B 后)

```powershell
# 看 vault 内 social-<platform> events 统计
adb shell run-as com.chainlesschain.android sqlite3 files/.chainlesschain/hub/vault.db `
  "SELECT adapter, kind, COUNT(*) FROM events WHERE adapter LIKE 'social-%' GROUP BY adapter, kind ORDER BY adapter, kind;"
```

**通过条件 (per platform)**:
- 每 kind 计数 > 0 (除 search 通常很少)
- 跑两次 Mode B 同步后总数应 ≈ 一次 (events.id `<kind>-<itemId>` 共享 id 让 vault 跨路径 dedup)

## 4. Phase C — 通用 scenarios 串跑 (~1 小时, 1 platform 跑通即可)

> 选 path A + Mode B 都跑通的 platform (Toutiao 最稳) 验通用流程

### 4.1 NoCredentials path
1. ChainlessChain App settings → 清 Toutiao 登录
2. 点 "本机 root" → banner 应 say "请先在路径 A 完成登录"

### 4.2 NoRoot path
1. `adb shell` → `su` 模式禁掉 (临时 unroot 或拔 Magisk)
2. 点 "本机 root" → banner 应 say "设备未 root"

### 4.3 单飞 (single-flight)
1. 同时点 path A "同步" + Mode B "本机 root"
2. 第二个点击应 no-op (button disabled while syncing)

### 4.4 Banner discrimination
1. 跑 path A "同步" → banner "已同步 ..."
2. 立即跑 Mode B "本机 root" → banner 应有 "本机 root:" 前缀, 跟 path A banner 区分

## 5. 完工标记

### 5.1 Schema 探测产物
- [ ] 6 platforms `<platform>-ls.txt` + `<platform>-tables.txt` 归档
- [ ] 5 个 P7.x.0 fill-in 完成在对应 E2E doc 内 (Toutiao+Douyin 合并)
- [ ] memory `pdh_mode_b_phase_7.md` schema 状态行新增

### 5.2 Mode B 同步实测
- [ ] §3.1 对 outcome=明文 的 platforms 各跑通过一次 (期待 Toutiao + Douyin + Bilibili + Weibo 命中)
- [ ] §3.2 path A vs Mode B fidelity 对比 (vault dedup 验)

### 5.3 v2.0 待办归档
- [ ] Xhs `likely-sqlcipher` 命中 → 记 v2.0 frida + libshield.so neuter 路径
- [ ] Kuaishou `likely-sqlcipher` 命中 → 记 v2.0 frida + libmsaoaidsec.so neuter (dual-role caveat)

### 5.4 通用 scenarios
- [ ] §4 4 scenarios (NoCredentials / NoRoot / 单飞 / Banner) 走 1 platform 验

## 6. 估时

| Phase | 内容 | 估时 |
|---|---|---|
| 1 | 准备清单 | ~30 分钟 |
| 2 | Schema 探测 (6 platforms 并行) | ~半天 (含归档 + memory 更新) |
| 3 | Mode B 同步实测 (4-6 platforms) | ~半天 |
| 4 | 通用 scenarios (1 platform) | ~1 小时 |
| **总计** | **1 day user effort + 1 rooted Android** | |

## 7. 关联

- `PDH_Mode_B_Phase_7_Plan.md` — 原计划 + §8 shipped state
- `PDH_Mode_B_Phase_7_Complete.md` — 完工报告 + risk distribution + remaining
- `PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E.md` — Toutiao + Douyin 详 8 scenarios
- `PDH_Bilibili_Mode_B_Real_Device_E2E.md` — 5 Bilibili-specific scenarios
- `PDH_Weibo_Mode_B_Real_Device_E2E.md` — 5 Weibo-specific 三分支决策
- `PDH_Xhs_Mode_B_Real_Device_E2E.md` — 5 Xhs-specific defer-recommended framing
- `PDH_Kuaishou_Mode_B_Real_Device_E2E.md` — 5 Kuaishou-specific dual-role libmsaoaidsec caveat
