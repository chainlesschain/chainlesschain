package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * [ChildIdentityProvider] 默认实装: 角色 + DID 双闸 (FAMILY-20).
 *
 * 仅当本机 [RoleLockState] 解析出 [AppRole.CHILD] (LockPending 或 Locked) 且
 * [DIDManager] 已建身份时返 child DID; 否则 null (家长端 / 未选 / 未建身份)。
 */
@Singleton
class RoleAwareChildIdentityProvider @Inject constructor(
    private val didManager: DIDManager,
    private val rolePreferencesRepository: RolePreferencesRepository,
) : ChildIdentityProvider {

    override suspend fun childDidOrNull(): String? {
        val role = rolePreferencesRepository.observeLockState().first().selectedRole()
        if (role != AppRole.CHILD) return null
        return didManager.getCurrentDID()
    }

    /** Unselected → null; LockPending / Locked → 已选角色。 */
    private fun RoleLockState.selectedRole(): AppRole? = when (this) {
        is RoleLockState.LockPending -> role
        is RoleLockState.Locked -> role
        RoleLockState.Unselected -> null
    }
}
