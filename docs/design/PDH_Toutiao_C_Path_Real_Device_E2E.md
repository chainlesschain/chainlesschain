# PDH Toutiao C 路径真机 E2E checklist (Win 优先)

> 状态: v1 (Phase 6c.5, 2026-05-25)
> Phase 6c.1-6c.4 全 ship 后真机验证
> 关联: [[pdh-sign-provider-phase-6a]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`

## 0. 这是什么 / 为什么手动跑

Phase 6c 已经把 Toutiao C 路径（PC + ADB cookies + passport 接口 + 3 个
`_signature` 签名端点 via ToutiaoSignBridge）的全链路代码 + 单测 + 三入口
UI 都 ship 了。但**单元测试只覆盖到 mock fetch + mock electron 一级**，
真机必须验证:

1. **acrawler.js 签名通路**: ToutiaoSignBridge（Electron WebContentsView）能
   真在 desktop 跑出 `_signature` 值 — JVM mock 不验证 acrawler.js 是否还在
   `window.byted_acrawler.sign` 全局上（这名字 4-8 周可能 rotate 到
   `_0x32d839` 或 `acrawler.sign`）
2. **3 signed endpoint 命中率**: feed / collection / search 应 ~100% 命中
   （bridge 路径，对比 Xhs 的 60% best-effort md5 fallback）。低于 50% 说明
   acrawler.js init 时序问题（postLoadDelayMs=2500 不够）或 cookie 灌注失败
3. **CLI 短路 banner**: cli context 无 bridge 应正确 short-circuit 3 signed
   endpoint（不发 HTTP，lastErrorCode=-99），profile 仍能拉到

**跟 Xhs 不同的关键差异**:
- Xhs 用 header signing (X-S/X-T)，Toutiao 用 URL mutation (?_signature=...)
- Toutiao 有 desktop vs CLI **双模式** — desktop 100% / CLI 0% signed endpoint
- Toutiao App 不像小红书那样常用 WebView — 必须主动**点开一篇文章**让
  com.ss.android.article.news 的 Chromium cookies 库填充

**Win 优先**: 我们代码已经 Win-friendly。本文档命令均 PowerShell。

## 1. 准备清单 (Win 桌面)

| 项 | 验证命令 |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| Android Magisk-root | `adb shell su -c "id -u"` 返 `0` |
| MIUI/HyperOS: 开 "USB 调试（安全设置）" 第二开关 | `adb shell pm list packages -3` 返 ≥ 1 行 |
| 手机装今日头条**标准版** APK | `adb shell pm list packages com.ss.android.article.news` 命中 |
| **不是**极速版！ | `adb shell pm list packages com.ss.android.article.lite` 应不命中或我们不读它 |
| 头条 App 已登录账号 | 手机点开头条看到自己头像 |
| **手机内随便点开一篇文章** | 让 WebView 写入 cookies — 这步漏了直接 `TOUTIAO_COOKIES_INCOMPLETE` |
| 项目 cc CLI 装好 (≥ Phase 6c) | `cc --version` 含 Phase 6c 版本 |
| 桌面 chainlesschain App 装好 (≥ v5.0.3.84) | 桌面 app 启动后菜单 PersonalDataHub 可见 |
| Terminal 中文编码 | `chcp 65001` |

**Win-specific 易踩坑** (跟 Weibo doc §1 同):
- 小米 MIUI USB 调试第二开关
- OEM 解锁 168h 等待
- 小米 USB 驱动

**Toutiao-specific 易踩坑**:
- **极速版包名不同**: `com.ss.android.article.lite` ≠ `com.ss.android.article.news`。
  我们 Phase 6c 只读标准版包；如果用户只装极速版 → `TOUTIAO_NOT_INSTALLED`。
- **不点开文章 cookies 不写**: 头条 App 主屏是 native 信息流，不进 WebView，
  cookies 库不填充。**必须**主动点开 1+ 篇文章触发内嵌 WebView 加载。
- **acrawler.js 全局名 rotate**: ByteDance 大约每 4-8 周 rotate
  `byted_acrawler.sign` ↔ `_0x32d839` ↔ `acrawler.sign`。3 候选都试，但 全
  miss 时 → 0 signed endpoint 命中 → 升级 ToutiaoSignBridge buildSignScript
- **sessionid_ss vs sessionid**: 不同版本头条 App cookie 名不同，我们都接受

## 2. 入口 A / B / C

**入口 A — CLI**:
```powershell
cc hub toutiao-adb-sync --json
```
**期望输出（CLI happy — profile only, signed endpoints 短路）**:
```json
{
  "ok": true,
  "report": {
    "adapter": "social-toutiao",
    "status": "ok",
    "rawCount": 1,
    "toutiao": {
      "uid": "12345678",
      "nickname": "Alice",
      "eventCounts": { "profile": 1, "feed": 0, "collection": 0, "search": 0, "total": 1 },
      "signProviderUsed": "none",
      "signProviderHits": 0,
      "signProviderFallbacks": 3,
      "lastErrorCode": -99,
      "profileFetchFailed": false
    }
  }
}
```

**入口 B — Desktop app**: 打开桌面 chainlesschain App → 菜单
PersonalDataHub → 顶部 extra-bar → 点 "通过 PC ADB 同步 Toutiao" 按钮。
**期望（desktop happy — 全部 3 endpoint 命中）**:
- banner 显示 `Toutiao 同步成功：profile=1 / feed=30 / collection=10 / search=5 (total=46) [Alice]`
- signProviderUsed === "ToutiaoSignBridge"

**入口 C — Web shell / 远程**: `cc ui` 起 web-shell → 浏览器开
`http://localhost:<port>/personal-data-hub` → 点同名按钮。**这条等价 CLI
路径** (no bridge) → 应见 banner "当前 web-shell 上下文不支持 _signature
签名，打开桌面 app 同步可获取 feed / collection / search"。

## 3. 8 个验证场景

### 场景 1 — Desktop happy path (5 min) — **关键：验 _signature 命中率**

**前置**: 准备清单全绿 + Toutiao App 登录 + 点开 1+ 文章 + 账号至少有 1
篇 saved article + 1 次搜索历史
**操作** (desktop app 内点按钮):

1. 启动 chainlesschain desktop app
2. 进 PersonalDataHub 页面
3. 点 "通过 PC ADB 同步 Toutiao"
4. 观察 antd message banner

**通过条件**:
- banner 字样 "Toutiao 同步成功"
- `profile === 1` AND `feed > 0` (推荐流应 ~30 条)
- 至少 collection / search 之一 > 0（用户得有收藏或搜索过）
- antd table 下方 `lastSync.toutiao.signProviderUsed === "ToutiaoSignBridge"`
- antd table 下方 `signProviderHits === 3` (3 个 signed endpoint 全命中)
- `signProviderFallbacks === 0`

**_signature 命中率达标 (跑 5 次取平均)**:

```powershell
# CLI 不能跑 desktop bridge 路径 — 此步骤需用 ws-client 通过 desktop app
# 触发，或在 desktop dev tools console 跑：
# window.electron.invoke("personal-data-hub.sync-adapter", {name:"social-toutiao",options:{}})
# 实际操作上简单点开 5 次按钮，看每次 antd success message 数字
```

**预期**:
- 5 次里至少 4 次 feed > 0（acrawler.js 偶尔 init 慢 — 1 次 0 OK）
- 5 次里至少 3 次 collection > 0
- 5 次里至少 4 次 search > 0
- 全 0 5 次连续 → acrawler.js 全局名 rotate，去看 ToutiaoSignBridge log

### 场景 2 — CLI 短路 banner (3 min) — **关键：验 no-bridge UX**

**前置**: 同场景 1 + 用 CLI 入口
**操作**:
```powershell
cc hub toutiao-adb-sync
```
**通过条件 (人类可读模式)**:
- stdout 含 `✓ toutiao-adb-sync succeeded`
- `uid:` 行有数字
- `profile: 1`
- `feed: 0` / `collection: 0` / `search: 0`
- `total: 1`
- ⚠ 行 `3 signed endpoints short-circuited (no sign bridge in CLI context) — run from desktop app to enable _signature via Electron WebContentsView`

**JSON 模式同 §2 入口 A 输出**

### 场景 3 — `TOUTIAO_NO_ROOT` (1 min)

跟 Weibo / Xhs 场景 2 同。非 root 设备跑 → `✗ TOUTIAO_NO_ROOT`。
Banner: "Phone needs Magisk root — Toutiao release APK isn't debuggable"

### 场景 4 — `TOUTIAO_NOT_INSTALLED` (1 min)

```powershell
adb shell pm uninstall com.ss.android.article.news
cc hub toutiao-adb-sync
```
**通过条件**:
- `✗ TOUTIAO_NOT_INSTALLED`
- Banner: "Install 今日头条 (com.ss.android.article.news, NOT 极速版/.lite) + log in once + open any article (WebView populates cookies), then retry"
- **关键**: banner 必含 "**NOT 极速版**" 提示

### 场景 5 — `TOUTIAO_COOKIES_INCOMPLETE` (2 min) — **常见**

**前置**: root 手机 + 头条 App **注销登录** 或 **登录但从未点开文章**
**操作**: `cc hub toutiao-adb-sync`
**通过条件**:
- `✗ TOUTIAO_COOKIES_INCOMPLETE`
- Banner: "sessionid / sessionid_ss missing — relog on the Toutiao App"

**变体测试 — 登录但没点文章**:
- 干净安装头条 + 登录账号 + **不点任何文章** → 直接跑 cc → 应同 banner
  (cookies 库可能完全空 OR 仅有 anti-bot cookies 但无 sessionid)

### 场景 6 — Profile fetch fail (3 min)

**前置**: 头条 App 登录但 cookie 已 expired (24h+ 没用)
**操作**: `cc hub toutiao-adb-sync`
**通过条件**:
- `✓ toutiao-adb-sync succeeded`（profile fetch 失败不致整体 fail）
- `uid: (profile fetch failed)`
- ⚠ 行 `passport/info/v2 returned no user_id — cookie expired or sessionid missing (lastErrorCode=1)` 或类似
- snapshot 仍写成功，profile=0 / feed=0 / collection=0 / search=0

### 场景 7 — Web-shell context banner (3 min)

**前置**: `cc ui` 启动 web-shell + 浏览器开页
**操作**: PersonalDataHub 页面点 "通过 PC ADB 同步 Toutiao" 按钮
**通过条件**:
- antd warning banner 字样 "Toutiao 同步仅获取了 profile (1 event)"
- description 字样 "当前 web-shell 上下文不支持 _signature 签名（仅
  desktop app 提供 ToutiaoSignBridge）。打开桌面 app 同步可获取 feed /
  collection / search。"
- 不是 error 红色，是 warning 黄色 — 用户不应感到失败

### 场景 8 — acrawler rotation drill (10 min) — **半年跑一次**

**目的**: 验 ToutiaoSignBridge buildSignScript 3 候选全 miss 时优雅
fallback (不 crash, signProviderHits=0, fallback=3)

**前置**: 在 desktop dev tools 临时把 acrawler.js 三个全局都覆盖：

```javascript
// 在 desktop devtools console 跑（启动同步前）
window.byted_acrawler = undefined
window._0x32d839 = undefined
window.acrawler = undefined
```

**操作**: 点 "通过 PC ADB 同步 Toutiao"
**通过条件**:
- 不 crash
- `signProviderUsed === "ToutiaoSignBridge"` (bridge 创建了，只是 sign
  call 返 null)
- `signProviderHits === 0`
- `signProviderFallbacks === 3` (3 signed endpoint 都走 `-99` 短路)
- profile 仍能拉
- banner 字样 "Toutiao 同步部分完成 (1 events)" + lastErrorCode=-99

**如果 crash / hang**: 说明 ElectronWebSignBridge 的 timeout (5s) 或 mutex
有 bug，回到代码层修

## 4. 命中率衰退红线

跑场景 1 平均命中率持续 **<50%** 5 天连续 → 触发 ToutiaoSignBridge v0.2
升级:
- 抓 1 次 acrawler.js 当前版本 (`view-source:https://www.toutiao.com/`
  → 找 `<script src="..acrawler..">`)
- 看新的全局名（很可能是 `_0xXXXXX` 形式 obfuscated minify）
- 加到 buildSignScript candidates 列表

## 5. 完工标记

- [ ] 场景 1 desktop 跑 5 次平均命中率 ≥ 4/5
- [ ] 场景 2 CLI 短路 banner 显示
- [ ] 场景 3 TOUTIAO_NO_ROOT banner OK
- [ ] 场景 4 TOUTIAO_NOT_INSTALLED 含 NOT 极速版 提示
- [ ] 场景 5 TOUTIAO_COOKIES_INCOMPLETE banner OK
- [ ] 场景 6 profile fetch fail 不全失败
- [ ] 场景 7 web-shell warning banner OK (黄色不是红色)
- [ ] 场景 8 acrawler rotation drill 不 crash + 正确短路

完工后回归 `pdh_sign_provider_phase_6a.md` 把 P6c 标 "real-device verified"。
