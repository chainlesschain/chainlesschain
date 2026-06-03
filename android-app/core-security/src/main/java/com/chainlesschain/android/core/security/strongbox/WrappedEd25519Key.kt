package com.chainlesschain.android.core.security.strongbox

/**
 * Wrapper-AES 路径下，Ed25519 私钥的加密落盘载荷。
 *
 * 解密流程（参见 [StrongBoxKeyManager.unwrapEd25519Private]）：
 *   AES-GCM(keystoreAlias, iv, ciphertext) -> plaintext 32-byte Ed25519 priv
 *
 * version 字段为未来格式演进预留（如切换 GCM-SIV 或增加 AAD）。当前固定 [CURRENT_VERSION]。
 */
data class WrappedEd25519Key(
    val version: Int,
    val keystoreAlias: String,
    val iv: ByteArray,
    val ciphertext: ByteArray,
) {
    init {
        require(version == CURRENT_VERSION) {
            "Unsupported WrappedEd25519Key version=$version (expected $CURRENT_VERSION)"
        }
        require(keystoreAlias.isNotBlank()) { "keystoreAlias must not be blank" }
        require(iv.size == AES_GCM_IV_SIZE) {
            "AES-GCM IV must be $AES_GCM_IV_SIZE bytes, got ${iv.size}"
        }
        require(ciphertext.isNotEmpty()) { "ciphertext must not be empty" }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is WrappedEd25519Key) return false
        return version == other.version &&
            keystoreAlias == other.keystoreAlias &&
            iv.contentEquals(other.iv) &&
            ciphertext.contentEquals(other.ciphertext)
    }

    override fun hashCode(): Int {
        var result = version
        result = 31 * result + keystoreAlias.hashCode()
        result = 31 * result + iv.contentHashCode()
        result = 31 * result + ciphertext.contentHashCode()
        return result
    }

    companion object {
        const val CURRENT_VERSION = 1
        const val AES_GCM_IV_SIZE = 12
        const val ED25519_PRIVATE_KEY_SIZE = 32
    }
}
