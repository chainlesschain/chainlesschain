package com.chainlesschain.android.core.e2ee.crypto

import android.util.Log
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-CBC加密工具
 *
 * Signal Protocol使用AES-256-CBC + HMAC-SHA256进行消息加密
 */
object AESCipher {

    private const val TAG = "AESCipher"

    /** AES密钥长度（256位） */
    const val KEY_SIZE = 32

    /** IV长度（128位） */
    const val IV_SIZE = 16

    /** MAC长度（SHA256输出，取前10字节） */
    const val MAC_SIZE = 10

    /**
     * 加密消息（AES-256-CBC）
     *
     * @param plaintext 明文
     * @param cipherKey 加密密钥（32字节）
     * @param macKey MAC密钥（32字节）
     * @param iv 初始化向量（16字节）
     * @return 密文（包含MAC）
     */
    fun encrypt(
        plaintext: ByteArray,
        cipherKey: ByteArray,
        macKey: ByteArray,
        iv: ByteArray
    ): ByteArray {
        require(cipherKey.size == KEY_SIZE) {
            "Cipher key must be $KEY_SIZE bytes"
        }
        require(macKey.size == KEY_SIZE) {
            "MAC key must be $KEY_SIZE bytes"
        }
        require(iv.size == IV_SIZE) {
            "IV must be $IV_SIZE bytes"
        }

        Log.d(TAG, "Encrypting message: ${plaintext.size} bytes")

        // AES-256-CBC加密
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        val secretKey = SecretKeySpec(cipherKey, "AES")
        val ivSpec = IvParameterSpec(iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec)

        val ciphertext = cipher.doFinal(plaintext)

        // 计算MAC（HMAC-SHA256）
        val mac = computeMAC(macKey, iv, ciphertext)

        // 组合：密文 + MAC
        val result = ByteArray(ciphertext.size + MAC_SIZE)
        System.arraycopy(ciphertext, 0, result, 0, ciphertext.size)
        System.arraycopy(mac, 0, result, ciphertext.size, MAC_SIZE)

        Log.d(TAG, "Encryption complete: ${result.size} bytes (ciphertext=${ciphertext.size}, mac=$MAC_SIZE)")

        return result
    }

    /**
     * 解密消息（AES-256-CBC）
     *
     * @param ciphertextWithMAC 密文（包含MAC）
     * @param cipherKey 加密密钥（32字节）
     * @param macKey MAC密钥（32字节）
     * @param iv 初始化向量（16字节）
     * @return 明文
     * @throws SecurityException 如果MAC验证失败
     */
    fun decrypt(
        ciphertextWithMAC: ByteArray,
        cipherKey: ByteArray,
        macKey: ByteArray,
        iv: ByteArray
    ): ByteArray {
        require(cipherKey.size == KEY_SIZE) {
            "Cipher key must be $KEY_SIZE bytes"
        }
        require(macKey.size == KEY_SIZE) {
            "MAC key must be $KEY_SIZE bytes"
        }
        require(iv.size == IV_SIZE) {
            "IV must be $IV_SIZE bytes"
        }
        require(ciphertextWithMAC.size > MAC_SIZE) {
            "Ciphertext too short"
        }

        Log.d(TAG, "Decrypting message: ${ciphertextWithMAC.size} bytes")

        // 分离密文和MAC
        val ciphertextSize = ciphertextWithMAC.size - MAC_SIZE
        val ciphertext = ciphertextWithMAC.copyOfRange(0, ciphertextSize)
        val receivedMAC = ciphertextWithMAC.copyOfRange(ciphertextSize, ciphertextWithMAC.size)

        // 验证MAC
        val expectedMAC = computeMAC(macKey, iv, ciphertext)

        if (!receivedMAC.contentEquals(expectedMAC)) {
            Log.e(TAG, "MAC verification failed")
            throw SecurityException("MAC verification failed - message may be tampered")
        }

        // AES-256-CBC解密
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        val secretKey = SecretKeySpec(cipherKey, "AES")
        val ivSpec = IvParameterSpec(iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec)

        val plaintext = cipher.doFinal(ciphertext)

        Log.d(TAG, "Decryption complete: ${plaintext.size} bytes")

        return plaintext
    }

    /**
     * 计算MAC（HMAC-SHA256，取前10字节）
     *
     * @param macKey MAC密钥
     * @param iv 初始化向量
     * @param ciphertext 密文
     * @return MAC（10字节）
     */
    private fun computeMAC(macKey: ByteArray, iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(macKey, "HmacSHA256"))

        // MAC计算：HMAC(macKey, IV || ciphertext)
        mac.update(iv)
        mac.update(ciphertext)

        val fullMAC = mac.doFinal()

        // Signal Protocol使用前10字节作为MAC
        return fullMAC.copyOfRange(0, MAC_SIZE)
    }

    /**
     * 加密消息（使用MessageKeys）
     *
     * @param plaintext 明文
     * @param messageKeys 消息密钥（包含cipherKey、macKey、iv）
     * @return 密文（包含MAC）
     */
    fun encrypt(plaintext: ByteArray, messageKeys: MessageKeys): ByteArray {
        return encrypt(
            plaintext,
            messageKeys.cipherKey,
            messageKeys.macKey,
            messageKeys.iv
        )
    }

    /**
     * 解密消息（使用MessageKeys）
     *
     * @param ciphertextWithMAC 密文（包含MAC）
     * @param messageKeys 消息密钥（包含cipherKey、macKey、iv）
     * @return 明文
     */
    fun decrypt(ciphertextWithMAC: ByteArray, messageKeys: MessageKeys): ByteArray {
        return decrypt(
            ciphertextWithMAC,
            messageKeys.cipherKey,
            messageKeys.macKey,
            messageKeys.iv
        )
    }
}
