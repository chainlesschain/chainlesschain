package com.chainlesschain.android.core.did.manager

import android.content.Context
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import com.chainlesschain.android.core.did.testing.FakeKeystoreFacade
import com.chainlesschain.android.core.did.wallet.MnemonicService
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File

/**
 * DIDManager D3 biometric 集成测试。
 *
 * 验证 [DIDManager.createIdentity] / [createIdentityWithMnemonic] / [importFromMnemonic]
 * 的 requireBiometric 参数能：
 *  1. 正确传递到 [StrongBoxKeyManager.setupWrapperKey]（FakeKeystoreFacade 记录 alias）
 *  2. 持久化到 wallet 文件 + 重启后恢复
 *  3. 通过 [DIDManager.requiresBiometric] 暴露给 UI 层
 *  4. 当 Keystore 模拟"未认证"状态时，unwrap 抛 KeystoreFacadeException
 *  5. 切换 active 不会因为其它 biometric DID 的 wrap key 触发认证（wrappedCache 保护）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DIDManagerBiometricTest {

    private lateinit var mockContext: Context
    private lateinit var didKeyResolver: DidKeyResolver
    private lateinit var fakeKeystore: FakeKeystoreFacade
    private lateinit var strongBoxKeyManager: StrongBoxKeyManager
    private lateinit var mnemonicService: MnemonicService
    private lateinit var tempDir: File

    @Before
    fun setup() {
        tempDir = File.createTempFile("did_biom_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }
        mockContext = mock()
        whenever(mockContext.filesDir).thenReturn(tempDir)

        didKeyResolver = DidKeyResolver()
        fakeKeystore = FakeKeystoreFacade(strongBoxSupported = true, hardwareBacked = true)
        strongBoxKeyManager = StrongBoxKeyManager(fakeKeystore, sdkInt = 30)
        mnemonicService = MnemonicService()
    }

    private fun newManager(): DIDManager =
        DIDManager(mockContext, didKeyResolver, strongBoxKeyManager, mnemonicService)

    @Test
    fun `createIdentity with requireBiometric=true marks DID as biometric-protected`() = runTest {
        val mgr = newManager()
        val identity = mgr.createIdentity("D", requireBiometric = true)

        assertTrue(mgr.requiresBiometric(identity.did))
        val meta = mgr.listIdentities().first { it.did == identity.did }
        assertTrue(meta.requireBiometric)
    }

    @Test
    fun `createIdentity default requireBiometric is false`() = runTest {
        val mgr = newManager()
        val identity = mgr.createIdentity("D")

        assertFalse(mgr.requiresBiometric(identity.did))
        val meta = mgr.listIdentities().first { it.did == identity.did }
        assertFalse(meta.requireBiometric)
    }

    @Test
    fun `createIdentityWithMnemonic with requireBiometric=true marks DID`() = runTest {
        val mgr = newManager()
        val result = mgr.createIdentityWithMnemonic("D", requireBiometric = true)

        assertTrue(mgr.requiresBiometric(result.identity.did))
    }

    @Test
    fun `importFromMnemonic with requireBiometric=true marks new DID`() = runTest {
        val mgr = newManager()
        val mnemonic = mnemonicService.generate()

        val identity = mgr.importFromMnemonic(mnemonic, "D", requireBiometric = true)

        assertTrue(mgr.requiresBiometric(identity.did))
    }

    @Test
    fun `importFromMnemonic of existing DID preserves original requireBiometric`() = runTest {
        val mgr = newManager()
        val result = mgr.createIdentityWithMnemonic("D", requireBiometric = false)
        assertFalse(mgr.requiresBiometric(result.identity.did))

        // 用同样 mnemonic 再 import，requireBiometric=true 参数应被忽略
        val reImported = mgr.importFromMnemonic(result.mnemonic, "D2", requireBiometric = true)

        assertEquals(result.identity.did, reImported.did)
        // 原 entry 的 requireBiometric=false 保留
        assertFalse(mgr.requiresBiometric(reImported.did))
    }

    @Test
    fun `requireBiometric flag persists across wallet reload`() = runTest {
        val mgr1 = newManager()
        val withBiom = mgr1.createIdentity("D1", requireBiometric = true)
        val noBiom = mgr1.createIdentity("D2", requireBiometric = false)

        // simulate biometric authenticated for sign in mgr1 (so it can save)
        fakeKeystore.simulateBiometricAuthenticated = true

        val mgr2 = newManager()
        mgr2.initialize()

        assertTrue(mgr2.requiresBiometric(withBiom.did))
        assertFalse(mgr2.requiresBiometric(noBiom.did))
    }

    @Test
    fun `requiresBiometric returns false for unknown DID`() = runTest {
        val mgr = newManager()
        mgr.createIdentity("D")

        assertFalse(mgr.requiresBiometric("did:key:zUNKNOWN"))
    }

    @Test
    fun `unwrap on biometric DID fails when not authenticated`() = runTest {
        val mgr1 = newManager()
        // create with biometric required
        val identity = mgr1.createIdentity("D", requireBiometric = true)
        val biometricAlias = "did_wrap_" + java.security.MessageDigest.getInstance("SHA-256")
            .digest(identity.did.toByteArray())
            .take(8)
            .joinToString("") { "%02x".format(it) }
        assertTrue(fakeKeystore.requiresBiometric(biometricAlias))

        // simulate user has NOT authenticated; reload manager → loadEntry should fail unwrap
        fakeKeystore.simulateBiometricAuthenticated = false

        val mgr2 = newManager()
        mgr2.initialize()

        // mgr2 failed to load wallet, falls back to creating fresh identity
        // (the biometric-protected one is now unrecoverable in this simulated state)
        assertNotNull(mgr2.getCurrentDID())
        // The freshly created DID is different (no biometric since default)
        assertFalse(mgr2.getCurrentDID() == identity.did)
    }

    @Test
    fun `unwrap on biometric DID succeeds when authenticated`() = runTest {
        val mgr1 = newManager()
        val identity = mgr1.createIdentity("D", requireBiometric = true)

        // simulate user authenticated successfully
        fakeKeystore.simulateBiometricAuthenticated = true

        val mgr2 = newManager()
        mgr2.initialize()

        assertEquals(identity.did, mgr2.getCurrentDID())
    }

    @Test
    fun `wrap cache prevents re-encryption on every save`() = runTest {
        val mgr = newManager()
        val identity = mgr.createIdentityWithMnemonic("D", requireBiometric = true)

        // Now simulate biometric becomes unavailable.
        // markMnemonicVerified saves the wallet — should NOT re-encrypt private key,
        // so should NOT fail despite biometric being unavailable.
        fakeKeystore.simulateBiometricAuthenticated = false

        val ok = mgr.markMnemonicVerified(identity.identity.did)

        // Cache hit means no re-wrap → no biometric guard triggered → save succeeds.
        assertTrue(ok)
    }

    @Test
    fun `switchActive between biometric and non-biometric DIDs works without re-authenticating`() =
        runTest {
            val mgr = newManager()
            val biomDid = mgr.createIdentity("D-biom", requireBiometric = true).did
            val plainDid = mgr.createIdentity("D-plain", requireBiometric = false).did

            // simulate biometric becomes unavailable AFTER both DIDs created
            fakeKeystore.simulateBiometricAuthenticated = false

            // switchActive saves wallet, but wrap cache means no re-encrypt → should succeed
            assertTrue(mgr.switchActive(biomDid))
            assertEquals(biomDid, mgr.getCurrentDID())

            assertTrue(mgr.switchActive(plainDid))
            assertEquals(plainDid, mgr.getCurrentDID())
        }
}
