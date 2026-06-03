package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.preferences.RolePreferencesDataSource
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * FAMILY-04 实装 (FAMILY-60 接权威时间). 时刻基线走 [TimeAuthority.authoritativeNow]
 * 而非设备墙钟 —— 记录 selectedAtMs 与判 24h 锁两端同源, 防孩子调设备时钟把锁"调过期"
 * 提前换角色 (家长配对 + TimeAuthority 同步后, 篡改墙钟无效)。配对前 TimeAuthority
 * 未同步则 authoritativeNow 退墙钟 (= 旧行为 baseline); 单测注入 fake 控制时间。
 *
 * 24h 锁判定: now - selectedAtMs >= LOCK_DURATION_MS → Locked, 否则 LockPending。
 * 上界用 ">=" 而非 ">", 边界恰 24h 即视为已锁。
 */
@Singleton
class RolePreferencesRepositoryImpl @Inject constructor(
    private val dataSource: RolePreferencesDataSource,
    private val timeAuthority: TimeAuthority,
) : RolePreferencesRepository {

    override fun observeLockState(): Flow<RoleLockState> =
        dataSource.observeStoredRole.map { stored ->
            if (stored == null) {
                RoleLockState.Unselected
            } else {
                val now = timeAuthority.authoritativeNow()
                val elapsedMs = now - stored.selectedAtMs
                if (elapsedMs >= LOCK_DURATION_MS) {
                    RoleLockState.Locked(
                        role = stored.role,
                        selectedAtMs = stored.selectedAtMs,
                    )
                } else {
                    RoleLockState.LockPending(
                        role = stored.role,
                        selectedAtMs = stored.selectedAtMs,
                        lockAtMs = stored.selectedAtMs + LOCK_DURATION_MS,
                    )
                }
            }
        }

    override suspend fun select(role: AppRole) {
        dataSource.save(role = role, selectedAtMs = timeAuthority.authoritativeNow())
    }

    override suspend fun tryChangeRole(role: AppRole): Boolean {
        val stored = currentStoredRole() ?: run {
            // No prior selection: treat as fresh select.
            dataSource.save(role = role, selectedAtMs = timeAuthority.authoritativeNow())
            return true
        }
        val now = timeAuthority.authoritativeNow()
        val isLocked = (now - stored.selectedAtMs) >= LOCK_DURATION_MS
        if (isLocked) return false
        dataSource.save(role = role, selectedAtMs = now)
        return true
    }

    override suspend fun reset() {
        dataSource.clear()
    }

    /** 单次取最新值 (非 Flow), 用于 tryChangeRole 这种同步判定路径。 */
    private suspend fun currentStoredRole(): RolePreferencesDataSource.StoredRole? =
        dataSource.observeStoredRole.first()

    companion object {
        const val LOCK_DURATION_MS: Long = 24L * 60L * 60L * 1000L
    }
}
