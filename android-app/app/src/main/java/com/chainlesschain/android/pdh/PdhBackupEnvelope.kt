package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import java.security.MessageDigest

/**
 * §8.3 跨设备备份 —— 加密块信封(纯逻辑核)—— module 101 Phase 7.
 *
 * 备份块 = "你持钥的加密块"(§8.3/§7.3):每个块带**明文内容哈希**(内容寻址,跨设备
 * 去重键 → 接 [PdhBackupSync.Block.hash])+ AES-256-GCM 的 iv/ciphertext。本核做:
 *  - 内容寻址([contentHash] = SHA-256(明文),与 iv/密钥无关 → 同内容跨设备同 hash);
 *  - 封装/解封([seal]/[open]),解封后**校验明文哈希**(防篡改 / 防错配密钥,不符即抛);
 *  - 转成增量同步块引用([toSyncBlock])。
 *
 * 真正的 AES-GCM 由注入的 [BackupCipher] 提供(生产实现 [keystoreCipher] 桥到
 * core-security 的 [KeystoreFacade];密钥由 DID 派生 §7.3,alias 管理是集成层)。
 * 信封结构 + 内容寻址 + 防篡改是**纯逻辑、可单测**;AES 本身已由 KeystoreFacade 覆盖。
 */
object PdhBackupEnvelope {

    /** 一个加密备份块。[contentHash] 是**明文** SHA-256(内容寻址/去重),非密文。 */
    data class EncryptedBlock(
        val assetKind: AssetKind,
        val contentHash: String,
        val iv: ByteArray,
        val ciphertext: ByteArray,
        val alg: String = "AES-256-GCM",
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is EncryptedBlock) return false
            return assetKind == other.assetKind &&
                contentHash == other.contentHash &&
                alg == other.alg &&
                iv.contentEquals(other.iv) &&
                ciphertext.contentEquals(other.ciphertext)
        }

        override fun hashCode(): Int {
            var h = assetKind.hashCode()
            h = 31 * h + contentHash.hashCode()
            h = 31 * h + alg.hashCode()
            h = 31 * h + iv.contentHashCode()
            h = 31 * h + ciphertext.contentHashCode()
            return h
        }
    }

    /** AES-GCM 封装/解封 seam。生产由 [keystoreCipher] 桥到 Keystore;测试可注入 fake。 */
    interface BackupCipher {
        fun seal(plaintext: ByteArray): EncryptResult
        fun open(iv: ByteArray, ciphertext: ByteArray): ByteArray
    }

    /** 明文内容哈希(SHA-256 hex)= 内容寻址键(同内容→同 hash,跨设备去重)。 */
    fun contentHash(plaintext: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(plaintext).joinToString("") { "%02x".format(it) }
    }

    /** 封装:加密明文 + 记录明文内容哈希(内容寻址)。 */
    fun seal(assetKind: AssetKind, plaintext: ByteArray, cipher: BackupCipher): EncryptedBlock {
        val r = cipher.seal(plaintext)
        return EncryptedBlock(assetKind, contentHash(plaintext), r.iv, r.ciphertext)
    }

    /**
     * 解封:解密后**校验明文哈希**与块记录一致 —— 不一致 = 被篡改 / 用错密钥 →
     * 抛 [IllegalStateException](绝不返回可疑明文)。
     */
    fun open(block: EncryptedBlock, cipher: BackupCipher): ByteArray {
        val plain = cipher.open(block.iv, block.ciphertext)
        check(contentHash(plain) == block.contentHash) {
            "backup block content-hash mismatch (tampered or wrong key)"
        }
        return plain
    }

    /** 转成增量同步用的内容寻址块引用(hash = 明文哈希 → 跨设备去重,接 [PdhBackupSync])。 */
    fun toSyncBlock(block: EncryptedBlock): PdhBackupSync.Block =
        PdhBackupSync.Block(block.assetKind, block.contentHash, block.ciphertext.size.toLong())

    /**
     * 生产 [BackupCipher]:桥到 core-security 的 [KeystoreFacade](真 AES-256-GCM +
     * StrongBox/TEE)。[alias] 对应的密钥由 DID 派生(§7.3)、调用方预先 generateAesKey。
     */
    fun keystoreCipher(facade: KeystoreFacade, alias: String): BackupCipher =
        object : BackupCipher {
            override fun seal(plaintext: ByteArray): EncryptResult =
                facade.encryptAesGcm(alias, plaintext)

            override fun open(iv: ByteArray, ciphertext: ByteArray): ByteArray =
                facade.decryptAesGcm(alias, iv, ciphertext)
        }
}
