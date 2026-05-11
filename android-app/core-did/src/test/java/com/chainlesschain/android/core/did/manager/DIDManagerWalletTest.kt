package com.chainlesschain.android.core.did.manager

import android.content.Context
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.did.generator.DidKeyGenerator
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import com.chainlesschain.android.core.did.testing.FakeKeystoreFacade
import com.chainlesschain.android.core.did.wallet.MnemonicService
import com.chainlesschain.android.core.did.wallet.WalletStorage
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File

/**
 * DIDManager v0.2 钱包能力新增测试（覆盖多 DID / 助记词 / 迁移 / 加密落盘）。
 *
 * 既有功能由 [DIDManagerTest] 覆盖；本文件只测 v0.2 新接口。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DIDManagerWalletTest {

    private lateinit var mockContext: Context
    private lateinit var didKeyResolver: DidKeyResolver
    private lateinit var fakeKeystore: FakeKeystoreFacade
    private lateinit var strongBoxKeyManager: StrongBoxKeyManager
    private lateinit var mnemonicService: MnemonicService
    private lateinit var tempDir: File

    @Before
    fun setup() {
        tempDir = File.createTempFile("did_wallet_test", "").apply {
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

    // ─── multi-DID storage (5) ───────────────────────────────────────────

    @Test
    fun `createIdentity adds DID to wallet and makes it active`() = runTest {
        val mgr = newManager()
        val identity = mgr.createIdentity("Pixel 7")

        assertEquals(identity.did, mgr.getCurrentDID())
        assertEquals(1, mgr.listIdentities().size)
        assertTrue(mgr.listIdentities().first().isActive)
    }

    @Test
    fun `multiple createIdentity calls produce distinct DIDs in wallet`() = runTest {
        val mgr = newManager()
        val id1 = mgr.createIdentity("Device 1")
        val id2 = mgr.createIdentity("Device 2")
        val id3 = mgr.createIdentity("Device 3")

        assertNotEquals(id1.did, id2.did)
        assertNotEquals(id2.did, id3.did)
        assertEquals(3, mgr.listIdentities().size)
        // last created is active
        assertEquals(id3.did, mgr.getCurrentDID())
    }

    @Test
    fun `switchActive changes current identity and persists`() = runTest {
        val mgr = newManager()
        val id1 = mgr.createIdentity("D1")
        val id2 = mgr.createIdentity("D2")
        assertEquals(id2.did, mgr.getCurrentDID())

        val switched = mgr.switchActive(id1.did)

        assertTrue(switched)
        assertEquals(id1.did, mgr.getCurrentDID())
        // persistence: reload manager and verify
        val mgr2 = newManager()
        mgr2.initialize()
        assertEquals(id1.did, mgr2.getCurrentDID())
    }

    @Test
    fun `switchActive returns false for unknown DID`() = runTest {
        val mgr = newManager()
        mgr.createIdentity("D1")

        val switched = mgr.switchActive("did:key:zUNKNOWN")

        assertFalse(switched)
    }

    @Test
    fun `listIdentities returns metadata with active flag`() = runTest {
        val mgr = newManager()
        val id1 = mgr.createIdentity("D1")
        val id2 = mgr.createIdentity("D2")
        mgr.switchActive(id1.did)

        val list = mgr.listIdentities()

        assertEquals(2, list.size)
        val a = list.first { it.did == id1.did }
        val b = list.first { it.did == id2.did }
        assertTrue(a.isActive)
        assertFalse(b.isActive)
        assertFalse(a.hasMnemonic) // createIdentity sans mnemonic
    }

    // ─── mnemonic (7) ────────────────────────────────────────────────────

    @Test
    fun `createIdentityWithMnemonic returns 24-word mnemonic`() = runTest {
        val mgr = newManager()

        val result = mgr.createIdentityWithMnemonic("Pixel 7")

        assertEquals(24, result.mnemonic.size)
        assertTrue(mnemonicService.validate(result.mnemonic))
        assertEquals(result.identity.did, mgr.getCurrentDID())
        val meta = mgr.listIdentities().first { it.did == result.identity.did }
        assertTrue(meta.hasMnemonic)
        assertFalse(meta.mnemonicVerified)
    }

    @Test
    fun `importFromMnemonic with valid words creates DID and marks verified`() = runTest {
        val mgr = newManager()
        val mnemonic = mnemonicService.generate()

        val identity = mgr.importFromMnemonic(mnemonic, "Restored Device")

        assertTrue(identity.did.startsWith("did:key:z"))
        val meta = mgr.listIdentities().first { it.did == identity.did }
        assertTrue(meta.hasMnemonic)
        assertTrue(meta.mnemonicVerified) // import 默认已 verified
    }

    @Test
    fun `importFromMnemonic with invalid words throws`() = runTest {
        val mgr = newManager()
        val invalid = listOf("notaword", "notaword", "notaword")

        assertThrows(IllegalArgumentException::class.java) {
            mgr.importFromMnemonic(invalid, "Bad Device")
        }
    }

    @Test
    fun `importFromMnemonic reproduces same DID as createIdentityWithMnemonic`() = runTest {
        val mgr1 = newManager()
        val result = mgr1.createIdentityWithMnemonic("Original")

        // simulate fresh device with new wallet but reuse mnemonic
        val tempDir2 = File.createTempFile("did_wallet_test2", "").apply {
            delete(); mkdir(); deleteOnExit()
        }
        val mockContext2 = mock<Context>()
        whenever(mockContext2.filesDir).thenReturn(tempDir2)
        // independent keystore — simulates new device
        val keystore2 = FakeKeystoreFacade(strongBoxSupported = true, hardwareBacked = true)
        val strongBox2 = StrongBoxKeyManager(keystore2, sdkInt = 30)
        val mgr2 = DIDManager(mockContext2, didKeyResolver, strongBox2, mnemonicService)

        val restored = mgr2.importFromMnemonic(result.mnemonic, "Restored")

        // Same mnemonic must derive same Ed25519 seed → same DID
        assertEquals(result.identity.did, restored.did)
    }

    @Test
    fun `importFromMnemonic with already-in-wallet DID switches active without duplicating`() =
        runTest {
            val mgr = newManager()
            val result = mgr.createIdentityWithMnemonic("D1")
            val otherId = mgr.createIdentity("D2")
            assertEquals(otherId.did, mgr.getCurrentDID())

            val imported = mgr.importFromMnemonic(result.mnemonic, "Re-imported")

            assertEquals(result.identity.did, imported.did)
            assertEquals(result.identity.did, mgr.getCurrentDID())
            assertEquals(2, mgr.listIdentities().size) // no duplicate
        }

    @Test
    fun `markMnemonicVerified updates meta and persists`() = runTest {
        val mgr = newManager()
        val result = mgr.createIdentityWithMnemonic("D1")
        assertFalse(mgr.listIdentities().first().mnemonicVerified)

        val ok = mgr.markMnemonicVerified(result.identity.did)

        assertTrue(ok)
        assertTrue(mgr.listIdentities().first().mnemonicVerified)

        val mgr2 = newManager()
        mgr2.initialize()
        assertTrue(mgr2.listIdentities().first().mnemonicVerified)
    }

    @Test
    fun `markMnemonicVerified returns false for DID without mnemonic`() = runTest {
        val mgr = newManager()
        val id = mgr.createIdentity("D1") // no mnemonic

        val ok = mgr.markMnemonicVerified(id.did)

        assertFalse(ok)
    }

    // ─── migration (4) ───────────────────────────────────────────────────

    @Test
    fun `legacy plaintext did_keypair_json is detected and migrated`() = runTest {
        // 写一个旧格式文件到 tempDir
        val legacyDid = "did:key:zLegacy12345"
        val keyPair = Ed25519KeyPair.generate()
        val legacyJson = """
            {
              "did": "${DidKeyGenerator.generate(keyPair)}",
              "deviceName": "OldDevice",
              "keyPair": {
                "publicKey": "${keyPair.getPublicKeyHex()}",
                "privateKey": "${keyPair.getPrivateKeyHex()}"
              },
              "createdAt": 1700000000000
            }
        """.trimIndent()
        File(tempDir, WalletStorage.LEGACY_FILE_NAME).writeText(legacyJson)

        val mgr = newManager()
        mgr.initialize()

        // active DID 应该是 legacy 中的那个
        assertEquals(DidKeyGenerator.generate(keyPair), mgr.getCurrentDID())
        // 新 wallet 文件出现
        assertTrue(File(tempDir, WalletStorage.FILE_NAME).exists())
        // 旧文件 rename 为 .migrated.bak
        assertFalse(File(tempDir, WalletStorage.LEGACY_FILE_NAME).exists())
        assertTrue(
            File(
                tempDir,
                WalletStorage.LEGACY_FILE_NAME + WalletStorage.LEGACY_BACKUP_SUFFIX,
            ).exists(),
        )
    }

    @Test
    fun `re-init after migration loads wallet without re-migrating`() = runTest {
        // 先迁移
        val keyPair = Ed25519KeyPair.generate()
        val did = DidKeyGenerator.generate(keyPair)
        File(tempDir, WalletStorage.LEGACY_FILE_NAME).writeText(
            """{"did":"$did","deviceName":"D","keyPair":{"publicKey":"${keyPair.getPublicKeyHex()}","privateKey":"${keyPair.getPrivateKeyHex()}"},"createdAt":1700000000000}""",
        )
        newManager().initialize()

        // 第二次初始化：wallet 已存在，legacy 已 rename
        val mgr2 = newManager()
        mgr2.initialize()

        assertEquals(did, mgr2.getCurrentDID())
        assertEquals(1, mgr2.listIdentities().size)
    }

    @Test
    fun `corrupted legacy file falls through to fresh creation`() = runTest {
        File(tempDir, WalletStorage.LEGACY_FILE_NAME).writeText("not valid json {")

        val mgr = newManager()
        mgr.initialize()

        // 应该 fallback 创建新 DID
        assertNotNull(mgr.getCurrentDID())
        // legacy 文件**没有** rename（因为迁移失败）
        assertTrue(File(tempDir, WalletStorage.LEGACY_FILE_NAME).exists())
    }

    @Test
    fun `wallet file does not contain plaintext private key after migration`() = runTest {
        val keyPair = Ed25519KeyPair.generate()
        val did = DidKeyGenerator.generate(keyPair)
        val plaintextHex = keyPair.getPrivateKeyHex()
        File(tempDir, WalletStorage.LEGACY_FILE_NAME).writeText(
            """{"did":"$did","deviceName":"D","keyPair":{"publicKey":"${keyPair.getPublicKeyHex()}","privateKey":"$plaintextHex"},"createdAt":1700000000000}""",
        )

        newManager().initialize()

        val walletContent = File(tempDir, WalletStorage.FILE_NAME).readText()
        // 私钥 hex 不应直接出现在 wallet json 中
        assertFalse(
            "Wallet must not contain plaintext private key hex",
            walletContent.contains(plaintextHex, ignoreCase = true),
        )
        // 但应包含密文 base64
        assertTrue(walletContent.contains("ciphertextBase64"))
    }

    // ─── encryption integration (3) ──────────────────────────────────────

    @Test
    fun `wrap and unwrap roundtrip preserves private key exactly`() = runTest {
        val mgr = newManager()
        val result = mgr.createIdentityWithMnemonic("D")
        val originalPrivate = result.identity.keyPair.privateKey

        // reload via fresh manager (same Keystore)
        val mgr2 = newManager()
        mgr2.initialize()
        val loadedPrivate = mgr2.currentIdentity.value!!.keyPair.privateKey

        assertArrayEquals(originalPrivate, loadedPrivate)
    }

    @Test
    fun `multi-DID wallet survives reinit`() = runTest {
        val mgr1 = newManager()
        val id1 = mgr1.createIdentity("D1")
        val id2 = mgr1.createIdentityWithMnemonic("D2").identity
        val id3 = mgr1.createIdentity("D3")
        mgr1.switchActive(id2.did)

        val mgr2 = newManager()
        mgr2.initialize()

        assertEquals(3, mgr2.listIdentities().size)
        assertEquals(id2.did, mgr2.getCurrentDID())
        val meta2 = mgr2.listIdentities().first { it.did == id2.did }
        assertTrue(meta2.hasMnemonic)
    }

    @Test
    fun `sign with reloaded wallet matches sign with original`() = runTest {
        val mgr1 = newManager()
        val id = mgr1.createIdentity("D")
        val message = "consistency check".toByteArray()
        val sigOriginal = mgr1.sign(message)

        val mgr2 = newManager()
        mgr2.initialize()
        val sigReloaded = mgr2.sign(message)

        // Ed25519 deterministic：相同 key + 相同 message → 相同 signature
        assertArrayEquals(sigOriginal, sigReloaded)
        // 验签也得过
        assertTrue(mgr2.verify(message, sigOriginal, id.did))
    }
}
