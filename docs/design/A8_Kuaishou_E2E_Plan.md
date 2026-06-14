# A8 快手 (Kuaishou) — 真机 E2E 测试计划

**Status**: v0.3 计划 (2026-05-25 update) — v0.2 stub `A8KuaishouE2ETest.kt` 已落；v0.3 新增 `KuaishouSignBridge` (hidden WebView 跑 NS_sig3 + kpf/kpn) + ApiClient GraphQL POST 3 endpoint (visionFeedRecommend / visionProfilePhotoList / visionSearchPhoto) + collector fan-out。Win dev box JVM 单测 (`KuaishouApiClientV03Test` + `KuaishouLocalCollectorV03Test`) ✅；真机 E2E 仍需 Mac/Linux + 真机 + 真账号。

## 范围

**v0.3 surface** (本轮新增):
- ✅ profile (cookie-parse `kuaishou.web.cp.api_ph`, v0.2 已通)
- 🆕 watch history → KIND_WATCH (`visionFeedRecommend` GraphQL, 需 `__NS_sig3` + kpf/kpn headers)
- 🆕 profile photos → KIND_COLLECT (`visionProfilePhotoList`, 用户自己发的视频)
- 🆕 search history → KIND_SEARCH (`visionSearchPhoto` with empty keyword)

NS_sig3 由 `KuaishouSignBridge` 在登录 cookie 注入后的 hidden WebView 里跑平台自带签名 JS — probe 4 候选 (`window.__APP__.encryptParams` / `window.NS.sign` / `window.GraphQL.fetch.sign` / `window.__SIGN__`)，与 Toutiao/Douyin (ByteDance acrawler 家族) 完全不同。signing JS 输入是 URL + operationName + 完整 POST body (GraphQL spec)，输出 `{__NS_sig3, kpf, kpn}`：__NS_sig3 进 URL 查询，kpf/kpn 进 header。Bridge 单 JS eval 产双输出，单槽缓存配对调用 (signUrl → signedHeaders 严格相等命中)。

**GraphQL POST 形态** vs Toutiao/Douyin GET：ApiClient 走 `/graphql` POST + JSON body，doPostJson helper 处理 GraphQL errors (`{errors:[...]}` → lastErrorCode=-5)。三个 endpoint 同 endpoint 不同 operationName，区分靠 body.operationName 字段。

**Graceful degrade**：
- bridge warmUp 失败 → 跳过 3 个 v0.3 端点, v0.2 profile (cookie-parse) 仍 emit
- signUrl 返 null (函数名 rotate / NS_sig3 算法漂) → 短路 (不发 HTTP), lastErrorCode=-99
- GraphQL errors → lastErrorCode=-5 + 错误消息 propagate

`v03Attempted` 字段在 `SnapshotResult.Ok` 透出。UI banner 三档与 Toutiao/Douyin 对齐。

```
WebView 登录 → SocialCookieWebViewScreen 提取 cookie
   ↓   (userId / kuaishou.web.cp.api_ph / did / passToken)
HubLocalViewModel.syncKuaishou()
   ↓
KuaishouLocalCollector.snapshot()
   ↓ KuaishouApiClient.fetchProfile (无 HTTP — 解 api_ph cookie JSON)
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-kuaishou.json (1 profile event 或 0)
   ↓
LocalCcRunner.syncAdapter("social-kuaishou", path)
   ↓ adapter._syncViaSnapshot → person-self with kuaishou-uid + kuaishou-id identifiers
   ↓
UI 显示 "已同步账号 profile (v0.2)。推荐/收藏/搜索需 v0.3 NS_sig3 接通"
```

## 前置（一次性）

1. 真快手账号 (v0.2 不需要内容，但 cookie 必须含 api_ph — 同手机一键登录路径稳定产出，扫码登录可能缺)
2. Mac/Linux dev box
3. 真 Android 设备
4. APK 已 bundle in-APK cc + PDH ≥ 0.3.0
5. （场景 7 / 8 需）能编辑 EncryptedSharedPreferences 的 root shell

**注意**: 因 v0.2 无网络调用，反爬场景（412 / NS_sig3 失败）**不在 E2E 范围内** — 这些只能等 v0.3 接通 GraphQL 后才有意义。

## 8 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到"快手"卡片，状态"未登录"
3. 点"登录"→ WebView 加载 `https://www.kuaishou.com/`（banner 推一键登录 deep-link）
4. 用真账号登录 — **推荐"本机一键登录"，扫码登录可能缺 api_ph**
5. WebView 跳到 `www.kuaishou.com` 主页 → ChainlessChain 命中 isLoginSuccess
6. 提取 cookie + 调 fetchProfile 解 api_ph JSON → 关 WebView

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片状态变"已登录 <user_name>"
- `pdh_social_kuaishou` EncryptedSharedPreferences 中 `cookie` / `uid` / `displayName` 全非空
- cookie 中 `userId` + `kuaishou.web.cp.api_ph` 字段都在
- displayName 是 api_ph JSON 里的 user_name（不是 fallback "(unnamed)"）

### 场景 2 — 同步 profile 成功（cookie-parse 路径）

**前置**: 场景 1 已完成

**步骤**:
1. 在卡片点"同步"
2. ~1-3s 后 (纯本地 cookie parse 无网络)，toast "social-kuaishou 同步完成 (+1 事件)"
3. 卡片显示"上次同步: <时间>"
4. banner 文本提示"已同步账号 profile（v0.2 含昵称/头像 cookie 解析）。推荐/收藏/搜索需 v0.3 NS_sig3 签名接通。"

**断言**:
- `+1` 是 profile event (KIND_PROFILE)
- vault 中可见 `person-kuaishou-<uid>` 记录
- person.identifiers 含 `kuaishou-uid` + `kuaishou-id`（快手 ID 字符串别名）
- person.extra 含 avatarUrl / sex / city / constellation / description（不是 followingCount/followerCount — 这些 cookie 没有，v0.3 GraphQL 才能拿）
- 子进程日志含"social-kuaishou snapshot ok (profileCount=1)"

### 场景 3 — Cookie 缺 api_ph (-8 missing)

**前置**: 已登录但 cookie 不含 `kuaishou.web.cp.api_ph`（某些跨端登录路径会跳过 api_ph 写入，例如扫码登录）

**模拟**:
- 全新 APK，scroll WebView 到"扫码登录"用 PC 扫码（**不**用一键登录）
- 或 `adb shell run-as com.chainlesschain.android` 编辑 cookie 文件删除 api_ph

**步骤**:
1. 点"同步"

**断言**:
- profile 返 null，lastErrorCode = -8
- 卡片显示"缺 api_ph cookie — 请用一键登录而非扫码"或 "登录数据不完整"
- 但 `account.uid` 仍持有（extractUid 拿到 userId），不是完全未登录态
- 同步 result 是 Ok with profileCount=0，不是 NoCredentials

### 场景 4 — api_ph 非 JSON (-9 non-JSON payload)

**前置**: 已登录但 api_ph 被快手新版改成 base64 / opaque token（未来可能发生）

**模拟**:
- `adb shell run-as` 改 EncryptedSharedPreferences 让 api_ph 字段是 base64-like 字符串

**步骤**:
1. 点"同步"

**断言**:
- profile 返 null，lastErrorCode = -9
- 卡片显示"api_ph 解码后非 JSON (likely base64 — v0.3 加 fallback)"
- 不 crash
- v0.3 计划: 加 base64 解码 fallback 路径

### 场景 5 — WebView 取消登录

**步骤**:
1. 全新装 APK
2. 点"登录"进 WebView
3. 在快手登录页不操作，按系统返回键

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
- raw_events 表只有 1 行 (profile originalId 是 `kuaishou:profile:<uid>`)
- 同步速度稳定 ~1-3s (纯本地)

### 场景 7 — EncryptedSharedPreferences keystore corruption

**模拟**: 改 `pdh_social_kuaishou.xml` 让 AES-256-GCM 解密失败

**步骤**:
1. `adb shell` 进 app data dir，备份 xml
2. 手改 1 byte
3. 重启 app

**断言**:
- App 不 crash
- 快手卡片显"未登录"
- Timber log 含 "KuaishouCredentialsStore: read failed"
- 用户能重新登录恢复

### 场景 8 — 退出登录 + 重新登录

**步骤**:
1. 已登录点"退出登录"
2. 卡片状态变"未登录"
3. 点"登录"重登同一账号
4. 同步

**断言**:
- 退出后 store 中 cookie / uid / displayName 全空
- 重新登录 uid 同上次 (同账号)
- 同步成功，person 记录同 ID (走 UPSERT 不是新建)
- 重新登录后 api_ph cookie 重新 rotate，但 user_id 字段不变

## 执行方式

- **手动**: 按 8 场景逐一跑，每个 ~3-8 分钟，总 ~1h
- **自动化**: 暂不可 (快手登录需短信 / 一键 / 扫码)
- **CI**: 仅跑场景 5 + 7 (非真账号)；其余手动

## v0.3 待补 (NS_sig3 接通后)

- `/graphql visionFeedRecommend` 推荐流 — 新场景: events 含 BROWSE 子类 (watch)
- `/graphql visionProfilePhotoList` 主页 / 收藏 — 新场景: events 含 LIKE 子类 (collect)
- `/graphql visionSearchPhoto` 搜索历史 — 新场景: events 含 SEARCH/POST 子类
- `/graphql currentUser` 动态 following/follower counts — 新场景: person.extra 包含动态计数
- NS_sig3 签名漂移 — 新场景类比 Xhs X-S 失败 + Douyin X-Bogus 漂移
- HTTP 反爬 412 — 新场景 (v0.2 无网络不需要)

## 反爬 caveats (v0.3 用)

- NS_sig3 比 X-Bogus 复杂，每月可能 rotate；v0.3 需 WebView JS injection 而非纯 Kotlin 端口
- visitor_id 是 cookie 字段，每登一次 rotate；NS_sig3 签名输入依赖它
- 单 IP 短时间频繁 GraphQL 请求触发"网络繁忙" 5-10 分钟封锁

## stub 占位

`androidTest/.../A8KuaishouE2ETest.kt` 8 个测试方法已 `@Ignore` 占位。

## 关联文档

- `docs/design/A8_Douyin_E2E_Plan.md` — 同 v0.2 profile-only 但走 HTTP passport endpoint (不同实现)
- `docs/design/A8_Toutiao_E2E_Plan.md` — 同 v0.2 profile-only 通过 HTTP passport endpoint
- memory `pdh_social_collector_test_gap_audit.md` — 6 platform 测试覆盖审计
- memory `pdh_social_webview_deeplink_cookie_capture.md` — WebView 一键登录 deep-link 协议（快手 banner 必须推一键而非扫码）

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E 测试计划。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文「范围」。A8 快手 v0.3 真机 E2E 测试计划，覆盖 profile（cookie-parse `api_ph`）+ watch/visionProfile/search 采集（GraphQL，需 `__NS_sig3` + kpf/kpn），共 8 个场景。

### 2. 核心特性

8 个 E2E 场景；`KuaishouSignBridge`（hidden WebView 跑 NS_sig3 + kpf/kpn）；GraphQL POST 3 endpoint；JVM 单测已通。

### 3. 系统架构

见 `Adapter_Social_Cookie.md`（A8 通用设计）；profile 走 cookie-parse、列表走 GraphQL 签名路径。

### 4. 系统定位

A8 快手 adapter 的**真机 E2E 验收计划**（v0.3 GraphQL 签名 surface）。

### 5. 核心功能

见正文「8 个 E2E 场景」（登录 / profile cookie-parse / 缺 api_ph / api_ph 非 JSON / WebView 取消 / 幂等 / keystore / 退登重登）。

### 6. 技术架构

cookie `api_ph` 解析 + `__NS_sig3` GraphQL 签名；ApiClient GraphQL POST（visionFeedRecommend / visionProfilePhotoList / visionSearchPhoto）；stub `A8KuaishouE2ETest.kt`。

### 7. 系统特点

Win dev box 跑 JVM 单测 ✅，真机 E2E 需 Mac/Linux + 真机 + 真账号；登录 banner 必须推一键而非扫码。

### 8. 应用场景

adapter 上线前真机验收（含 NS_sig3 接通后的 watch/search）。

### 9. 竞品对比

与 `A8_Douyin_E2E_Plan.md` / `A8_Toutiao_E2E_Plan.md`（HTTP passport profile）同套蓝图，签名路径各异。

### 10. 配置参考

见正文「前置（一次性）」与「v0.3 待补（NS_sig3 接通后）」。

### 11. 性能指标

见正文「反爬 caveats（v0.3 用）」；性能单独 perf plan。

### 12. 测试覆盖

本文即测试覆盖：8 个 E2E 场景 + JVM 单测（已通）；E2E stub @Ignore 占位。

### 13. 安全考虑

场景 7 EncryptedSharedPreferences keystore corruption；cookie + 签名高敏感。

### 14. 故障排除

见正文异常场景：缺 api_ph（-8，场景 3）、api_ph 非 JSON（-9，场景 4）、WebView 取消（场景 5）。

### 15. 关键文件

androidTest `A8KuaishouE2ETest.kt`；`KuaishouSignBridge` / `KuaishouApiClient`。

### 16. 使用示例

见正文「执行方式」。

### 17. 相关文档

见正文「关联文档」：`A8_Douyin_E2E_Plan.md`、`A8_Toutiao_E2E_Plan.md`、memory `pdh_social_collector_test_gap_audit.md`、`pdh_social_webview_deeplink_cookie_capture.md`。
