package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 2b — credentials store for the **Android in-APK root** Douyin
 * collector (path B, mirror of the Node desktop path C in
 * `packages/personal-data-hub/lib/adapters/social-douyin-adb/`).
 *
 * Two stores **coexist** for Douyin:
 *
 *  - [DouyinCredentialsStore] (v0.2) — cookies + sec_user_id for the
 *    WebView + passport endpoint path. **Don't migrate or touch this**;
 *    it's wired up by HubLocalViewModel for the cookies flow.
 *
 *  - [DouyinRootCredentialsStore] (this) — uid only (19-digit numeric
 *    from `<uid>_im.db` filename). Path B doesn't need cookies because
 *    we read the SQLite db directly via root.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"            : 19-digit Douyin uid (matches filename pattern)
 *   - "lastSyncAtMs"   : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"  : Int total events written by last sync
 *   - "lastErrorCode"  : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_douyin_root` — distinct from the
 * cookies-path store `pdh_social_douyin` so they can't collide.
 *
 * uid validation in [saveAccount] — 19 digits is the canonical Douyin
 * shape but the parser is defensive: any all-digit string ≥ 16 chars is
 * accepted (Douyin has historically used 16-19 digit uids; some accounts
 * created via WeChat-binding flow are shorter).
 */
@Singleton
class DouyinRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Douyin uid (the 19-digit numeric one — matches the
     * `<uid>_im.db` filename and what passport/account/info/v2 returns
     * as `user_id`).
     *
     * Throws IllegalArgumentException via [BaseRootCredentialsStore.saveAccount]
     * if uid is blank. Additionally validates the all-digit shape — we
     * reject obvious mistakes (e.g. a sec_user_id "MS4wLj..." being
     * passed in) early so the path-B collector's ls + filename match
     * doesn't silently fail later.
     */
    fun saveDouyinAccount(uid: String) {
        require(uid.isNotBlank()) { "uid must not be blank" }
        require(uid.length >= 16 && uid.all { it.isDigit() }) {
            "uid must be a numeric string of ≥16 digits (got len=${uid.length}: '${uid.take(20)}…')"
        }
        saveAccount(uid)
    }

    companion object {
        /**
         * Unique to path-B Douyin. **Must NOT collide with the cookies-path
         * `pdh_social_douyin` (DouyinCredentialsStore).** Both stores can
         * be populated simultaneously — one for cookies/profile, one for
         * root db extraction — and switching paths shouldn't clobber the
         * other's state.
         */
        private const val PREFS_NAME = "pdh_social_douyin_root"
    }
}
