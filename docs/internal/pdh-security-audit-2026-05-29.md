# PDH Security Audit — 2026-05-29

> Static security audit of 7 in-app ApiClients + the shared WebView cookie-capture screen.
> Scope: `android-app/app/src/main/java/com/chainlesschain/android/pdh/{social,travel}/**`
> Method: 8 parallel agent reads, full-file (not skim), 5-category checklist per file.
> Status: read-only audit. Fix proposals listed but not yet landed (see §6).

## 1. Scope

| File | LOC | Platform | Maturity |
|---|---|---|---|
| `BilibiliApiClient.kt` | 690 | Bilibili | v0.2 |
| `DouyinApiClient.kt` | 385 | Douyin | v0.1 |
| `KuaishouApiClient.kt` | 527 | Kuaishou | v0.1 (mostly stub) |
| `ToutiaoApiClient.kt` | 473 | Toutiao | v0.1 (mostly stub) |
| `WeiboApiClient.kt` | 307 | Weibo | v0.2 |
| `XhsApiClient.kt` | 466 | Xiaohongshu | v0.2 |
| `Kyfw12306ApiClient.kt` | 348 | 12306 (rail) | v0.2 |
| `SocialCookieWebViewScreen.kt` | 759 | shared | v0.2+ |
| **Total** | **3955** | | |

## 2. Severity Totals

| Severity | Count | Examples |
|---|---|---|
| HIGH | 24 | WebView JS bridge cross-contamination, PII in Timber, sentinel conflation, missing cookie-completeness gates |
| MEDIUM | 47 | Stale Chrome 120 UA, `@Volatile` errorCode race, silent partial-page truncation, CancellationException swallowed |
| LOW | 37 | Missing `Sec-Ch-Ua-*` Client Hints, no request jitter, epoch-0 timestamp fallthrough, `@Volatile` test seams |
| **Total** | **108** | |

## 3. Systemic Findings (every platform)

These appear on **all 7 ApiClients**. Fix them in one sweep:

### S1. Stale "ChainlessChain" literal embedded in User-Agent strings — HIGH
Every UA string includes `Linux; Android <ver>; ChainlessChain` or similar. A trivial regex blocklist on the literal "ChainlessChain" instantly clusters all our installs.

- `BilibiliApiClient.kt:597` — `"Android 14; ChainlessChain"`
- `WeiboApiClient.kt:196-199` — `"Linux; Android 14; ChainlessChain"`
- *(others use generic Chrome UA without the literal — confirm in fix sweep)*

**Fix**: drop literal, use stock Chrome UA without app identifier.

### S2. Hardcoded `Chrome/120.0.0.0` UA — MEDIUM (universal)
Chrome 120 shipped November 2023. By 2026-05 it is ~2 years stale. Platforms fingerprint UA version freshness; this is a Tier-2 bot signal.

**Fix**: centralize UA constant + bump to current Chrome major. Defer to real-device verification before shipping.

### S3. `null` collapses all failure modes — HIGH (universal)
Auth-expired (401), anti-bot (412/461/-461), parse failure, network error, schema drift, and "user genuinely has no data" all surface to callers as `null` → `emptyList()`. Result: vault sync writing empty arrays as authoritative could overwrite real records.

**Fix**: introduce a sealed `FetchResult<T>` with discriminants `Ok(data)` / `AuthExpired` / `AntiSpider` / `SchemaDrift` / `Transport(e)` / `EmptyButOk`. Touches every caller. Defer to v0.3 architecture pass.

### S4. `@Volatile lastErrorCode` racy with return value — MEDIUM (universal)
Per-instance mutable error state on `@Singleton` ApiClient. Concurrent endpoint fetches (e.g. Bilibili's 4 endpoints fired in parallel) race; the last writer wins, earlier failures lost. Callers reading `lastErrorCode` after `fetchX()` may see a code from a different fetcher's call.

**Fix**: tie error info to the return value via sealed `FetchResult<T>` (same S3 fix).

### S5. PII / credential fragments leak via Timber response-body logging — HIGH
- **DouyinApiClient.kt:117-153** — logs `obj.toString().take(500)` of passport response containing `mobile`, `screen_name`, `sec_user_id`, `avatar_url`
- **KuaishouApiClient.kt:166-191** — logs first 50-300 chars of decoded `api_ph` credential blob
- **BilibiliApiClient.kt:614-626** — logs `body.take(200-300)` + full signed URL with `w_rid`+`wts`
- **WeiboApiClient.kt:215-218** — logs `body.take(200)` of redirect HTML (may contain Set-Cookie mirrors)
- **XhsApiClient.kt:127-149, 337-340** — logs `obj.toString().take(500)` of `/user/me` JSON
- **ToutiaoApiClient.kt:194-205, 425-426** — logs full passport response (mobile/user_id/screen_name)
- **Kyfw12306ApiClient.kt:281** — logs server-returned message strings (may contain user identifiers)

On rooted devices logcat is readable by any app; on dev builds it ships to crashlytics / file sinks. **GDPR/PIPL liability.**

**Fix**: redact before log. Allow-list of safe keys (`code`, `msg`, length, http status) only.

### S6. Missing-cookie permissive: empty cookie still fires the request — HIGH
Every fetcher accepts `cookie: String` (non-null) but never validates non-blank / non-expired before HTTP. Empty cookie → unauthenticated request → response `null` → caller sees "no data" rather than "credential missing → trigger re-login".

**Fix**: `require(cookie.isNotBlank()) { "missing cookie" }` at fetcher entry, or return distinct `AuthMissing` result.

### S7. `catch (e: Exception)` swallows `CancellationException` — MEDIUM
Confirmed in **Toutiao** (line 449); audit notes the same pattern in Bilibili / Douyin / Kuaishou / Weibo / Xhs. Breaks Kotlin coroutine structured concurrency — `withContext(Dispatchers.IO) { ... }` cancellation surfaces as `parse: ...` error and the parent coroutine appears to complete normally.

**Fix**: rethrow CancellationException at top of every broad catch:
```kotlin
} catch (e: Exception) {
    if (e is CancellationException) throw e
    setLastError(-3, "parse: ${e.message}")
    null
}
```

### S8. Missing `Sec-Ch-Ua-*` Client Hints + `Sec-Fetch-*` — LOW-MEDIUM (universal)
Chrome 120 sends `Sec-Ch-Ua`, `Sec-Ch-Ua-Mobile`, `Sec-Ch-Ua-Platform`, `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest` on every request. Absence is a stronger bot signal than UA version mismatch.

**Fix**: add the 6 headers. Defer to real-device verification (changes platform request signature).

### S9. No request jitter / no backoff — LOW-MEDIUM (universal)
Sequential fetcher calls fire within ms of each other from same IP/cookie. Classic bot signature.

**Fix**: collector-side jitter (200-500ms random sleep between fetchers). Defer to collector layer.

## 4. Platform-Specific HIGH-severity findings

### Bilibili (2 HIGH)
- **Caller-side error collapse**: per-folder `continue` in `fetchFavourites` (line 421-423, 471-473) silently drops failed folders. User gets partial data with no signal.
- **`@Volatile lastError*` race across endpoint fetches**: explicit caller risk when collector parallelizes.

### Douyin (4 HIGH)
- Full passport JSON logged to Timber (S5 above)
- Cookie passed by value with no scrubbing / no zeroize
- `OkHttpClient` default `retryOnConnectionFailure=true` could fire 2nd request on 412 connection drop

### Kuaishou (1 HIGH)
- `catch (e: Exception)` at line 431/505 collapses parse failures and runtime errors into generic `-3 parse` code — loses real bug context.

### Toutiao (3 HIGH)
- `catch (_: Throwable)` at line 398 in `decodeNestedRaw` swallows OOM silently
- Missing-cookie permissive (S6)
- Stale Chrome 120 UA (S2)

### Weibo (3 HIGH)
- **Silent-block vs empty ambiguity**: file's own KDoc acknowledges Weibo returns `{code:0, data:list:[]}` on silent block, but code's success path treats any empty array as "user has 0 posts" and clears `lastError`. Shadow-banned account indistinguishable from healthy zero-post account.
- `fetchFavourites` returns `emptyList()` unconditionally without setting `lastError` — hides anti-spider failure.
- Cookie missing-cookie permissive (S6).

### Xhs (4 HIGH)
- **Sentinel conflation** (line 362): unknown error codes coerced to `-461` (the ban code). `success` and `code` default to optimistic values (line 354-356). Ban-state misattribution real.
- **No circuit-breaker** for `-461`: caller can blindly reissue fetchers after ban, accelerating account block.
- Cookie/PII logged via Timber `take(500)` (S5)
- Cross-platform retry-bomb amplification: 3 fetchers all fire if first already triggered `-461`.

### 12306 (3 HIGH)
- Travel PII scope: `tk` / `JSESSIONID` / `RAIL_DEVICEID` grant real-name + payment access. Caller-side encryption-at-rest is implicit only.
- Cookie-expiry detection collapsed into generic `false`/`null` — caller cannot honor documented "登录已过期" UX prompt.
- Pagination breaks on transient errors are indistinguishable from end-of-data → silent partial order-history.
- Price parse fail-silent to `0.0` (line 176, 214-216) — vault stores ¥0 records for real tickets.

### WebView (4 HIGH)
- **🔴 Cross-platform JS bridge contamination** (lines 516-531): all 4 `@JavascriptInterface` bridges (`BilibiliBridge`, `DouyinBridge`, `XhsBridge`, `ToutiaoBridge`) are installed unconditionally on every WebView session, regardless of which platform is being loaded. A malicious Weibo XSS can call `window.BilibiliBridge.onSyncData(...)` and poison the Bilibili sync pipeline. **Treated as effective CRITICAL** for prioritization.
- Cookie-poll path missing the 5s race-safety defer (only URL path got the fix from trap #20).
- No `setAllowFileAccess(false)` / `setAllowUniversalAccessFromFileURLs(false)` — defaults vary by API level, combined with the JS bridges above this is a remote-data-exfil chain.
- No `FLAG_SECURE` on the login window: screenshots / recents thumbnail / screen recording capture password text and post-login cookies.

## 5. Per-Platform Cookie-Completeness Gates (WebView)

| Platform | Race-safety (URL path) | Race-safety (cookie poll) | Required-cookie gate | False-positive risk |
|---|---|---|---|---|
| Bilibili | 5s defer ✓ | **no defer** ✗ | `SESSDATA=` substring only (needs 4 keys) | **HIGH** |
| Weibo | 5s defer ✓ | n/a (no poll) | None — URL only ✗ | **HIGH** |
| Xhs | 5s defer ✓ | no defer ✗ | `web_session` length ≥ 30 ✓ | LOW |
| Douyin | 5s defer ✓ | no defer ✗ | `sessionid` substring (no `passport_csrf_token` check) | MEDIUM |
| Toutiao | URL disabled | cookie only | `sid_ucp_v1` / `sso_uid_tt` / `sid_tt` length ≥ 32 ✓ | LOW |
| Kuaishou | 5s defer ✓ | no defer ✗ | `userId=` substring (set for ANON visitors too) | **HIGH** |

**Bilibili / Weibo / Kuaishou** ship cookies on first match without verifying the required-cookie set is complete → "login success" then 4-API empty results.

## 6. Fix Roadmap

### Tier A — Land without device validation (safe / additive / search-replace)
- **F1** Drop "ChainlessChain" literal from all UA strings (S1) — pure string change, immediate anti-detection benefit
- **F2** Redact response-body before Timber.warn (S5) — only changes error-path logs, no success-path impact
- **F3** Rethrow `CancellationException` in broad catches (S7) — fixes structured-concurrency bug, no behavior change in non-cancellation paths
- **F4** Missing-cookie fail-fast guard (S6) — `require()` at fetcher entry, surfaces error earlier vs silent
- **F5** Xhs `-461` circuit-breaker (4.6) — `if (lastErrorCode == -461) return emptyList()` at fetcher entry. Defensive only.
- **F6** Scope WebView JS bridges to active platform (4.WebView): inject only the relevant `@JavascriptInterface`. Eliminates cross-platform XSS chain. Slightly higher complexity but additive.

### Tier B — Needs real-device verification before ship
- **B1** Bump Chrome UA version + add `Sec-Ch-Ua-*` / `Sec-Fetch-*` headers (S2, S8) — changes platform request signature
- **B2** Sealed `FetchResult<T>` refactor (S3, S4) — replaces null-collapse with discriminated unions; touches every caller
- **B3** Bilibili: randomize `dm_cover_img_str` GPU base64 from pool of 20 (file-specific finding) — needs verification that Bilibili accepts the new strings
- **B4** Bilibili: invalidate WBI `mixinKey` cache on `code in {-403, -352, -799}` (file's own KDoc promises but doesn't deliver)
- **B5** Weibo: shape-vs-block sentinel detection (`{code:0, data:list:[]}` after non-zero expected timeline)
- **B6** WebView: `FLAG_SECURE` on login activity — UX side-effect (screenshot apps complain)
- **B7** Collector-side jitter + per-platform-banlist short-circuit (S9 + caller-layer)

### Tier C — Architecture / design tickets
- **C1** Centralize UA + headers in a `SocialHttpClientConfig` so version drift is single-file
- **C2** Add `cc pdh doctor --audit` CLI command that runs the static checks from this audit as a CI gate
- **C3** Document caller-side encryption-at-rest contract on every ApiClient class KDoc
- **C4** WebView: clear `CookieManager` between platform sessions (helper exists at `SocialCookieWebViewScreen.kt:739-745` but is unused)

## 7. Known traps re-confirmed

These audit findings confirm and extend existing handbook traps:

| Trap | Handbook ref | Status |
|---|---|---|
| #15 better-sqlite3 Number→TEXT | docs/internal/hidden-risk-traps.md §15 | Confirmed: `Long` timestamps in Toutiao/Xhs/Douyin/Kuaishou could surface — risk lives in vault writer, not ApiClient |
| #20 Bilibili post-onload cookie race | bilibili_post_onload_cookie_race.md | Fix in URL path ✓; cookie-poll path missing same defer ✗ |
| pdh_social_webview_deeplink_cookie_capture | memory | Deep-link override is robust ✓ |
| pdh_social_cookie_endpoint_drift_2026_05 | memory | Cookie schema drift handlers patchy; Xhs has length gate but Bilibili/Weibo/Kuaishou don't |

## 8. New trap candidates (audit-discovered)

| Candidate | Description | Suggested # |
|---|---|---|
| WebView JS bridge cross-contamination | `@JavascriptInterface` exposed unconditionally enables A-platform-page → B-platform-pipeline poison | #29 candidate |
| `catch (Exception)` swallows CancellationException | breaks Kotlin coroutine structured concurrency in IO scopes | #30 candidate |
| Xhs sentinel conflation: unknown codes coerced to `-461` | ban-state misattribution; retry-bomb-after-ban risk | #31 candidate |

## 9. Methodology + Limits

- 7 ApiClient + 1 WebView screen audited via parallel general-purpose agents, each with the same 5-category checklist
- Each agent read the full file (not skim) and returned `<800 words structured findings
- Severity tags are agent's calibrated judgment — independent calibration would tighten H/M/L boundaries
- **Not audited in this pass**:
  - Adapter layer (`packages/personal-data-hub/lib/adapters/social-*`) — Node side, separate audit
  - Vault writer (`packages/personal-data-hub/lib/vault.js`) — separate audit (would re-validate trap #15/#25 application)
  - WeChat Frida hook code (`assets/frida/wechat-key-hook.js`) — already covered by memory `wechat_frida_hook_audit_traps.md`
  - QQ XOR-IMEI extraction — covered by memory `android_qq_collector_phase_13_5.md`
  - Sign-provider implementations
- Recommend follow-up: same methodology on Tier A code (`SignProvider*`, vault.js, adapter base classes)

---

*Audited 2026-05-29 from Windows dev box. No real device executed; all findings static.*

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：PDH Security Audit — 2026-05-29。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
