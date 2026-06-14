# A8 抖音 (Douyin) — 真机 E2E 测试计划

**Status**: v0.3 计划 (2026-05-25 update) — v0.2 stub `A8DouyinE2ETest.kt` 已落；v0.3 新增 `DouyinSignBridge` (hidden WebView 跑 acrawler.js 取 `X-Bogus + _signature`) + ApiClient 3 endpoint (history/favourite/like) + collector fan-out。Win dev box 跑 JVM 单测 (`DouyinApiClientV03Test` + `DouyinLocalCollectorV03Test`) ✅；真机 E2E 仍需 Mac/Linux + 真机 + 真账号。

## 范围

**v0.3 surface** (本轮新增 — 复用 Toutiao 模板)：
- ✅ profile (`/aweme/v1/passport/account/info/v2/?aid=2906`, unsigned passport endpoint, v0.2 已通)
- 🆕 history → KIND_HISTORY (`/aweme/v1/web/history/read/`, 需 `X-Bogus` header + `_signature` query)
- 🆕 favourites → KIND_FAVOURITE (`/aweme/v1/web/aweme/favorite/`)
- 🆕 likes → KIND_LIKE (`/aweme/v1/web/aweme/post/like/`)

`X-Bogus` + `_signature` 由 `DouyinSignBridge` 在登录 cookie 注入后的 hidden WebView 里跑 `window.byted_acrawler.sign({url, aid:2906, platform:'PC'})` 拿 — 与 Toutiao 同 ByteDance acrawler 家族，**复用 Toutiao 的 probe 候选** (`byted_acrawler.sign` / `_0x32d839` / `acrawler.sign`)，差异在 aid (2906 抖音 web vs 24 头条 web) + 输出 shape (Douyin 返 `{X-Bogus, _signature}` 对象，Toutiao 返裸 string)。

`SignProvider` 接口扩展了 `signedHeaders(rawUrl, purpose): Map<String, String>` 支持 Douyin 的 header-form 签名 (X-Bogus)。Bridge 单 JS eval 同时算出 URL 签名 + header 签名，单槽缓存配对调用。

**Graceful degrade** (与 Toutiao 同):
- bridge warmUp 失败 → 跳过 3 个 v0.3 端点, v0.2 profile 仍 emit
- signUrl 返 null (函数名 rotate / X-Bogus 算法漂) → 短路 (不发 HTTP), lastErrorCode=-99
- 任一 endpoint 返 412 / status_code != 0 → 其它两个继续

`v03Attempted` 字段在 `SnapshotResult.Ok` 透出 → UI banner 区分: "v0.3 命中 (N 历史/M 收藏/K 点赞)" / "v0.3 attempted 但 0 抓到" / "v0.2 fallback"。

```
WebView 登录 → SocialCookieWebViewScreen 提取 cookie
   ↓   (sessionid / passport_csrf_token / ttwid / __ac_nonce / msToken)
HubLocalViewModel.syncDouyin()
   ↓
DouyinLocalCollector.snapshot()
   ↓ DouyinApiClient.fetchProfile (1 endpoint, 无 X-Bogus)
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-douyin.json (1 profile event)
   ↓
LocalCcRunner.syncAdapter("social-douyin", path)
   ↓ adapter._syncViaSnapshot → person-self with douyin-sec-uid identifier
   ↓
UI 显示 "已同步账号 profile (v0.2)。历史/收藏/点赞需 v0.3 X-Bogus 接通"
```

## 前置（一次性）

1. 真抖音账号 (v0.2 不需要有内容，只验登录态)
2. Mac/Linux dev box
3. 真 Android 设备
4. APK 已 bundle in-APK cc + PDH ≥ 0.3.0
5. 抓包工具 (Charles / mitmproxy) — 模拟 412 / 401 / msToken 过期

## 8 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到"抖音"卡片，状态"未登录"
3. 点"登录"→ WebView 加载 `https://www.douyin.com/` (banner 推"一键登录" deep-link `snssdk1128://`)
4. 系统弹"抖音"app 同意授权 → cookie 自动回写 web 域
5. WebView 跳到 `www.douyin.com` 主页 → ChainlessChain 命中 isLoginSuccess
6. 提取 cookie + 调 `/aweme/v1/passport/account/info/v2/?aid=2906` 拿 sec_user_id + screen_name → 关 WebView

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片状态变"已登录 <nickname>"
- `pdh_social_douyin` EncryptedSharedPreferences 中 `cookie` / `secUid` / `displayName` 全非空
- cookie 中 `sessionid` / `ttwid` 字段都在

### 场景 2 — 同步 profile 成功

**前置**: 场景 1 已完成

**步骤**:
1. 在卡片点"同步"
2. ~2-5s 后 (单 endpoint)，toast "social-douyin 同步完成 (+1 事件)"
3. 卡片显示"上次同步: <时间>"

**断言**:
- `+1` 是 profile event (KIND_PROFILE)
- vault 中可见 `person-douyin-<secUid>` 记录
- person.identifiers 含 `douyin-sec-uid` + `douyin-short-id` (若有)
- person.extra 含 followingCount / followerCount / awemeCount / favoritingCount / totalFavorited (passport endpoint 不返这些 counts，应为 0)
- banner 文本提示"历史/收藏/点赞需 v0.3"

### 场景 3 — Cookie 过期 (status_code != 0)

**前置**: 已登录，cookie sessionid 失效

**模拟**:
- `adb shell run-as com.chainlesschain.android rm -rf app_webview/Cookies*` (清 WebView cookie 但 store 仍持有旧 cookie)
- 或 Charles 拦 passport endpoint 返 `{"status_code":2154,"status_msg":"token expired"}`

**步骤**:
1. 点"同步"

**断言**:
- profile 返 null，lastErrorCode = 2154
- 卡片显示"登录已过期 — code=2154 token expired (请重新登录)"
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
- 不清 store (cookie 可能仍有效，只是 IP 暂被限)

### 场景 5 — WebView 取消登录

**步骤**:
1. 全新装 APK
2. 点"登录"进 WebView
3. 在抖音登录页不操作，按系统返回键

**断言**:
- WebView 关闭返回卡片列表
- 状态仍"未登录"
- 无 toast，无 errorMessage
- store 中 cookie / secUid 字段空

### 场景 6 — 反复同步幂等性

**前置**: 已登录 + 已同步过一次

**步骤**:
1. 立即再点"同步"
2. 再点一次

**断言**:
- 三次 sync 后 `vault.queryPersons()` 数量不变 (同 secUid 走 UPSERT)
- person.extra.snapshottedAt 每次更新
- person.names 不变 (除非用户改了昵称)
- raw_events 表只有 1 行 (profile originalId 是 `douyin:profile:<secUid>`)

### 场景 7 — EncryptedSharedPreferences keystore corruption

**模拟**: 改 `pdh_social_douyin.xml` 让 AES-256-GCM 解密失败

**步骤**:
1. `adb shell` 进 app data dir，备份当前 xml
2. 手改 1 byte
3. 重启 app

**断言**:
- App 不 crash
- 抖音卡片显"未登录"
- Timber log 含 "DouyinCredentialsStore: read failed"
- 用户能重新登录恢复

### 场景 8 — 退出登录 + 重新登录

**步骤**:
1. 已登录点"退出登录"
2. 卡片状态变"未登录"
3. 点"登录"重登同一账号
4. 同步

**断言**:
- 退出后 store 中 cookie / secUid / shortId / displayName 全空
- 重新登录 secUid 同上次 (同账号)
- 同步成功，person 记录同 ID (走 UPSERT 不是新建)

## 执行方式

- **手动**: 按 8 场景逐一跑，每个 ~3-8 分钟 (v0.2 surface 窄)，总 ~1h
- **自动化**: 暂不可 (抖音登录需短信 / 一键 deep-link / 扫码)
- **CI**: 仅跑场景 5 + 7 (非真账号)；其余手动

## v0.3 待补 (X-Bogus 签名接通后)

- `/aweme/v1/web/history/read/` 观看历史 — 新 E2E 场景: 同步后 vault 中 events 含 BROWSE 子类
- `/aweme/v1/web/aweme/favorite/` 收藏 — 新 E2E 场景: events 含 LIKE 子类
- `/aweme/v1/web/aweme/post/` 自己发布的作品 — 新 E2E 场景: items 含 video 类
- msToken / __ac_nonce 5-15 分钟刷新 — 新 E2E 场景: 同步后等 15 分钟再同步，验签名重计算
- X-Bogus 签名漂移 (mssdk.js obfuscate rotate) — 新场景类比 [[A8_Xhs_E2E_Plan]] 场景 3

## 反爬 caveats

- 412 是 IP-based，单设备触发后影响整设备同一 IP 网络的其他抖音操作 5-15 分钟
- msToken / __ac_nonce 在 cookie 中刷新但 EncryptedSharedPreferences 持久的是登录时刻值；passport endpoint 不依赖这俩 (是 X-Bogus 才依赖)，但若 sessionid 同步过期则一起失效
- 抖音的 ttwid 是 device fingerprint 长期不变；缺它直接 412

## stub 占位

`androidTest/.../A8DouyinE2ETest.kt` 8 个测试方法已 `@Ignore` 占位，每个含 TODO 链接到本计划对应章节。

## 不在本 plan 范围

- v0.3 X-Bogus / msToken 签名
- 私信 / 评论 (隐私敏感)
- 性能 perf 测试
- 跨账号切换 (用户体验问题，非测试范畴)

## 关联文档

- `docs/design/A8_Bilibili_E2E_Plan.md` — 8 场景模板基线
- `docs/design/A8_Xhs_E2E_Plan.md` — 同 v0.2 但 surface 更宽 (3 fetcher + X-S)
- memory `pdh_social_collector_test_gap_audit.md` — 4-platform JVM 已落，E2E stub-only
- memory `pdh_social_webview_deeplink_cookie_capture.md` — WebView 一键登录 deep-link 协议

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E 测试计划。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文「范围」。A8 抖音 v0.3 真机 E2E 测试计划，覆盖 profile + history/favourite/like 采集路径（需 `X-Bogus` + `_signature` 签名），共 8 个场景。

### 2. 核心特性

8 个 E2E 场景；`DouyinSignBridge`（hidden WebView 跑 acrawler.js 取 X-Bogus + _signature）；JVM 单测已通，真机 E2E 待跑。

### 3. 系统架构

见 `Adapter_Social_Cookie.md`（A8 通用设计）+ `A8_Bilibili_E2E_Plan.md`（8 场景模板基线）。

### 4. 系统定位

A8 抖音 adapter 的**真机 E2E 验收计划**（v0.3 加签名 surface）。

### 5. 核心功能

见正文「8 个 E2E 场景」（登录 / 同步 profile / cookie 过期 / 反爬 412 / WebView 取消 / 幂等 / keystore / 退登重登）。

### 6. 技术架构

cookie + X-Bogus/_signature 签名（acrawler.js）；ApiClient 3 endpoint（history/favourite/like）；androidTest stub `A8DouyinE2ETest.kt`。

### 7. 系统特点

Win dev box 跑 JVM 单测 ✅（`DouyinApiClientV03Test` 等），真机 E2E 需 Mac/Linux + 真机 + 真账号。

### 8. 应用场景

adapter 上线前真机验收（含签名接通后的 history/favourite/like）。

### 9. 竞品对比

与 `A8_Xhs_E2E_Plan.md`（surface 更宽 + X-S）、`A8_Toutiao_E2E_Plan.md`（同 v0.3 模板）同套蓝图。

### 10. 配置参考

见正文「前置（一次性）」与「v0.3 待补（X-Bogus 签名接通后）」。

### 11. 性能指标

见正文「反爬 caveats」（412 反爬、签名稳定性）；性能单独 perf plan。

### 12. 测试覆盖

本文即测试覆盖：8 个 E2E 场景 + JVM 单测（已通）；E2E stub @Ignore 占位。

### 13. 安全考虑

场景 7 EncryptedSharedPreferences keystore corruption；cookie + 签名高敏感。

### 14. 故障排除

见正文异常场景：cookie 过期 status_code≠0（场景 3）、反爬 412（场景 4）、WebView 取消（场景 5）。

### 15. 关键文件

androidTest `A8DouyinE2ETest.kt`；`DouyinSignBridge` / `DouyinApiClient`。

### 16. 使用示例

见正文「执行方式」。

### 17. 相关文档

见正文「关联文档」：`A8_Bilibili_E2E_Plan.md`、`A8_Xhs_E2E_Plan.md`、memory `pdh_social_collector_test_gap_audit.md`、`pdh_social_webview_deeplink_cookie_capture.md`。
