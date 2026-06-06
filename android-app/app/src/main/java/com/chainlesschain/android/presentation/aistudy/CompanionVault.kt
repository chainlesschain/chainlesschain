package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 陪伴 tab 的一条聊天记录 (主文档 §3.6 Companion TEE Vault `chat_messages`)。
 * 只存 是否用户 / 文本 / 时间 —— 角色护栏/system prompt 不入库。
 */
data class CompanionChatRecord(
    val isUser: Boolean,
    val content: String,
    val timestamp: Long,
)

/**
 * 陪伴 tab 的私密加密金库 (主文档 §3.6 v0.2 Companion TEE Vault)。
 *
 * **隐私契约**：明文经 Android Keystore (StrongBox 硬件支持时) 的 AES-256-GCM 加密后落盘。
 * 解密 key 永不出 Keystore —— **家长端即使 root + dump 整个 /data/data，拿到的也是密文**。
 * 该金库目录带 [SYNC_EXCLUDE_DIR_NAME] 标志，Sync engine 必须整目录跳过、永不上行。
 *
 * 全部方法 `suspend` 且实现内部跳到 [Dispatchers.IO]：Keystore 操作绝不能在主线程跑
 * (StrongBox 解锁会 ANR，见 memory android_main_thread_keystore_anr)。
 */
interface CompanionVault {
    suspend fun load(): List<CompanionChatRecord>
    suspend fun append(record: CompanionChatRecord)
    suspend fun clear()

    companion object {
        /** 金库所在子目录名；Sync engine 见此目录直接跳过 (TEE-only)。 */
        const val SYNC_EXCLUDE_DIR_NAME = "companion_vault"

        /** 目录内的"勿同步"哨兵文件名，供 Sync engine 双保险识别。 */
        const val SYNC_EXCLUDE_MARKER = ".tee-only-no-sync"
    }
}

/**
 * 加密金库存储后端 (字节级 read/write/delete)。
 *
 * 接口化把唯一的设备相关部分 (文件 I/O) 隔离出去，使 [EncryptedCompanionVault] 的
 * 加解密 + 序列化逻辑可在 JVM 单测里用内存 fake 跑透。生产实现 [FileVaultStorage]。
 */
interface VaultStorage {
    fun read(): ByteArray?
    fun write(bytes: ByteArray)
    fun delete()
}

/**
 * 陪伴聊天记录 ↔ 字节 的序列化 (纯逻辑，可单测)。
 *
 * 长度前缀二进制格式，避免文本分隔符转义问题；UTF-8 任意长度。
 */
object CompanionVaultCodec {
    private const val VERSION = 1

    fun encode(records: List<CompanionChatRecord>): ByteArray {
        val bos = ByteArrayOutputStream()
        DataOutputStream(bos).use { out ->
            out.writeInt(VERSION)
            out.writeInt(records.size)
            for (r in records) {
                out.writeBoolean(r.isUser)
                out.writeLong(r.timestamp)
                val bytes = r.content.toByteArray(Charsets.UTF_8)
                out.writeInt(bytes.size)
                out.write(bytes)
            }
        }
        return bos.toByteArray()
    }

    /** @throws IllegalStateException 格式损坏 (由调用方决定是否吞成空列表)。 */
    fun decode(bytes: ByteArray): List<CompanionChatRecord> {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            val version = input.readInt()
            check(version == VERSION) { "unsupported vault version $version" }
            val count = input.readInt()
            check(count in 0..MAX_RECORDS) { "implausible record count $count" }
            val out = ArrayList<CompanionChatRecord>(count)
            repeat(count) {
                val isUser = input.readBoolean()
                val ts = input.readLong()
                val len = input.readInt()
                check(len in 0..MAX_CONTENT_BYTES) { "implausible content length $len" }
                val buf = ByteArray(len)
                input.readFully(buf)
                out += CompanionChatRecord(isUser, String(buf, Charsets.UTF_8), ts)
            }
            return out
        }
    }

    private const val MAX_RECORDS = 1_000_000
    private const val MAX_CONTENT_BYTES = 16 * 1024 * 1024
}

/**
 * [CompanionVault] 默认实现：序列化 → Keystore AES-256-GCM 加密 → 落 [VaultStorage]。
 *
 * 每次 append 走 read-modify-write 全量重新加密 (MVP 规模够用)；[Mutex] 串行化避免
 * 并发读改写丢数据。解密失败 (key 被轮换/密文损坏) → 返回空列表而非崩溃。
 */
@Singleton
class EncryptedCompanionVault @Inject constructor(
    private val keystore: KeystoreFacade,
    private val storage: VaultStorage,
) : CompanionVault {

    private val mutex = Mutex()

    override suspend fun load(): List<CompanionChatRecord> = withContext(Dispatchers.IO) {
        mutex.withLock { readDecrypt() }
    }

    override suspend fun append(record: CompanionChatRecord) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val current = readDecrypt().toMutableList()
            current += record
            writeEncrypt(current)
        }
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock { storage.delete() }
    }

    private fun readDecrypt(): List<CompanionChatRecord> {
        val blob = storage.read() ?: return emptyList()
        return try {
            val (iv, ciphertext) = unframe(blob)
            val plain = keystore.decryptAesGcm(VAULT_ALIAS, iv, ciphertext)
            CompanionVaultCodec.decode(plain)
        } catch (e: Exception) {
            // key 轮换 / 密文损坏 / 格式漂移 → 不可读，按空历史处理 (不暴露原文、不崩)。
            Timber.w(e, "companion vault unreadable, treating as empty")
            emptyList()
        }
    }

    private fun writeEncrypt(records: List<CompanionChatRecord>) {
        ensureKey()
        val plain = CompanionVaultCodec.encode(records)
        val enc = keystore.encryptAesGcm(VAULT_ALIAS, plain)
        storage.write(frame(enc.iv, enc.ciphertext))
    }

    private fun ensureKey() {
        if (!keystore.containsAlias(VAULT_ALIAS)) {
            // 请求 StrongBox；facade 在无 StrongBox 时静默降级到 TEE。
            keystore.generateAesKey(
                alias = VAULT_ALIAS,
                requestedTier = KeyTier.WRAPPER_STRONGBOX,
                requireUserAuthentication = false,
                userAuthenticationValiditySeconds = 0,
            )
        }
    }

    /** 帧格式：[4-byte iv 长度][iv][ciphertext]。 */
    private fun frame(iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream(4 + iv.size + ciphertext.size)
        DataOutputStream(bos).use { out ->
            out.writeInt(iv.size)
            out.write(iv)
            out.write(ciphertext)
        }
        return bos.toByteArray()
    }

    private fun unframe(blob: ByteArray): Pair<ByteArray, ByteArray> {
        DataInputStream(ByteArrayInputStream(blob)).use { input ->
            val ivLen = input.readInt()
            check(ivLen in 1..64) { "implausible iv length $ivLen" }
            val iv = ByteArray(ivLen)
            input.readFully(iv)
            val ciphertext = input.readBytes()
            return iv to ciphertext
        }
    }

    private companion object {
        const val VAULT_ALIAS = "cc_companion_tee_vault"
    }
}
