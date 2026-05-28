package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.preferences.RolePreferencesDataSource
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * FAMILY-04 实装. Clock 注入而非读 System.currentTimeMillis() 让 24h 锁
 * 可测试 (无需睡 24h, 用 Clock.fixed)。
 *
 * 24h 锁判定: now - selectedAtMs >= LOCK_DURATION_MS → Locked, 否则 LockPending。
 * 上界用 ">=" 而非 ">", 边界恰 24h 即视为已锁。
 */
@Singleton
class RolePreferencesRepositoryImpl @Inject constructor(
    private val dataSource: RolePreferencesDataSource,
    private val clock: Clock,
) : RolePreferencesRepository {

    override fun observeLockState(): Flow<RoleLockState> =
        dataSource.observeStoredRole.map { stored ->
            if (stored == null) {
                RoleLockState.Unselected
            } else {
                val now = clock.millis()
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
        dataSource.save(role = role, selectedAtMs = clock.millis())
    }

    override suspend fun tryChangeRole(role: AppRole): Boolean {
        val stored = currentStoredRole() ?: run {
            // No prior selection: treat as fresh select.
            dataSource.save(role = role, selectedAtMs = clock.millis())
            return true
        }
        val now = clock.millis()
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
