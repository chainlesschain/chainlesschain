package com.chainlesschain.android.feature.p2p.benchmark

import android.content.Context
import androidx.benchmark.junit4.BenchmarkRule
import androidx.benchmark.junit4.measureRepeated
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.e2ee.identity.IdentityKeyManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.SafetyNumbers
import com.chainlesschain.android.core.e2ee.verification.SessionFingerprint
import com.chainlesschain.android.core.e2ee.x3dh.X3DHKeyExchange
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject

/**
 * P2P性能基准测试
 *
 * 测试关键操作的性能指标
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class P2PBenchmarkTest {

    @get:Rule
    val benchmarkRule = BenchmarkRule()

    @get:Rule
    var hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var identityKeyManager: IdentityKeyManager

    @Inject
    lateinit var sessionManager: PersistentSessionManager

    @Inject
    lateinit var keyExchange: X3DHKeyExchange

    private lateinit var context: Context

    @Before
    fun setup() {
        hiltRule.inject()
        context = ApplicationProvider.getApplicationContext()

        runBlocking {
            sessionManager.initialize(autoRestore = false, enableRotation = false)
        }
    }

    /**
     * 基准测试：身份密钥对生成
     *
     * 预期性能：< 100ms
     */
    @Test
    fun benchmarkIdentityKeyGeneration() {
        benchmarkRule.measureRepeated {
            identityKeyManager.generateIdentityKeyPair()
        }
    }

    /**
     * 基准测试：预密钥包生成
     *
     * 预期性能：< 200ms
     */
    @Test
    fun benchmarkPreKeyBundleGeneration() {
        benchmarkRule.measureRepeated {
            identityKeyManager.generatePreKeyBundle()
        }
    }

    /**
     * 基准测试：X3DH密钥交换
     *
     * 预期性能：< 300ms
     */
    @Test
    fun benchmarkX3DHKeyExchange() = runBlocking {
        val preKeyBundle = identityKeyManager.generatePreKeyBundle()

        benchmarkRule.measureRepeated {
            runBlocking {
                keyExchange.initiateSession(
                    remoteIdentityKey = preKeyBundle.identityKey,
                    remoteSignedPreKey = preKeyBundle.signedPreKey,
                    remoteOneTimePreKey = preKeyBundle.oneTimePreKey,
                    remoteSignature = preKeyBundle.signature
                )
            }
        }
    }

    /**
     * 基准测试：消息加密
     *
     * 预期性能：< 50ms for 1KB message
     */
    @Test
    fun benchmarkMessageEncryption() = runBlocking {
        val peerId = "benchmark_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(peerId, sharedSecret, true)

        val plaintext = ByteArray(1024) { it.toByte() } // 1KB message

        benchmarkRule.measureRepeated {
            runBlocking {
                sessionManager.encryptMessage(peerId, plaintext)
            }
        }
    }

    /**
     * 基准测试：消息解密
     *
     * 预期性能：< 50ms for 1KB message
     */
    @Test
    fun benchmarkMessageDecryption() = runBlocking {
        val peerId = "benchmark_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(peerId, sharedSecret, true)

        val plaintext = ByteArray(1024) { it.toByte() }
        val encrypted = sessionManager.encryptMessage(peerId, plaintext)

        benchmarkRule.measureRepeated {
            runBlocking {
                sessionManager.decryptMessage(peerId, encrypted)
            }
        }
    }

    /**
     * 基准测试：Safety Numbers生成
     *
     * 预期性能：< 100ms
     */
    @Test
    fun benchmarkSafetyNumbersGeneration() {
        val localId = "alice"
        val remoteId = "bob"
        val localKey = ByteArray(32) { 0x01 }
        val remoteKey = ByteArray(32) { 0x02 }

        benchmarkRule.measureRepeated {
            SafetyNumbers.generate(
                localIdentifier = localId,
                localPublicKey = localKey,
                remoteIdentifier = remoteId,
                remotePublicKey = remoteKey
            )
        }
    }

    /**
     * 基准测试：会话指纹生成
     *
     * 预期性能：< 10ms
     */
    @Test
    fun benchmarkSessionFingerprintGeneration() {
        val localKey = ByteArray(32) { 0x01 }
        val remoteKey = ByteArray(32) { 0x02 }
        val associatedData = "session".toByteArray()

        benchmarkRule.measureRepeated {
            SessionFingerprint.generate(
                localPublicKey = localKey,
                remotePublicKey = remoteKey,
                associatedData = associatedData
            )
        }
    }

    /**
     * 基准测试：会话创建
     *
     * 预期性能：< 100ms
     */
    @Test
    fun benchmarkSessionCreation() {
        var counter = 0

        benchmarkRule.measureRepeated {
            runBlocking {
                val peerId = "peer_${counter++}"
                val sharedSecret = ByteArray(32) { it.toByte() }

                sessionManager.createSession(peerId, sharedSecret, true)

                // Clean up
                sessionManager.deleteSession(peerId)
            }
        }
    }

    /**
     * 基准测试：会话持久化
     *
     * 预期性能：< 200ms
     */
    @Test
    fun benchmarkSessionPersistence() {
        var counter = 0

        benchmarkRule.measureRepeated {
            runBlocking {
                val peerId = "persist_peer_${counter++}"
                val sharedSecret = ByteArray(32) { it.toByte() }

                // Create and save
                sessionManager.createSession(peerId, sharedSecret, true)

                // Force save
                val sessionInfo = sessionManager.getSessionInfo(peerId)

                // Clean up
                sessionManager.deleteSession(peerId)
            }
        }
    }

    /**
     * 基准测试：大消息加密 (10KB)
     *
     * 预期性能：< 200ms
     */
    @Test
    fun benchmarkLargeMessageEncryption() = runBlocking {
        val peerId = "large_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(peerId, sharedSecret, true)

        val plaintext = ByteArray(10 * 1024) { it.toByte() } // 10KB

        benchmarkRule.measureRepeated {
            runBlocking {
                sessionManager.encryptMessage(peerId, plaintext)
            }
        }
    }

    /**
     * 基准测试：大消息解密 (10KB)
     *
     * 预期性能：< 200ms
     */
    @Test
    fun benchmarkLargeMessageDecryption() = runBlocking {
        val peerId = "large_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(peerId, sharedSecret, true)

        val plaintext = ByteArray(10 * 1024) { it.toByte() }
        val encrypted = sessionManager.encryptMessage(peerId, plaintext)

        benchmarkRule.measureRepeated {
            runBlocking {
                sessionManager.decryptMessage(peerId, encrypted)
            }
        }
    }

    /**
     * 基准测试：连续消息加密 (模拟对话)
     *
     * 预期性能：< 100ms per message
     */
    @Test
    fun benchmarkContinuousMessageEncryption() = runBlocking {
        val peerId = "continuous_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(peerId, sharedSecret, true)

        var messageCounter = 0

        benchmarkRule.measureRepeated {
            runBlocking {
                val plaintext = "Message ${messageCounter++}".toByteArray()
                sessionManager.encryptMessage(peerId, plaintext)
            }
        }
    }

    /**
     * 基准测试：QR码数据编码
     *
     * 预期性能：< 50ms
     */
    @Test
    fun benchmarkQRCodeDataEncoding() {
        val safetyNumber = "123456789012234567890123345678901234456789012345567890123456"
        val version = "1"

        benchmarkRule.measureRepeated {
            val qrData = "$version:$safetyNumber"
            val encoded = android.util.Base64.encodeToString(
                qrData.toByteArray(),
                android.util.Base64.NO_WRAP
            )
            encoded
        }
    }
}
