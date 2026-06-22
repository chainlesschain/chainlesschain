package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.security.strongbox.EncryptResult
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 备份编排服务测试:seedLocalStore 把源记录封进块库;syncWith 端到端(配对 responder +
 * fake keystore + fake 源)—— A 播种本机块、握手取 B 清单、跑协调器拉回 B 的块并合并 → A 收敛到 A∪B。
 */
class PdhBackupServiceTest {

    // 可逆 fake keystore(reverse cipher,所有 alias 同一确定性变换 → 两端同 DID 同 cipher)。
    private class FakeFacade : KeystoreFacade {
        private val aliases = mutableSetOf<String>()
        override fun isStrongBoxSupported() = false
        override fun containsAlias(alias: String) = aliases.contains(alias)
        override fun generateAesKey(alias: String, requestedTier: KeyTier, requireUserAuthentication: Boolean, userAuthenticationValiditySeconds: Int): KeyTier {
            aliases.add(alias); return KeyTier.WRAPPER_TEE
        }
        override fun encryptAesGcm(alias: String, plaintext: ByteArray) =
            EncryptResult(byteArrayOf(7), plaintext.reversedArray())
        override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray) = ciphertext.reversedArray()
        override fun isHardwareBackedFor(alias: String) = true
        override fun isStrongBoxBackedFor(alias: String) = false
        override fun deleteAlias(alias: String) { aliases.remove(alias) }
    }

    private class FakeMessenger(val myId: String) : PdhP2PResponder.P2PMessenger {
        val flow = MutableSharedFlow<P2PMessage>(extraBufferCapacity = 64)
        var peer: FakeMessenger? = null
        override val incoming = flow
        override suspend fun send(toDeviceId: String, payload: String) {
            peer?.flow?.emit(P2PMessage(UUID.randomUUID().toString(), myId, toDeviceId, MessageType.KNOWLEDGE_SYNC, payload))
        }
    }

    private class FakeSource(
        override val kind: AssetKind,
        var records: MutableList<PdhBackupCoordinator.Record>,
    ) : PdhBackupCoordinator.AssetSource {
        override fun read() = records.toList()
        override fun write(records: List<PdhBackupCoordinator.Record>) { this.records = records.toMutableList() }
    }

    private fun rec(key: String, content: String) =
        PdhBackupCoordinator.Record(key, 0L, content.toByteArray())

    private fun didManager(did: String?): DIDManager =
        mockk<DIDManager>().also { every { it.getCurrentDID() } returns did }

    private fun handlerResponder(messenger: PdhP2PResponder.P2PMessenger, store: InMemoryBackupBlockStore, scope: kotlinx.coroutines.CoroutineScope) =
        PdhP2PResponder(messenger, scope, onRequest = { type, data ->
            when (type) {
                PdhBackupBlockChannel.TYPE_PUSH -> PdhBackupRequestHandler.handlePush(data, store)
                PdhBackupBlockChannel.TYPE_PULL -> PdhBackupRequestHandler.handlePull(data, store)
                PdhBackupBlockChannel.TYPE_MANIFEST -> PdhBackupRequestHandler.handleManifest(store)
                else -> ByteArray(0)
            }
        })

    @Test
    fun seed_seals_all_source_records_into_store() {
        val mem = FakeSource(AssetKind.MEMORY, mutableListOf(rec("m1", "a"), rec("m2", "b")))
        val store = InMemoryBackupBlockStore()
        val svc = PdhBackupService(FakeFacade(), didManager("did:x"), store, mockk(relaxed = true), { listOf(mem) })
        val cipher = object : PdhBackupEnvelope.BackupCipher {
            override fun seal(plaintext: ByteArray) = EncryptResult(byteArrayOf(1), plaintext.reversedArray())
            override fun open(iv: ByteArray, ciphertext: ByteArray) = ciphertext.reversedArray()
        }
        assertEquals(2, svc.seedLocalStore(cipher))
        assertEquals(2, store.allBlocks().size)
    }

    @Test
    fun sync_with_peer_pulls_and_converges() = runTest(UnconfinedTestDispatcher()) {
        val facade = FakeFacade()
        val did = "did:owner"
        val cipher = PdhBackupKey.cipherFor(facade.also { PdhBackupKey.ensureKey(it, did) }, did)

        // 对端 B:库里预先封好 B 的记录(同 DID/cipher),responder 服务该库
        val storeB = InMemoryBackupBlockStore()
        storeB.put(PdhBackupEnvelope.seal(AssetKind.MEMORY, PdhRecordCodec.encode(rec("m2", "fromB")), cipher))
        val msgA = FakeMessenger("A"); val msgB = FakeMessenger("B"); msgA.peer = msgB; msgB.peer = msgA
        handlerResponder(msgB, storeB, backgroundScope).start()

        // 本端 A:源里只有 A 的记录;service 用 A 的 responder(经配对 messenger 触达 B)
        val storeA = InMemoryBackupBlockStore()
        val respA = handlerResponder(msgA, storeA, backgroundScope).also { it.start() }
        val memA = FakeSource(AssetKind.MEMORY, mutableListOf(rec("m1", "fromA")))
        val svc = PdhBackupService(facade, didManager(did), storeA, respA, { listOf(memA) })

        val result = svc.syncWith("B")

        assertTrue(result is PdhBackupService.Result.Ok)
        assertTrue((result as PdhBackupService.Result.Ok).outcome.ok)
        assertEquals(setOf("m1", "m2"), memA.records.map { it.key }.toSet()) // 收敛:A∪B
        assertTrue(memA.records.any { String(it.content) == "fromB" }) // B 的内容已拉回合并
    }

    @Test
    fun sync_fails_cleanly_without_did() = runTest {
        val svc = PdhBackupService(FakeFacade(), didManager(null), InMemoryBackupBlockStore(), mockk(relaxed = true), { emptyList() })
        assertTrue(svc.syncWith("B") is PdhBackupService.Result.Failed)
    }
}
