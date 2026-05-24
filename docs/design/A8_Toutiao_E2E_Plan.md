# A8 今日头条 (Toutiao) — 真机 E2E 测试计划

**Status**: v0.2 计划 (2026-05-24) — stub `A8ToutiaoE2ETest.kt` 已落，真机执行需 Mac/Linux + Android 真机 + 真账号；Win dev box 无法运行。

## 范围

A8 v0.2 surface = **profile-only**。所有读取接口（history/collection/search）都需 `_signature` 签名（ByteDance acrawler.js 反爬 SDK），v0.3 接通后再补 E2E。当前 E2E 只覆盖 cookie 登录态 + ByteDance 老 passport endpoint（`/passport/account/info/v2/?aid=24`, unsigned, 与 Douyin aid=2906 同 family）。

```
WebView 登录 → SocialCookieWebViewScreen 提取 cookie
   ↓   (passport_uid / multi_sids / sessionid / ttwid / __ac_nonce)
HubLocalViewModel.syncToutiao()
   ↓
ToutiaoLocalCollector.snapshot()
   ↓ ToutiaoApiClient.fetchProfile (1 endpoint, 无 _signature)
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-toutiao.json (1 profile event)
   ↓
LocalCcRunner.syncAdapter("social-toutiao", path)
   ↓ adapter._syncViaSnapshot → person-self with toutiao-uid identifier
   ↓
UI 显示 "已同步账号 profile (v0.2)。历史/收藏/搜索需 v0.3 _signature 接通"
```

## 前置（一次性）

1. 真头条账号 (v0.2 不需要有内容，只验登录态 + profile)
2. Mac/Linux dev box
3. 真 Android 设备
4. APK 已 bundle in-APK cc + PDH ≥ 0.3.0
5. 抓包工具 (Charles / mitmproxy) — 模拟 412 / token 过期

## 8 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到"今日头条"卡片，状态"未登录"
3. 点"登录"→ WebView 加载 `https://www.toutiao.com/`（banner 推一键登录）
4. 用真账号登录 (短信 / 一键)
5. WebView 跳到 `www.toutiao.com` 主页 → ChainlessChain 命中 isLoginSuccess
6. 提取 cookie + 调 `/passport/account/info/v2/?aid=24` 拿 user_id + screen_name → 关 WebView

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片状态变"已登录 <nickname>"
- `pdh_social_toutiao` EncryptedSharedPreferences 中 `cookie` / `uid` / `displayName` 全非空
- cookie 中 `passport_uid` (或 `multi_sids` 首段) 字段存在

### 场景 2 — 同步 profile 成功

**前置**: 场景 1 已完成

**步骤**:
1. 在卡片点"同步"
2. ~2-5s 后 (单 endpoint)，toast "social-toutiao 同步完成 (+1 事件)"
3. 卡片显示"上次同步: <时间>"
4. banner 文本提示"已同步账号 profile（v0.2 含昵称/头像/粉丝数）。历史/收藏/搜索需 v0.3 _signature 签名接通。"

**断言**:
- `+1` 是 profile event (KIND_PROFILE)
- vault 中可见 `person-toutiao-<uid>` 记录
- person.identifiers 含 `toutiao-uid` + 可选 `toutiao-media-id`
- person.extra 含 followingCount / followerCount / avatarUrl / description / mobile (passport endpoint 不返 counts，应为 0)

### 场景 3 — Cookie 过期 (status_code != 0)

**前置**: 已登录，cookie sessionid 失效

**模拟**:
- `adb shell run-as com.chainlesschain.android rm -rf app_webview/Cookies*`
- 或 Charles 拦 passport endpoint 返 `{"status_code":2154,"status_msg":"session expired"}`

**步骤**:
1. 点"同步"

**断言**:
- profile 返 null，lastErrorCode = 2154
- 卡片显示"登录已过期 — code=2154 session expired (请重新登录)"
- 点"退出登录"清除本地 store

### 场景 4 — 反爬 412 (anti-spider)

**模拟**:
- Charles 拦 passport endpoint 返 HTTP 412 + body "blocked"
- 或缺 ttwid cookie / UA 非桌面 Chrome 触发真 412

**步骤**:
1. 点"同步"

**断言**:
- profile 返 null，lastErrorCode = 412
- 卡片显示"风控触发 — code=412 HTTP 412 (请稍后或换网络重试)"
- 不清 store (cookie 可能仍有效)

### 场景 5 — WebView 取消登录

**步骤**:
1. 全新装 APK
2. 点"登录"进 WebView
3. 在头条登录页不操作，按系统返回键

**断言**:
- WebView 关闭返回卡片列表
- 状态仍"未登录"
- 无 toast，无 errorMessage
- store 中 cookie / uid 字段空

### 场景 6 — 反复同步幂等性

**前置**: 已登录 + 已同步过一次

**步骤**:
1. 立即再点"同步"
2. 再点一次

**断言**:
- 三次 sync 后 `vault.queryPersons()` 数量不变 (同 uid 走 UPSERT)
- person.extra.snapshottedAt 每次更新
- person.names 不变 (除非用户改了昵称)
- raw_events 表只有 1 行 (profile originalId 是 `toutiao:profile:<uid>`)

### 场景 7 — EncryptedSharedPreferences keystore corruption

**模拟**: 改 `pdh_social_toutiao.xml` 让 AES-256-GCM 解密失败

**步骤**:
1. `adb shell` 进 app data dir，备份 xml
2. 手改 1 byte
3. 重启 app

**断言**:
- App 不 crash
- 头条卡片显"未登录"
- Timber log 含 "ToutiaoCredentialsStore: read failed"
- 用户能重新登录恢复

### 场景 8 — 退出登录 + 重新登录

**步骤**:
1. 已登录点"退出登录"
2. 卡片状态变"未登录"
3. 点"登录"重登同一账号
4. 同步

**断言**:
- 退出后 store 中 cookie / uid / displayName 全空
- 重新登录 uid 同上次
- 同步成功，person 记录同 ID (走 UPSERT 不是新建)

## 执行方式

- **手动**: 按 8 场景逐一跑，每个 ~3-8 分钟，总 ~1h
- **自动化**: 暂不可 (头条登录需短信 / 一键 / 扫码)
- **CI**: 仅跑场景 5 + 7 (非真账号)；其余手动

## v0.3 待补 (_signature 签名接通后)

- `/api/news/feed/v90/?category=__all__` 推荐流 — 新 E2E 场景: events 含 BROWSE 子类
- `/article/v2/tab_comments/` 收藏 — 新 E2E 场景: events 含 LIKE 子类
- `/api/search/content/` 搜索历史 — 新 E2E 场景: events 含 POST/SEARCH 子类
- _signature 漂移 (acrawler.js obfuscate rotate) — 同 Douyin X-Bogus 模式

## 反爬 caveats

- 412 是 IP-based，单设备触发后影响整设备同一 IP 5-15 分钟
- ttwid 是 device fingerprint 长期不变；缺它直接 412
- passport endpoint 比 _signature 端点宽松，但仍要桌面 Chrome UA + Referer www.toutiao.com

## stub 占位

`androidTest/.../A8ToutiaoE2ETest.kt` 8 个测试方法已 `@Ignore` 占位。

## 关联文档

- `docs/design/A8_Douyin_E2E_Plan.md` — 同 v0.2 profile-only 模板基线 (aid=2906 vs aid=24 差异)
- memory `pdh_social_collector_test_gap_audit.md` — 6 platform 测试覆盖审计
- memory `pdh_social_webview_deeplink_cookie_capture.md` — WebView 一键登录 deep-link 协议
