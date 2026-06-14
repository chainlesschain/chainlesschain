# A8 小红书 (Xhs) — 真机 E2E 测试计划

**Status**: v0.2 计划 (2026-05-24) — stub `A8XhsE2ETest.kt` 已落，真机执行需 Mac/Linux + Android 真机 + 真账号；Win dev box 无法运行。

## 范围

A8 v0.2 端到端覆盖 Xiaohongshu 完整路径：

```
WebView 登录 → SocialCookieWebViewScreen 提取 cookie (a1 / web_session / webId / xsecappid)
   ↓
HubLocalViewModel.syncXhs()
   ↓
XhsLocalCollector.snapshot()
   ↓ XhsApiClient × 4:
   ↓   me      /api/sns/web/v1/user/me           (cookie-only, 无 X-S)
   ↓   notes   /api/sns/web/v2/user_posted       (X-S + X-T required)
   ↓   liked   /api/sns/web/v1/note/like/page    (X-S + X-T required)
   ↓   follows /api/sns/web/v1/user/follow/list  (X-S + X-T required)
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-xhs.json
   ↓
LocalCcRunner.syncAdapter("social-xhs", path)
   ↓ mksh 起 in-APK cc 子进程
   ↓ cc hub sync-adapter --input <path> --json
   ↓ adapter._syncViaSnapshot → registry → 本机 SQLCipher LocalVault
   ↓
UI 显示 "已同步 N 条 (笔记 + 点赞 + 关注)"
```

## 前置（一次性）

1. 真小红书账号 (账号有 ≥1 篇发布笔记 + ≥1 篇点赞过的笔记 + ≥1 个关注)
2. Mac/Linux dev box (Win 不能跑 adb / Android SDK)
3. 真 Android 设备
4. APK 已 bundle in-APK cc + PDH ≥ 0.3.0
5. 网络抓包工具 (Charles / mitmproxy) — 模拟 461 / 风控场景

## 9 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到"小红书"卡片，状态"未登录"
3. 点"登录"→ WebView 加载 `https://www.xiaohongshu.com/` (banner 推"一键登录"，**不**推扫码)
4. 用真账号登录 (短信 / 一键登录)
5. WebView 跳到 `www.xiaohongshu.com` 主页 → ChainlessChain 命中 isLoginSuccess
6. 提取 cookie + 调 `/api/sns/web/v1/user/me` 拿 user_id + nickname → 关 WebView

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片状态变"已登录 <nickname>"
- `pdh_social_xhs` EncryptedSharedPreferences 中 `cookie` / `userId` / `displayName` / `a1` 全非空
- a1 字段独立持久 (X-S 算法依赖)

### 场景 2 — 同步 3 类数据成功

**前置**: 场景 1 已完成

**步骤**:
1. 在卡片点"同步"
2. ~10-25s 后 (3 个 X-S 端点 sequential)，toast "social-xhs 同步完成 (+N 事件)"
3. 卡片显示"上次同步: <时间> (+N 事件)"

**断言**:
- N ≥ 3 (至少各类 1 条)
- vault 中可见 originalId 前缀 `xhs:note:` / `xhs:liked:` / `xhs:follow:`
- 子进程日志含 3 类 fetcher 完成行 (不应有 sentinel "-461" 或 "code 460")

### 场景 3 — X-S 签名失败 (code 461 / -461)

**前置**: 已登录但 X-S 算法漂移 (xhs 升级风控算法后 v0.2 算法不再被接受)

**模拟**:
- Charles 拦 `/api/sns/web/v2/user_posted` 返 `{ "code": 460, "msg": "invalid signature" }`
- 或返 HTTP 461

**步骤**:
1. 点"同步"

**断言**:
- 同步不抛异常 (catch sentinel)
- 卡片显示"X-S 签名失败 — 笔记接口 (code=460)。请提交 issue 或等待 v0.3 算法更新。"
- 其他 2 个端点 (liked / follows) 仍能跑 (degraded mode)
- ingested 数 < 期望，但不为 0

### 场景 4 — Cookie 过期

**前置**: 已登录，cookie 主动失效

**步骤**:
1. `adb shell run-as com.chainlesschain.android rm -rf app_webview/Cookies*`
2. 或等 14 天自然过期
3. 点"同步"

**断言**:
- `/api/sns/web/v1/user/me` 返 `{ "code": -101 }` 或 `{ "data": null }`
- 卡片显示"账号未登录 — cookie 已过期"
- 点"退出登录"清除本地 store
- 点"登录"进 WebView，仍是登录页

### 场景 5 — WebView 取消登录

**步骤**:
1. 全新装 APK
2. 点"登录"进 WebView
3. 在小红书登录页不输任何信息，点系统返回键

**断言**:
- WebView 关闭返回卡片列表
- 状态仍"未登录"
- 无 toast 错误，无 errorMessage
- store 中 cookie / a1 字段空

### 场景 6 — 部分 fetcher 失败 (一个 5xx)

**前置**: 已登录，3 fetcher 中 1 个被代理拦截

**模拟**:
- Charles 规则: 拦截 `/api/sns/web/v1/user/follow/list` 返 503，其他放行

**步骤**:
1. 点"同步"

**断言**:
- 同步完成不抛异常
- 卡片显示"+M 事件"，M < 总数 (缺 follows 那部分)
- lastErrorCode 透出 503
- notes / liked 正常入库

### 场景 7 — 反复同步幂等性

**前置**: 已登录 + 已同步过一次

**步骤**:
1. 立即再点"同步"
2. 再点一次

**断言**:
- 三次 sync 后 `vault.queryItems()` 数量不变 (同 noteId 走 UPSERT)
- 三次 sync 后 `vault.queryPersons()` 数量不变 (关注的人去重)
- events 表累积 3 倍 (每次 sync 一次 browse-like)
- 子进程日志中 originalId 在 raw_events 表有 dedup

### 场景 8 — EncryptedSharedPreferences keystore corruption

**模拟**: 改 `pdh_social_xhs.xml` 让 AES-256-GCM 解密失败

**步骤**:
1. `adb shell` 进 app data dir，备份 `pdh_social_xhs.xml`
2. 手改 xml 文件 1 byte
3. 重启 app

**断言**:
- App 不 crash
- 小红书卡片显"未登录"
- Timber log 含 "XhsCredentialsStore: read failed"
- 用户能重新登录恢复

### 场景 9 — 退出登录 + 重新登录

**步骤**:
1. 已登录点"退出登录"
2. 卡片状态变"未登录"
3. 点"登录"
4. 重新登录同一账号
5. 同步

**断言**:
- 退出后 EncryptedSharedPreferences 中 cookie / userId / a1 全空
- 重新登录 userId 同上次
- 同步成功

## 执行方式

- **手动**: 按 9 场景逐一跑，每个 ~5-10 分钟，总 ~1.5h
- **自动化**: 暂不可 (小红书登录需短信 / 扫码)
- **CI**: 仅跑场景 5 + 8 (非真账号)；其余手动

## 反爬 caveats

- X-S 算法每月可能 rotate — 如果场景 3 在新版本机器上是"基线"现象 (而非异常)，说明 v0.2 算法已腐烂，需升 v0.3
- a1 cookie 在 WebView 登录后稳定，但每登一次都会 rotate；store 持久的是登录时刻的 a1
- 461 short-band 触发后短 IP 封禁 5-15 分钟，测试间留 buffer

## stub 占位

`androidTest/.../A8XhsE2ETest.kt` 9 个测试方法已 `@Ignore` 占位，每个含 TODO 链接到本计划对应章节。

## 不在本 plan 范围

- v0.3 X-S 算法升级 (引入 b1 + a1.tail)
- 笔记内容深度解析 (当前只入 note 元数据，正文 v0.3 加 OCR + 长文截取)
- 私信 / 评论采集 (隐私敏感，v1.0 + 用户显式同意 gate)
- 性能 perf 测试 (单独 plan)

## 关联文档

- `docs/design/A8_Bilibili_E2E_Plan.md` — 同 v0.1 模板，差异点在 X-S 签名层
- `docs/design/Adapter_Social_Cookie.md` — A8 通用设计
- memory `pdh_social_collector_test_gap_audit.md` — 4-platform / 33 JVM 案例已落，E2E 仍 stub
- memory `pdh_social_webview_deeplink_cookie_capture.md` — WebView 一键登录 deep-link 协议

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E 测试计划。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文「范围」。A8 小红书 v0.2 真机 E2E 测试计划，覆盖 Xiaohongshu 完整路径（含 `X-S` 签名），同步 3 类数据，共 9 个场景。

### 2. 核心特性

9 个 E2E 场景（比其它平台多 X-S 签名失败场景）；3 类数据 fetcher；stub `A8XhsE2ETest.kt` 已落（@Ignore 占位）。

### 3. 系统架构

见 `Adapter_Social_Cookie.md`（A8 通用设计）+ `A8_Bilibili_E2E_Plan.md`（同 v0.1 模板，差异在 X-S 签名层）。

### 4. 系统定位

A8 小红书 adapter 的**真机 E2E 验收计划**（带 X-S 签名复杂度）。

### 5. 核心功能

见正文「9 个 E2E 场景」（登录 / 同步 3 类 / X-S 签名失败 / cookie 过期 / WebView 取消 / 部分 fetcher 失败 / 幂等 / keystore / 退登重登）。

### 6. 技术架构

cookie + `X-S` 签名（code 461/-461 失败）；3 类 fetcher（surface 较宽）；stub `A8XhsE2ETest.kt`。

### 7. 系统特点

Win dev box 无法跑真机 E2E（需 Mac/Linux + 真机 + 真账号）；X-S 签名是最大复杂度来源。

### 8. 应用场景

adapter 上线前真机验收（重点验 X-S 签名稳定性）。

### 9. 竞品对比

是其它 A8 平台 plan 的「签名复杂度上限」参照（见 `A8_Douyin_E2E_Plan.md` / `A8_Weibo_E2E_Plan.md` 互引）。

### 10. 配置参考

见正文「前置（一次性）」。

### 11. 性能指标

见正文「反爬 caveats」；性能 perf 测试单独 plan。

### 12. 测试覆盖

本文即测试覆盖：9 个 E2E 场景；4-platform / 33 JVM 案例已落，E2E 仍 stub @Ignore。

### 13. 安全考虑

场景 8 EncryptedSharedPreferences keystore corruption；cookie + X-S 签名高敏感。

### 14. 故障排除

见正文异常场景：X-S 签名失败 461/-461（场景 3）、cookie 过期（场景 4）、WebView 取消（场景 5）、部分 fetcher 5xx（场景 6）。

### 15. 关键文件

androidTest `A8XhsE2ETest.kt`；`Adapter_Social_Cookie.md`。

### 16. 使用示例

见正文「执行方式」。

### 17. 相关文档

见正文「关联文档」：`A8_Bilibili_E2E_Plan.md`、`Adapter_Social_Cookie.md`、memory `pdh_social_collector_test_gap_audit.md`、`pdh_social_webview_deeplink_cookie_capture.md`。
