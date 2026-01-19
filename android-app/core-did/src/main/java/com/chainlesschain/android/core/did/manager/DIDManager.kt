package com.chainlesschain.android.core.did.manager

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPairJson
import com.chainlesschain.android.core.did.crypto.SignatureUtils
import com.chainlesschain.android.core.did.crypto.TimestampedSignature
import com.chainlesschain.android.core.did.generator.DidKeyGenerator
import com.chainlesschain.android.core.did.model.DIDDocument
import com.chainlesschain.android.core.did.resolver.DIDResolver
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID管理器
 *
 * 负责：
 * - 创建和管理DID身份
 * - 密钥对存储
 * - 签名和验证
 * - 信任设备管理
 */
@Singleton
class DIDManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val didKeyResolver: DidKeyResolver
) {

    companion object {
        private const val TAG = "DIDManager"

        /** 密钥存储文件名 */
        private const val KEY_FILE = "did_keypair.json"

        /** 可信设备存储文件名 */
        private const val TRUSTED_DEVICES_FILE = "trusted_devices.json"
    }

    private val json = Json { prettyPrint = true }

    // 当前设备的DID身份
    private var _currentIdentity = MutableStateFlow<DIDIdentity?>(null)
    val currentIdentity: StateFlow<DIDIdentity?> = _currentIdentity.asStateFlow()

    // 可信设备列表
    private val trustedDevices = mutableMapOf<String, TrustedDevice>()
    private val _trustedDevicesList = MutableStateFlow<List<TrustedDevice>>(emptyList())
    val trustedDevicesList: StateFlow<List<TrustedDevice>> = _trustedDevicesList.asStateFlow()

    /**
     * 初始化DID管理器
     */
    suspend fun initialize() {
        Log.i(TAG, "Initializing DID Manager")

        // 加载或创建身份
        val identity = loadIdentity() ?: createIdentity()
        _currentIdentity.value = identity

        // 加载可信设备
        loadTrustedDevices()

        Log.i(TAG, "DID Manager initialized: did=${identity.did}")
    }

    /**
     * 创建新的DID身份
     *
     * @param deviceName 设备名称
     * @return DID身份
     */
    fun createIdentity(deviceName: String = android.os.Build.MODEL): DIDIdentity {
        Log.i(TAG, "Creating new DID identity for device: $deviceName")

        // 生成Ed25519密钥对
        val keyPair = Ed25519KeyPair.generate()

        // 生成did:key
        val did = DidKeyGenerator.generate(keyPair)

        // 生成DID Document
        val didDocument = DidKeyGenerator.generateDocument(did)

        val identity = DIDIdentity(
            did = did,
            deviceName = deviceName,
            keyPair = keyPair,
            didDocument = didDocument,
            createdAt = System.currentTimeMillis()
        )

        // 保存到本地
        saveIdentity(identity)

        Log.i(TAG, "DID identity created: $did")

        return identity
    }

    /**
     * 获取当前DID
     */
    fun getCurrentDID(): String? {
        return _currentIdentity.value?.did
    }

    /**
     * 获取当前DID Document
     */
    fun getCurrentDIDDocument(): DIDDocument? {
        return _currentIdentity.value?.didDocument
    }

    /**
     * 签名消息
     *
     * @param message 消息内容
     * @return 签名
     */
    fun sign(message: ByteArray): ByteArray {
        val identity = _currentIdentity.value
            ?: throw IllegalStateException("No DID identity available")

        return SignatureUtils.sign(message, identity.keyPair)
    }

    /**
     * 签名消息（字符串）
     */
    fun sign(message: String): ByteArray {
        return sign(message.toByteArray())
    }

    /**
     * 签名并附加时间戳
     *
     * @param message 消息内容
     * @return 带时间戳的签名
     */
    fun signWithTimestamp(message: ByteArray): TimestampedSignature {
        val identity = _currentIdentity.value
            ?: throw IllegalStateException("No DID identity available")

        return SignatureUtils.signWithTimestamp(message, identity.keyPair)
    }

    /**
     * 验证签名
     *
     * @param message 原始消息
     * @param signature 签名
     * @param did 签名者的DID
     * @return 是否验证通过
     */
    suspend fun verify(message: ByteArray, signature: ByteArray, did: String): Boolean {
        return try {
            // 解析DID获取公钥
            val publicKey = DidKeyGenerator.extractPublicKey(did)

            // 验证签名
            SignatureUtils.verify(message, signature, publicKey)
        } catch (e: Exception) {
            Log.e(TAG, "Signature verification failed", e)
            false
        }
    }

    /**
     * 验证签名（字符串消息）
     */
    suspend fun verify(message: String, signature: ByteArray, did: String): Boolean {
        return verify(message.toByteArray(), signature, did)
    }

    /**
     * 验证带时间戳的签名
     *
     * @param message 原始消息
     * @param timestampedSignature 带时间戳的签名
     * @param did 签名者的DID
     * @param maxAgeMs 最大时间差
     * @return 是否验证通过
     */
    suspend fun verifyWithTimestamp(
        message: ByteArray,
        timestampedSignature: TimestampedSignature,
        did: String,
        maxAgeMs: Long = 60000
    ): Boolean {
        return try {
            val publicKey = DidKeyGenerator.extractPublicKey(did)
            SignatureUtils.verifyWithTimestamp(message, timestampedSignature, publicKey, maxAgeMs)
        } catch (e: Exception) {
            Log.e(TAG, "Timestamped signature verification failed", e)
            false
        }
    }

    /**
     * 添加可信设备
     *
     * @param did 设备的DID
     * @param deviceName 设备名称
     * @param publicKey 公钥
     */
    fun addTrustedDevice(did: String, deviceName: String, publicKey: ByteArray? = null) {
        Log.i(TAG, "Adding trusted device: $did ($deviceName)")

        val device = TrustedDevice(
            did = did,
            deviceName = deviceName,
            publicKey = publicKey ?: DidKeyGenerator.extractPublicKey(did),
            trustedAt = System.currentTimeMillis()
        )

        trustedDevices[did] = device
        _trustedDevicesList.value = trustedDevices.values.toList()

        saveTrustedDevices()
    }

    /**
     * 移除可信设备
     */
    fun removeTrustedDevice(did: String) {
        Log.i(TAG, "Removing trusted device: $did")

        trustedDevices.remove(did)
        _trustedDevicesList.value = trustedDevices.values.toList()

        saveTrustedDevices()
    }

    /**
     * 检查设备是否可信
     */
    fun isTrustedDevice(did: String): Boolean {
        return trustedDevices.containsKey(did)
    }

    /**
     * 获取可信设备
     */
    fun getTrustedDevice(did: String): TrustedDevice? {
        return trustedDevices[did]
    }

    /**
     * 解析DID
     */
    suspend fun resolveDID(did: String): DIDDocument? {
        return didKeyResolver.resolveDocument(did)
    }

    /**
     * 保存身份到本地
     */
    private fun saveIdentity(identity: DIDIdentity) {
        try {
            val keyPairJson = Ed25519KeyPairJson.fromKeyPair(identity.keyPair)
            val data = IdentityStorage(
                did = identity.did,
                deviceName = identity.deviceName,
                keyPair = keyPairJson,
                createdAt = identity.createdAt
            )

            val jsonString = json.encodeToString(data)
            val file = File(context.filesDir, KEY_FILE)
            file.writeText(jsonString)

            Log.d(TAG, "Identity saved to: ${file.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save identity", e)
        }
    }

    /**
     * 从本地加载身份
     */
    private fun loadIdentity(): DIDIdentity? {
        return try {
            val file = File(context.filesDir, KEY_FILE)
            if (!file.exists()) {
                Log.d(TAG, "No existing identity found")
                return null
            }

            val jsonString = file.readText()
            val data = json.decodeFromString<IdentityStorage>(jsonString)

            val keyPair = data.keyPair.toKeyPair()
            val didDocument = DidKeyGenerator.generateDocument(data.did)

            Log.d(TAG, "Identity loaded: ${data.did}")

            DIDIdentity(
                did = data.did,
                deviceName = data.deviceName,
                keyPair = keyPair,
                didDocument = didDocument,
                createdAt = data.createdAt
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load identity", e)
            null
        }
    }

    /**
     * 保存可信设备列表
     */
    private fun saveTrustedDevices() {
        try {
            val data = trustedDevices.values.toList()
            val jsonString = json.encodeToString(data)
            val file = File(context.filesDir, TRUSTED_DEVICES_FILE)
            file.writeText(jsonString)

            Log.d(TAG, "Trusted devices saved: ${data.size} devices")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save trusted devices", e)
        }
    }

    /**
     * 加载可信设备列表
     */
    private fun loadTrustedDevices() {
        try {
            val file = File(context.filesDir, TRUSTED_DEVICES_FILE)
            if (!file.exists()) {
                Log.d(TAG, "No trusted devices file found")
                return
            }

            val jsonString = file.readText()
            val data = json.decodeFromString<List<TrustedDevice>>(jsonString)

            trustedDevices.clear()
            data.forEach { device ->
                trustedDevices[device.did] = device
            }
            _trustedDevicesList.value = trustedDevices.values.toList()

            Log.d(TAG, "Trusted devices loaded: ${data.size} devices")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load trusted devices", e)
        }
    }
}

/**
 * DID身份
 */
data class DIDIdentity(
    /** DID标识符 */
    val did: String,

    /** 设备名称 */
    val deviceName: String,

    /** 密钥对 */
    val keyPair: Ed25519KeyPair,

    /** DID Document */
    val didDocument: DIDDocument,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * 可信设备
 */
@kotlinx.serialization.Serializable
data class TrustedDevice(
    /** DID标识符 */
    val did: String,

    /** 设备名称 */
    val deviceName: String,

    /** 公钥（十六进制） */
    val publicKey: String,

    /** 信任时间 */
    val trustedAt: Long
) {
    constructor(did: String, deviceName: String, publicKey: ByteArray, trustedAt: Long) : this(
        did = did,
        deviceName = deviceName,
        publicKey = publicKey.joinToString("") { "%02x".format(it) },
        trustedAt = trustedAt
    )

    fun getPublicKeyBytes(): ByteArray {
        return publicKey.chunked(2)
            .map { it.toInt(16).toByte() }
            .toByteArray()
    }
}

/**
 * 身份存储格式
 */
@kotlinx.serialization.Serializable
private data class IdentityStorage(
    val did: String,
    val deviceName: String,
    val keyPair: Ed25519KeyPairJson,
    val createdAt: Long
)
