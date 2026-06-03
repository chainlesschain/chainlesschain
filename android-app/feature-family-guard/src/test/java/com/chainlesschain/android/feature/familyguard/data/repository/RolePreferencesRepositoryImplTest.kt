package com.chainlesschain.android.feature.familyguard.data.repository

import app.cash.turbine.test
import com.chainlesschain.android.feature.familyguard.data.preferences.RolePreferencesDataSource
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * FAMILY-04 + FAMILY-60 验收: 3 态 state machine + 24h 锁 (按权威时间判)。
 *
 * 时刻基线用 fake [TimeAuthority] 注入, 完全避开真墙钟。`StoredRole` Flow 用
 * MutableStateFlow 模拟 DataStore 行为, 允许测试控制 emission 时序。
 */
class RolePreferencesRepositoryImplTest {

    private val storedFlow =
        MutableStateFlow<RolePreferencesDataSource.StoredRole?>(null)

    private val dataSource: RolePreferencesDataSource = mockk(relaxed = true) {
        coEvery { observeStoredRole } returns storedFlow
    }

    private class FakeTimeAuthority(private val nowMs: Long) : TimeAuthority {
        override fun authoritativeNow(): Long = nowMs
        override fun status(): TimeAuthorityStatus = TimeAuthorityStatus.TRUSTED
        override fun isTimeTrusted(): Boolean = true
        override fun shouldLockTimeFeatures(): Boolean = false
        override suspend fun sync(): Boolean = true
    }

    private fun fixedTime(epochMs: Long): TimeAuthority = FakeTimeAuthority(epochMs)

    @Test
    fun `null stored emits Unselected`() = runTest {
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(0L))

        repo.observeLockState().test {
            assertEquals(RoleLockState.Unselected, awaitItem())
        }
    }

    @Test
    fun `stored within 24h emits LockPending with correct lockAtMs`() = runTest {
        val selectedAt = 1_000_000_000_000L
        val now = selectedAt + 6 * 60 * 60 * 1000L // +6h
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        storedFlow.value = RolePreferencesDataSource.StoredRole(
            role = AppRole.PARENT,
            selectedAtMs = selectedAt,
        )

        repo.observeLockState().test {
            val state = awaitItem()
            assertIs<RoleLockState.LockPending>(state)
            assertEquals(AppRole.PARENT, state.role)
            assertEquals(selectedAt + 24 * 60 * 60 * 1000L, state.lockAtMs)
        }
    }

    @Test
    fun `stored exactly 24h ago emits Locked (inclusive boundary)`() = runTest {
        val selectedAt = 1_000_000_000_000L
        val now = selectedAt + RolePreferencesRepositoryImpl.LOCK_DURATION_MS
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        storedFlow.value = RolePreferencesDataSource.StoredRole(
            role = AppRole.CHILD,
            selectedAtMs = selectedAt,
        )

        repo.observeLockState().test {
            val state = awaitItem()
            assertIs<RoleLockState.Locked>(state)
            assertEquals(AppRole.CHILD, state.role)
        }
    }

    @Test
    fun `select writes role and selectedAt via dataSource`() = runTest {
        val now = 2_000_000_000_000L
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        repo.select(AppRole.PARENT)

        coVerify(exactly = 1) {
            dataSource.save(role = AppRole.PARENT, selectedAtMs = now)
        }
    }

    @Test
    fun `tryChangeRole during lock pending succeeds`() = runTest {
        val selectedAt = 3_000_000_000_000L
        val now = selectedAt + 12 * 60 * 60 * 1000L // +12h, still pending
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        storedFlow.value = RolePreferencesDataSource.StoredRole(
            role = AppRole.PARENT,
            selectedAtMs = selectedAt,
        )

        val changed = repo.tryChangeRole(AppRole.CHILD)

        assertTrue(changed)
        coVerify(exactly = 1) {
            dataSource.save(role = AppRole.CHILD, selectedAtMs = now)
        }
    }

    @Test
    fun `tryChangeRole after lock returns false and does not write`() = runTest {
        val selectedAt = 3_000_000_000_000L
        val now = selectedAt + 48 * 60 * 60 * 1000L // +48h, locked
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        storedFlow.value = RolePreferencesDataSource.StoredRole(
            role = AppRole.PARENT,
            selectedAtMs = selectedAt,
        )

        val changed = repo.tryChangeRole(AppRole.CHILD)

        assertFalse(changed)
        coVerify(exactly = 0) {
            dataSource.save(role = AppRole.CHILD, selectedAtMs = any())
        }
    }

    @Test
    fun `tryChangeRole when nothing stored falls through to fresh select`() = runTest {
        val now = 4_000_000_000_000L
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(now))

        val changed = repo.tryChangeRole(AppRole.PARENT)

        assertTrue(changed)
        coVerify(exactly = 1) {
            dataSource.save(role = AppRole.PARENT, selectedAtMs = now)
        }
    }

    @Test
    fun `reset delegates to dataSource clear`() = runTest {
        val repo = RolePreferencesRepositoryImpl(dataSource, fixedTime(0L))
        repo.reset()
        coVerify(exactly = 1) { dataSource.clear() }
    }
}
