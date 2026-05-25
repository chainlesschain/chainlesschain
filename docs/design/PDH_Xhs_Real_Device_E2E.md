# PDH Xhs C 路径真机 E2E checklist (Win 优先)

> 状态: v1 (Phase 3d, 2026-05-25)
> Phase 3c 全 ship 后真机验证
> 关联: [[pdh-xhs-c-path-phase-3c]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6.3

## 0. 这是什么 / 为什么手动跑

Phase 3c 已经把 Xhs C 路径（PC + ADB cookies + a1 + X-S 签名 Node 移植 + edith.xiaohongshu.com 4 endpoint HTTP）的全链路代码 + 单测 + 三入口 UI 都 ship 了。但**单元测试只覆盖到 mock fetch 一级**，**X-S 签名命中率必须真机验证** — Kotlin 实测 ~60% GET / <30% POST，Node 移植应同。

跟 Weibo 不同，**Xhs 真机 E2E 有额外目标**:
1. 验 X-S 签名命中率达预期 (~60% GET) — 远低于则说明 base64 编码或 a1 提取有 bug
2. 验 partial-result (461) 用户体验 — UI 应 surface "X-S 4-8 周 rotate" 不是 "同步失败"
3. 监测 X-S 算法是否需要 升级 (v0.3 Electron BrowserView 灌注)

**Win 优先**: 我们代码已经 Win-friendly。

## 1. 准备清单 (Win 桌面)

| 项 | 验证命令 |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| Android Magisk-root | `adb shell su -c "id -u"` 返 `0` |
| MIUI/HyperOS: 开 "USB 调试（安全设置）" 第二开关 | `adb shell pm list packages -3` 返 ≥ 1 行 |
| 手机装小红书正式版 APK | `adb shell pm list packages com.xingin.xhs` 命中 |
| 小红书 App 已登录账号 | 手机点开小红书看到自己头像 |
| 项目 cc CLI 装好 (≥ Phase 3c) | `cc --version` 含 Phase 3c 版本 |
| Terminal 中文编码 | `chcp 65001` |

**Win-specific 易踩坑** (跟 Weibo doc §1 同):
- 小米 MIUI USB 调试第二开关
- OEM 解锁 168h 等待
- 小米 USB 驱动

**Xhs-specific 易踩坑**:
- **a1 cookie 必需**: 这是 anti-bot fingerprint，X-S 签名的输入。如果 cookies 里缺 a1 → `XHS_COOKIES_INCOMPLETE`
- **web_session 必需**: 登录态 cookie。缺它 `/user/me` 返 user_id blank → meFetchFailed warning
- **xhs App WebView profile dir**: 默认 `app_webview/Default/Cookies`，需真机验证

## 2. 入口 A / B / C (跟 Weibo doc §2 同)

```powershell
cc hub xhs-adb-sync --json
```

**期望输出（happy）**:
```json
{
  "ok": true,
  "report": {
    "adapter": "social-xiaohongshu",
    "status": "ok",
    "rawCount": 20,
    "xhs": {
      "userId": "5e8c8f7e1234abcdef",
      "nickname": "Alice",
      "eventCounts": { "note": 15, "liked": 3, "follow": 2, "total": 20 },
      "lastErrorCode": 0,
      "cookieDiagnostic": { "cookieCount": 8, "hadEncrypted": false },
      "meFetchFailed": false
    }
  }
}
```

## 3. 6 个验证场景

### 场景 1 — Happy path (5 min) — **关键：验 X-S 命中率**

**前置**: 准备清单全绿 + Xhs App 登录 + 账号至少有 1 笔记 / 1 like / 1 follow
**操作**:
```powershell
cc hub xhs-adb-sync --json | jq '.report.xhs.eventCounts'
```

**通过条件**:
- userId 非 null + nickname 非 null
- `note > 0` OR `liked > 0` OR `follow > 0` (至少一个 X-S 端点命中)
- **关键**: 跑 5 次取平均 hit 率，应 ≥ 1/3 endpoint (~60% GET hit, 至少 follow 或 notes 一个能拿到)

```powershell
# 跑 5 次看 X-S 命中分布
$results = @()
for ($i=1; $i -le 5; $i++) {
  $r = cc hub xhs-adb-sync --json | ConvertFrom-Json
  $results += [PSCustomObject]@{
    note     = $r.report.xhs.eventCounts.note
    liked    = $r.report.xhs.eventCounts.liked
    follow   = $r.report.xhs.eventCounts.follow
    errCode  = $r.report.xhs.lastErrorCode
  }
  Start-Sleep -Seconds 15
}
$results | Format-Table
```

**X-S 命中率达标**:
- 5 次里至少 3 次 note > 0
- 至少 2 次 follow > 0
- liked 偶尔 0 是 OK 的（<30% POST hit）
- 如果 5 次全 0 → X-S 算法可能 rotate 了，需要升级

### 场景 2 — `XHS_NO_ROOT` (1 min)

跟 Weibo 场景 2 同。非 root 设备跑 → `✗ XHS_NO_ROOT`。

### 场景 3 — `XHS_NOT_INSTALLED` (1 min)

卸载小红书 → `✗ XHS_NOT_INSTALLED`。

### 场景 4 — `XHS_COOKIES_INCOMPLETE` (2 min)

**前置**: root 手机 + 小红书 App **注销登录**
**操作**: `cc hub xhs-adb-sync`
**通过条件**: 输出 `✗ XHS_COOKIES_INCOMPLETE` + tip "a1 / web_session cookie missing — relog"

**变体测试 — 缺 a1 vs 缺 web_session**:
- 缺 a1 (理论上不会，因为 a1 是 anti-bot 自动写入，登出不清): 跟缺 web_session 同 banner
- 缺 web_session (logout 后清): banner 显 "a1 / web_session missing"

### 场景 5 — `meFetchFailed` (warning state, 3 min) — Xhs 特有

类似 Weibo 的 uidFetchFailed。

**前置**: a1 + web_session 都在但 web_session 已过期（服务端 invalidate）
**操作**: `cc hub xhs-adb-sync`
**期望输出**:
```
✓ xhs-adb-sync succeeded
  userId:     (me fetch failed)
  notes:      0
  liked:      0
  follows:    0
  total:      0
  ⚠ /user/me returned no user_id — cookie expired or web_session missing (lastErrorCode=-7)
```

**通过条件**:
- exit 0（不是 1）
- meFetchFailed warning 行明确 lastErrorCode=-7
- Web UI 收到 antd warning notification（非 error）

### 场景 6 — **X-S 461 partial-result** (Xhs 独有, 3 min)

**前置**: Happy path 已成功 + cookies 完整
**操作**: 改 a1 cookie 字段（用 `adb shell su -c` 写入 chromium cookies sqlite + 把 a1 改成无效值）→ 跑 `cc hub xhs-adb-sync`

**期望输出**:
```
✓ xhs-adb-sync succeeded
  userId:     5e8c8f7e1234abcdef
  nickname:   Alice
  notes:      0
  liked:      0
  follows:    0
  total:      0
  ⚠ partial: lastErrorCode=461 (X-S validation failed) — X-S 签名 best-effort, 部分接口 461 可能正常
```

**通过条件**:
- userId 非 null (因为 fetchMe 不需 X-S, 仍 OK)
- 3 endpoint 全 0 (因 a1 错 → X-S 全 461)
- lastErrorCode=461 + 中文 banner 区分 X-S rotate vs auth fail

**Web UI 期望**: `message.warning` 蓝色"X-S 签名 best-effort 提示" — 不是 error！

## 4. UI 入口 (PersonalDataHub.vue) 6 场景

跟 Weibo §4 同。**关键 UI 区分**:
- happy path → success
- meFetchFailed → warning "user_id 拿不到"
- 461 X-S partial → warning "X-S 签名 best-effort"
- ≥ 1 endpoint 失败但有部分数据 → warning
- 全 reason 失败 → error

## 5. 真账号数据抽样深验

```powershell
# 看最近一周事件
cc hub query-events --adapter social-xiaohongshu `
  --since (Get-Date -UFormat %s -Date (Get-Date).AddDays(-7))

# 看自己发的笔记 (note)
cc hub query-events --adapter social-xiaohongshu --subtype note --limit 5

# 看点赞过的笔记 (liked)
cc hub query-events --adapter social-xiaohongshu --subtype liked --limit 5

# 看关注列表 (follow)
cc hub query-events --adapter social-xiaohongshu --subtype follow --limit 20
```

**抽样验证点**:
- note 的 title / desc 含真账号笔记的中文
- note 的 likedCount / collectedCount / commentCount 跟手机 App 显示一致（差异 ≤ 5%）
- note 的 type = "normal" / "video"
- liked 显示真账号点赞过的笔记（authorNickname 是真 UP）
- follow 列表 nickname 跟手机关注前 20 个一致

## 6. **X-S 签名命中率监测 (Xhs 核心)**

每天跑 1 次记录命中率：

```powershell
# 跑 10 次 sync 取 X-S 命中分布
$today = Get-Date -Format "yyyy-MM-dd"
$logFile = "$env:USERPROFILE\xhs-xs-hitrate-$today.csv"
"run,note,liked,follow,errCode" | Out-File $logFile
for ($i=1; $i -le 10; $i++) {
  $r = cc hub xhs-adb-sync --json | ConvertFrom-Json
  "$i,$($r.report.xhs.eventCounts.note),$($r.report.xhs.eventCounts.liked),$($r.report.xhs.eventCounts.follow),$($r.report.xhs.lastErrorCode)" | Add-Content $logFile
  Start-Sleep -Seconds 30
}
```

**预期命中分布**（基于 Kotlin v0.2 实测）:
- note (GET): ~60% hit — 10 次里 ~6 次 > 0
- follow (GET): ~60% hit — 10 次里 ~6 次 > 0
- liked (GET): ~50% hit — xhs liked 端点 X-S 校验偏严
- 411/461 errCode 在 10 次里 ~4 次出现

**红线**: 命中率突降 < 30%（特别是 note 命中 < 3/10） → X-S 算法可能 rotate，触发升级：
1. 对比 Android `XhsApiClient.kt:computeXsXt` 看 Kotlin 端命中率是否同步降
2. 如 Kotlin 也降 → xhs.js 升级，两端都要 fix
3. 如 Kotlin 还 OK 而 Node 降 → Node base64/md5 实现有 bug，去 sign.test.js 加 byte-parity 测

## 7. 反爬触发场景

```powershell
# 短时间重复跑 10 次，验 X-S 命中率不大幅波动
for ($i=1; $i -le 10; $i++) {
  cc hub xhs-adb-sync --limit-note 10 --limit-liked 10
  Start-Sleep -Seconds 3
}
```

**通过条件**: 命中率不应因频率降到 0%（xhs 主要靠 X-S 不靠 rate-limit）。如果 10 次全 461 → IP 被 ban 或 a1 失效。

## 8. 回归 trap 记录位置

跟 Bilibili / Douyin / Weibo E2E 文档 §7 同模板。**byte-parity check 特别重要**:
- X-S 签名 fix → Node `sign.js` + Kotlin `XhsApiClient.computeXsXt` 必须同步
- a1 提取 fix → Node `extractA1` + Kotlin `SocialCookieWebViewHelpers.parseCookieValue` 同步
- Required cookies 加 → Node `XHS_REQUIRED_COOKIES` + Kotlin `XhsCredentialsStore.hasCredentials` 同步

## 9. 已知风险 / Phase 4+ 待补

- **X-S 算法 4-8 周 rotate**: xhs.js 经常 minify + 改算法 (open-source reverse-engineering 难追)。命中率监测下降即触发 v0.3 升级
- **v0.3 Electron BrowserView 灌注 xhs.js**: 真接通 ~100% hit rate (vs best-effort 60%)。Toutiao [[pdh-websign-bridge-pattern]] 已有模板可复用。但需 Electron 加 hidden BrowserView (~50MB heap)；纯 Node 上下文做不了
- **liked_at / followed_at 时间缺失**: xhs API 不返显式时间，snapshot-builder 用 snapshottedAt fallback。如果用户想按时间排序笔记 X-S API 满足不了，需要走 sqlite path B (零公开资料，不推荐)
- **doctor dry-run 入口缺失**: 跟 Bilibili 1e 模式，可加 `cc hub xhs-adb-doctor` 单独 probe cookies + X-S sign 不调 endpoint。Phase 4 加

---

跑完 E2E + 找到的 trap 都收口到 memory，**Phase 3c/3d Xhs C 路径完整收口**。下一段 Phase 4/5 复用同模板做 Toutiao + Kuaishou C 路径（都需要 SignProvider，跟 Xhs X-S 模式同）。
