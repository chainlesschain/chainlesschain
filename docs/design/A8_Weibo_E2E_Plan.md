# A8 微博 (Weibo) — 真机 E2E 测试计划

**Status**: v0.2 计划 (2026-05-24) — stub `A8WeiboE2ETest.kt` 已落，真机执行需 Mac/Linux + Android 真机 + 真账号；Win dev box 无法运行。

## 范围

A8 v0.2 端到端覆盖 m.weibo.cn (移动端) 完整路径：

```
WebView 登录 → SocialCookieWebViewScreen 提取 cookie (SUB / SUBP / _T_WM)
   ↓
HubLocalViewModel.syncWeibo()
   ↓
WeiboLocalCollector.snapshot()
   ↓ WeiboApiClient × 4:
   ↓   config     /api/config                                            (cookie 验登录 + 拿 uid)
   ↓   posts      /api/container/getIndex?type=uid&value=<uid>&containerid=107603<uid>
   ↓   favourites /api/favorites?page=1
   ↓   follows    /api/friendships/friends?uid=<uid>&page=1
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-weibo.json
   ↓
LocalCcRunner.syncAdapter("social-weibo", path)
   ↓ adapter._syncViaSnapshot → registry → SQLCipher LocalVault
   ↓
UI 显示 "已同步 N 条 (微博 + 收藏 + 关注)"
```

## 前置（一次性）

1. 真微博账号 (账号有 ≥1 条原创微博 + ≥1 条收藏 + ≥1 个关注)
2. Mac/Linux dev box (Win 不能跑 adb / Android SDK)
3. 真 Android 设备
4. APK 已 bundle in-APK cc + PDH ≥ 0.3.0
5. 抓包工具 (Charles / mitmproxy) — 模拟 -100 silentband / 5xx 场景

## 8 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到"微博"卡片，状态"未登录"
3. 点"登录"→ WebView 加载 `https://passport.weibo.cn/signin/login`（移动端）
4. 用真账号登录 (密码 / 短信 / 一键)
5. 登录成功后 WebView 跳到 `m.weibo.cn` 主页 → ChainlessChain 命中 isLoginSuccess
6. 提取 cookie + 调 `/api/config` 拿 uid → 关 WebView

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片状态变"已登录 UID:<你的uid>"
- `pdh_social_weibo` EncryptedSharedPreferences 中 `cookie` / `uid` 全非空
- cookie 中 `SUB` / `SUBP` 字段都在（核心凭证）

### 场景 2 — 同步 3 类数据成功

**前置**: 场景 1 已完成

**步骤**:
1. 在卡片点"同步"
2. ~10-20s 后 (3 个 fetcher sequential)，toast "social-weibo 同步完成 (+N 事件)"
3. 卡片显示"上次同步: <时间> (+N 事件)"

**断言**:
- N ≥ 3 (至少各类 1 条)
- vault 中可见 originalId 前缀 `weibo:post:` / `weibo:favourite:` / `weibo:follow:`
- 子进程日志含 3 类 fetcher 完成行
- 时间字段正确解析（ISO 8601 "Sun Jan 12 13:45:00 +0800 2026" → epoch-ms）

### 场景 3 — Cookie 过期 (-100 silentband)

**前置**: 已登录，cookie SUB 失效

**模拟**:
- `adb shell run-as com.chainlesschain.android rm -rf app_webview/Cookies*`
- 或 Charles 拦 `/api/config` 返 `{"ok": 0, "code": -100, "msg": "请先登录"}`

**步骤**:
1. 点"同步"

**断言**:
- config 端点返 ok=0，lastErrorCode=-100
- 卡片显示"账号未登录 — cookie 已过期 (code=-100)"
- 不调后续 3 个 fetcher（fail-fast）
- 点"退出登录"清除本地 store
- 点"登录"进 WebView，仍是登录页

### 场景 4 — WebView 取消登录

**步骤**:
1. 全新装 APK 或退出登录后
2. 点"登录"进 WebView
3. 在微博登录页不输任何信息，点系统返回键 / 顶部"取消"

**断言**:
- WebView 关闭返回卡片列表
- 微博卡片状态仍是"未登录"
- 无 toast 错误，无 errorMessage
- EncryptedSharedPreferences 中 cookie 字段空

### 场景 5 — 部分 fetcher 失败 (一个 5xx)

**前置**: 已登录，1 fetcher 被拦

**模拟**:
- Charles 规则: 拦截 `/api/friendships/friends` 返 503，其他放行
- 或拦 `/api/favorites` 返 30x 重定向到登录页（触发 -100 silentband）

**步骤**:
1. 点"同步"

**断言**:
- 同步完成不抛异常
- 卡片显示"+M 事件"，M < 总数 (缺 follows 那部分)
- lastErrorCode 透出 503 (或 -100)
- posts / favourites 正常入库
- 子进程日志含 OkHttp warn "503 on /api/friendships/friends"

### 场景 6 — 反爬 anti-cookie-hijack burst

**模拟**: 短时间内连续 5 次同步触发"网络繁忙"

**步骤**:
1. 已登录状态点"同步" 5 次（间隔 < 5s）

**断言**:
- 第 3-5 次同步部分 fetcher 返"网络繁忙"或 30x 重定向
- 卡片显示反爬提示，不 crash
- 等待 5 分钟后再同步可恢复
- collector sequential await 防止并发触雷（按 design 设计）

### 场景 7 — 反复同步幂等性

**前置**: 已登录 + 已同步过一次

**步骤**:
1. 立即再点"同步"
2. 再点一次

**断言**:
- 三次 sync 后 `vault.queryItems()` 数量不变（同 mid 走 UPSERT）
- 三次 sync 后 `vault.queryPersons()` 数量不变（关注的人去重）
- events 表累积 3 倍 (每次 sync 一次 browse-like)
- raw_events 表 dedup 正常

### 场景 8 — EncryptedSharedPreferences keystore corruption

**模拟**: 改 `pdh_social_weibo.xml` 让 AES-256-GCM 解密失败

**步骤**:
1. `adb shell` 进 app data dir，备份当前 xml
2. 手改 1 byte
3. 重启 app

**断言**:
- App 不 crash
- 微博卡片显"未登录"
- Timber log 含 "WeiboCredentialsStore: read failed"
- 用户能重新登录恢复

## 执行方式

- **手动**: 按 8 场景逐一跑，每个 ~5-10 分钟，总 ~1.2h
- **自动化**: 暂不可 (微博登录需短信 / 扫码 / 一键)
- **CI**: 仅跑场景 4 + 8 (非真账号)；其余手动

## 反爬 caveats

- m.weibo.cn (移动端) 反爬比 weibo.com (桌面端) 宽松，无 X-Bogus / WBI 强制要求
- 单 IP 短时间频繁请求触发"网络繁忙"封锁 5-15 分钟
- 时间字段格式不稳定：某些 endpoint 返 "刚刚" / "5 分钟前" 字符串，需 fallback 到 createdAtMs 字段
- SUB cookie 是 Base64 加密复合 token，不要尝试解码取 uid（不稳定），必须走 /api/config

## v0.3 待补 (按需)

- 桌面端 weibo.com WBI / X-Bogus 签名接通后增加场景：转发 / 评论 / 长微博正文 OCR
- 私信采集（隐私敏感，v1.0 + 用户显式同意 gate）
- 群组 / 超话采集

## stub 占位

`androidTest/.../A8WeiboE2ETest.kt` 8 个测试方法已 `@Ignore` 占位，每个含 TODO 链接到本计划对应章节。

## 关联文档

- `docs/design/A8_Bilibili_E2E_Plan.md` — 4-fetcher 全 sync 模板基线（同套蓝图）
- `docs/design/A8_Xhs_E2E_Plan.md` — 同 v0.2 但带 X-S 签名复杂度
- memory `pdh_social_collector_test_gap_audit.md` — 6 platform 测试覆盖审计
- memory `pdh_social_webview_deeplink_cookie_capture.md` — WebView 一键登录 deep-link 协议
