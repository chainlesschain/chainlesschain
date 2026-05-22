package com.chainlesschain.android.core.p2p.realtime

import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.sync.MessageQueue
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * RealtimeEventManager.queryProfile / handleProfileQuery / handleProfileResponse 单元测试
 *
 * 三件套：
 * 1. 远端在线 → 收到回包，返回 SelfProfileSnapshot
 * 2. 远端超时 → 返回 null
 * 3. 本机收到 PROFILE_QUERY → 通过注入的 SelfProfileProvider 回包
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RealtimeEventManagerProfileQueryTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var messageQueue: MessageQueue
    private lateinit var presenceManager: PresenceManager
    private lateinit var manager: RealtimeEventManager

    private val incomingFlow = MutableSharedFlow<P2PMessage>(extraBufferCapacity = 8)
    private val json = Json { ignoreUnknownKeys = true }

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        messageQueue = mockk(relaxed = true)
        presenceManager = mockk(relaxed = true)
        every { messageQueue.incomingMessages } returns incomingFlow
        manager = RealtimeEventManager(messageQueue, presenceManager)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `queryProfile returns null on timeout when no responder`() = runTest {
        // 不调 setSelfProfileProvider，不预热回包流；queryProfile 必须 ≤ timeout 返回 null。
        val result = manager.queryProfile(targetDid = "did:key:absent", timeoutMs = 200L)
        assertNull("no peer answers ⇒ null", result)
        // 但请求一定发出去了
        verify { messageQueue.enqueue(match { it.type == MessageType.PROFILE_QUERY }, any()) }
    }

    @Test
    fun `queryProfile resolves with matching PROFILE_RESPONSE`() = runBlocking {
        // 用 runBlocking 而不是 runTest——RealtimeEventManager 的内部 scope 用 Dispatchers.IO，
        // 与 virtual-time TestDispatcher 不在同一调度图上，runTest 会瞬时跳完 2s timeout
        // 在 IO 协程还没来得及 handleRealtimeMessage 之前就 fail。
        withTimeout(10_000L) {
            manager.startListening()

            // 拦截入队的 PROFILE_QUERY，提取 requestId 并伪造一个匹配的 PROFILE_RESPONSE 走入站流
            val sent = slot<P2PMessage>()
            every { messageQueue.enqueue(capture(sent), any()) } returns true

            val expectedProfile = SelfProfileSnapshot(
                did = "did:key:remote",
                nickname = "Alice",
                avatarUrl = "https://example.com/a.png",
                bio = "hello"
            )

            var result: SelfProfileSnapshot? = null
            val job = launch {
                result = manager.queryProfile(targetDid = "did:key:remote", timeoutMs = 3_000L)
            }

            // 等到查询包被发出（sent 被 capture）
            var spins = 0
            while (!sent.isCaptured && spins++ < 200) {
                delay(10)
            }
            check(sent.isCaptured) { "PROFILE_QUERY was never enqueued" }

            val queryPayload = json.decodeFromString(ProfileQueryPayload.serializer(), sent.captured.payload)
            val responsePayload = ProfileResponsePayload(
                requestId = queryPayload.requestId,
                profile = expectedProfile,
                timestamp = System.currentTimeMillis()
            )
            val responseMsg = P2PMessage(
                id = "resp-1",
                fromDeviceId = "did:key:remote",
                toDeviceId = "did:key:me",
                type = MessageType.PROFILE_RESPONSE,
                payload = json.encodeToString(ProfileResponsePayload.serializer(), responsePayload),
                requiresAck = false
            )
            incomingFlow.emit(responseMsg)

            job.join()
            assertEquals("requester sees the responder's profile", expectedProfile, result)
        }
    }

    @Test
    fun `handleProfileQuery sends PROFILE_RESPONSE via injected provider`() = runBlocking {
        // runBlocking + withTimeout 不用 runTest——同 line 73 的 `queryProfile resolves`
        // 测试：RealtimeEventManager 内部走 Dispatchers.IO，runTest 的 virtual time
        // 让 delay(5) 瞬间跳过 100 次，IO 协程还没来得及把回包入队 sent 就被 check
        // 抛 IllegalStateException。
        withTimeout(10_000L) {
            val ownProfile = SelfProfileSnapshot(
                did = "did:key:me",
                nickname = "Bob",
                avatarUrl = null,
                bio = "bio"
            )
            manager.setSelfProfileProvider(object : SelfProfileProvider {
                override suspend fun loadSelfProfile(): SelfProfileSnapshot = ownProfile
            })
            manager.startListening()

            // SharedFlow(replay=0) + IO scope async launch 的经典竞态：startListening
            // 在 Dispatchers.IO 上 launch 一个 collector，但 launch 是异步的。如果在
            // collector 真正 subscribe 之前就 emit，事件被丢弃。等到 subscriber
            // 出现再 emit，避免 flake。
            incomingFlow.subscriptionCount.first { it > 0 }

            val sent = slot<P2PMessage>()
            every { messageQueue.enqueue(capture(sent), any()) } returns true

            // 模拟收到 PROFILE_QUERY
            val queryPayload = ProfileQueryPayload(
                requestId = "req-abc",
                targetDid = "did:key:me",
                timestamp = 0L
            )
            incomingFlow.emit(
                P2PMessage(
                    id = "q-1",
                    fromDeviceId = "did:key:asker",
                    toDeviceId = "did:key:me",
                    type = MessageType.PROFILE_QUERY,
                    payload = json.encodeToString(ProfileQueryPayload.serializer(), queryPayload),
                    requiresAck = false
                )
            )

            // 等回包入队
            var spins = 0
            while (!sent.isCaptured && spins++ < 200) {
                delay(10)
            }
            check(sent.isCaptured) { "PROFILE_RESPONSE was never enqueued" }
            assertEquals(MessageType.PROFILE_RESPONSE, sent.captured.type)
            assertEquals("did:key:asker", sent.captured.toDeviceId)
            val resp = json.decodeFromString(ProfileResponsePayload.serializer(), sent.captured.payload)
            assertEquals("requestId echoed back so requester can match", "req-abc", resp.requestId)
            assertEquals(ownProfile, resp.profile)
        }
    }

    @Test
    fun `handleProfileQuery does nothing when no provider registered`() = runTest {
        // 不注入 provider
        manager.startListening()
        val sent = slot<P2PMessage>()
        every { messageQueue.enqueue(capture(sent), any()) } returns true

        val payload = ProfileQueryPayload(requestId = "x", targetDid = "did:key:me", timestamp = 0L)
        incomingFlow.emit(
            P2PMessage(
                id = "q-2",
                fromDeviceId = "did:key:asker",
                toDeviceId = "did:key:me",
                type = MessageType.PROFILE_QUERY,
                payload = json.encodeToString(ProfileQueryPayload.serializer(), payload),
                requiresAck = false
            )
        )
        delay(50)
        assert(!sent.isCaptured) { "无 provider 时不应回包" }
    }

    @Test
    fun `handleProfileQuery does nothing when provider returns null`() = runTest {
        manager.setSelfProfileProvider(object : SelfProfileProvider {
            override suspend fun loadSelfProfile(): SelfProfileSnapshot? = null
        })
        manager.startListening()
        val sent = slot<P2PMessage>()
        every { messageQueue.enqueue(capture(sent), any()) } returns true

        val payload = ProfileQueryPayload(requestId = "y", targetDid = "did:key:me", timestamp = 0L)
        incomingFlow.emit(
            P2PMessage(
                id = "q-3",
                fromDeviceId = "did:key:asker",
                toDeviceId = "did:key:me",
                type = MessageType.PROFILE_QUERY,
                payload = json.encodeToString(ProfileQueryPayload.serializer(), payload),
                requiresAck = false
            )
        )
        delay(50)
        assert(!sent.isCaptured) { "provider 返回 null 时不应回包（未登录态）" }
    }

    @Test
    fun `non-matching requestId is ignored`() = runTest {
        manager.startListening()
        val sent = slot<P2PMessage>()
        every { messageQueue.enqueue(capture(sent), any()) } returns true

        var result: SelfProfileSnapshot? = null
        val job = launch {
            result = manager.queryProfile(targetDid = "did:key:remote", timeoutMs = 200L)
        }

        var spins = 0
        while (!sent.isCaptured && spins++ < 100) {
            delay(5)
        }

        // 发一个 requestId 不匹配的响应——应被 first { it.requestId == requestId } 过滤
        val unrelated = ProfileResponsePayload(
            requestId = "different-id",
            profile = SelfProfileSnapshot("did:key:other", "Eve"),
            timestamp = 0L
        )
        incomingFlow.emit(
            P2PMessage(
                id = "r-unrel",
                fromDeviceId = "did:key:other",
                toDeviceId = "did:key:me",
                type = MessageType.PROFILE_RESPONSE,
                payload = json.encodeToString(ProfileResponsePayload.serializer(), unrelated),
                requiresAck = false
            )
        )

        job.join()
        assertNull("不匹配的 requestId 不应被采纳", result)
    }
}
