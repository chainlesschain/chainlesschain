package com.chainlesschain.android.pdh.social.kuaishou

import android.content.Context
import com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 7.6 — credentials store for the **Android in-APK root** Kuaishou
 * collector (path B, mirror of Xhs/Weibo Mode B template).
 *
 * **v0.1 风险与 Xhs 并列最高**: per plan §6.6 (`PDH_Mode_B_Phase_7_Plan.md`),
 * Kuaishou Mode B = "自研加密可能 + **libmsaoaidsec.so 反 frida 极高** + 极低
 * 公开 schema 资料 → 推 defer v2.0+". v0.1 ship 是 user-explicit "Mode B 全面
 * 5 平台" override; 真机大概率命中 `likely-sqlcipher` banner 跳 v2.0 路径。
 *
 * Two stores **coexist** for Kuaishou:
 *
 *  - [KuaishouCredentialsStore] (path A) — cookies + uid + passToken
 *    + NS_sig3 a1 (签名 SDK param). **Don't migrate or touch this**;
 *    wired by HubLocalViewModel for the cookies + GraphQL 签名 flow.
 *
 *  - [KuaishouRootCredentialsStore] (this, path B) — uid only. Path B
 *    reads `/data/data/com.smile.gifmaker/databases/*.db` directly via root.
 *
 * Schema (from [BaseRootCredentialsStore] base):
 *   - "uid"             : Kuaishou uid (numeric string)
 *   - "lastSyncAtMs"    : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount"   : Int total events written by last sync
 *   - "lastErrorCode"   : Int non-zero on last failure
 *   - "lastErrorMessage": String? human-readable failure tail
 *
 * Unique `prefs_name`: `pdh_social_kuaishou_root` — distinct from path-A
 * `pdh_social_kuaishou`.
 *
 * uid validation in [saveKuaishouAccount] — Kuaishou uid is a numeric
 * string (typically 8-10 digits for modern accounts). Min 6 to be
 * conservative (legacy account floor).
 */
@Singleton
class KuaishouRootCredentialsStore @Inject constructor(
    @ApplicationContext context: Context,
) : BaseRootCredentialsStore(context, PREFS_NAME) {

    /**
     * Save the Kuaishou uid (same value path A's
     * [KuaishouCredentialsStore.getUid] returns).
     *
     * Throws IllegalArgumentException via [BaseRootCredentialsStore.saveAccount]
     * if uid is blank. Additionally validates the all-digit shape.
     */
    fun saveKuaishouAccount(uid: String) {
        require(uid.isNotBlank()) { "uid must not be blank" }
        require(uid.length >= 6 && uid.all { it.isDigit() }) {
            "uid must be a numeric string of >=6 digits (got len=${uid.length}: '${uid.take(20)}…')"
        }
        saveAccount(uid)
    }

    companion object {
        /**
         * Unique to path-B Kuaishou. **Must NOT collide with path-A
         * `pdh_social_kuaishou`.** Both stores can be populated
         * simultaneously — one for cookies + NS_sig3 signing, one for
         * root db extraction.
         */
        private const val PREFS_NAME = "pdh_social_kuaishou_root"
    }
}
