# PDH Weibo C 路径真机 E2E checklist (Win 优先)

> 状态: v1 (Phase 3d, 2026-05-25)
> Phase 3a + 3b 全 ship 后真机验证
> 关联: [[pdh-weibo-c-path-phase-3a]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6.2

## 0. 这是什么 / 为什么手动跑

Phase 3a + 3b 已经把 Weibo C 路径（PC + ADB cookies + m.weibo.cn 4 endpoint HTTP scrape）的全链路代码 + 单测 + 三入口 UI 都 ship 了。但**单元测试只覆盖到 mock fetch 一级**，真正决定能不能 ship 的是：

1. **Win + Magisk-root Android** + **真 Weibo App** + **真账号 cookie** 端到端跑一遍
2. 验 4 endpoint 真返事件（不是 `{ok:0}` 或 HTML 重定向 silent 空集）
3. 验 10 typed reason banner 至少能命中 4 个常见路径

**Win 跑得动** — 我们代码已经 Win-friendly (CRLF / chcp 65001 / 32MB maxBuffer / explicit utf8 全 handle 过了)。下面以 **Win 为主推路径**。Mac/Linux 同步骤可跑。

## 1. 准备清单 (Win 桌面)

| 项 | 验证命令 (PowerShell / cmd) |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| 解压 platform-tools 加 PATH | `where adb` 显路径 |
| Android 手机 Magisk-root (或 KernelSU) | `adb shell su -c "id -u"` 返 `0` 或 `uid=0(...)` |
| Android USB debugging + 授权 PC RSA | `adb devices` 显 device 非 `unauthorized` |
| Win 装小米/OPPO/华为等厂商 USB 驱动 | `adb devices` 命中 |
| MIUI/HyperOS: 开 "USB 调试（安全设置）" 第二开关 | `adb shell pm list packages -3 \| Select-Object -First 3` 返 ≥ 1 行 |
| 手机装微博正式版 APK | `adb shell pm list packages com.sina.weibo` 命中 |
| 微博 App 已登录账号 | 手机点开微博看到自己头像（不是登录页） |
| 项目 cc CLI 装好 (≥ Phase 3a) | `cc --version` 含 Phase 3a 版本 |
| Terminal 中文编码 | `chcp 65001` (PowerShell 偶尔需手动) |

**Win-specific 易踩坑**:
- **小米 MIUI / HyperOS**: 开 "USB 调试（安全设置）" **第二开关**，否则 `adb shell su -c "..."` silent 返空
- **微博 WebView 数据目录**: Weibo App 的 cookies 可能在 `app_webview/Default/Cookies` (默认) 也可能在自定义目录。如果 P3d 真机跑发现 `WEIBO_NOT_INSTALLED` 但 App 装了，是路径不对，更新 `WEIBO_COOKIES_REMOTE_PATH` 常量
- **OEM 解锁**: OPPO / vivo Magisk root 需先申请解锁码 + 168 小时等待

## 2. 三种入口任选其一

### 入口 A — `cc hub weibo-adb-sync` (PowerShell)

```powershell
cc hub weibo-adb-sync --json
```

**期望输出（happy）**:
```json
{
  "ok": true,
  "report": {
    "adapter": "social-weibo",
    "status": "ok",
    "rawCount": 25,
    "entityCounts": { "events": 25, ... },
    "weibo": {
      "uid": 1234567890,
      "eventCounts": { "post": 15, "favourite": 5, "follow": 5, "total": 25 },
      "lastErrorCode": 0,
      "cookieDiagnostic": { "cookieCount": 6, "hasSub": true, "hadEncrypted": false },
      "uidFetchFailed": false,
      "cleanupFailed": false
    }
  }
}
```

human 输出（不加 `--json`）:
```
✓ weibo-adb-sync succeeded
  uid:        1234567890
  posts:      15
  favourites: 5
  follows:    5
  total:      25
  status:     ok
  rawCount:   25
```

### 入口 B — WS topic + JSON 调用 (开发者侧)

```javascript
ws.send({
  id: "...",
  type: "personal-data-hub.weibo-adb-sync",
  limits: { post: 50, favourite: 30, follow: 100 },
  displayName: "alice"
})
```

### 入口 C — Web Panel UI (`cc serve` + 浏览器 / desktop V6)

```powershell
cc serve --port 8200
# 浏览器打开 http://localhost:8200，进入 PersonalDataHub 页
```

按钮 "通过 PC ADB 同步 Weibo" → antd notification (success / warning / error)。

## 3. 6 个验证场景

### 场景 1 — Happy path (5 min)

**前置**: 准备清单全绿 + 微博 App 已登录
**操作**:
```powershell
cc hub weibo-adb-sync
```
**通过条件**:
- 输出 `✓ weibo-adb-sync succeeded` + uid 非 null + 至少 1 个 post/favourite/follow

**验证 vault**:
```powershell
cc hub query-events --adapter social-weibo --limit 5
cc hub query-events --adapter social-weibo --subtype post --limit 3
cc hub query-events --adapter social-weibo --subtype favourite --limit 3
cc hub query-events --adapter social-weibo --subtype follow --limit 10
```

### 场景 2 — `WEIBO_NO_ROOT` (1 min)

**前置**: 非 root 设备（或 Magisk denylist 加 cc shell）
**操作**: `cc hub weibo-adb-sync`
**通过条件**: 输出 `✗ WEIBO_NO_ROOT` + tip "phone needs Magisk root"

### 场景 3 — `WEIBO_NOT_INSTALLED` (1 min)

**前置**: 卸载微博 App
**操作**: `cc hub weibo-adb-sync`
**通过条件**: 输出 `✗ WEIBO_NOT_INSTALLED` + tip "install Weibo App + log in"

**变体**: 装了微博但**未登录** — 这会进 `WEIBO_COOKIES_INCOMPLETE`（看场景 4）。

### 场景 4 — `WEIBO_COOKIES_INCOMPLETE` (2 min)

**前置**: root 手机 + 微博 App **已注销登录**（点头像 → 退出登录）
**操作**: `cc hub weibo-adb-sync`
**通过条件**: 输出 `✗ WEIBO_COOKIES_INCOMPLETE` + tip "SUB cookie missing — relog"
**预期**: 退登后 Cookies 文件还在但缺 SUB 字段（或 SUB 为空字符串）

### 场景 5 — `uidFetchFailed` (warning state, 3 min)

这是 Weibo 特有 — happy 和 fail 之间的中间态。

**前置**: Cookies 完整 + 进入"伪 cookie expired" 状态：
- 在手机微博 App 内**切换登录账号**（旧 cookie 触发服务器端 invalidate）
- 或长时间不用导致 cookie 自然过期

**操作**: `cc hub weibo-adb-sync`
**期望输出**:
```
✓ weibo-adb-sync succeeded
  uid:        (uid fetch failed)
  posts:      0
  favourites: 0
  follows:    0
  total:      0
  status:     ok
  rawCount:   0
  ⚠ /api/config returned login=false — cookie expired or anti-bot redirect (lastErrorCode=-4)
```

**通过条件**: 命令 exit 0（不是 1）+ warning 行明确说明 cookie 过期 / login=false / lastErrorCode=-4。Web UI 收到 antd warning notification (非 error)。

### 场景 6 — Multi-device / 多账号 (2 min)

**前置**: 同时插 2 个 Android 设备（或 1 手机 + 1 emulator）
**操作**:
```powershell
adb devices         # 看到 2 行 device
cc hub weibo-adb-sync   # 应失败 + tip "set ADB_SERIAL"
$env:ADB_SERIAL = "<具体 serial>"
cc hub weibo-adb-sync   # 应成功
```
**通过条件**: 第一次失败带 "multiple devices attached" 错误，set serial 后成功

## 4. UI 入口 (PersonalDataHub.vue) 6 场景

跟 §3 一样的 6 场景，但走 Web UI：
1. `cc serve --port 8200`
2. 浏览器打开 PersonalDataHub 页
3. 每场景设前置（root/notroot/installed/loggedout/uidFetchFailed/multidevice）
4. 点 "通过 PC ADB 同步 Weibo" 按钮 → 看 antd notification
5. notification.content 应包含对应中文 banner (`weiboReasonMessage` 映射)

**关键 UI 区分**:
- happy path → `message.success` (绿色)
- uidFetchFailed → `message.warning` (黄色, "/api/config 返 login=false")
- lastErrorCode != 0 (partial) → `message.warning` (黄色, "部分接口受反爬限制")
- 任何 reason 失败 → `message.error` (红色)

## 5. 真账号数据抽样深验

```powershell
# 看最近一周事件
cc hub query-events --adapter social-weibo `
  --since (Get-Date -UFormat %s -Date (Get-Date).AddDays(-7))

# 看自己发的微博 (post)
cc hub query-events --adapter social-weibo --subtype post --limit 5

# 看收藏夹 (favourite)
cc hub query-events --adapter social-weibo --subtype favourite --limit 5

# 看关注列表 (follow)
cc hub query-events --adapter social-weibo --subtype follow --limit 20
```

**抽样验证点**:
- post 的 text 字段含真账号发过的中文内容（HTML 已 stripped — 没 `<a href>` 残留）
- post 的 likes/reposts/comments 计数跟手机微博 App 显示数字一致 (差异 ≤ 5% 内 OK，因为 cache lag)
- favourite 显示真账号收藏的微博（含转发的 @ user 名）
- follow 列表 screen_name 跟手机关注列表前 20 个匹配（前 20 是最新关注的）

## 6. 反爬触发场景 (Weibo 特有)

短时间内重复跑 `cc hub weibo-adb-sync` ~10 次（间隔 < 30s），观察是否进入：
- `ok: -100` (m.weibo.cn 反爬触发，UA 检测) → lastErrorCode=-100
- HTTP 30x 重定向到登录页 → lastErrorCode=-4 (non-json)
- 单 IP rate-limit "网络繁忙" → empty array

```powershell
for ($i=1; $i -le 10; $i++) {
  cc hub weibo-adb-sync --limit-post 20
  Start-Sleep -Seconds 5
}
```

**通过条件**: 至少 3 次完整成功 + 部分次进 partial-result (lastErrorCode != 0)。如果 10 次全 fail，说明：
- UA / Referer / X-Requested-With / MWeibo-Pwa 头 4 个里有一个被 Weibo 反爬 rotate 了
- 去 Android `WeiboApiClient.kt` 比对当前 header 是否一致，同步更新 Node 端

## 7. 回归 trap 记录位置

跟 Bilibili 1e §7 + Douyin 2c §7 同模板：
1. memory `pdh_weibo_c_path_phase_3a.md` 加 "Phase 3d 真机踩坑" 区
2. handbook `docs/internal/hidden-risk-traps.md` 加 #26+（如新 silent failure 模式）
3. 代码: `packages/personal-data-hub/lib/adapters/social-weibo-adb/`
4. 测试: `__tests__/adapters/social-weibo-adb-*.test.js`
5. **byte-parity check**: 任何 root cause fix 必须**两边同改** — Node parser 跟 Kotlin parser 同 parseWeiboTime / stripHtml / header 4 个 anti-bot 字段。一边改一边不改就是回归

## 8. 已知风险 / Phase 4+ 待补

- **Weibo App WebView 自定义 profile dir**: 默认 `app_webview/Default/Cookies`，但 Weibo 可能换路径。真机如果发现 `WEIBO_NOT_INSTALLED` 但 App 装了，是路径不对，调 `WEIBO_COOKIES_REMOTE_PATH` 常量
- **m.weibo.cn vs weibo.com 双 host**: 现 cookies extension 只 filter `m.weibo.cn`。如果用户在 PC 上登 weibo.com 后桌面 cookies sync 到手机，可能 host_key=".weibo.com" 但 SUB 在 m.weibo.cn 也有。监控真机如果某些 cookie missing 但 PC 端有
- **多账号支持**: 现 fetchUid 自动用 cookie 中 default 账号；不支持手动选 uid。Phase 4 加 `--uid` 参数 (类似 Douyin)
- **doctor dry-run 入口缺失**: 跟 Bilibili 1e 模式，可加 `cc hub weibo-adb-doctor` 单独 probe cookies 不调 4 endpoint。Phase 4 加

---

跑完 E2E + 找到的 trap 都收口到 memory，**Phase 3a/3b/3d Weibo C 路径完整收口**。
