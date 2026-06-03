package com.chainlesschain.android.core.did.manager

import android.content.Context
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import com.chainlesschain.android.core.did.testing.FakeKeystoreFacade
import com.chainlesschain.android.core.did.wallet.MnemonicService
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File

/**
 * DIDManager 单元测试 — v0.2 wallet 形态。
 *
 * 与 v0.1 相比的变化：
 *  - 构造器新增 [StrongBoxKeyManager] + [MnemonicService] 两个依赖
 *  - 测试用 [FakeKeystoreFacade] 模拟 Keystore（真实 AES 加解密，无 Android 依赖）
 *  - 多个 manager 实例共享同一 FakeKeystoreFacade，模拟设备级 Keystore 单例
 *
 * 既有测试逻辑保持不变；只调整构造器入参。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DIDManagerTest {

    private lateinit var didManager: DIDManager
    private lateinit var mockContext: Context
    private lateinit var didKeyResolver: DidKeyResolver
    private lateinit var fakeKeystore: FakeKeystoreFacade
    private lateinit var strongBoxKeyManager: StrongBoxKeyManager
    private lateinit var mnemonicService: MnemonicService
    private lateinit var tempDir: File

    @Before
    fun setup() {
        tempDir = File.createTempFile("did_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }

        mockContext = mock()
        whenever(mockContext.filesDir).thenReturn(tempDir)

        didKeyResolver = DidKeyResolver()
        fakeKeystore = FakeKeystoreFacade(strongBoxSupported = false, hardwareBacked = false)
        strongBoxKeyManager = StrongBoxKeyManager(fakeKeystore, sdkInt = 28)
        mnemonicService = MnemonicService()

        didManager = newDidManager()
    }

    private fun newDidManager(): DIDManager =
        DIDManager(mockContext, didKeyResolver, strongBoxKeyManager, mnemonicService)

    @Test
    fun `test createIdentity generates valid DID`() {
        val identity = didManager.createIdentity("TestDevice")

        assertNotNull(identity.did)
        assertTrue(identity.did.startsWith("did:key:z"))
        assertEquals("TestDevice", identity.deviceName)
        assertTrue(identity.keyPair.hasPrivateKey())
        assertNotNull(identity.didDocument)
        assertEquals(identity.did, identity.didDocument.id)
    }

    @Test
    fun `test initialize loads or creates identity`() = runTest {
        didManager.initialize()

        val currentDID = didManager.getCurrentDID()
        assertNotNull(currentDID)
        assertTrue(currentDID!!.startsWith("did:key:z"))

        val currentDocument = didManager.getCurrentDIDDocument()
        assertNotNull(currentDocument)
        assertEquals(currentDID, currentDocument!!.id)
    }

    @Test
    fun `test sign creates valid signature`() = runTest {
        didManager.initialize()
        val message = "Test message for signing"

        val signature = didManager.sign(message)

        assertEquals(64, signature.size)
    }

    @Test
    fun `test sign and verify roundtrip`() = runTest {
        didManager.initialize()
        val message = "Test message"

        val signature = didManager.sign(message)
        val isValid = didManager.verify(message, signature, didManager.getCurrentDID()!!)

        assertTrue(isValid)
    }

    @Test
    fun `test verify fails with wrong message`() = runTest {
        didManager.initialize()
        val originalMessage = "Original message"
        val tamperedMessage = "Tampered message"

        val signature = didManager.sign(originalMessage)
        val isValid = didManager.verify(tamperedMessage, signature, didManager.getCurrentDID()!!)

        assertFalse(isValid)
    }

    @Test
    fun `test verify fails with wrong DID`() = runTest {
        didManager.initialize()
        val message = "Test message"

        // 用 importFromMnemonic 创建 second DID，避免对共享文件的覆盖竞争
        val mnemonic = mnemonicService.generate(strength = 128)
        val otherIdentity = didManager.importFromMnemonic(mnemonic, "OtherDevice")
        // switch back to original for signing
        val originalDid = didManager.listIdentities().first { !it.isActive }.did
        didManager.switchActive(originalDid)

        val signature = didManager.sign(message)
        val isValid = didManager.verify(message, signature, otherIdentity.did)

        assertFalse(isValid)
    }

    @Test
    fun `test signWithTimestamp creates valid timestamped signature`() = runTest {
        didManager.initialize()
        val message = "Test message".toByteArray()

        val timestampedSig = didManager.signWithTimestamp(message)

        assertEquals(64, timestampedSig.signature.size)
        assertTrue(timestampedSig.timestamp > 0)
    }

    @Test
    fun `test verifyWithTimestamp succeeds`() = runTest {
        didManager.initialize()
        val message = "Test message".toByteArray()

        val timestampedSig = didManager.signWithTimestamp(message)
        val isValid = didManager.verifyWithTimestamp(
            message,
            timestampedSig,
            didManager.getCurrentDID()!!,
            maxAgeMs = 60000,
        )

        assertTrue(isValid)
    }

    @Test
    fun `test addTrustedDevice stores device`() = runTest {
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        didManager.addTrustedDevice(
            otherIdentity.did, "OtherDevice", otherIdentity.keyPair.publicKey,
        )

        assertTrue(didManager.isTrustedDevice(otherIdentity.did))
        val trustedDevice = didManager.getTrustedDevice(otherIdentity.did)
        assertNotNull(trustedDevice)
        assertEquals(otherIdentity.did, trustedDevice!!.did)
        assertEquals("OtherDevice", trustedDevice.deviceName)
    }

    @Test
    fun `test addTrustedDevice without publicKey extracts from DID`() = runTest {
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        val trustedDevice = didManager.getTrustedDevice(otherIdentity.did)
        assertNotNull(trustedDevice)
        assertArrayEquals(otherIdentity.keyPair.publicKey, trustedDevice!!.getPublicKeyBytes())
    }

    @Test
    fun `test removeTrustedDevice removes device`() = runTest {
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")
        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        didManager.removeTrustedDevice(otherIdentity.did)

        assertFalse(didManager.isTrustedDevice(otherIdentity.did))
        assertNull(didManager.getTrustedDevice(otherIdentity.did))
    }

    @Test
    fun `test trustedDevicesList Flow updates`() = runTest {
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        val trustedDevices = didManager.trustedDevicesList.value
        assertEquals(1, trustedDevices.size)
        assertEquals(otherIdentity.did, trustedDevices[0].did)

        didManager.removeTrustedDevice(otherIdentity.did)

        assertEquals(0, didManager.trustedDevicesList.value.size)
    }

    @Test
    fun `test resolveDID returns valid DID Document`() = runTest {
        didManager.initialize()
        val did = didManager.getCurrentDID()!!

        val didDocument = didManager.resolveDID(did)

        assertNotNull(didDocument)
        assertEquals(did, didDocument!!.id)
    }

    @Test
    fun `test currentIdentity Flow is updated after initialize`() = runTest {
        didManager.initialize()

        val identity = didManager.currentIdentity.value
        assertNotNull(identity)
        assertNotNull(identity!!.did)
        assertTrue(identity.did.startsWith("did:key:z"))
    }

    @Test(expected = IllegalStateException::class)
    fun `test sign without initialize throws exception`() {
        didManager.sign("test")
    }

    @Test(expected = IllegalStateException::class)
    fun `test signWithTimestamp without initialize throws exception`() {
        didManager.signWithTimestamp("test".toByteArray())
    }

    @Test
    fun `test TrustedDevice publicKey conversion`() {
        val publicKey = ByteArray(32) { it.toByte() }
        val trustedDevice = TrustedDevice(
            did = "did:key:z123",
            deviceName = "Test",
            publicKey = publicKey,
            trustedAt = System.currentTimeMillis(),
        )

        val extractedPublicKey = trustedDevice.getPublicKeyBytes()

        assertArrayEquals(publicKey, extractedPublicKey)
    }

    @Test
    fun `test identity persistence across instances`() = runTest {
        val manager1 = newDidManager()
        manager1.initialize()
        val originalDID = manager1.getCurrentDID()

        val manager2 = newDidManager()
        manager2.initialize()
        val loadedDID = manager2.getCurrentDID()

        assertEquals(originalDID, loadedDID)
    }

    @Test
    fun `test trusted devices persistence across instances`() = runTest {
        val manager1 = newDidManager()
        manager1.initialize()
        val otherIdentity = manager1.createIdentity("OtherDevice")
        manager1.addTrustedDevice(otherIdentity.did, "OtherDevice")

        val manager2 = newDidManager()
        manager2.initialize()

        assertTrue(manager2.isTrustedDevice(otherIdentity.did))
    }
}
