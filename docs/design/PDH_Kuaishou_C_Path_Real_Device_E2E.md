# PDH Kuaishou C 路径真机 E2E checklist (Win 优先)

> 状态: v1 (Phase 6d.5, 2026-05-25)
> Phase 6d.1-6d.4 全 ship 后真机验证
> 关联: [[pdh-sign-provider-phase-6a]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`

## 0. 这是什么 / 为什么手动跑

Phase 6d 已经把 Kuaishou C 路径（PC + ADB cookies + profile 解析 + 3
GraphQL POST endpoints with `__NS_sig3` + `kpf`/`kpn` via
KuaishouSignBridge）的全链路代码 + 单测 + 三入口 UI 都 ship 了。但**单元
测试只覆盖到 mock fetch + mock electron 一级**，真机必须验证:

1. **NS_sig3 签名通路**: KuaishouSignBridge（Electron WebContentsView）能
   真在 desktop 跑出 `__NS_sig3` 值 + `kpf`/`kpn` headers — 4 个 candidate
   全局 (`__APP__.encryptParams` / `NS.sign` / `GraphQL.fetch.sign` /
   `__SIGN__`) 中至少一个 hit
2. **GraphQL body hash 一致性**: NS_sig3 用 body bytes 算 hash，body 字
   节 mismatch 必失败。如果命中率突降 → body serialization 漂了
3. **3 signed endpoint 命中率**: watch / collect / search 应 ~100% 命中
   （bridge 路径）。低于 50% 说明 NS_sig3 init 时序问题
   （postLoadDelayMs=3000 不够）或 cookie/body 签名失败
4. **profile from cookie**: api_ph payload 解析正确 — 该路径不走 HTTP，
   完全本地 cookie 派生
5. **CLI 短路 banner**: cli context 无 bridge 应正确 short-circuit 3
   signed endpoint，profile 仍能拉到（从 cookie）

**跟 Toutiao 不同的关键差异**:
- Kuaishou 是 GraphQL POST，body 包含在签名 hash 内（Toutiao 是 GET URL
  签名）
- Kuaishou bridge 返 URL mutation + headers BOTH（Toutiao 仅 URL）
- Kuaishou profile 从 cookie payload 派生（Toutiao 走 passport HTTP endpoint）
- postLoadDelayMs=3000 vs Toutiao 2500ms（NS_sig3 init 更重）
- WS timeout 120s vs Toutiao 90s（NS_sig3 warmUp 更慢）

**Win 优先**: 我们代码已经 Win-friendly。本文档命令均 PowerShell。

## 1. 准备清单 (Win 桌面)

| 项 | 验证命令 |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| Android Magisk-root | `adb shell su -c "id -u"` 返 `0` |
| MIUI/HyperOS: "USB 调试（安全设置）" 开 | `adb shell pm list packages -3` 返 ≥ 1 行 |
| 手机装快手**标准版** APK | `adb shell pm list packages com.smile.gifmaker` 命中 |
| **不是**极速版 | `adb shell pm list packages com.kuaishou.nebula` 应不命中或我们不读它 |
| 快手 App 已登录账号 | 手机点开快手看到自己头像 |
| **手机内随便看 1 个视频** | 让 WebView 写入 cookies — 漏了直接 `KUAISHOU_COOKIES_INCOMPLETE` |
| 项目 cc CLI 装好 (≥ Phase 6d) | `cc --version` 含 Phase 6d 版本 |
| 桌面 chainlesschain App 装好 (≥ v5.0.3.89+) | 桌面 app 启动后菜单 PersonalDataHub 可见 |
| Terminal 中文编码 | `chcp 65001` |

**Win-specific 易踩坑** (跟 Toutiao doc §1 同):
- 小米 MIUI USB 调试第二开关
- OEM 解锁 168h 等待
- 小米 USB 驱动

**Kuaishou-specific 易踩坑**:
- **极速版包名 com.kuaishou.nebula ≠ com.smile.gifmaker**: 我们只读标准
  版。UI banner 必含 "NOT 极速版" 提示
- **快手 cookie 全名是 `kuaishou.web.cp.api_ph`**: 注意点号 + 下划线混
  合，写漏一个就直接 `KUAISHOU_COOKIES_INCOMPLETE`
- **api_ph 是 URL-encoded JSON**: 包含 user_id / user_name / kuaishou_id
  / headurl / sex / city / constellation / signature。某些登录路径会写
  入但缺 user_id → `KUAISHOU_COOKIES_INCOMPLETE` 用户感到困惑
- **NS_sig3 全局名 rotate**: 每 4-8 周可能 rotate。4 candidate 全 miss
  时 → 0 signed endpoint 命中
- **kpf/kpn headers 必发**: bridge 返回这俩，client 必须 forward 到 POST
  request 里，否则 server 401/403

## 2. 入口 A / B / C

**入口 A — CLI**:
```powershell
cc hub kuaishou-adb-sync --json
```
**期望输出（CLI happy — profile only, signed 短路）**:
```json
{
  "ok": true,
  "report": {
    "adapter": "social-kuaishou",
    "status": "ok",
    "rawCount": 1,
    "kuaishou": {
      "uid": "12345678",
      "nickname": "Alice",
      "eventCounts": { "profile": 1, "watch": 0, "collect": 0, "search": 0, "total": 1 },
      "signProviderUsed": "none",
      "signProviderHits": 0,
      "signProviderFallbacks": 3,
      "lastErrorCode": -99,
      "profileFetchFailed": false
    }
  }
}
```

**入口 B — Desktop app**: 桌面 chainlesschain App → PersonalDataHub →
extra-bar → 点 "通过 PC ADB 同步 Kuaishou" 按钮。
**期望（desktop happy — 全部 3 endpoint 命中）**:
- antd success banner: `Kuaishou 同步成功：profile=1 / watch=30 / collect=10 / search=5 (total=46) [Alice]`
- signProviderUsed === "KuaishouSignBridge"

**入口 C — Web shell**: `cc ui` → 浏览器开 `/personal-data-hub` → 点同名
按钮。**这条等价 CLI 路径** (no bridge) → 应见 banner "当前 web-shell 上下
文不支持 __NS_sig3 签名，打开桌面 app 同步可获取 watch / collect / search"。

## 3. 8 个验证场景

### 场景 1 — Desktop happy path (5 min) — **关键：验 __NS_sig3 命中率**

**前置**: 准备清单全绿 + 快手 App 登录 + 看 1+ 视频 + 账号至少有 1
posted photo + 1 search history

**操作** (desktop app 内点按钮): 启动 → PersonalDataHub → 点同步按钮

**通过条件**:
- banner 字样 "Kuaishou 同步成功"
- `profile === 1` AND `watch > 0` (推荐流应 ~30 条)
- 至少 collect / search 之一 > 0
- antd table 下方 `lastSync.kuaishou.signProviderUsed === "KuaishouSignBridge"`
- antd table 下方 `signProviderHits === 3`
- `signProviderFallbacks === 0`

**__NS_sig3 命中率达标 (跑 5 次取平均)**:
- 5 次里至少 4 次 watch > 0
- 5 次里至少 3 次 collect > 0
- 5 次里至少 3 次 search > 0 (有些账号搜索史空 — OK)
- 5 次连续全 0 → NS_sig3 全局名 rotate，去看 KuaishouSignBridge log

### 场景 2 — CLI 短路 banner (3 min) — **关键：验 no-bridge UX**

**前置**: 同场景 1 + 用 CLI 入口
**操作**:
```powershell
cc hub kuaishou-adb-sync
```
**通过条件 (人类可读模式)**:
- stdout 含 `✓ kuaishou-adb-sync succeeded`
- `uid:` 行有数字
- `profile: 1`
- `watch: 0` / `collect: 0` / `search: 0`
- `total: 1`
- ⚠ 行 `3 signed endpoints short-circuited (no sign bridge in CLI context) — run from desktop app to enable __NS_sig3 via Electron WebContentsView`

**JSON 模式同 §2 入口 A 输出**

### 场景 3 — `KUAISHOU_NO_ROOT` (1 min)

跟 Toutiao 场景 3 同。非 root 设备跑 → `✗ KUAISHOU_NO_ROOT`。

### 场景 4 — `KUAISHOU_NOT_INSTALLED` (1 min)

```powershell
adb shell pm uninstall com.smile.gifmaker
cc hub kuaishou-adb-sync
```
**通过条件**:
- `✗ KUAISHOU_NOT_INSTALLED`
- Banner: "Install 快手 (com.smile.gifmaker, NOT 极速版 com.kuaishou.nebula) + log in once + open any video (WebView populates cookies), then retry"
- **关键**: banner 必含 "**NOT 极速版**" + "**open any video**" 提示

### 场景 5 — `KUAISHOU_COOKIES_INCOMPLETE` (2 min) — **常见**

**前置**: root 手机 + 快手 App **注销** 或 **从未看视频**
**操作**: `cc hub kuaishou-adb-sync`
**通过条件**:
- `✗ KUAISHOU_COOKIES_INCOMPLETE`
- Banner: "userId / kuaishou.web.cp.api_ph missing — relog on the Kuaishou App"

### 场景 6 — Profile fetch fail (cookie has userId but no api_ph) (3 min)

**前置**: 手机快手 App 登录但 cookie 不完整（仅 userId，缺 api_ph）。
**操作**: `cc hub kuaishou-adb-sync`
**通过条件**:
- `✓ kuaishou-adb-sync succeeded`（profile fail 不致整体 fail）
- `uid:` 显 `(profile fetch failed)` 或 cookie 的 userId
- ⚠ 行 `cookie 缺 kuaishou.web.cp.api_ph — relog on Kuaishou (lastErrorCode=-8)`
- snapshot 仍写成功，profile=0 / 其他=0 (因为 cli 也短路)

### 场景 7 — Web-shell context banner (3 min)

**前置**: `cc ui` 启动 + 浏览器开页
**操作**: PersonalDataHub 页面点 "通过 PC ADB 同步 Kuaishou" 按钮
**通过条件**:
- antd warning banner 字样 "Kuaishou 同步仅获取了 profile (1 event)"
- description 字样 "当前 web-shell 上下文不支持 __NS_sig3 签名（仅
  desktop app 提供 KuaishouSignBridge）。打开桌面 app 同步可获取 watch
  / collect / search。"
- 黄色 warning, 不是红色 error

### 场景 8 — NS_sig3 rotation drill (10 min) — **半年跑一次**

**目的**: 验 KuaishouSignBridge buildSignScript 4 candidate 全 miss 时
优雅 fallback (不 crash, signProviderHits=0, fallback=3)

**前置**: 在 desktop dev tools console 覆盖 4 个全局:
```javascript
window.__APP__ = undefined
window.NS = undefined
window.GraphQL = undefined
window.__SIGN__ = undefined
```

**操作**: 点 "通过 PC ADB 同步 Kuaishou"
**通过条件**:
- 不 crash
- `signProviderUsed === "KuaishouSignBridge"` (bridge 创建了但 sign 返 null)
- `signProviderHits === 0`
- `signProviderFallbacks === 3`
- profile 从 cookie 仍能拉
- banner 字样 "Kuaishou 同步部分完成 (1 events)" + lastErrorCode=-99

## 4. 命中率衰退红线

跑场景 1 平均命中率持续 **<50%** 5 天连续 → 触发 KuaishouSignBridge
v0.2 升级:
- 查 kuaishou web 当前 NS_sig3 SDK 文件 (`view-source:https://www.kuaishou.com/new-reco` → 找 `<script src="..encrypt..">`)
- 看新的全局名（obfuscated minify 后常见 `_0xXXXXX`）
- 加到 buildSignScript candidates 列表（与 Toutiao 升级流程一致）

## 5. 完工标记

- [ ] 场景 1 desktop 跑 5 次平均命中率 ≥ 4/5
- [ ] 场景 2 CLI 短路 banner 显示
- [ ] 场景 3 KUAISHOU_NO_ROOT banner OK
- [ ] 场景 4 KUAISHOU_NOT_INSTALLED 含 NOT 极速版 + open any video 提示
- [ ] 场景 5 KUAISHOU_COOKIES_INCOMPLETE banner OK
- [ ] 场景 6 profile fetch fail 不全失败
- [ ] 场景 7 web-shell warning banner OK (黄色不是红色)
- [ ] 场景 8 NS_sig3 rotation drill 不 crash + 正确短路

完工后回归 `pdh_sign_provider_phase_6a.md` 把 P6d 标 "real-device verified"。

## 6. 后续 (跟 Toutiao P6c.5 共享)

Phase 6e 真机 E2E 实跑应**同步** 4 平台 (Xhs upgrade / Toutiao + Kuaishou
new / Bilibili-Douyin-Weibo 已 ship 不动)。命中率监测 Xhs 升级前 60% → 后
~100%；Toutiao + Kuaishou 0% → ~100%。同模板 Win-first。
