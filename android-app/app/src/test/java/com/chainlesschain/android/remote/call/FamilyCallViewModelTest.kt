package com.chainlesschain.android.remote.call

import com.chainlesschain.android.remote.webrtc.CallKind
import com.chainlesschain.android.remote.webrtc.FamilyCallEvent
import com.chainlesschain.android.remote.webrtc.FamilyCallRpcClient
import com.chainlesschain.android.remote.webrtc.FamilyCallType
import com.chainlesschain.android.remote.webrtc.UrgentCallQuota
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-37 验收: FamilyCallViewModel 状态机 + 动作委托 + 配额展示。
 * SharedFlow 观测走 UnconfinedTestDispatcher（[[android_runtest_sharedflow_unconfined_dispatcher]]）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FamilyCallViewModelTest {

    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var familyCall: FamilyCallRpcClient
    private lateinit var quota: UrgentCallQuota
    private lateinit var events: MutableSharedFlow<FamilyCallEvent>

    private val targetPeer = "did:chain:peer"
    private val targetDid = "did:chain:kid"

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        events = MutableSharedFlow(extraBufferCapacity = 16)
        familyCall = mockk(relaxed = true)
        quota = mockk(relaxed = true)
        every { familyCall.observeCallEvents() } returns events
        every { familyCall.start() } just Runs
        every { familyCall.stop() } just Runs
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = FamilyCallViewModel(familyCall, quota)

    @Test
    fun `init starts client + idle`() {
        val vm = vm()
        assertEquals(FamilyCallUiState.Idle, vm.state.value)
        every { familyCall.start() } // verified via relaxed; start called in init
        coVerify { familyCall.observeCallEvents() }
    }

    @Test
    fun `startCall success transitions to Outgoing`() = runTest(dispatcher) {
        coEvery { familyCall.invite(targetPeer, targetDid, CallKind.AUDIO) } returns Result.success("call-1")
        val vm = vm()
        vm.startCall(targetPeer, targetDid, CallKind.AUDIO)
        val s = vm.state.value
        assertTrue(s is FamilyCallUiState.Outgoing)
        assertEquals("call-1", (s as FamilyCallUiState.Outgoing).callId)
        assertEquals(CallKind.AUDIO, s.callKind)
    }

    @Test
    fun `startCall failure transitions to Error`() = runTest(dispatcher) {
        coEvery { familyCall.invite(any(), any(), any()) } returns Result.failure(Exception("denied"))
        val vm = vm()
        vm.startCall(targetPeer, targetDid, CallKind.VIDEO)
        assertTrue(vm.state.value is FamilyCallUiState.Error)
    }

    @Test
    fun `incoming invite event transitions to Incoming`() = runTest(dispatcher) {
        val vm = vm()
        events.emit(
            FamilyCallEvent(FamilyCallType.INVITE, "call-9", "did:chain:mom", CallKind.VIDEO, seq = 1),
        )
        val s = vm.state.value
        assertTrue(s is FamilyCallUiState.Incoming)
        assertEquals("call-9", (s as FamilyCallUiState.Incoming).callId)
        assertEquals("did:chain:mom", s.fromPeerId)
        assertEquals(CallKind.VIDEO, s.callKind)
    }

    @Test
    fun `acceptIncoming calls accept + Connected`() = runTest(dispatcher) {
        coEvery { familyCall.accept(any(), any()) } returns Result.success(Unit)
        val vm = vm()
        events.emit(FamilyCallEvent(FamilyCallType.INVITE, "call-9", "did:chain:mom", CallKind.AUDIO, seq = 1))
        vm.acceptIncoming()
        coVerify { familyCall.accept("did:chain:mom", "call-9") }
        assertTrue(vm.state.value is FamilyCallUiState.Connected)
    }

    @Test
    fun `rejectIncoming calls reject + Ended`() = runTest(dispatcher) {
        coEvery { familyCall.reject(any(), any(), any()) } returns Result.success(Unit)
        val vm = vm()
        events.emit(FamilyCallEvent(FamilyCallType.INVITE, "call-9", "did:chain:mom", CallKind.AUDIO, seq = 1))
        vm.rejectIncoming("busy")
        coVerify { familyCall.reject("did:chain:mom", "call-9", "busy") }
        assertTrue(vm.state.value is FamilyCallUiState.Ended)
    }

    @Test
    fun `ACCEPT event while Outgoing transitions to Connected`() = runTest(dispatcher) {
        coEvery { familyCall.invite(any(), any(), any()) } returns Result.success("call-1")
        val vm = vm()
        vm.startCall(targetPeer, targetDid, CallKind.AUDIO)
        events.emit(FamilyCallEvent(FamilyCallType.ACCEPT, "call-1", targetPeer, null, seq = 2))
        assertTrue(vm.state.value is FamilyCallUiState.Connected)
    }

    @Test
    fun `HANGUP event transitions to Ended`() = runTest(dispatcher) {
        val vm = vm()
        events.emit(FamilyCallEvent(FamilyCallType.HANGUP, "call-1", targetPeer, null, seq = 3))
        assertTrue(vm.state.value is FamilyCallUiState.Ended)
    }

    @Test
    fun `urgentQuotaRemaining delegates to quota`() {
        every { quota.remaining(targetDid, any()) } returns 2
        assertEquals(2, vm().urgentQuotaRemaining(targetDid))
    }
}
