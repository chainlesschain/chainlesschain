package com.chainlesschain.android.pdh.social.toutiao

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 7.1 — credentials store for the **Android in-APK root** Toutiao
 * collector (path B, mirror of path C
 * `packages/personal-data-hub/lib/adapters/social-toutiao-adb/` and
 * sister of [com.chainlesschain.android.pdh.social.douyin.DouyinRootCredentialsStore]).
 *
 * Two stores **coexist** for Toutiao:
 *
 *  - [ToutiaoCredentialsStore] (path A, v0.2) — cookies + passport_uid
 *    from the WebView + passport/account/info/v2 endpoint. **Don't
 *    migrate or touch this**; wired up by HubLocalViewModel for the
 *    cookies+SignBridge flow.
 *
 *  - [ToutiaoRootCredentialsStore] (this, path B) — uid only. Path B
 *    reads `/data/data/com.ss.android.article.news/databases/*.db`
 *    directly via root; doesn't need cookies because we're not making
 *    HTTP requests.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"             : Toutiao passport_uid (string of digits)
 *   - "lastSyncAtMs"    : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"   : Int total events written by last sync
 *   - "lastErrorCode"   : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_toutiao_root` — distinct from the
 * path-A store `pdh_social_toutiao` so they can't collide.
 *
 * uid validation in [saveToutiaoAccount] — Toutiao passport_uid is a
 * numeric string. Douyin's 19-digit pattern doesn't apply (Toutiao
 * uids observed in real captures range 10-15 digits).
 */
@Singleton
class ToutiaoRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Toutiao passport_uid (same value as what
     * `passport/account/info/v2/?aid=24` returns as `data.user_id`).
     *
     * Throws IllegalArgumentException via [BaseRootCredentialsStore.saveAccount]
     * if uid is blank. Additionally validates the all-digit shape — we
     * reject obvious mistakes (e.g. a cookie string being passed in)
     * early so the path-B collector's ls + filename match doesn't
     * silently fail later. Min length 6 (Toutiao early accounts have
     * short uids; recent registrations are 10+ digits).
     */
    fun saveToutiaoAccount(uid: String) {
        require(uid.isNotBlank()) { "uid must not be blank" }
        require(uid.length >= 6 && uid.all { it.isDigit() }) {
            "uid must be a numeric string of ≥6 digits (got len=${uid.length}: '${uid.take(20)}…')"
        }
        saveAccount(uid)
    }

    companion object {
        /**
         * Unique to path-B Toutiao. **Must NOT collide with the path-A
         * `pdh_social_toutiao` (ToutiaoCredentialsStore).** Both stores can
         * be populated simultaneously — one for cookies+SignBridge, one
         * for root db extraction — and switching paths shouldn't clobber
         * the other's state.
         */
        private const val PREFS_NAME = "pdh_social_toutiao_root"
    }
}
