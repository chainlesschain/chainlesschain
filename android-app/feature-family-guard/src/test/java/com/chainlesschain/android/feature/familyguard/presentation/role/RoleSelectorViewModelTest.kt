package com.chainlesschain.android.feature.familyguard.presentation.role

import app.cash.turbine.test
import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/**
 * FAMILY-04 ViewModel 单测. Mock Repository, 验证:
 *   - lockState 直接镜像 Repository Flow
 *   - onRoleClicked 在 Unselected → 走 select()
 *   - onRoleClicked 在 LockPending → 走 tryChangeRole(), 成功 emit RoleSelected
 *   - onRoleClicked 在 Locked → emit RoleLocked message, 不调 Repository
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoleSelectorViewModelTest {

    // Qualified name 避开顶层 import (memory [[android_mockk_inline_reified_type_slot]]).
    private val testDispatcher = StandardTestDispatcher()

    private val stateFlow = MutableStateFlow<RoleLockState>(RoleLockState.Unselected)
    private val repo: RolePreferencesRepository = mockk(relaxed = true) {
        coEvery { observeLockState() } returns stateFlow
    }

    @Before
    fun setUp() {
        kotlinx.coroutines.Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `lockState mirrors repository flow`() = runTest(testDispatcher) {
        val vm = RoleSelectorViewModel(repo)

        vm.lockState.test {
            // 初值
            assertEquals(RoleLockState.Unselected, awaitItem())

            stateFlow.value = RoleLockState.LockPending(
                role = AppRole.PARENT,
                selectedAtMs = 100L,
                lockAtMs = 100L + 24 * 3600 * 1000L,
            )
            val pending = awaitItem()
            assertIs<RoleLockState.LockPending>(pending)
            assertEquals(AppRole.PARENT, pending.role)
        }
    }

    @Test
    fun `clicking role in Unselected calls select()`() = runTest(testDispatcher) {
        val vm = RoleSelectorViewModel(repo)
        // stateFlow 起点已是 Unselected

        vm.onRoleClicked(AppRole.CHILD)
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repo.select(AppRole.CHILD) }
        coVerify(exactly = 0) { repo.tryChangeRole(any()) }

        assertEquals(
            RoleSelectorViewModel.UserMessage.RoleSelected(AppRole.CHILD),
            vm.userMessage.value,
        )
    }

    @Test
    fun `clicking role in LockPending calls tryChangeRole and emits RoleSelected on success`() =
        runTest(testDispatcher) {
            stateFlow.value = RoleLockState.LockPending(
                role = AppRole.PARENT,
                selectedAtMs = 0L,
                lockAtMs = 24 * 3600 * 1000L,
            )
            coEvery { repo.tryChangeRole(AppRole.CHILD) } returns true

            val vm = RoleSelectorViewModel(repo)
            testDispatcher.scheduler.advanceUntilIdle()

            vm.onRoleClicked(AppRole.CHILD)
            testDispatcher.scheduler.advanceUntilIdle()

            coVerify(exactly = 1) { repo.tryChangeRole(AppRole.CHILD) }
            assertEquals(
                RoleSelectorViewModel.UserMessage.RoleSelected(AppRole.CHILD),
                vm.userMessage.value,
            )
        }

    @Test
    fun `clicking role in LockPending emits RoleLocked when concurrent lock landed`() =
        runTest(testDispatcher) {
            stateFlow.value = RoleLockState.LockPending(
                role = AppRole.PARENT,
                selectedAtMs = 0L,
                lockAtMs = 24 * 3600 * 1000L,
            )
            coEvery { repo.tryChangeRole(AppRole.CHILD) } returns false

            val vm = RoleSelectorViewModel(repo)
            testDispatcher.scheduler.advanceUntilIdle()

            vm.onRoleClicked(AppRole.CHILD)
            testDispatcher.scheduler.advanceUntilIdle()

            assertEquals(
                RoleSelectorViewModel.UserMessage.RoleLocked,
                vm.userMessage.value,
            )
        }

    @Test
    fun `clicking role in Locked emits RoleLocked and does not touch Repository`() =
        runTest(testDispatcher) {
            stateFlow.value = RoleLockState.Locked(
                role = AppRole.PARENT,
                selectedAtMs = 0L,
            )
            val vm = RoleSelectorViewModel(repo)
            testDispatcher.scheduler.advanceUntilIdle()

            vm.onRoleClicked(AppRole.CHILD)
            testDispatcher.scheduler.advanceUntilIdle()

            coVerify(exactly = 0) { repo.select(any()) }
            coVerify(exactly = 0) { repo.tryChangeRole(any()) }
            assertEquals(
                RoleSelectorViewModel.UserMessage.RoleLocked,
                vm.userMessage.value,
            )
        }

    @Test
    fun `consumeMessage clears userMessage`() = runTest(testDispatcher) {
        val vm = RoleSelectorViewModel(repo)
        vm.onRoleClicked(AppRole.PARENT)
        testDispatcher.scheduler.advanceUntilIdle()

        vm.consumeMessage()
        assertNull(vm.userMessage.value)
    }
}
