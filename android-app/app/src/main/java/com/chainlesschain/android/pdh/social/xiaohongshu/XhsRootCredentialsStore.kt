package com.chainlesschain.android.pdh.social.xiaohongshu

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 7.5 — credentials store for the **Android in-APK root** Xhs
 * collector (path B, mirror of Weibo/Toutiao/Bilibili Mode B template).
 *
 * **v0.1 风险最高**: per plan §6.5 (`PDH_Mode_B_Phase_7_Plan.md`), Xhs Mode B
 * = "可能 SQLCipher + **libshield.so 反 frida** + 极低公开 schema 资料 → 推
 * defer v2.0+". v0.1 ship 作为 user-explicit "全面 5 平台" override; 期望
 * 大多数真机会触发 `likely-sqlcipher` banner 跳 v2.0 路径，少数走通明文 db。
 *
 * **关键差异 (vs Weibo/Bilibili 数字 uid)**: Xhs `user_id` 是 24-char hex
 * string (ObjectId-like, e.g. "5e8c8f7e1234567890abcdef")。Path A
 * `XhsCredentialsStore.getUserIdStr()` 已是这种形态; Mode B 直接复用。
 *
 * Two stores **coexist** for Xhs:
 *
 *  - [XhsCredentialsStore] (path A) — cookies + uid Long + userIdStr +
 *    a1 (X-S signing param) + displayName. **Don't migrate or touch
 *    this**; wired by HubLocalViewModel for the cookies + 签名 flow.
 *
 *  - [XhsRootCredentialsStore] (this, path B) — userIdStr only.
 *    Path B reads `/data/data/com.xingin.xhs/databases/*.db` directly
 *    via root.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"             : Xhs user_id (24-char hex string)
 *   - "lastSyncAtMs"    : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"   : Int total events written by last sync
 *   - "lastErrorCode"   : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_xiaohongshu_root` — distinct from
 * path-A `pdh_social_xiaohongshu`.
 *
 * uid validation in [saveXhsAccount] — Xhs `user_id` is 24-char
 * lowercase hex (BSON ObjectId convention from MongoDB-backed user table).
 * Some legacy uids may use uppercase; accept both case for safety.
 */
@Singleton
class XhsRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Xhs user_id (same 24-char hex value path A's
     * [XhsCredentialsStore.getUserIdStr] returns).
     *
     * Throws IllegalArgumentException if userIdStr is blank or doesn't
     * match the 24-char hex shape.
     */
    fun saveXhsAccount(userIdStr: String) {
        require(userIdStr.isNotBlank()) { "user_id must not be blank" }
        require(USER_ID_PATTERN.matches(userIdStr)) {
            "user_id must be 24-char hex string (got len=${userIdStr.length}: '${userIdStr.take(30)}…')"
        }
        saveAccount(userIdStr)
    }

    companion object {
        /**
         * Unique to path-B Xhs. **Must NOT collide with path-A
         * `pdh_social_xiaohongshu`.** Both stores can be populated
         * simultaneously — one for cookies + a1 + signed HTTP, one for
         * root db extraction.
         */
        private const val PREFS_NAME = "pdh_social_xiaohongshu_root"

        /**
         * BSON ObjectId regex — 24 lowercase/uppercase hex chars. Xhs
         * canonical form is lowercase; accept uppercase too to absorb
         * legacy account drift.
         */
        private val USER_ID_PATTERN = Regex("^[0-9a-fA-F]{24}$")
    }
}
