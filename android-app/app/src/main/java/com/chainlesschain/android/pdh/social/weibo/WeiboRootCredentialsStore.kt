package com.chainlesschain.android.pdh.social.weibo

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 7.4 — credentials store for the **Android in-APK root** Weibo
 * collector (path B, mirror of [ToutiaoRootCredentialsStore] +
 * [DouyinRootCredentialsStore] + [BilibiliRootCredentialsStore]).
 *
 * **v0.1 assumes 明文 SQLite** per P7.3 §6 prediction (Weibo older
 * codebase, more likely SQLCipher OR plaintext than self-rolled
 * anti-frida like Xhs/Kuaishou). If real-device probe reveals
 * SQLCipher in `app_webview_cache` or self-encrypted DB, v0.2 follows
 * with a `WeiboFridaInjector` + key-derivation hook (mirror of WeChat
 * 12.10 pattern).
 *
 * Two stores **coexist** for Weibo:
 *
 *  - [WeiboCredentialsStore] (path A) — cookies + uid + xsrf-token
 *    from WebView + m.weibo.cn HTTP endpoints. **Don't migrate or touch
 *    this**; wired by HubLocalViewModel for the cookies flow.
 *
 *  - [WeiboRootCredentialsStore] (this, path B) — uid only. Path B
 *    reads `/data/data/com.sina.weibo/databases/` `*.db` files directly via root.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"             : Weibo uid (numeric string, typically 10 digits
 *                         for modern accounts; some legacy 7-9 digit)
 *   - "lastSyncAtMs"    : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"   : Int total events written by last sync
 *   - "lastErrorCode"   : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_weibo_root` — distinct from path-A
 * `pdh_social_weibo`.
 *
 * uid validation in [saveWeiboAccount] — Weibo uid is a numeric string,
 * typically 10 digits. Some legacy accounts 7-9 digits. Min 6 to be
 * conservative.
 */
@Singleton
class WeiboRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Weibo uid (same value path A's WeiboCredentialsStore
     * stores from the cookies extract).
     *
     * Throws IllegalArgumentException via [BaseRootCredentialsStore.saveAccount]
     * if uid is blank. Additionally validates the all-digit shape.
     */
    fun saveWeiboAccount(uid: String) {
        require(uid.isNotBlank()) { "uid must not be blank" }
        require(uid.length >= 6 && uid.all { it.isDigit() }) {
            "uid must be a numeric string of ≥6 digits (got len=${uid.length}: '${uid.take(20)}…')"
        }
        saveAccount(uid)
    }

    companion object {
        /**
         * Unique to path-B Weibo. **Must NOT collide with path-A
         * `pdh_social_weibo`.** Both stores can be populated simultaneously
         * — one for cookies, one for root db extraction.
         */
        private const val PREFS_NAME = "pdh_social_weibo_root"
    }
}
