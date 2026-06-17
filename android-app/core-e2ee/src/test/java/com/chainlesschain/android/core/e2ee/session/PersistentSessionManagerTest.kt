package com.chainlesschain.android.core.e2ee.session

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.storage.SessionStorage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.times
import org.mockito.kotlin.verifyBlocking

/**
 * [PersistentSessionManager] 的 initialize/autoRestore 单测（FAMILY-67 启动会话恢复关键路径）。
 *
 * 经 internal 构造注入 mock [SessionStorage]（生产用 Android Keystore-backed 实现，Robolectric
 * 跑不了）。本模块用 mockito-kotlin（非 mockk）。统一 enableRotation=false 避免起后台轮转计时器。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PersistentSessionManagerTest {

    /** 空存储：无身份密钥、无一次性预密钥、无已保存会话。 */
    private fun emptyStorage(): SessionStorage = mock {
        onBlocking { loadIdentityKeys() } doReturn null
        onBlocking { loadOneTimePreKeys() } doReturn emptyMap()
        onBlocking { getAllSessionIds() } doReturn emptyList()
    }

    @Test
    fun `initialize with autoRestore attempts session restore and provisions keys`() = runTest {
        val storage = emptyStorage()

        PersistentSessionManager(storage).initialize(autoRestore = true, enableRotation = false)

        verifyBlocking(storage) { getAllSessionIds() }             // FAMILY-67: restore attempted on boot
        verifyBlocking(storage) { saveIdentityKeys(any(), any()) } // no saved keys → generate + persist
        verifyBlocking(storage) { saveOneTimePreKeys(any()) }      // 0 prekeys → replenish + persist
    }

    @Test
    fun `initialize without autoRestore does not restore sessions`() = runTest {
        val storage = emptyStorage()

        PersistentSessionManager(storage).initialize(autoRestore = false, enableRotation = false)

        verifyBlocking(storage, never()) { getAllSessionIds() }
    }

    @Test
    fun `initialize is idempotent - second call returns early`() = runTest {
        val storage = emptyStorage()
        val psm = PersistentSessionManager(storage)

        psm.initialize(autoRestore = true, enableRotation = false)
        psm.initialize(autoRestore = true, enableRotation = false)

        // 已初始化标志 → 第二次应早返，密钥加载只发生一次
        verifyBlocking(storage, times(1)) { loadIdentityKeys() }
    }

    @Test
    fun `initialize reuses saved identity keys without regenerating`() = runTest {
        val storage = mock<SessionStorage> {
            onBlocking { loadIdentityKeys() } doReturn
                Pair(X25519KeyPair.generate(), X25519KeyPair.generate())
            onBlocking { loadOneTimePreKeys() } doReturn emptyMap()
            onBlocking { getAllSessionIds() } doReturn emptyList()
        }

        PersistentSessionManager(storage).initialize(autoRestore = true, enableRotation = false)

        // 已有保存的身份密钥 → 不应重新生成并覆盖保存
        verifyBlocking(storage, never()) { saveIdentityKeys(any(), any()) }
    }
}
