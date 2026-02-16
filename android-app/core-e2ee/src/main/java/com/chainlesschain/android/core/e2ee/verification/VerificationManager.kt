package com.chainlesschain.android.core.e2ee.verification

import android.content.Context
import timber.log.Timber
import com.chainlesschain.android.core.e2ee.session.E2EESession
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 验证管理器
 *
 * 管理会话的安全验证，包括 Safety Numbers 和会话指纹
 */
@Singleton
class VerificationManager @Inject constructor(
    @ApplicationContext private val context: Context
) {

    // 已验证的会话
    private val verifiedSessions = mutableMapOf<String, VerifiedSession>()
    private val mutex = Mutex()

    /**
     * 生成会话的完整验证信息
     *
     * @param peerId 对等方ID
     * @param localIdentifier 本地标识符（DID）
     * @param localPublicKey 本地公钥
     * @param remoteIdentifier 远程标识符（DID）
     * @param remotePublicKey 远程公钥
     * @param associatedData 会话关联数据
     * @return 完整验证信息
     */
    fun generateVerificationInfo(
        peerId: String,
        localIdentifier: String,
        localPublicKey: ByteArray,
        remoteIdentifier: String,
        remotePublicKey: ByteArray,
        associatedData: ByteArray
    ): CompleteVerificationInfo {
        Timber.d("Generating verification info for peer: $peerId")

        // 生成 Safety Number
        val safetyNumber = SafetyNumbers.generate(
            localIdentifier,
            localPublicKey,
            remoteIdentifier,
            remotePublicKey
        )

        // 生成会话指纹
        val fingerprint = SessionFingerprint.generate(
            localPublicKey,
            remotePublicKey,
            associatedData
        )

        val shortFingerprint = SessionFingerprint.generateShort(fingerprint)
        val formattedFingerprint = SessionFingerprint.format(fingerprint)
        val colorFingerprint = SessionFingerprint.generateColorFingerprint(fingerprint)

        // 生成二维码数据
        val qrCodeData = SafetyNumbers.generateQRCodeData(
            localIdentifier,
            localPublicKey,
            remoteIdentifier,
            remotePublicKey
        )

        return CompleteVerificationInfo(
            peerId = peerId,
            safetyNumber = safetyNumber,
            sessionFingerprint = fingerprint,
            shortFingerprint = shortFingerprint,
            formattedFingerprint = formattedFingerprint,
            colorFingerprint = colorFingerprint,
            qrCodeData = qrCodeData,
            localIdentifier = localIdentifier,
            remoteIdentifier = remoteIdentifier,
            isVerified = false,
            verifiedAt = null
        )
    }

    /**
     * 标记会话为已验证
     *
     * @param peerId 对等方ID
     * @param verificationMethod 验证方法
     */
    suspend fun markAsVerified(
        peerId: String,
        verificationMethod: VerificationMethod
    ) = mutex.withLock {
        Timber.i("Marking session as verified for peer: $peerId")

        val verifiedSession = VerifiedSession(
            peerId = peerId,
            verifiedAt = System.currentTimeMillis(),
            verificationMethod = verificationMethod
        )

        verifiedSessions[peerId] = verifiedSession

        Timber.i("Session verified for peer: $peerId")
    }

    /**
     * 取消验证
     *
     * @param peerId 对等方ID
     */
    suspend fun unmarkAsVerified(peerId: String) = mutex.withLock {
        verifiedSessions.remove(peerId)
        Timber.i("Session verification removed for peer: $peerId")
    }

    /**
     * 检查会话是否已验证
     *
     * @param peerId 对等方ID
     * @return 是否已验证
     */
    suspend fun isVerified(peerId: String): Boolean = mutex.withLock {
        verifiedSessions.containsKey(peerId)
    }

    /**
     * 获取验证信息
     *
     * @param peerId 对等方ID
     * @return 验证信息，如果未验证返回null
     */
    suspend fun getVerificationInfo(peerId: String): VerifiedSession? = mutex.withLock {
        verifiedSessions[peerId]
    }

    /**
     * 验证二维码
     *
     * @param qrCodeData 扫描的二维码数据
     * @param localIdentifier 本地标识符
     * @param localPublicKey 本地公钥
     * @return 验证结果
     */
    fun verifyQRCode(
        qrCodeData: String,
        localIdentifier: String,
        localPublicKey: ByteArray
    ): VerificationResult {
        return SafetyNumbers.verifyQRCodeData(qrCodeData, localIdentifier, localPublicKey)
    }

    /**
     * 比较安全码
     *
     * @param safetyNumber1 安全码1
     * @param safetyNumber2 安全码2
     * @return 是否匹配
     */
    fun compareSafetyNumbers(safetyNumber1: String, safetyNumber2: String): Boolean {
        return SafetyNumbers.compare(safetyNumber1, safetyNumber2)
    }

    /**
     * 验证会话指纹
     *
     * @param localPublicKey 本地公钥
     * @param remotePublicKey 远程公钥
     * @param associatedData 关联数据
     * @param expectedFingerprint 期望的指纹
     * @return 是否匹配
     */
    fun verifySessionFingerprint(
        localPublicKey: ByteArray,
        remotePublicKey: ByteArray,
        associatedData: ByteArray,
        expectedFingerprint: String
    ): Boolean {
        return SessionFingerprint.verify(
            localPublicKey,
            remotePublicKey,
            associatedData,
            expectedFingerprint
        )
    }

    /**
     * 获取所有已验证的会话
     */
    suspend fun getAllVerifiedSessions(): List<VerifiedSession> = mutex.withLock {
        verifiedSessions.values.toList()
    }

    /**
     * 清除所有验证
     */
    suspend fun clearAll() = mutex.withLock {
        verifiedSessions.clear()
        Timber.i("All session verifications cleared")
    }
}

/**
 * 完整验证信息
 */
data class CompleteVerificationInfo(
    /** 对等方ID */
    val peerId: String,

    /** 安全码（60位数字） */
    val safetyNumber: String,

    /** 会话指纹（完整） */
    val sessionFingerprint: String,

    /** 简短指纹 */
    val shortFingerprint: String,

    /** 格式化指纹 */
    val formattedFingerprint: String,

    /** 彩色指纹 */
    val colorFingerprint: List<FingerprintColor>,

    /** 二维码数据 */
    val qrCodeData: String,

    /** 本地标识符 */
    val localIdentifier: String,

    /** 远程标识符 */
    val remoteIdentifier: String,

    /** 是否已验证 */
    val isVerified: Boolean,

    /** 验证时间 */
    val verifiedAt: Long?
)

/**
 * 已验证的会话
 */
data class VerifiedSession(
    /** 对等方ID */
    val peerId: String,

    /** 验证时间 */
    val verifiedAt: Long,

    /** 验证方法 */
    val verificationMethod: VerificationMethod
)

/**
 * 验证方法
 */
enum class VerificationMethod {
    /** 二维码扫描 */
    QR_CODE_SCAN,

    /** 手动比较安全码 */
    MANUAL_SAFETY_NUMBER,

    /** 语音验证 */
    VOICE_CALL,

    /** 第三方验证 */
    THIRD_PARTY,

    /** 其他 */
    OTHER
}
