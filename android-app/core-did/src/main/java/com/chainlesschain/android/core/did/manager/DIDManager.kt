package com.chainlesschain.android.core.did.manager

import android.content.Context
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPairJson
import com.chainlesschain.android.core.did.crypto.SignatureUtils
import com.chainlesschain.android.core.did.crypto.TimestampedSignature
import com.chainlesschain.android.core.did.crypto.hexToByteArray
import com.chainlesschain.android.core.did.crypto.toHexString
import com.chainlesschain.android.core.did.generator.DidKeyGenerator
import com.chainlesschain.android.core.did.model.DIDDocument
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import com.chainlesschain.android.core.did.wallet.DIDIdentityMeta
import com.chainlesschain.android.core.did.wallet.NewIdentityResult
import com.chainlesschain.android.core.did.wallet.MnemonicService
import com.chainlesschain.android.core.did.wallet.WalletIdentityEntry
import com.chainlesschain.android.core.did.wallet.WalletStorage
import com.chainlesschain.android.core.did.wallet.WrappedPrivateKeyStorage
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import com.chainlesschain.android.core.security.strongbox.WrappedEd25519Key
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID 管理器（v0.2 wallet 形态）。
 *
 * 与旧版（v0.1）相比的变化：
 *  - 多 DID 钱包（[identities] map + [activeDid] 指针），不再仅持单 DID
 *  - 私钥加密落盘（[StrongBoxKeyManager.wrapEd25519Private]），不再明文 JSON
 *  - 助记词（BIP-39，[MnemonicService]）支持，可恢复
 *  - 旧 `did_keypair.json` 明文格式自动迁移到 `did_wallet.json`，旧文件 rename 备份
 *
 * 公开 API 向后兼容：
 *  - [currentIdentity] / [sign] / [verify] / [createIdentity] / [trustedDevicesList] 等
 *    保持不变；现有调用方无需修改
 *  - 新增：[createIdentityWithMnemonic] / [importFromMnemonic] / [listIdentities]
 *    / [switchActive] / [markMnemonicVerified]
 *
 * 设计文档：`docs/design/Android_重新定位_设计文档.md` v0.2 §5.2 + ADR-2。
 */
@Singleton
class DIDManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val didKeyResolver: DidKeyResolver,
    private val strongBoxKeyManager: StrongBoxKeyManager,
    private val mnemonicService: MnemonicService,
) {

    companion object {
        private const val TRUSTED_DEVICES_FILE = "trusted_devices.json"
        private const val WRAP_ALIAS_PREFIX = "did_wrap_"
        private const val WRAP_ALIAS_HASH_BYTES = 8
    }

    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }

    /** DID → 内存中的完整身份（含解密后的密钥对）。 */
    private val identities = mutableMapOf<String, DIDIdentity>()

    /** DID → 元数据（mnemonicVerified / hasMnemonic）。 */
    private val entryMeta = mutableMapOf<String, EntryMetadata>()

    /**
     * Wrap 缓存：`saveWallet` 不再每次重新加密 32-byte 私钥（否则 biometric-bound
     * DID 每次切换 active 都要重新认证）。仅在 [finishAddIdentity] / 显式 rotation
     * 时填入；[loadEntry] 从磁盘 hydrate；其余 save 操作复用缓存的密文。
     */
    private val wrappedCache = mutableMapOf<String, WrappedPrivateKeyStorage>()

    /** 当前激活的 DID。 */
    private var activeDid: String? = null

    private val _currentIdentity = MutableStateFlow<DIDIdentity?>(null)
    val currentIdentity: StateFlow<DIDIdentity?> = _currentIdentity.asStateFlow()

    private val trustedDevices = mutableMapOf<String, TrustedDevice>()
    private val _trustedDevicesList = MutableStateFlow<List<TrustedDevice>>(emptyList())
    val trustedDevicesList: StateFlow<List<TrustedDevice>> = _trustedDevicesList.asStateFlow()

    // ─── lifecycle ──────────────────────────────────────────────────────

    /**
     * 初始化：尝试 1）加载现有 wallet；2）迁移旧明文格式；3）创建新 DID 作为兜底。
     */
    suspend fun initialize() = withContext(Dispatchers.IO) {
        // 全程切到 IO 线程：loadWallet→loadEntry→StrongBoxKeyManager.unwrapEd25519Private
        // 是阻塞式 Android Keystore (StrongBox) 调用，部分机型 (小米 amethyst) 单次解密
        // 可达数秒。早期 init { viewModelScope.launch { didManager.initialize() } } 默认
        // 跑在 Dispatchers.Main → 进社交页时主线程卡 >5s → ANR("点社交会卡住")。
        Timber.i("Initializing DID Manager (v0.2 wallet)")

        if (loadWallet()) {
            Timber.i("Wallet loaded with ${identities.size} identities, active=$activeDid")
        } else if (migrateLegacyPlaintext()) {
            Timber.i("Legacy plaintext DID migrated to encrypted wallet")
        } else {
            createIdentity(defaultDeviceName())
            Timber.i("Fresh DID created (no existing identity)")
        }

        loadTrustedDevices()
    }

    // ─── identity creation ──────────────────────────────────────────────

    /**
     * **向后兼容入口**：以纯随机熵创建新 DID。不返回助记词——这意味着用户**无法恢复**
     * 该 DID。新代码应改用 [createIdentityWithMnemonic] 或 [importFromMnemonic]。
     *
     * @param requireBiometric true 时该 DID 的 wrapper key 绑定 BiometricPrompt；UI
     * 层负责在 sign/switchActive 前调起 [BiometricAuthenticator.authenticate]。
     */
    fun createIdentity(
        deviceName: String = defaultDeviceName(),
        requireBiometric: Boolean = false,
    ): DIDIdentity {
        Timber.w(
            "createIdentity(no-mnemonic) called — user has no backup path. " +
                "Prefer createIdentityWithMnemonic for production flows."
        )
        val keyPair = Ed25519KeyPair.generate()
        return finishAddIdentity(
            keyPair = keyPair,
            deviceName = deviceName,
            hasMnemonic = false,
            mnemonicVerified = false,
            requireBiometric = requireBiometric,
        )
    }

    /**
     * 创建新 DID 并生成 24 字 BIP-39 助记词（256-bit entropy）。
     *
     * 调用者（UI）负责一次性展示 [NewIdentityResult.mnemonic] 给用户抄写，并通过
     * [markMnemonicVerified] 确认。**助记词永不持久化**，丢失即无法恢复。
     *
     * @param requireBiometric true 时该 DID 的 wrapper key 绑定 BiometricPrompt。
     */
    fun createIdentityWithMnemonic(
        deviceName: String = defaultDeviceName(),
        requireBiometric: Boolean = false,
    ): NewIdentityResult {
        val mnemonic = mnemonicService.generate()
        val seed = mnemonicService.toEd25519Seed(mnemonic)
        val keyPair = Ed25519KeyPair.fromPrivateKey(seed)
        val identity = finishAddIdentity(
            keyPair = keyPair,
            deviceName = deviceName,
            hasMnemonic = true,
            mnemonicVerified = false,
            requireBiometric = requireBiometric,
        )
        return NewIdentityResult(identity, mnemonic)
    }

    /**
     * 从已有助记词恢复 DID 到本设备钱包。
     *
     * - 若 derived DID 已在钱包中，则切换为 active 并返回已有身份
     * - 若是新 DID，则添加到钱包；[DIDIdentityMeta.mnemonicVerified] 默认 true（用户能写
     *   出助记词即已具备备份能力）
     *
     * @param requireBiometric true 时该 DID 的 wrapper key 绑定 BiometricPrompt。
     * 若 DID 已在钱包中，此参数被**忽略**（已有 entry 的 requireBiometric 不变）。
     *
     * @throws IllegalArgumentException 助记词非法
     */
    fun importFromMnemonic(
        words: List<String>,
        deviceName: String = defaultDeviceName(),
        requireBiometric: Boolean = false,
    ): DIDIdentity {
        require(mnemonicService.validate(words)) { "Invalid mnemonic phrase" }

        val seed = mnemonicService.toEd25519Seed(words)
        val keyPair = Ed25519KeyPair.fromPrivateKey(seed)
        val did = DidKeyGenerator.generate(keyPair)

        identities[did]?.let { existing ->
            Timber.i("Mnemonic import: DID $did already in wallet, switching active")
            switchActive(did)
            return existing
        }

        return finishAddIdentity(
            keyPair = keyPair,
            deviceName = deviceName,
            hasMnemonic = true,
            mnemonicVerified = true,
            requireBiometric = requireBiometric,
        )
    }

    /**
     * 查询某个 DID 是否需要 BiometricPrompt。
     *
     * UI 层在调用 [switchActive] / [sign] / [signWithTimestamp] 前应先调此方法，
     * true 则触发 [BiometricAuthenticator.authenticate]（在 feature-auth）。
     */
    fun requiresBiometric(did: String): Boolean {
        return entryMeta[did]?.requireBiometric ?: false
    }

    // ─── wallet management ──────────────────────────────────────────────

    /** 列出钱包中所有 DID 的元数据。 */
    fun listIdentities(): List<DIDIdentityMeta> {
        return identities.values.map { identity ->
            val meta = entryMeta[identity.did] ?: EntryMetadata.DEFAULT
            DIDIdentityMeta(
                did = identity.did,
                deviceName = identity.deviceName,
                createdAt = identity.createdAt,
                isActive = identity.did == activeDid,
                mnemonicVerified = meta.mnemonicVerified,
                hasMnemonic = meta.hasMnemonic,
                requireBiometric = meta.requireBiometric,
            )
        }
    }

    /**
     * 切换激活的 DID。
     *
     * @return false 表示 [did] 不在钱包内；true 表示切换成功并已持久化
     */
    fun switchActive(did: String): Boolean {
        val identity = identities[did] ?: return false
        activeDid = did
        _currentIdentity.value = identity
        saveWallet()
        Timber.i("Active DID switched to: $did")
        return true
    }

    /**
     * 用户确认已抄录助记词。
     *
     * @return false 表示 [did] 不在钱包 / 没有助记词可验证；true 表示已标记
     */
    fun markMnemonicVerified(did: String): Boolean {
        val meta = entryMeta[did] ?: return false
        if (!meta.hasMnemonic) {
            Timber.w("Cannot mark mnemonic verified for DID without mnemonic: $did")
            return false
        }
        if (meta.mnemonicVerified) return true
        entryMeta[did] = meta.copy(mnemonicVerified = true)
        saveWallet()
        return true
    }

    // ─── signing & verification ─────────────────────────────────────────

    fun getCurrentDID(): String? = _currentIdentity.value?.did

    fun getCurrentDIDDocument(): DIDDocument? = _currentIdentity.value?.didDocument

    fun sign(message: ByteArray): ByteArray {
        val identity = _currentIdentity.value
            ?: throw IllegalStateException("No DID identity available")
        return SignatureUtils.sign(message, identity.keyPair)
    }

    fun sign(message: String): ByteArray = sign(message.toByteArray())

    fun signWithTimestamp(message: ByteArray): TimestampedSignature {
        val identity = _currentIdentity.value
            ?: throw IllegalStateException("No DID identity available")
        return SignatureUtils.signWithTimestamp(message, identity.keyPair)
    }

    suspend fun verify(message: ByteArray, signature: ByteArray, did: String): Boolean {
        return try {
            val publicKey = DidKeyGenerator.extractPublicKey(did)
            SignatureUtils.verify(message, signature, publicKey)
        } catch (e: Exception) {
            Timber.e(e, "Signature verification failed")
            false
        }
    }

    suspend fun verify(message: String, signature: ByteArray, did: String): Boolean {
        return verify(message.toByteArray(), signature, did)
    }

    suspend fun verifyWithTimestamp(
        message: ByteArray,
        timestampedSignature: TimestampedSignature,
        did: String,
        maxAgeMs: Long = 60000,
    ): Boolean {
        return try {
            val publicKey = DidKeyGenerator.extractPublicKey(did)
            SignatureUtils.verifyWithTimestamp(message, timestampedSignature, publicKey, maxAgeMs)
        } catch (e: Exception) {
            Timber.e(e, "Timestamped signature verification failed")
            false
        }
    }

    // ─── trusted devices (unchanged from v0.1) ──────────────────────────

    fun addTrustedDevice(did: String, deviceName: String, publicKey: ByteArray? = null) {
        Timber.i("Adding trusted device: $did ($deviceName)")
        val device = TrustedDevice(
            did = did,
            deviceName = deviceName,
            publicKey = publicKey ?: DidKeyGenerator.extractPublicKey(did),
            trustedAt = System.currentTimeMillis(),
        )
        trustedDevices[did] = device
        _trustedDevicesList.value = trustedDevices.values.toList()
        saveTrustedDevices()
    }

    fun removeTrustedDevice(did: String) {
        Timber.i("Removing trusted device: $did")
        trustedDevices.remove(did)
        _trustedDevicesList.value = trustedDevices.values.toList()
        saveTrustedDevices()
    }

    fun isTrustedDevice(did: String): Boolean = trustedDevices.containsKey(did)

    fun getTrustedDevice(did: String): TrustedDevice? = trustedDevices[did]

    suspend fun resolveDID(did: String): DIDDocument? = didKeyResolver.resolveDocument(did)

    // ─── internal helpers ───────────────────────────────────────────────

    private fun defaultDeviceName(): String = android.os.Build.MODEL ?: "Unknown Device"

    private fun finishAddIdentity(
        keyPair: Ed25519KeyPair,
        deviceName: String,
        hasMnemonic: Boolean,
        mnemonicVerified: Boolean,
        requireBiometric: Boolean,
    ): DIDIdentity {
        val did = DidKeyGenerator.generate(keyPair)
        val didDocument = DidKeyGenerator.generateDocument(did)
        val identity = DIDIdentity(
            did = did,
            deviceName = deviceName,
            keyPair = keyPair,
            didDocument = didDocument,
            createdAt = System.currentTimeMillis(),
        )
        // Pre-create the wrapper key with the right biometric binding before wrap.
        // wrapEd25519Private's auto-create defaults to no-biometric, so explicit
        // setupWrapperKey here is required when requireBiometric=true.
        val alias = walletAliasFor(did)
        strongBoxKeyManager.setupWrapperKey(alias, requireBiometric = requireBiometric)

        // Wrap once at create time; cache the ciphertext so subsequent saveWallet
        // calls don't re-encrypt (otherwise biometric-bound DIDs would prompt on
        // every metadata change). Re-wrap happens only on explicit key rotation.
        val wrapped = strongBoxKeyManager.wrapEd25519Private(alias, keyPair.privateKey)
        wrappedCache[did] = wrappedToStorage(wrapped)

        identities[did] = identity
        entryMeta[did] = EntryMetadata(
            hasMnemonic = hasMnemonic,
            mnemonicVerified = mnemonicVerified,
            requireBiometric = requireBiometric,
        )
        activeDid = did
        _currentIdentity.value = identity
        saveWallet()
        Timber.i(
            "DID added to wallet: $did (hasMnemonic=$hasMnemonic, " +
                "verified=$mnemonicVerified, biometric=$requireBiometric)"
        )
        return identity
    }

    private fun wrappedToStorage(wrapped: WrappedEd25519Key): WrappedPrivateKeyStorage {
        val b64 = Base64.getEncoder()
        return WrappedPrivateKeyStorage(
            version = wrapped.version,
            keystoreAlias = wrapped.keystoreAlias,
            ivBase64 = b64.encodeToString(wrapped.iv),
            ciphertextBase64 = b64.encodeToString(wrapped.ciphertext),
        )
    }

    /** 为某个 DID 生成 deterministic wrapper key alias（避免不同 DID 共享一个 wrap key）。 */
    private fun walletAliasFor(did: String): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(did.toByteArray(Charsets.UTF_8))
        val short = hash.copyOfRange(0, WRAP_ALIAS_HASH_BYTES).toHexString()
        return WRAP_ALIAS_PREFIX + short
    }

    private fun saveWallet() {
        val current = activeDid
            ?: throw IllegalStateException("Cannot save wallet without active DID")
        if (identities.isEmpty()) {
            throw IllegalStateException("Cannot save empty wallet")
        }
        try {
            val storage = WalletStorage(
                version = WalletStorage.CURRENT_VERSION,
                activeDid = current,
                identities = identities.values.map { toEntry(it) },
            )
            val file = File(context.filesDir, WalletStorage.FILE_NAME)
            file.writeText(json.encodeToString(storage))
            Timber.d("Wallet saved: ${storage.identities.size} identities → ${file.absolutePath}")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save wallet")
            throw e
        }
    }

    private fun toEntry(identity: DIDIdentity): WalletIdentityEntry {
        // Use cached wrap if available (normal path). Falls back to re-wrap only if
        // cache is empty (e.g., legacy migration before cache hydration) — this re-wrap
        // path will trigger biometric prompt if the alias requires it.
        val wrappedStorage = wrappedCache[identity.did] ?: run {
            Timber.w("Wrap cache miss for ${identity.did}, re-wrapping (may prompt biometric)")
            val alias = walletAliasFor(identity.did)
            wrappedToStorage(strongBoxKeyManager.wrapEd25519Private(alias, identity.keyPair.privateKey))
                .also { wrappedCache[identity.did] = it }
        }
        val meta = entryMeta[identity.did] ?: EntryMetadata.DEFAULT
        return WalletIdentityEntry(
            did = identity.did,
            deviceName = identity.deviceName,
            createdAt = identity.createdAt,
            publicKeyHex = identity.keyPair.publicKey.toHexString(),
            wrappedPrivate = wrappedStorage,
            mnemonicVerified = meta.mnemonicVerified,
            hasMnemonic = meta.hasMnemonic,
            requireBiometric = meta.requireBiometric,
        )
    }

    private fun loadWallet(): Boolean {
        val file = File(context.filesDir, WalletStorage.FILE_NAME)
        if (!file.exists()) return false
        return try {
            val storage = json.decodeFromString<WalletStorage>(file.readText())
            identities.clear()
            entryMeta.clear()
            storage.identities.forEach { entry -> loadEntry(entry) }
            activeDid = storage.activeDid
            _currentIdentity.value = identities[storage.activeDid]
            true
        } catch (e: Exception) {
            Timber.e(e, "Failed to load wallet from ${file.absolutePath}")
            false
        }
    }

    private fun loadEntry(entry: WalletIdentityEntry) {
        val b64 = Base64.getDecoder()
        val wrapped = WrappedEd25519Key(
            version = entry.wrappedPrivate.version,
            keystoreAlias = entry.wrappedPrivate.keystoreAlias,
            iv = b64.decode(entry.wrappedPrivate.ivBase64),
            ciphertext = b64.decode(entry.wrappedPrivate.ciphertextBase64),
        )
        val privateBytes = strongBoxKeyManager.unwrapEd25519Private(wrapped)
        val keyPair = Ed25519KeyPair.fromPrivateKey(privateBytes)
        // sanity check: stored public key matches derived public key
        val derivedPubHex = keyPair.publicKey.toHexString()
        if (derivedPubHex != entry.publicKeyHex) {
            throw IllegalStateException(
                "Public key mismatch for DID ${entry.did}: " +
                    "stored=${entry.publicKeyHex}, derived=$derivedPubHex"
            )
        }
        val identity = DIDIdentity(
            did = entry.did,
            deviceName = entry.deviceName,
            keyPair = keyPair,
            didDocument = DidKeyGenerator.generateDocument(entry.did),
            createdAt = entry.createdAt,
        )
        identities[entry.did] = identity
        entryMeta[entry.did] = EntryMetadata(
            hasMnemonic = entry.hasMnemonic,
            mnemonicVerified = entry.mnemonicVerified,
            requireBiometric = entry.requireBiometric,
        )
        wrappedCache[entry.did] = entry.wrappedPrivate
    }

    /**
     * 检测旧 `did_keypair.json` 明文格式并迁移到加密 wallet。
     *
     * 流程：
     *  1. 读旧文件 → 解析 [LegacyIdentityStorage]
     *  2. 用 StrongBoxKeyManager 加密私钥后保存为 wallet
     *  3. 旧文件 rename 为 `.migrated.bak`（保留以备人工 rollback；不删除）
     *
     * @return true 迁移成功；false 旧文件不存在或迁移失败
     */
    private fun migrateLegacyPlaintext(): Boolean {
        val legacy = File(context.filesDir, WalletStorage.LEGACY_FILE_NAME)
        if (!legacy.exists()) return false
        return try {
            val legacyText = legacy.readText()
            val legacyData = json.decodeFromString<LegacyIdentityStorage>(legacyText)
            val keyPair = legacyData.keyPair.toKeyPair()
            require(keyPair.hasPrivateKey()) { "Legacy storage missing private key" }

            val didDocument = DidKeyGenerator.generateDocument(legacyData.did)
            val identity = DIDIdentity(
                did = legacyData.did,
                deviceName = legacyData.deviceName,
                keyPair = keyPair,
                didDocument = didDocument,
                createdAt = legacyData.createdAt,
            )
            identities[identity.did] = identity
            entryMeta[identity.did] = EntryMetadata(
                hasMnemonic = false,
                mnemonicVerified = false,
                requireBiometric = false,
            )
            activeDid = identity.did
            _currentIdentity.value = identity
            // Pre-create wrapper key without biometric (migrated DIDs preserve old security model;
            // user can upgrade later via a UI flow that recreates the entry with requireBiometric=true).
            strongBoxKeyManager.setupWrapperKey(
                alias = walletAliasFor(identity.did),
                requireBiometric = false,
            )
            saveWallet()

            val backup = File(
                context.filesDir,
                WalletStorage.LEGACY_FILE_NAME + WalletStorage.LEGACY_BACKUP_SUFFIX,
            )
            if (backup.exists()) backup.delete()
            legacy.renameTo(backup)

            Timber.i(
                "Migrated legacy plaintext DID ${identity.did} → wallet (backup at ${backup.absolutePath})"
            )
            true
        } catch (e: Exception) {
            Timber.e(e, "Legacy migration failed")
            false
        }
    }

    private fun saveTrustedDevices() {
        try {
            val data = trustedDevices.values.toList()
            val text = json.encodeToString(data)
            File(context.filesDir, TRUSTED_DEVICES_FILE).writeText(text)
        } catch (e: Exception) {
            Timber.e(e, "Failed to save trusted devices")
        }
    }

    private fun loadTrustedDevices() {
        try {
            val file = File(context.filesDir, TRUSTED_DEVICES_FILE)
            if (!file.exists()) return
            val data = json.decodeFromString<List<TrustedDevice>>(file.readText())
            trustedDevices.clear()
            data.forEach { trustedDevices[it.did] = it }
            _trustedDevicesList.value = trustedDevices.values.toList()
        } catch (e: Exception) {
            Timber.e(e, "Failed to load trusted devices")
        }
    }

    // ─── private types ──────────────────────────────────────────────────

    private data class EntryMetadata(
        val hasMnemonic: Boolean,
        val mnemonicVerified: Boolean,
        val requireBiometric: Boolean = false,
    ) {
        companion object {
            val DEFAULT = EntryMetadata(hasMnemonic = false, mnemonicVerified = false, requireBiometric = false)
        }
    }

    /** 旧版（v0.1）单 DID 落盘格式，仅用于迁移读取。 */
    @Serializable
    private data class LegacyIdentityStorage(
        val did: String,
        val deviceName: String,
        val keyPair: Ed25519KeyPairJson,
        val createdAt: Long,
    )
}

// ─── existing public data types (unchanged from v0.1) ──────────────────

/**
 * DID 身份。
 */
data class DIDIdentity(
    val did: String,
    val deviceName: String,
    val keyPair: Ed25519KeyPair,
    val didDocument: DIDDocument,
    val createdAt: Long = System.currentTimeMillis(),
)

/**
 * 可信设备。
 */
@kotlinx.serialization.Serializable
data class TrustedDevice(
    val did: String,
    val deviceName: String,
    val publicKey: String,
    val trustedAt: Long,
) {
    constructor(did: String, deviceName: String, publicKey: ByteArray, trustedAt: Long) : this(
        did = did,
        deviceName = deviceName,
        publicKey = publicKey.joinToString("") { "%02x".format(it) },
        trustedAt = trustedAt,
    )

    fun getPublicKeyBytes(): ByteArray {
        return publicKey.chunked(2)
            .map { it.toInt(16).toByte() }
            .toByteArray()
    }
}
