# Adapter — Social Cookie 模式（A8）

**Version**: v0.1 (2026-05-22)
**Status**: Bilibili 端到端 ✅；微博 / 抖音 / 小红书 占位卡片 ✅；4 平台等量 v0.2 设计中
**Architecture**: Plan A v0.1 扩展 — Android 完全独立路径，不依赖桌面

## 1. 背景

Plan A v0.1 把 `system-data-android` 一个 adapter 接通了"in-APK cc → 本机 SQLCipher LocalVault" 的离桌面路径。但 Android UI 只有 1 张卡，用户问"其他 app 数据看不见"。A8 把 4 个社交平台（Bilibili / 微博 / 抖音 / 小红书）接到同一条独立路径上。

A8 与 Phase 7.5 Mobile Extraction Layer 的关键差异：

| 维度 | Phase 7.5（device-pull） | **A8（cookie + HTTP）** |
|---|---|---|
| 触发方 | 桌面（adb backup → 解析）| **Android 端 UI** |
| 数据源 | 平台 app 内部 SQLite（root/解锁备份）| 平台 HTTP API（cookie 鉴权）|
| Root 要求 | ⚠️ 需要 root 或 backup-enabled 调试包 | ❌ 不需要 |
| 桌面在线 | ✅ 需要 | ❌ 不需要 |
| 数据全度 | 高（DB 全表）| 中（API 限 paging）|
| 反封风险 | 低（本地读 DB）| 中（HTTP 受反爬监控）|

A8 没有取代 Phase 7.5，两条路径互补 — desktop user 用 7.5，Android 移动用户用 A8。

## 2. 架构

```
┌─────────────────────────────────────────────────────────────┐
│ Android APK                                                 │
│                                                             │
│  ┌─────────────────────────────────────────────┐            │
│  │ Compose UI / HubLocalScreen                 │            │
│  │   ↓ 用户点 "Bilibili 登录"                  │            │
│  │ SocialCookieWebViewScreen (4 平台共用)      │            │
│  │   ↓ 用户登录平台账号                         │            │
│  │ CookieManager.flush + getCookie(domain)     │            │
│  │   ↓ cookie 字符串                            │            │
│  └─────────────────────────────────────────────┘            │
│                ↓                                            │
│  ┌─────────────────────────────────────────────┐            │
│  │ <Platform>CredentialsStore                  │            │
│  │   EncryptedSharedPreferences AES-256-GCM    │            │
│  │   (cookie + uid + lastSyncAt + count)       │            │
│  └─────────────────────────────────────────────┘            │
│                ↓                                            │
│  ┌─────────────────────────────────────────────┐            │
│  │ <Platform>ApiClient (OkHttp + JSON parse)   │            │
│  │   - 4 endpoint 串行 fetch                    │            │
│  │   - cookie 进 Header                         │            │
│  │   - 401/412 视为 anti-bot, 返空              │            │
│  └─────────────────────────────────────────────┘            │
│                ↓                                            │
│  ┌─────────────────────────────────────────────┐            │
│  │ <Platform>LocalCollector (orchestrator)     │            │
│  │   合成 snapshot.json {schemaVersion, events[]}│           │
│  │   写 filesDir/.chainlesschain/staging/      │            │
│  └─────────────────────────────────────────────┘            │
│                ↓                                            │
│  ┌─────────────────────────────────────────────┐            │
│  │ LocalCcRunner.syncAdapter("<adapter>", path) │           │
│  │   mksh → in-APK cc → cc hub sync-adapter    │            │
│  │   --input <path> --json                      │            │
│  └─────────────────────────────────────────────┘            │
│                ↓                                            │
│  ┌─────────────────────────────────────────────┐            │
│  │ @chainlesschain/personal-data-hub (in-APK)  │            │
│  │   <Platform>Adapter._syncViaSnapshot()      │            │
│  │   → registry → 本机 SQLCipher LocalVault    │            │
│  │   → KG triples / RAG docs                   │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                NO desktop connection required
```

## 3. 4 平台对比

| 平台 | login URL | cookie domain | 关键 cookie | API 复杂度 | v0.1 状态 |
|---|---|---|---|---|---|
| Bilibili | `https://passport.bilibili.com/login` | `.bilibili.com` | `SESSDATA + DedeUserID + bili_jct` | 中（SESSDATA 直请求，部分 endpoint WBI）| ✅ 端到端 |
| 微博 | `https://weibo.com/login.php` | `.weibo.com` | `SUB`（JWT 解码 UID）+ `SUBP` | 中 | 🚧 占位 |
| 抖音 | `https://www.douyin.com/` | `.douyin.com` | `sessionid` + `passport_csrf_token` | 高（msToken / X-Bogus 签名）| 🚧 占位 |
| 小红书 | `https://www.xiaohongshu.com/explore` | `.xiaohongshu.com` | `web_session` + `xsec_token` | 高（X-s 签名）| 🚧 占位 |

## 4. Snapshot Schema

通用形状（JS 端读，Kotlin 端写）：

```json
{
  "schemaVersion": 1,
  "snapshottedAt": 1716000000000,
  "account": {
    "uid": "12345",
    "displayName": "alice"
  },
  "events": [
    {
      "kind": "history|favourite|dynamic|follow|...",
      "id": "<stable platform-specific id>",
      "capturedAt": 1715000000000,
      "<flat platform-specific fields>": "..."
    }
  ]
}
```

关键约束：
- `schemaVersion=1` lock — 跨端必须一致，drift → `_syncViaSnapshot` throw "schemaVersion mismatch"
- `events[].kind` 必须在 adapter 的 `VALID_KINDS` 白名单（unknown kind silently skip）
- `events[].id` 缺失时 adapter fallback：`bvid → mid → rid → "unknown-<ts>-<rand>"`
- 字段**平铺**不嵌套（旧 sqlite-mode 的 `payload.row.X` 形状已废弃）

### Bilibili 字段示例

```json
{
  "kind": "history",
  "id": "BV1abc",
  "capturedAt": 1715000000000,
  "title": "Rust 异步学习",
  "bvid": "BV1abc",
  "avid": 42,
  "duration": 600,
  "uploader": "技术UP主",
  "uploaderMid": 100,
  "part": "01 介绍"
}
```

## 5. JS Adapter (snapshot mode)

```js
class BilibiliAdapter {
  constructor(opts = {}) {
    // 完全 stateless — 适合自动注册到 registry
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;
    // ...
  }
  
  async *sync(opts = {}) {
    // 双模式 — 哪个有就用哪个
    if (typeof opts.inputPath === "string") {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    const dbPath = opts.dbPath || this._dbPath;
    if (dbPath) {
      yield* this._syncViaSqlite({ ...opts, dbPath });
      return;
    }
    throw new Error("needs inputPath OR dbPath");
  }
  
  async *_syncViaSnapshot(opts) {
    const snapshot = JSON.parse(fs.readFileSync(opts.inputPath, "utf-8"));
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error("schemaVersion mismatch");
    }
    for (const ev of snapshot.events || []) {
      if (!VALID_KINDS.includes(ev.kind)) continue;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, ev.id || ev.bvid || ev.mid),
        capturedAt: ev.capturedAt,
        payload: { ...ev, account: snapshot.account },
      };
    }
  }
  
  normalize(raw) {
    // kind-dispatched → events / persons / items / topics
    // ...
  }
}
```

完整代码在 `packages/personal-data-hub/lib/adapters/social-bilibili/adapter.js`。

## 6. Kotlin Layer (Bilibili 模板，其他 3 平台对照实现)

### 6.1 SocialCookieWebViewScreen（4 平台共用）

参数化 Composable：
- `loginUrl: String`
- `cookieDomain: String`
- `displayName: String`
- `isLoginSuccess: (url: String) -> Boolean`
- `onLoginComplete: (cookie: String) -> Unit`

核心：
```kotlin
webViewClient = object : WebViewClient() {
    override fun onPageFinished(view: WebView, url: String) {
        if (isLoginSuccess(url)) {
            CookieManager.getInstance().flush()  // force in-memory → disk
            val cookie = CookieManager.getInstance().getCookie(cookieDomain) ?: ""
            if (cookie.isNotEmpty()) onLoginCookie(cookie)
        }
    }
}
```

### 6.2 PlatformApiClient

- 持有 own OkHttpClient（**不**复用 core-network 那份 — 那个带 AuthInterceptor 会被平台反爬）
- 4 endpoint 方法 suspend fun
- 401 / 412 / `code != 0` → null（caller 当 anti-bot 兜底）

### 6.3 PlatformCredentialsStore

- EncryptedSharedPreferences（AES-256-GCM + AndroidKeyStore master）
- 5 字段：cookie / uid / displayName / lastSyncAtMs / lastSyncCount
- 读操作全部 try/catch(Throwable) — 兜底 KeyStore corruption（factory reset / OS upgrade）

### 6.4 PlatformLocalCollector（orchestrator）

```kotlin
suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
    if (!credentialsStore.hasCredentials()) return SnapshotResult.NoCredentials
    val cookie = credentialsStore.getCookie() ?: return NoCredentials
    val uid = credentialsStore.getUid() ?: return NoCredentials
    
    // 串行（不并行 — 避免反爬触发）
    val history = try { apiClient.fetchHistory(cookie) } catch (_) { emptyList() }
    val favs = try { apiClient.fetchFavourites(cookie, uid) } catch (_) { emptyList() }
    val dyns = try { apiClient.fetchDynamics(cookie) } catch (_) { emptyList() }
    val follows = try { apiClient.fetchFollows(cookie, uid) } catch (_) { emptyList() }
    
    // 拼 snapshot.json + 写盘
    val file = File(stagingDir, "social-bilibili.json")
    file.writeText(root.toString(), Charsets.UTF_8)
    return SnapshotResult.Ok(snapshotPath = file.absolutePath, ...)
}
```

## 7. 测试矩阵

| 层 | 测试文件 | 覆盖 |
|---|---|---|
| JS unit | `__tests__/social-bilibili-snapshot.test.js` (12) | adapter 契约 + 4 kind yield + include filter + limit + unknown-kind skip + fallback originalId |
| JS unit (legacy) | `__tests__/social-adapters.test.js` (4 Bilibili tests rewired) | sqlite-mode 保留 + flat-payload 形状 |
| JS integration | `__tests__/integration/social-bilibili-pipeline.test.js` (6) | 4-kind → 真 vault end-to-end + idempotency + partial + schemaVersion mismatch |
| Kotlin unit | `BilibiliApiClientTest` (14) | MockWebServer 4 endpoint + cookie header + 401 + 412 + 缺字段 + mid=0 skip |
| Kotlin unit | `BilibiliLocalCollectorTest` (8) | NoCredentials / 4-kind 全成功 / everythingEmpty / 1 API throw 不影响 / snapshot 字段 contract |
| Kotlin unit | `HubLocalViewModelTest` (15) | login lifecycle + sync paths + globalSyncingAdapter 互斥 |
| Android E2E | `A8BilibiliE2ETest.kt` (8 stub) | 真机手动 — 见 [`A8_Bilibili_E2E_Plan.md`](./A8_Bilibili_E2E_Plan.html) |

## 8. Forward-looking Traps（每个都要扫）

1. **KDoc `/*` 转义** — Kotlin 注释字符串里讨论 URL pattern 时凡含 `*/` 序列会提前关闭 KDoc，建议用反引号 ``` `xxx/...` ``` 或转义 `/\*`。BilibiliApiClient.kt v0.1 命中过（已修）。
2. **OkHttp baseUrl override 时序** — MockWebServer 测试在 `setUp()` 里覆盖 `baseUrl`；如果 client 在构造时 freeze URL，测试全挂。当前实现 `var baseUrl` 公开支持。
3. **CookieManager.flush() 同步语义** — Android API `flush()` 是同步但底层走 IPC 到 WebView 进程；某些 OEM ROM 上 dispose 跟 flush 有 race。单 shot OK，background flush 必须 await callback。
4. **UID 提取位置** — 每平台 unique-id 字段名不同：Bilibili `DedeUserID`、微博 `SUB` 解码、抖音 `sessionid`、小红书需 me 接口。每平台需独立 `extractUid` 实现。
5. **EncryptedSharedPreferences keystore corruption** — Factory reset / OS upgrade 可让 master key 失效，`getString` 抛 `GeneralSecurityException`；store 内 `try/catch(Throwable)` 兜底当未登录。**不要**吞 unrelated exception。
6. **Flat payload vs legacy `{ kind, row }` 套层** — A8 重构后 raw.payload 平铺。任何外部代码若引用 `raw.payload.row.X` 立崩。Bilibili 4 test 已迁；微博/抖音/小红书 v0.2 refactor 时同步迁。
7. **In-APK cc bundle 必含新 adapter** — Plan A v0.1 bundle 默认只 pack `system-data-android`。`node-runtime-bundle.yml` 的 PKGS / 文件清单需要 audit；如未包含，Android UI 同步会失败 — `cc hub list-adapters` 看不到 social-bilibili。

## 9. v0.2 路线图

| 平台 | 工期 | 关键风险 |
|---|---|---|
| 微博 | ~1.5d | SUB JWT 解码 + timeline /api/container/getIndex 调用 |
| 抖音 | ~2d | msToken/X-Bogus 签名 — WebView evaluate `window.byted_acrawler.sign` |
| 小红书 | ~2d | X-s 签名 — 同上需 WebView JS evaluate |
| Bilibili WBI | ~0.5d | 如 wbi-* endpoint 强制启用补 |

实际工期取决于签名算法稳定性 — 平台升级时签名常变。

## 10. 关联

- [`Personal_Data_Hub_Android_Standalone_Cc.md`](./Personal_Data_Hub_Android_Standalone_Cc.html) — Plan A v0.1 主架构
- [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.html) — PDH 整体架构
- [`A8_Bilibili_E2E_Plan.md`](./A8_Bilibili_E2E_Plan.html) — 8 场景真机测试计划
- [`Adapter_Social_Messaging.md`](./Adapter_Social_Messaging.html) — Phase 13 device-pull 模式（互补）

## 11. CHANGELOG

- v0.1 (2026-05-22) — Bilibili 端到端落地 + 微博/抖音/小红书 UI 占位
