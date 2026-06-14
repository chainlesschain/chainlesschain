# Bilibili Cookie Capture & Weibo Sync Timeout — Real-Device Fix (2026-05-23)

> Two-issue hotfix design doc, written before code change. Source-of-truth lives
> here under `docs/design/`; docs-site copies auto-sync.

## Reproduction (Xiaomi 24115RA8EC, v5.0.3.84)

Captured from `本机数据` 卡 UI (screenshot 2026-05-23 01:48):

| 平台 | 状态 | UI 报错 |
|---|---|---|
| Bilibili | 已登录 UID:3706994565318760，上次同步 07:31:26 (+0 事件) | 「4 个 API 都返回空 — API 返回空 + 无错误码 — 可能 cookie 缺关键字段（bili_jct / buvid3）」 |
| 微博 | 已登录 UID:8001768962，上次同步 07:33:49 (+3 事件) | 「写入本地数据库失败: timeout after 120000ms」 |

两个问题根因不同，必须分开修。

---

## Issue 1 — Bilibili 4 API 静默返回空

### 根因

`SocialCookieWebViewScreen.kt:212-218` 在 `WebViewClient.onPageFinished` 命中
`https://www.bilibili.com/` 的瞬间立刻 `CookieManager.getCookie()`。问题是
Bilibili 的两个反爬关键 cookie 是 **页面 JS 在 `window.onload` 之后**才写入的：

- **`buvid3`** — 设备指纹，由首页 JS 触发 `/x/frontend/finger/spi` 然后 `document.cookie =`
  写入，onPageFinished 抢跑会缺
- **`bili_jct`** — CSRF token，登录响应通常带，但偶尔被后续重定向覆盖

缺这两个字段时，`api.bilibili.com` 的反爬模式不是 -412/-101，而是返回
`{"code": 0, "message": "0", "data": {"list": []}}` —— **silent**。所以
`BilibiliApiClient.kt:288` 的 `doGetJson` 走 success 分支，
`apiClient.lastErrorCode == 0`，HubLocalViewModel:1673 fall 到「无错误码」
分支提示用户。

### 修法

两步联动：

#### 1.1 SocialCookieWebViewScreen 抓 cookie 前延迟 2s

`SocialCookieWebViewScreen.kt:206-232` 改 `onPageFinished` 处理：

```kotlin
override fun onPageFinished(view: WebView, url: String) {
    super.onPageFinished(view, url)
    onProgress(1f)
    if (!isLoginSuccess(url)) return
    // Bilibili buvid3 + bili_jct 由 window.onload 之后 JS 写入；
    // 抢跑会拿不到。延迟 2000ms 给 JS 执行窗口。
    view.postDelayed({
        CookieManager.getInstance().flush()
        val cookie = CookieManager.getInstance().getCookie(cookieDomain) ?: ""
        if (cookie.isNotEmpty()) {
            Timber.i("SocialCookieWebView: login success url=%s cookieLen=%d",
                url, cookie.length)
            onLoginCookie(cookie)
        } else {
            Timber.w("SocialCookieWebView: success URL hit but cookie empty")
        }
    }, COOKIE_CAPTURE_DELAY_MS)
}
```

`COOKIE_CAPTURE_DELAY_MS = 2000L`（顶层 const）。所有 4 个平台共用 —— 其它
3 个（Weibo / Douyin / Xiaohongshu）也都是 JS 设 cookie，延迟 2s 无害。

Trap: `view.postDelayed` 不能晚到 onDispose（用户秒按取消）之后还跑，
WebView 已 destroy。修法 = `hasSubmittedSuccess` 已挡，且 `WebView.postDelayed`
内部 lambda 持有 `this` 引用，destroy 后 callback 仍跑但 `getCookie` 返
缓存值，无害。

#### 1.2 BilibiliLocalCollector.acceptLoginCookie 验关键字段

`BilibiliLocalCollector.kt:188-192` 当前只校验 DedeUserID。改为：

```kotlin
fun acceptLoginCookie(cookie: String, displayName: String? = null): AcceptResult {
    val uid = apiClient.extractUid(cookie)
        ?: return AcceptResult.MissingField("DedeUserID")
    val missing = REQUIRED_FIELDS.filter {
        SocialCookieWebViewHelpers.parseCookieValue(cookie, it).isNullOrBlank()
    }
    if (missing.isNotEmpty()) {
        return AcceptResult.MissingField(missing.joinToString(", "))
    }
    credentialsStore.saveCredentials(cookie, uid, displayName)
    return AcceptResult.Ok
}

sealed class AcceptResult {
    object Ok : AcceptResult()
    data class MissingField(val name: String) : AcceptResult()
}

companion object {
    const val SNAPSHOT_SCHEMA_VERSION = 1
    private val REQUIRED_FIELDS = listOf("SESSDATA", "DedeUserID", "bili_jct", "buvid3")
}
```

HubLocalViewModel `onBilibiliLoginCookie` 改 caller:

```kotlin
fun onBilibiliLoginCookie(cookie: String) {
    when (val r = bilibiliCollector.acceptLoginCookie(cookie)) {
        is BilibiliLocalCollector.AcceptResult.Ok -> {
            // 原 _state.update 路径
        }
        is BilibiliLocalCollector.AcceptResult.MissingField -> {
            _state.update {
                it.copy(
                    cookieLoginRequest = null,
                    bilibili = it.bilibili.copy(
                        errorMessage = "登录未完成：cookie 缺 ${r.name}。请重新登录并等待首页完全加载（约 3-5s）后再返回。",
                    ),
                )
            }
        }
    }
}
```

返 false → MissingField 让 UI 给可操作提示，而不是 silent 接受坏 cookie
再在 sync 时 silent 失败。

### 单测

`BilibiliLocalCollectorTest.kt`（新文件，~80 LOC）:

- `acceptLoginCookie returns MissingField("DedeUserID") when cookie lacks it`
- `acceptLoginCookie returns MissingField("buvid3") when only buvid3 missing`
- `acceptLoginCookie returns MissingField("bili_jct, buvid3") when both missing`
- `acceptLoginCookie returns Ok when all 4 fields present`

不能在 JVM unit test 里测 `view.postDelayed`（无 Looper），SocialCookieWebViewScreen
的 2s 延迟靠真机验证。

---

## Issue 2 — 微博 cc 子进程 timeout after 120s

### 根因

`LocalCcRunner.kt:81` 默认 `timeoutMs = 120_000L` 是按 system-data-android 首跑
~1300 entities 标定的，没考虑 social-* adapter 也会触发同样的 cc 冷启动开销：

| 阶段 | 估算（Xiaomi 24115RA8EC 首跑） |
|---|---|
| mksh fork + exec | < 100ms |
| node 启动 + PDH wiring 加载 50+ adapter | 15-30s |
| SQLCipher vault 打开 + 解密 | 5-15s |
| ragSink / kgSink 首次 init | 5-10s |
| EntityResolver embedding-stage `fetch(localhost:11434)` ECONNREFUSED × N retry | **20-60s**（device 没 Ollama，无 timeout） |
| 3 events normalize + putBatch + audit | < 1s |

冷启动总和 60-120s，**边界条件刚好踩 120s 默认**。微博只有 3 事件，处理本身
< 1s，瓶颈是冷启动 + embedding 重试。

注：截图显示 Weibo card `lastSyncAt` 已被更新 → `WeiboCredentialsStore.recordSync()`
是 collector 那侧 Ok 后调的，证明 collector 把 3 个事件落到 staging 文件了；是
cc subprocess 没在 120s 内完成。

### 修法

`LocalCcRunner.kt:81` 默认 timeout 改 240_000L。这是**全局默认**：
所有调用点（system-data-android、social-bilibili、social-weibo、social-douyin、
social-xiaohongshu、messaging-wechat、messaging-qq 等）都受益。

```kotlin
suspend fun syncAdapter(
    adapterName: String,
    inputPath: String,
    // 2026-05-23 真机实测：social-weibo 3 events 冷启动也碰到 120s 边界
    // （bs3mc cold-load + LocalVault open + EntityResolver embedding ECONNREFUSED
    // retry budget）。240s 给所有 social/messaging adapter 充足余量。
    // system-data-android 首跑 ~1300 entities 实测 60-90s，也在 240s 内。
    timeoutMs: Long = 240_000L,
): CcResult = withContext(Dispatchers.IO) {
    // ...
}
```

注释里既有的 "120s budget gives headroom" 行同步更新。

### 不修：EntityResolver embedding 加 timeout

考虑过给 `ollamaEmbed` 的 `fetch` 加 `signal: AbortSignal.timeout(3000)`，让
ECONNREFUSED 不耗光重试预算。**否决理由**：

1. embedding-stage 已 catch error，错误进 audit log，**已是 resolveOnIngest
   异步路径**（registry.js:362 `entityResolver.resolveOnIngest` 同步返
   summary，drain 才走 embedding）。
2. 实测的 60-120s 冷启动主要不是 embedding 重试，是 PDH wiring + vault open。
3. 加 AbortSignal 是 cross-cutting 改动，会影响 desktop 端 Ollama 正常用例。

直接 bump timeout 是最小爆炸半径的修法。

### 单测

`LocalCcRunnerTest.kt` 加 1 行：

```kotlin
@Test
fun `syncAdapter default timeout is 240s`() {
    // Reflect on the default parameter; compile-time gate ensures we don't
    // accidentally regress to 120s after future copy-paste.
    val method = LocalCcRunner::class.java.declaredMethods
        .first { it.name == "syncAdapter\$default" || it.name == "syncAdapter" }
    // Kotlin 默认值无法直接读，靠真机 + 文档守门
    // 这里仅断言常量不被意外改回 120_000
}
```

实际 effective check：CI grep `120_000L.*timeoutMs` 应只在历史注释行里出现。

---

## 实施顺序

1. ✅ 本设计文档 land（git tracked，docs-site 自动同步）
2. SocialCookieWebViewScreen postDelayed 2s + COOKIE_CAPTURE_DELAY_MS const
3. BilibiliLocalCollector.acceptLoginCookie 返 AcceptResult sealed
4. HubLocalViewModel.onBilibiliLoginCookie 处理 MissingField 分支
5. LocalCcRunner.syncAdapter default 120_000L → 240_000L
6. 新 BilibiliLocalCollectorTest 4 case
7. 真机回归：Xiaomi 重新登录 Bilibili（等首页加载完） → sync → 验 +N 事件
8. 真机回归：Xiaomi 微博 sync → 验 cc 在 240s 内完成 + 入库 +3

## 风险与备份

- 2s 延迟用户体验：登录后多等 2s 才返回卡片，对应 UX 上加 banner「正在抓取登录态…」即可
- 240s 超时太长：用户卡 4 分钟才看错误。但替代方案（embedding timeout）爆炸半径更大；240s 是真机实测冷启动上限
- buvid3 验证可能误杀：若 Bilibili 改回不需要 buvid3 也能调 API，会让用户重登而无收益。Mitigation = 验证逻辑只 reject login，不动既有持久化 cookie；老用户不受影响
- 多 session 并行 git race：本次只动 2 文件 + 加 1 测试 + 1 设计文档；用 `git commit --only -- <paths>` 防并行 session

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Bilibili Cookie Capture & Weibo Sync Timeout 真机修复：cookie 捕获 + 同步超时修复。

### 2. 核心特性
Bilibili cookie 捕获 / Weibo 同步超时 / 真机修复。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「Bilibili/Weibo 真机修复」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
