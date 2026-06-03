package com.chainlesschain.android.core.security.strongbox

import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * StrongBoxKeyManager 单元测试（25 用例）
 *
 * 全部走 [KeystoreFacade] mock，不依赖真机 / Robolectric。
 * 设计文档 M2 D1 验收：25 单测覆盖（1）tier 探测降级 +（2）wrap/unwrap 往返
 * +（3）native Ed25519 桩接口 +（4）边界拒绝（blank alias / wrong size 等）。
 */
class StrongBoxKeyManagerTest {

    private lateinit var keystore: KeystoreFacade

    @Before
    fun setup() {
        keystore = mockk(relaxed = false)
    }

    // ─── Tier detection (6) ────────────────────────────────────────────────

    @Test
    fun `detectMaxTier returns NATIVE_STRONGBOX on API 33+ with StrongBox`() {
        every { keystore.isStrongBoxSupported() } returns true
        val mgr = StrongBoxKeyManager(keystore, sdkInt = 33)

        assertEquals(KeyTier.NATIVE_STRONGBOX, mgr.detectMaxTier())
    }

    @Test
    fun `detectMaxTier returns NATIVE_TEE on API 33+ without StrongBox`() {
        every { keystore.isStrongBoxSupported() } returns false
        val mgr = StrongBoxKeyManager(keystore, sdkInt = 34)

        assertEquals(KeyTier.NATIVE_TEE, mgr.detectMaxTier())
    }

    @Test
    fun `detectMaxTier returns WRAPPER_STRONGBOX on API 28-32 with StrongBox`() {
        every { keystore.isStrongBoxSupported() } returns true
        val mgr = StrongBoxKeyManager(keystore, sdkInt = 30)

        assertEquals(KeyTier.WRAPPER_STRONGBOX, mgr.detectMaxTier())
    }

    @Test
    fun `detectMaxTier returns WRAPPER_TEE on API 26-32 without StrongBox`() {
        every { keystore.isStrongBoxSupported() } returns false
        val mgr = StrongBoxKeyManager(keystore, sdkInt = 26)

        assertEquals(KeyTier.WRAPPER_TEE, mgr.detectMaxTier())
    }

    @Test
    fun `detectMaxTier returns SOFTWARE below API 23`() {
        every { keystore.isStrongBoxSupported() } returns false
        val mgr = StrongBoxKeyManager(keystore, sdkInt = 22)

        assertEquals(KeyTier.SOFTWARE, mgr.detectMaxTier())
    }

    @Test
    fun `KeyTier ranks respect StrongBox over TEE over Software`() {
        assertTrue(KeyTier.NATIVE_STRONGBOX.isAtLeast(KeyTier.NATIVE_TEE))
        assertTrue(KeyTier.NATIVE_TEE.isAtLeast(KeyTier.WRAPPER_STRONGBOX))
        assertTrue(KeyTier.WRAPPER_STRONGBOX.isAtLeast(KeyTier.WRAPPER_TEE))
        assertTrue(KeyTier.WRAPPER_TEE.isAtLeast(KeyTier.SOFTWARE))
        assertFalse(KeyTier.SOFTWARE.isAtLeast(KeyTier.WRAPPER_TEE))
        assertTrue(KeyTier.NATIVE_STRONGBOX.allowsHighRisk())
        assertFalse(KeyTier.SOFTWARE.allowsHighRisk())
    }

    // ─── setupWrapperKey (6) ──────────────────────────────────────────────

    @Test
    fun `setupWrapperKey generates new alias when not exists`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("a1") } returns false
        every {
            keystore.generateAesKey("a1", KeyTier.WRAPPER_STRONGBOX, false, any())
        } returns KeyTier.WRAPPER_STRONGBOX

        val res = mgr.setupWrapperKey("a1")

        assertTrue(res.freshlyCreated)
        assertEquals(KeyTier.WRAPPER_STRONGBOX, res.tier)
        assertEquals(KeyTier.WRAPPER_STRONGBOX, res.requestedTier)
    }

    @Test
    fun `setupWrapperKey is idempotent on existing alias`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("a2") } returns true
        every {
            keystore.generateAesKey("a2", any(), any(), any())
        } returns KeyTier.WRAPPER_STRONGBOX

        val res = mgr.setupWrapperKey("a2")

        assertFalse(res.freshlyCreated)
    }

    @Test
    fun `setupWrapperKey falls back to WRAPPER_TEE when StrongBox absent`() {
        val mgr = mgrAtApi(28, strongBox = false)
        every { keystore.containsAlias(any()) } returns false
        every {
            keystore.generateAesKey("a3", KeyTier.WRAPPER_TEE, false, any())
        } returns KeyTier.WRAPPER_TEE

        val res = mgr.setupWrapperKey("a3")

        assertEquals(KeyTier.WRAPPER_TEE, res.requestedTier)
        assertEquals(KeyTier.WRAPPER_TEE, res.tier)
    }

    @Test
    fun `setupWrapperKey reports actual tier when vendor silently demotes`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias(any()) } returns false
        // 厂商裁剪：请求 StrongBox，实际拿到 TEE
        every {
            keystore.generateAesKey("a4", KeyTier.WRAPPER_STRONGBOX, false, any())
        } returns KeyTier.WRAPPER_TEE

        val res = mgr.setupWrapperKey("a4")

        assertEquals(KeyTier.WRAPPER_STRONGBOX, res.requestedTier)
        assertEquals(KeyTier.WRAPPER_TEE, res.tier)
    }

    @Test
    fun `setupWrapperKey passes requireBiometric and validity through`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias(any()) } returns false
        val authSlot = slot<Boolean>()
        val validitySlot = slot<Int>()
        every {
            keystore.generateAesKey("a5", any(), capture(authSlot), capture(validitySlot))
        } returns KeyTier.WRAPPER_STRONGBOX

        mgr.setupWrapperKey("a5", requireBiometric = true, userAuthValiditySec = 60)

        assertTrue(authSlot.captured)
        assertEquals(60, validitySlot.captured)
    }

    @Test
    fun `setupWrapperKey rejects blank alias`() {
        val mgr = mgrAtApi(28, strongBox = true)

        assertThrows(IllegalArgumentException::class.java) { mgr.setupWrapperKey("") }
        assertThrows(IllegalArgumentException::class.java) { mgr.setupWrapperKey("   ") }
    }

    // ─── wrap / unwrap roundtrip (7) ──────────────────────────────────────

    @Test
    fun `wrapEd25519Private rejects non-32-byte input`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias(any()) } returns true

        assertThrows(IllegalArgumentException::class.java) {
            mgr.wrapEd25519Private("a", ByteArray(31))
        }
        assertThrows(IllegalArgumentException::class.java) {
            mgr.wrapEd25519Private("a", ByteArray(33))
        }
        assertThrows(IllegalArgumentException::class.java) {
            mgr.wrapEd25519Private("a", ByteArray(0))
        }
    }

    @Test
    fun `wrapEd25519Private auto-creates alias when missing`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("auto") } returns false andThen true
        every {
            keystore.generateAesKey("auto", any(), false, any())
        } returns KeyTier.WRAPPER_STRONGBOX
        every { keystore.encryptAesGcm("auto", any()) } returns
            EncryptResult(ByteArray(12), ByteArray(48))

        mgr.wrapEd25519Private("auto", ByteArray(32) { it.toByte() })

        verify(exactly = 1) {
            keystore.generateAesKey("auto", any(), false, any())
        }
    }

    @Test
    fun `wrapEd25519Private result carries correct alias and version`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("a") } returns true
        every { keystore.encryptAesGcm("a", any()) } returns
            EncryptResult(ByteArray(12), ByteArray(48))

        val w = mgr.wrapEd25519Private("a", ByteArray(32))

        assertEquals("a", w.keystoreAlias)
        assertEquals(WrappedEd25519Key.CURRENT_VERSION, w.version)
    }

    @Test
    fun `wrap then unwrap restores plaintext`() {
        val mgr = mgrAtApi(28, strongBox = true)
        val priv = ByteArray(32) { (it * 7).toByte() }
        every { keystore.containsAlias("rk") } returns true
        every { keystore.encryptAesGcm("rk", priv) } returns
            EncryptResult(ByteArray(12) { 0xAB.toByte() }, ByteArray(48) { 0xCD.toByte() })
        every {
            keystore.decryptAesGcm("rk", any(), any())
        } returns priv

        val wrapped = mgr.wrapEd25519Private("rk", priv)
        val restored = mgr.unwrapEd25519Private(wrapped)

        assertArrayEquals(priv, restored)
    }

    @Test
    fun `unwrap throws when alias has been deleted`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("dead") } returns false
        val wrapped = WrappedEd25519Key(
            version = 1,
            keystoreAlias = "dead",
            iv = ByteArray(12),
            ciphertext = ByteArray(48),
        )

        assertThrows(KeystoreFacadeException::class.java) {
            mgr.unwrapEd25519Private(wrapped)
        }
    }

    @Test
    fun `unwrap propagates GCM tag mismatch as KeystoreFacadeException`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("bad") } returns true
        every {
            keystore.decryptAesGcm("bad", any(), any())
        } throws KeystoreFacadeException("GCM tag mismatch")
        val wrapped = WrappedEd25519Key(
            version = 1,
            keystoreAlias = "bad",
            iv = ByteArray(12),
            ciphertext = ByteArray(48),
        )

        assertThrows(KeystoreFacadeException::class.java) {
            mgr.unwrapEd25519Private(wrapped)
        }
    }

    @Test
    fun `unwrap rejects facade returning wrong-size plaintext`() {
        val mgr = mgrAtApi(28, strongBox = true)
        every { keystore.containsAlias("x") } returns true
        every {
            keystore.decryptAesGcm("x", any(), any())
        } returns ByteArray(31) // 不是 32 字节
        val wrapped = WrappedEd25519Key(
            version = 1,
            keystoreAlias = "x",
            iv = ByteArray(12),
            ciphertext = ByteArray(48),
        )

        assertThrows(KeystoreFacadeException::class.java) {
            mgr.unwrapEd25519Private(wrapped)
        }
    }

    // ─── WrappedEd25519Key invariants (4) ─────────────────────────────────

    @Test
    fun `WrappedEd25519Key rejects unsupported version`() {
        assertThrows(IllegalArgumentException::class.java) {
            WrappedEd25519Key(version = 99, keystoreAlias = "a", iv = ByteArray(12), ciphertext = ByteArray(48))
        }
    }

    @Test
    fun `WrappedEd25519Key rejects blank alias`() {
        assertThrows(IllegalArgumentException::class.java) {
            WrappedEd25519Key(version = 1, keystoreAlias = "", iv = ByteArray(12), ciphertext = ByteArray(48))
        }
    }

    @Test
    fun `WrappedEd25519Key rejects wrong-size IV`() {
        assertThrows(IllegalArgumentException::class.java) {
            WrappedEd25519Key(version = 1, keystoreAlias = "a", iv = ByteArray(11), ciphertext = ByteArray(48))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WrappedEd25519Key(version = 1, keystoreAlias = "a", iv = ByteArray(16), ciphertext = ByteArray(48))
        }
    }

    @Test
    fun `WrappedEd25519Key equality compares byte content`() {
        val a = WrappedEd25519Key(1, "a", ByteArray(12) { 1 }, ByteArray(48) { 2 })
        val b = WrappedEd25519Key(1, "a", ByteArray(12) { 1 }, ByteArray(48) { 2 })
        val c = WrappedEd25519Key(1, "a", ByteArray(12) { 1 }, ByteArray(48) { 3 })

        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
        assertNotEquals(a, c)
    }

    // ─── Native Ed25519 stub (2) ──────────────────────────────────────────

    @Test
    fun `isNativeEd25519Available reflects API level`() {
        every { keystore.isStrongBoxSupported() } returns false
        assertFalse(StrongBoxKeyManager(keystore, sdkInt = 32).isNativeEd25519Available())
        assertTrue(StrongBoxKeyManager(keystore, sdkInt = 33).isNativeEd25519Available())
        assertTrue(StrongBoxKeyManager(keystore, sdkInt = 34).isNativeEd25519Available())
    }

    @Test
    fun `signWithNativeEd25519 throws on both pre-API-33 and stub-not-implemented paths`() {
        every { keystore.isStrongBoxSupported() } returns false

        val pre33 = StrongBoxKeyManager(keystore, sdkInt = 32)
        assertThrows(UnsupportedOperationException::class.java) {
            pre33.signWithNativeEd25519("any", ByteArray(0))
        }

        val post33 = StrongBoxKeyManager(keystore, sdkInt = 33)
        // 当前 D1 桩，应该抛 UnsupportedOperationException 但消息不同
        val ex = assertThrows(UnsupportedOperationException::class.java) {
            post33.signWithNativeEd25519("any", ByteArray(0))
        }
        assertNotNull(ex.message)
        assertTrue(ex.message!!.contains("not yet implemented") || ex.message!!.contains("D1 stub"))
    }

    // ─── helpers ──────────────────────────────────────────────────────────

    private fun mgrAtApi(sdk: Int, strongBox: Boolean): StrongBoxKeyManager {
        every { keystore.isStrongBoxSupported() } returns strongBox
        return StrongBoxKeyManager(keystore, sdkInt = sdk)
    }
}
