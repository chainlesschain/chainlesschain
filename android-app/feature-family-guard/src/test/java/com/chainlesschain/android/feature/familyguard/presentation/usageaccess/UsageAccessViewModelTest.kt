package com.chainlesschain.android.feature.familyguard.presentation.usageaccess

import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppQuery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

/**
 * FAMILY-20 验收: UsageAccessViewModel 把角色 + 授予态合成卡片可见态。
 *   - 非 CHILD → Hidden (即使未授权)
 *   - CHILD + 已授权 → Granted
 *   - CHILD + 未授权 → Denied
 *   - recheck() 在设置返回后刷新授予态 → Denied 翻 Granted
 *
 * 用 UnconfinedTestDispatcher + 活跃 collector (激活 WhileSubscribed) 后读 .value:
 * combine/stateIn 在 Unconfined 下 eager 计算, 避开 StandardTestDispatcher 下
 * stateIn 先发 initialValue 的时序坑 ([[android_runtest_sharedflow_unconfined_dispatcher]])。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UsageAccessViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    private val lockState = MutableStateFlow<RoleLockState>(RoleLockState.Unselected)
    private val roleRepo: RolePreferencesRepository = mockk(relaxed = true) {
        every { observeLockState() } returns lockState
    }
    private val query: ForegroundAppQuery = mockk(relaxed = true)

    private fun childLocked() = RoleLockState.Locked(role = AppRole.CHILD, selectedAtMs = 0L)
    private fun parentLocked() = RoleLockState.Locked(role = AppRole.PARENT, selectedAtMs = 0L)

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `parent device is always hidden`() = runTest(testDispatcher) {
        every { query.isAccessGranted() } returns false
        lockState.value = parentLocked()
        val vm = UsageAccessViewModel(query, roleRepo)
        backgroundScope.launch { vm.uiState.collect {} } // 激活 WhileSubscribed

        assertEquals(UsageAccessUiState.Hidden, vm.uiState.value)
    }

    @Test
    fun `child without access is denied`() = runTest(testDispatcher) {
        every { query.isAccessGranted() } returns false
        lockState.value = childLocked()
        val vm = UsageAccessViewModel(query, roleRepo)
        backgroundScope.launch { vm.uiState.collect {} }

        assertEquals(UsageAccessUiState.Denied, vm.uiState.value)
    }

    @Test
    fun `child with access is granted`() = runTest(testDispatcher) {
        every { query.isAccessGranted() } returns true
        lockState.value = childLocked()
        val vm = UsageAccessViewModel(query, roleRepo)
        backgroundScope.launch { vm.uiState.collect {} }

        assertEquals(UsageAccessUiState.Granted, vm.uiState.value)
    }

    @Test
    fun `recheck flips denied to granted after user grants in settings`() = runTest(testDispatcher) {
        every { query.isAccessGranted() } returns false
        lockState.value = childLocked()
        val vm = UsageAccessViewModel(query, roleRepo)
        backgroundScope.launch { vm.uiState.collect {} }
        assertEquals(UsageAccessUiState.Denied, vm.uiState.value)

        // 用户在系统设置授权后返回 → onResume 触发 recheck
        every { query.isAccessGranted() } returns true
        vm.recheck()

        assertEquals(UsageAccessUiState.Granted, vm.uiState.value)
    }
}
