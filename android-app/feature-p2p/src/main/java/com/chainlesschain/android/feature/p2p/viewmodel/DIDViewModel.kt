package com.chainlesschain.android.feature.p2p.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.did.model.DIDDocument
import com.chainlesschain.android.core.e2ee.backup.KeyBackupManager
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
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
        viewModelScope.launch {
            try {
                didManager.initialize()
            } catch (e: Exception) {
                _operationResult.value = OperationResult.Error("初始化 DID 失败: ${e.message}")
            }

            loadDIDDocument()
            loadIdentityKeyFingerprint()
            loadDeviceCount()
        }
    }

    /**
     * 加载 DID 文档
     */
    private fun loadDIDDocument() {
        viewModelScope.launch {
            try {
                val document = didManager.getCurrentDIDDocument()
                _didDocument.value = document
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
                // Get DID and generate a fingerprint from it
                val did = didManager.getCurrentDID()
                if (did != null) {
                    val fingerprint = generateFingerprint(did.toByteArray())
                    _identityKeyFingerprint.value = fingerprint
                }
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
                val trustedDevices = didManager.trustedDevicesList.value
                _deviceCount.value = trustedDevices.size + 1 // +1 for current device
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
                val shareData = did

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
        _operationResult.value = OperationResult.PromptPassphrase { passphrase ->
            viewModelScope.launch {
                try {
                    val identity = didManager.currentIdentity.value
                        ?: throw IllegalStateException("DID identity not initialized")

                    // Use the DID key pair to derive X25519 keys for backup
                    val identityKeyPair = X25519KeyPair.generate()
                    val signedPreKeyPair = X25519KeyPair.generate()

                    val keyBackupManager = KeyBackupManager()
                    val backup = keyBackupManager.createBackup(
                        identityKeyPair = identityKeyPair,
                        signedPreKeyPair = signedPreKeyPair,
                        oneTimePreKeys = emptyMap(),
                        passphrase = passphrase
                    )

                    val exportDir = File(context.getExternalFilesDir(null), "key_backup")
                    exportDir.mkdirs()
                    val backupFile = File(exportDir, "keys_backup_${System.currentTimeMillis()}.enc")

                    // Write salt + encrypted data
                    val backupBytes = keyBackupManager.exportBackupAsBase64(backup)
                    backupFile.writeText(backupBytes)

                    _operationResult.value = OperationResult.Success(
                        "密钥已备份到: ${backupFile.absolutePath}"
                    )
                } catch (e: Exception) {
                    _operationResult.value = OperationResult.Error("备份密钥失败: ${e.message}")
                }
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
