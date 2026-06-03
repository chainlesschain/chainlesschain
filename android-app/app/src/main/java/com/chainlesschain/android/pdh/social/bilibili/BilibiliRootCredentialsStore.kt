package com.chainlesschain.android.pdh.social.bilibili

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 7.2 — credentials store for the **Android in-APK root** Bilibili
 * collector (path B, mirror of [ToutiaoRootCredentialsStore] +
 * [DouyinRootCredentialsStore]).
 *
 * **Plan §6.4 recommendation**: SKIP — Bilibili path A (SESSDATA cookie
 * + api.bilibili.com web-interface) is already the optimal route and
 * adding Mode B has poor ROI. This phase ships v0.1 anyway for
 * completeness as a fallback when api.bilibili.com is unavailable or
 * heavily anti-bot-throttled (no internet / offline mode).
 *
 * Two stores **coexist** for Bilibili:
 *
 *  - [BilibiliCredentialsStore] (path A) — DedeUserID + SESSDATA + bili_jct
 *    + buvid3 etc. from WebView. **Don't migrate or touch this**; wired
 *    by HubLocalViewModel for the cookies + WBI signing flow.
 *
 *  - [BilibiliRootCredentialsStore] (this, path B) — DedeUserID (mid)
 *    only. Path B reads `/data/data/tv.danmaku.bili/databases/` `*.db` files
 *    directly via root; doesn't need cookies because we're not making
 *    HTTP requests.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"             : Bilibili DedeUserID / mid (numeric string)
 *   - "lastSyncAtMs"    : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"   : Int total events written by last sync
 *   - "lastErrorCode"   : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_bilibili_root` — distinct from the
 * path-A store `pdh_social_bilibili` so they can't collide.
 *
 * uid validation in [saveBilibiliAccount] — Bilibili mid is a numeric
 * string. Length: early accounts (2011-2014) can be as short as 4
 * digits; modern accounts (2018+) are typically 8-10 digits; UP主 large
 * accounts up to 12. We accept ≥4 digits to be conservative.
 */
@Singleton
class BilibiliRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Bilibili mid / DedeUserID (same value the path-A cookies
     * carry as `DedeUserID=NNNN`).
     *
     * Throws IllegalArgumentException via [BaseRootCredentialsStore.saveAccount]
     * if uid is blank. Additionally validates the all-digit shape — we
     * reject obvious mistakes (e.g. a SESSDATA cookie blob being passed
     * in) early so the path-B collector's ls + filename match doesn't
     * silently fail later.
     */
    fun saveBilibiliAccount(uid: String) {
        require(uid.isNotBlank()) { "uid must not be blank" }
        require(uid.length >= 4 && uid.all { it.isDigit() }) {
            "uid must be a numeric string of ≥4 digits (got len=${uid.length}: '${uid.take(20)}…')"
        }
        saveAccount(uid)
    }

    companion object {
        /**
         * Unique to path-B Bilibili. **Must NOT collide with path-A
         * `pdh_social_bilibili` (BilibiliCredentialsStore).** Both stores
         * can be populated simultaneously — one for cookies + WBI signing,
         * one for root db extraction — and switching paths shouldn't
         * clobber the other's state.
         */
        private const val PREFS_NAME = "pdh_social_bilibili_root"
    }
}
