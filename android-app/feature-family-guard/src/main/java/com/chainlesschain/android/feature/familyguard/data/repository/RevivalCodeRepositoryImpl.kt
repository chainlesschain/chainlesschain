package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.RevivalCodeDao
import com.chainlesschain.android.feature.familyguard.data.entity.RevivalCodeEntity
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCodeVerification
import com.chainlesschain.android.feature.familyguard.domain.repository.RevivalCodeRepository
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-08 实装. 主文档 §3.1 v0.2 紧急解绑 + 复活码安全模型。
 *
 * 关键决策:
 *   - SecureRandom 使用平台默认 (Android 走 /dev/urandom; 测试走 fixed seed)
 *   - SHA-256 + 16 字节 salt; 不用 PBKDF2/Argon2, 因为 SQLCipher 已是第一道
 *     加密屏障 (主文档 §3.6 安全模型). 单 hash 速度让 verify 实时.
 *   - 锁 24h 是产品决策 (主文档 §3.1 "解绑需要 24h 冷却"); 与失败次数耦合
 *     防恶意暴破; 锁中再验直接拒, 不计入 failed_attempts (防加锁延长攻击)
 *   - SecureRandom + Clock 都通过构造器注入, 让单测 100% 可重现
 */
@Singleton
class RevivalCodeRepositoryImpl @Inject constructor(
    private val revivalCodeDao: RevivalCodeDao,
    private val clock: Clock,
    /** 测试可注入 fixed-seed SecureRandom; 生产走 SecureRandom() 默认。 */
    private val secureRandom: SecureRandom = SecureRandom(),
) : RevivalCodeRepository {

    override suspend fun generateNewCode(familyRelationshipId: Long?): RevivalCode {
        val plaintext = nextSixDigitCode()
        val salt = nextSalt()
        val hash = hashCode(plaintext, salt)
        val entity = RevivalCodeEntity(
            familyRelationshipId = familyRelationshipId,
            codeHash = hash,
            salt = salt,
            createdAt = clock.millis(),
        )
        revivalCodeDao.insert(entity)
        return RevivalCode(plaintext)
    }

    override suspend fun verify(input: RevivalCode): RevivalCodeVerification {
        val candidates = revivalCodeDao.listAvailable()
        if (candidates.isEmpty()) return RevivalCodeVerification.NoCodeRegistered

        val now = clock.millis()

        // 优先检查全局锁: 任一 entity locked_until > now → 直接拒, 不递增 attempts
        candidates.firstOrNull { it.lockedUntil != null && it.lockedUntil > now }
            ?.let { return RevivalCodeVerification.LockedOut(unlockAtMs = it.lockedUntil!!) }

        // 比对每一条 active code (一般 0 或 1 条); 任一 hash 命中即 Success
        val match = candidates.firstOrNull { entity ->
            hashCode(input.value, entity.salt) == entity.codeHash
        }
        if (match != null) {
            if (match.consumedAt != null) return RevivalCodeVerification.AlreadyConsumed
            revivalCodeDao.markConsumed(id = match.id, consumedAt = now)
            return RevivalCodeVerification.Success(
                familyRelationshipId = match.familyRelationshipId,
            )
        }

        // 错码: 在每一个 active code 上记录失败 (因为攻击者不知是哪个 code 上错的)
        var minRemaining = MAX_FAILED_ATTEMPTS
        candidates.forEach { entity ->
            val nextFailed = entity.failedAttempts + 1
            val nextLocked = if (nextFailed >= MAX_FAILED_ATTEMPTS) {
                now + LOCKOUT_DURATION_MS
            } else null
            revivalCodeDao.updateFailedAttempts(
                id = entity.id,
                failedAttempts = nextFailed,
                lockedUntil = nextLocked,
            )
            val remaining = (MAX_FAILED_ATTEMPTS - nextFailed).coerceAtLeast(0)
            if (remaining < minRemaining) minRemaining = remaining
        }
        if (minRemaining == 0) {
            return RevivalCodeVerification.LockedOut(unlockAtMs = now + LOCKOUT_DURATION_MS)
        }
        return RevivalCodeVerification.WrongCode(remainingAttempts = minRemaining)
    }

    override suspend fun hasActiveCode(): Boolean =
        revivalCodeDao.listAvailable().isNotEmpty()

    override suspend fun clearAll() {
        revivalCodeDao.listAvailable().forEach { revivalCodeDao.deleteById(it.id) }
    }

    // ─── 内部工具 (internal for tests) ───

    /** 生成 [100000, 1000000) 范围 6 位数字 (CSPRNG). */
    internal fun nextSixDigitCode(): String {
        val range = RevivalCode.MAX_VALUE_EXCLUSIVE - RevivalCode.MIN_VALUE
        val n = secureRandom.nextInt(range) + RevivalCode.MIN_VALUE
        return n.toString()
    }

    /** 16 字节 salt → hex 32 字符. */
    internal fun nextSalt(): String {
        val bytes = ByteArray(SALT_LENGTH_BYTES)
        secureRandom.nextBytes(bytes)
        return bytes.toHex()
    }

    /** SHA-256(salt || code) → hex 64 字符. */
    internal fun hashCode(plaintext: String, saltHex: String): String {
        val saltBytes = saltHex.hexToBytes()
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(saltBytes)
        digest.update(plaintext.toByteArray(Charsets.UTF_8))
        return digest.digest().toHex()
    }

    companion object {
        const val MAX_FAILED_ATTEMPTS = 3
        const val LOCKOUT_DURATION_MS: Long = 24L * 60L * 60L * 1000L
        const val SALT_LENGTH_BYTES = 16
    }
}

private fun ByteArray.toHex(): String =
    joinToString("") { "%02x".format(it) }

private fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0) { "hex string must have even length" }
    return ByteArray(length / 2) { i ->
        substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}
