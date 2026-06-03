package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * 本机 child 身份解析 (FAMILY-20 ForegroundAppTimer).
 *
 * 把「本机是否 CHILD 角色」(RolePreferencesRepository) 与「本机 DID」(DIDManager)
 * 收敛到一个可 fake 的接口, 让 [ForegroundAppTimer] 不直接依赖具象 DIDManager
 * (无法在 JVM 单测构造)。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.telemetry.RoleAwareChildIdentityProvider]。
 */
interface ChildIdentityProvider {

    /**
     * @return 本机 child DID, 当且仅当本机角色为 CHILD 且已建立 DID 身份;
     *   否则 null (家长端 / 未选角色 / 未建身份 → 不采集前台 app)。
     */
    suspend fun childDidOrNull(): String?
}
