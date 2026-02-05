package com.chainlesschain.android.remote.crypto

import android.util.Base64
import io.mockk.*
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * DIDSigner 单元测试
 *
 * 测试 Ed25519 签名和验证功能
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DIDSignerTest {

    private lateinit var keyStore: DIDKeyStore
    private lateinit var keyGenerator: DIDKeyGenerator
    private lateinit var signer: DIDSigner

    private val testDid = "did:key:test123"
    private val testData = "Hello, ChainlessChain!"

    @Before
    fun setup() {
        // Mock Android Base64
        mockkStatic(Base64::class)
        every { Base64.encodeToString(any(), any()) } answers {
            java.util.Base64.getEncoder().encodeToString(firstArg())
        }
        every { Base64.decode(any<String>(), any()) } answers {
            java.util.Base64.getDecoder().decode(firstArg<String>())
        }
        every { Base64.decode(any<ByteArray>(), any()) } answers {
            firstArg()
        }

        // 初始化真实的密钥存储和生成器
        keyStore = AndroidDIDKeyStore()
        keyGenerator = DIDKeyGenerator(keyStore)
        signer = DIDSigner(keyStore)
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `生成密钥对成功`() = runTest {
        // When
        val result = keyGenerator.generateKeyPair(testDid)

        // Then
        assertTrue("密钥对生成应该成功", result.isSuccess)
        val keyPairInfo = result.getOrNull()
        assertNotNull("密钥对信息不应为空", keyPairInfo)
        assertEquals("算法应为 Ed25519", "Ed25519", keyPairInfo?.algorithm)
        assertTrue("公钥不应为空", keyPairInfo?.publicKey?.isNotEmpty() == true)
    }

    @Test
    fun `签名和验证成功`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()
        val publicKeyBase64 = keyGenerator.getPublicKey(testDid).getOrThrow()

        // When - 签名
        val signResult = signer.sign(testData, testDid)
        assertTrue("签名应该成功", signResult.isSuccess)
        val signature = signResult.getOrThrow()

        // Then - 验证
        val verifyResult = signer.verify(testData, signature, publicKeyBase64)
        assertTrue("验证应该成功", verifyResult.isSuccess)
        assertTrue("签名应该有效", verifyResult.getOrThrow())
    }

    @Test
    fun `验证错误的签名失败`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()
        val publicKeyBase64 = keyGenerator.getPublicKey(testDid).getOrThrow()

        // 创建一个假的签名（64字节全为0）
        val fakeSignature = java.util.Base64.getEncoder().encodeToString(ByteArray(64))

        // When
        val verifyResult = signer.verify(testData, fakeSignature, publicKeyBase64)

        // Then
        assertTrue("验证应该成功执行", verifyResult.isSuccess)
        assertFalse("假签名应该无效", verifyResult.getOrThrow())
    }

    @Test
    fun `签名不同数据产生不同签名`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()
        val data1 = "Message 1"
        val data2 = "Message 2"

        // When
        val signature1 = signer.sign(data1, testDid).getOrThrow()
        val signature2 = signer.sign(data2, testDid).getOrThrow()

        // Then
        assertNotEquals("不同数据应产生不同签名", signature1, signature2)
    }

    @Test
    fun `导入密钥对成功`() = runTest {
        // Given - 生成原始密钥对
        val originalKeyPair = keyGenerator.generateKeyPair(testDid).getOrThrow()
        val privateKeyBytes = keyStore.getPrivateKey(testDid)!!
        val privateKeyBase64 = java.util.Base64.getEncoder().encodeToString(privateKeyBytes)

        // When - 使用新DID导入相同私钥
        val newDid = "did:key:imported"
        val importResult = keyGenerator.importKeyPair(newDid, privateKeyBase64)

        // Then
        assertTrue("导入应该成功", importResult.isSuccess)
        val importedKeyPair = importResult.getOrThrow()
        assertEquals("公钥应该相同", originalKeyPair.publicKey, importedKeyPair.publicKey)
    }

    @Test
    fun `签名不存在的DID失败`() = runTest {
        // When
        val result = signer.sign(testData, "did:key:nonexistent")

        // Then
        assertTrue("签名应该失败", result.isFailure)
        assertTrue(
            "错误信息应包含'not found'",
            result.exceptionOrNull()?.message?.contains("not found", ignoreCase = true) == true
        )
    }

    @Test
    fun `验证无效公钥长度失败`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()
        val signature = signer.sign(testData, testDid).getOrThrow()

        // 创建错误长度的公钥（16字节而不是32字节）
        val invalidPublicKey = java.util.Base64.getEncoder().encodeToString(ByteArray(16))

        // When
        val result = signer.verify(testData, signature, invalidPublicKey)

        // Then
        assertTrue("验证应该失败", result.isFailure)
    }

    @Test
    fun `哈希功能正常工作`() {
        // When
        val hash1 = signer.hash(testData)
        val hash2 = signer.hash(testData)
        val hash3 = signer.hash("Different data")

        // Then
        assertNotNull("哈希不应为空", hash1)
        assertEquals("相同数据应产生相同哈希", hash1, hash2)
        assertNotEquals("不同数据应产生不同哈希", hash1, hash3)
    }

    @Test
    fun `Ed25519签名长度为64字节`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()

        // When
        val signature = signer.sign(testData, testDid).getOrThrow()
        val signatureBytes = java.util.Base64.getDecoder().decode(signature)

        // Then
        assertEquals("Ed25519签名长度应为64字节", 64, signatureBytes.size)
    }

    @Test
    fun `Ed25519公钥长度为32字节`() = runTest {
        // Given
        keyGenerator.generateKeyPair(testDid).getOrThrow()

        // When
        val publicKeyBase64 = keyGenerator.getPublicKey(testDid).getOrThrow()
        val publicKeyBytes = java.util.Base64.getDecoder().decode(publicKeyBase64)

        // Then
        assertEquals("Ed25519公钥长度应为32字节", 32, publicKeyBytes.size)
    }
}
