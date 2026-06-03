package com.chainlesschain.android.core.did.wallet

import io.github.novacrypto.bip39.MnemonicGenerator
import io.github.novacrypto.bip39.MnemonicValidator
import io.github.novacrypto.bip39.SeedCalculator
import io.github.novacrypto.bip39.Validation.InvalidChecksumException
import io.github.novacrypto.bip39.Validation.InvalidWordCountException
import io.github.novacrypto.bip39.Validation.UnexpectedWhiteSpaceException
import io.github.novacrypto.bip39.Validation.WordNotFoundException
import io.github.novacrypto.bip39.wordlists.English
import org.bouncycastle.crypto.digests.SHA512Digest
import org.bouncycastle.crypto.macs.HMac
import org.bouncycastle.crypto.params.KeyParameter
import timber.log.Timber
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * BIP-39 助记词生成 / 校验 / 派生 Ed25519 32 字节种子。
 *
 * 设计选择：
 *  - 24 字 mnemonic（256-bit entropy）匹配 Ed25519 256-bit 私钥强度
 *  - BIP-39 标准（novacrypto 库提供 English 词表 + 校验）
 *  - PBKDF2-HMAC-SHA512 派生 64-byte BIP-39 seed，可选 passphrase
 *  - SLIP-0010 master key derivation：HMAC-SHA512("ed25519 seed", bip39_seed)[0:32]
 *    → 32-byte Ed25519 私钥种子（与 BouncyCastle Ed25519PrivateKeyParameters 直接兼容）
 *
 * **永不持久化助记词**。仅 [generate] 返回时由调用者一次性展示给用户。
 */
@Singleton
class MnemonicService @Inject constructor() {

    private val secureRandom = SecureRandom()

    /**
     * 生成新助记词。
     *
     * @param strength entropy 位数，必须是 128/160/192/224/256（对应 12/15/18/21/24 词）
     * @return 助记词词数组（空格分割原文可用 `joinToString(" ")` 还原）
     */
    fun generate(strength: Int = DEFAULT_STRENGTH_BITS): List<String> {
        require(strength in VALID_STRENGTHS) {
            "Strength must be one of $VALID_STRENGTHS bits, got $strength"
        }
        val entropy = ByteArray(strength / 8)
        secureRandom.nextBytes(entropy)
        return entropyToWords(entropy)
    }

    /**
     * 校验助记词合法性（词表 + 校验和 + 词数）。
     */
    fun validate(words: List<String>): Boolean {
        if (words.isEmpty()) return false
        val phrase = words.joinToString(" ")
        return try {
            MnemonicValidator.ofWordList(English.INSTANCE).validate(phrase)
            true
        } catch (e: InvalidChecksumException) {
            Timber.d("Invalid mnemonic checksum")
            false
        } catch (e: InvalidWordCountException) {
            Timber.d("Invalid mnemonic word count")
            false
        } catch (e: UnexpectedWhiteSpaceException) {
            Timber.d("Unexpected whitespace in mnemonic")
            false
        } catch (e: WordNotFoundException) {
            Timber.d("Mnemonic contains unknown word")
            false
        }
    }

    /**
     * 把助记词派生为 Ed25519 32 字节种子。
     *
     * 流程：
     *  1. BIP-39: mnemonic + passphrase → 64-byte seed via PBKDF2-HMAC-SHA512
     *  2. SLIP-0010 Ed25519 master: HMAC-SHA512("ed25519 seed", bip39_seed)[0:32]
     *
     * @param words 助记词
     * @param passphrase BIP-39 passphrase（可选；空字符串与 null 等价）
     * @throws IllegalArgumentException 助记词非法
     */
    fun toEd25519Seed(words: List<String>, passphrase: String? = null): ByteArray {
        require(validate(words)) { "Invalid mnemonic phrase" }

        val bip39Seed = SeedCalculator()
            .calculateSeed(words.joinToString(" "), passphrase ?: "")

        return slip0010Ed25519Master(bip39Seed)
    }

    private fun entropyToWords(entropy: ByteArray): List<String> {
        val phrase = StringBuilder()
        MnemonicGenerator(English.INSTANCE).createMnemonic(entropy) { c -> phrase.append(c) }
        return phrase.toString().split(" ").filter { it.isNotBlank() }
    }

    /**
     * SLIP-0010 master key derivation for Ed25519:
     *   I = HMAC-SHA512(key=b"ed25519 seed", data=bip39_seed)
     *   I_L = I[0:32]  → master private key
     *   I_R = I[32:64] → master chain code (unused for v1.0 non-HD)
     *
     * 参考：https://github.com/satoshilabs/slips/blob/master/slip-0010.md
     */
    private fun slip0010Ed25519Master(bip39Seed: ByteArray): ByteArray {
        val hmac = HMac(SHA512Digest()).apply {
            init(KeyParameter(ED25519_SEED_KEY))
            update(bip39Seed, 0, bip39Seed.size)
        }
        val output = ByteArray(64)
        hmac.doFinal(output, 0)
        return output.copyOfRange(0, 32)
    }

    companion object {
        const val DEFAULT_STRENGTH_BITS = 256

        /** 合法 BIP-39 entropy 位数 → 词数：128→12, 160→15, 192→18, 224→21, 256→24 */
        val VALID_STRENGTHS = listOf(128, 160, 192, 224, 256)

        /** SLIP-0010 Ed25519 master HMAC key（固定字节序列）。 */
        private val ED25519_SEED_KEY = "ed25519 seed".toByteArray(Charsets.US_ASCII)
    }
}
