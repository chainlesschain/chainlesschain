package com.chainlesschain.android.feature.p2p.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.did.model.DIDDocument
import com.chainlesschain.android.core.e2ee.identity.IdentityKeyManager
import com.chainlesschain.android.core.e2ee.backup.KeyBackupManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

/**
 * DID 管理 ViewModel
 *
 * 管理去中心化身份标识和相关操作
 */
@HiltViewModel
class DIDViewModel @Inject constructor(
    private val didManager: DIDManager,
    private val identityKeyManager: IdentityKeyManager,
    private val keyBackupManager: KeyBackupManager,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _didDocument = MutableStateFlow<DIDDocument?>(null)
    val didDocument: StateFlow<DIDDocument?> = _didDocument.asStateFlow()

    private val _identityKeyFingerprint = MutableStateFlow<String?>(null)
    val identityKeyFingerprint: StateFlow<String?> = _identityKeyFingerprint.asStateFlow()

    private val _deviceCount = MutableStateFlow(1)
    val deviceCount: StateFlow<Int> = _deviceCount.asStateFlow()

    private val _operationResult = MutableStateFlow<OperationResult?>(null)
    val operationResult: StateFlow<OperationResult?> = _operationResult.asStateFlow()

    init {
        loadDIDDocument()
        loadIdentityKeyFingerprint()
        loadDeviceCount()
    }

    /**
     * 加载 DID 文档
     */
    private fun loadDIDDocument() {
        viewModelScope.launch {
            try {
                val did = didManager.getLocalDID()
                if (did != null) {
                    val document = didManager.resolveDID(did)
                    _didDocument.value = document
                }
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("加载 DID 失败: ${e.message}")
            }
        }
    }

    /**
     * 加载身份密钥指纹
     */
    private fun loadIdentityKeyFingerprint() {
        viewModelScope.launch {
            try {
                val identityKey = identityKeyManager.getIdentityKeyPair()
                val fingerprint = generateFingerprint(identityKey.publicKey.keyBytes)
                _identityKeyFingerprint.value = fingerprint
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("加载密钥指纹失败: ${e.message}")
            }
        }
    }

    /**
     * 加载设备数量
     */
    private fun loadDeviceCount() {
        viewModelScope.launch {
            try {
                // TODO: Implement device tracking
                // For now, default to 1 (this device)
                _deviceCount.value = 1
            } catch (e: Exception) {
                _deviceCount.value = 1
            }
        }
    }

    /**
     * 生成指纹
     */
    private fun generateFingerprint(publicKey: ByteArray): String {
        val hash = java.security.MessageDigest.getInstance("SHA-256")
            .digest(publicKey)

        return hash.joinToString("") { byte ->
            "%02x".format(byte)
        }.chunked(4).joinToString(" ")
    }

    /**
     * 导出 DID
     */
    fun exportDID() {
        viewModelScope.launch {
            try {
                val document = _didDocument.value
                    ?: throw IllegalStateException("DID document not loaded")

                // Serialize DID document to JSON
                val json = serializeDIDDocument(document)

                // Save to external storage
                val exportDir = File(context.getExternalFilesDir(null), "did_export")
                exportDir.mkdirs()

                val exportFile = File(exportDir, "did_document_${System.currentTimeMillis()}.json")
                exportFile.writeText(json)

                _operationResult.value = OperationResult.Success(
                    "DID 已导出到: ${exportFile.absolutePath}"
                )
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("导出 DID 失败: ${e.message}")
            }
        }
    }

    /**
     * 分享 DID
     */
    fun shareDID() {
        viewModelScope.launch {
            try {
                val did = _didDocument.value?.id
                    ?: throw IllegalStateException("DID not loaded")

                // Create share intent data
                val shareData = "did:chainlesschain:$did"

                _operationResult.value = OperationResult.ShareIntent(shareData)
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("分享 DID 失败: ${e.message}")
            }
        }
    }

    /**
     * 备份密钥
     */
    fun backupKeys() {
        viewModelScope.launch {
            try {
                val identityKeyPair = identityKeyManager.getIdentityKeyPair()
                val signedPreKeyPair = identityKeyManager.getSignedPreKey()
                val oneTimePreKeys = identityKeyManager.getOneTimePreKeys()

                // Prompt user for passphrase
                _operationResult.value = OperationResult.PromptPassphrase { passphrase ->
                    performKeyBackup(identityKeyPair, signedPreKeyPair, oneTimePreKeys, passphrase)
                }
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("备份密钥失败: ${e.message}")
            }
        }
    }

    /**
     * 执行密钥备份
     */
    private fun performKeyBackup(
        identityKeyPair: Any,
        signedPreKeyPair: Any,
        oneTimePreKeys: Map<String, Any>,
        passphrase: String
    ) {
        viewModelScope.launch {
            try {
                // Create encrypted backup
                val backup = keyBackupManager.createBackup(
                    identityKeyPair = identityKeyPair as com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair,
                    signedPreKeyPair = signedPreKeyPair as com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair,
                    oneTimePreKeys = oneTimePreKeys as Map<String, com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair>,
                    passphrase = passphrase
                )

                // Save to external storage
                val backupDir = File(context.getExternalFilesDir(null), "key_backup")
                backupDir.mkdirs()

                val backupFile = File(backupDir, "keys_${System.currentTimeMillis()}.backup")
                backupFile.writeBytes(backup.encryptedData)

                _operationResult.value = OperationResult.Success(
                    "密钥已备份到: ${backupFile.absolutePath}"
                )
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("密钥备份失败: ${e.message}")
            }
        }
    }

    /**
     * 序列化 DID 文档
     */
    private fun serializeDIDDocument(document: DIDDocument): String {
        // Simple JSON serialization
        return """
            {
                "id": "${document.id}",
                "verificationMethod": [
                    ${document.verificationMethod.joinToString(",\n") { method ->
            """
                        {
                            "id": "${method.id}",
                            "type": "${method.type}",
                            "controller": "${method.controller}",
                            "publicKeyMultibase": "${method.publicKeyMultibase ?: ""}"
                        }
                    """
        }}
                ],
                "authentication": [${document.authentication.joinToString(",") { "\"$it\"" }}],
                "assertionMethod": [${document.assertionMethod.joinToString(",") { "\"$it\"" }}],
                "keyAgreement": [${document.keyAgreement.joinToString(",") { "\"$it\"" }}]
            }
        """.trimIndent()
    }

    /**
     * 清除操作结果
     */
    fun clearOperationResult() {
        _operationResult.value = null
    }

    override fun onCleared() {
        super.onCleared()
        // Cleanup
    }
}

/**
 * 操作结果
 */
sealed class OperationResult {
    data class Success(val message: String) : OperationResult()
    data class Error(val message: String) : OperationResult()
    data class ShareIntent(val data: String) : OperationResult()
    data class PromptPassphrase(val onPassphrase: (String) -> Unit) : OperationResult()
}
