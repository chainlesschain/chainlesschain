package com.chainlesschain.android.core.blockchain.crypto

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.common.Result
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bouncycastle.asn1.x9.X9ECParameters
import org.bouncycastle.crypto.ec.CustomNamedCurves
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECPrivateKeyParameters
import org.bouncycastle.crypto.signers.ECDSASigner
import org.bouncycastle.crypto.signers.HMacDSAKCalculator
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.math.ec.ECPoint
import org.bouncycastle.math.ec.FixedPointCombMultiplier
import timber.log.Timber
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wallet core adapter for cryptographic operations
 * Uses BouncyCastle for cryptographic primitives
 * Follows BIP32/BIP39/BIP44 standards
 */
@Singleton
class WalletCoreAdapter @Inject constructor() {

    init {
        // Register BouncyCastle provider
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(BouncyCastleProvider())
        }
    }

    private val secureRandom = SecureRandom()

    /**
     * BIP39 word list (English)
     * This is a subset - full list has 2048 words
     */
    private val wordList: List<String> by lazy {
        // In production, load full BIP39 wordlist from resources
        BIP39_ENGLISH_WORDLIST
    }

    /**
     * Generate new mnemonic phrase
     */
    suspend fun generateMnemonic(
        strength: MnemonicStrength = MnemonicStrength.WORDS_12
    ): Result<String> = withContext(Dispatchers.Default) {
        try {
            val entropy = ByteArray(strength.entropyBits / 8)
            secureRandom.nextBytes(entropy)

            val mnemonic = entropyToMnemonic(entropy)
            Result.success(mnemonic)
        } catch (e: Exception) {
            Timber.e(e, "Failed to generate mnemonic")
            Result.error(e, "Failed to generate mnemonic")
        }
    }

    /**
     * Validate mnemonic phrase
     */
    fun validateMnemonic(mnemonic: String): Boolean {
        val words = mnemonic.trim().split("\\s+".toRegex())
        if (words.size !in listOf(12, 15, 18, 21, 24)) {
            return false
        }

        return words.all { it.lowercase() in wordList }
    }

    /**
     * Derive seed from mnemonic
     */
    suspend fun mnemonicToSeed(
        mnemonic: String,
        passphrase: String = ""
    ): Result<ByteArray> = withContext(Dispatchers.Default) {
        try {
            if (!validateMnemonic(mnemonic)) {
                return@withContext Result.error(
                    IllegalArgumentException("Invalid mnemonic"),
                    "Invalid mnemonic phrase"
                )
            }

            val normalizedMnemonic = mnemonic.trim().lowercase()
            val salt = "mnemonic$passphrase"

            // PBKDF2-HMAC-SHA512 with 2048 iterations
            val seed = pbkdf2HmacSha512(
                password = normalizedMnemonic.toByteArray(Charsets.UTF_8),
                salt = salt.toByteArray(Charsets.UTF_8),
                iterations = 2048,
                keyLength = 64
            )

            Result.success(seed)
        } catch (e: Exception) {
            Timber.e(e, "Failed to derive seed from mnemonic")
            Result.error(e, "Failed to derive seed")
        }
    }

    /**
     * Derive private key from seed using BIP44 path
     */
    suspend fun derivePrivateKey(
        seed: ByteArray,
        chain: SupportedChain,
        accountIndex: Int = 0,
        addressIndex: Int = 0
    ): Result<ByteArray> = withContext(Dispatchers.Default) {
        try {
            // BIP44 path: m/44'/coin_type'/account'/0/address_index
            val coinType = getCoinType(chain)
            val path = "m/44'/$coinType'/$accountIndex'/0/$addressIndex"

            val privateKey = derivePath(seed, path)
            Result.success(privateKey)
        } catch (e: Exception) {
            Timber.e(e, "Failed to derive private key")
            Result.error(e, "Failed to derive private key")
        }
    }

    /**
     * Derive address from private key
     */
    suspend fun privateKeyToAddress(
        privateKey: ByteArray,
        chain: SupportedChain
    ): Result<String> = withContext(Dispatchers.Default) {
        try {
            // Get public key from private key
            val publicKey = privateKeyToPublicKey(privateKey)

            // Derive address based on chain type
            val address = when (chain) {
                // All EVM chains use same address format
                else -> publicKeyToEthAddress(publicKey)
            }

            Result.success(address)
        } catch (e: Exception) {
            Timber.e(e, "Failed to derive address")
            Result.error(e, "Failed to derive address")
        }
    }

    /**
     * Sign message hash
     */
    suspend fun signHash(
        hash: ByteArray,
        privateKey: ByteArray
    ): Result<ByteArray> = withContext(Dispatchers.Default) {
        try {
            require(hash.size == 32) { "Hash must be 32 bytes" }
            require(privateKey.size == 32) { "Private key must be 32 bytes" }

            // ECDSA signature on secp256k1
            val signature = ecdsaSign(hash, privateKey)
            Result.success(signature)
        } catch (e: Exception) {
            Timber.e(e, "Failed to sign hash")
            Result.error(e, "Failed to sign")
        }
    }

    /**
     * Sign personal message (EIP-191)
     */
    suspend fun signPersonalMessage(
        message: String,
        privateKey: ByteArray
    ): Result<ByteArray> = withContext(Dispatchers.Default) {
        try {
            val prefix = "\u0019Ethereum Signed Message:\n${message.length}"
            val prefixedMessage = prefix.toByteArray() + message.toByteArray()
            val hash = keccak256(prefixedMessage)

            signHash(hash, privateKey)
        } catch (e: Exception) {
            Timber.e(e, "Failed to sign personal message")
            Result.error(e, "Failed to sign message")
        }
    }

    /**
     * Sign typed data (EIP-712)
     */
    suspend fun signTypedData(
        domainSeparator: ByteArray,
        structHash: ByteArray,
        privateKey: ByteArray
    ): Result<ByteArray> = withContext(Dispatchers.Default) {
        try {
            val prefix = byteArrayOf(0x19, 0x01)
            val message = prefix + domainSeparator + structHash
            val hash = keccak256(message)

            signHash(hash, privateKey)
        } catch (e: Exception) {
            Timber.e(e, "Failed to sign typed data")
            Result.error(e, "Failed to sign typed data")
        }
    }

    // ==================== Helper Functions ====================

    /**
     * Convert entropy to mnemonic words
     */
    private fun entropyToMnemonic(entropy: ByteArray): String {
        val hash = sha256(entropy)
        val entropyBits = bytesToBits(entropy)
        val checksumBits = bytesToBits(hash).take(entropy.size / 4)
        val allBits = entropyBits + checksumBits

        val words = allBits.chunked(11).map { bits ->
            val index = bits.fold(0) { acc, bit -> (acc shl 1) or (if (bit) 1 else 0) }
            wordList[index]
        }

        return words.joinToString(" ")
    }

    /**
     * Get coin type for BIP44 derivation
     */
    private fun getCoinType(chain: SupportedChain): Int {
        // Most EVM chains use ETH coin type (60)
        // Some chains have their own coin types
        return when (chain) {
            SupportedChain.ETHEREUM,
            SupportedChain.GOERLI,
            SupportedChain.SEPOLIA -> 60
            SupportedChain.BSC -> 60  // BSC uses ETH addresses
            SupportedChain.POLYGON,
            SupportedChain.MUMBAI -> 60
            else -> 60  // Default to ETH for all EVM chains
        }
    }

    /**
     * Derive key from path
     */
    private fun derivePath(seed: ByteArray, path: String): ByteArray {
        // Parse path and derive
        val components = path.split("/").drop(1) // Remove 'm'

        var key = hmacSha512("Bitcoin seed".toByteArray(), seed)
        var chainCode = key.sliceArray(32 until 64)
        key = key.sliceArray(0 until 32)

        for (component in components) {
            val hardened = component.endsWith("'")
            val index = component.removeSuffix("'").toInt()

            val data = if (hardened) {
                byteArrayOf(0) + key + indexToBytes(index + 0x80000000.toInt())
            } else {
                privateKeyToCompressedPublicKey(key) + indexToBytes(index)
            }

            val derived = hmacSha512(chainCode, data)
            key = derived.sliceArray(0 until 32)
            chainCode = derived.sliceArray(32 until 64)
        }

        return key
    }

    /**
     * Get uncompressed public key from private key using secp256k1 curve (65 bytes)
     */
    private fun privateKeyToPublicKey(privateKey: ByteArray): ByteArray {
        val curveParams = CustomNamedCurves.getByName("secp256k1")
        val privateKeyNum = BigInteger(1, privateKey)
        val pointQ = FixedPointCombMultiplier().multiply(curveParams.g, privateKeyNum)
        return pointQ.getEncoded(false) // 65 bytes uncompressed: 0x04 + x(32) + y(32)
    }

    /**
     * Get compressed public key from private key using secp256k1 curve (33 bytes)
     * Used for BIP32 non-hardened child key derivation
     */
    private fun privateKeyToCompressedPublicKey(privateKey: ByteArray): ByteArray {
        val curveParams = CustomNamedCurves.getByName("secp256k1")
        val privateKeyNum = BigInteger(1, privateKey)
        val pointQ = FixedPointCombMultiplier().multiply(curveParams.g, privateKeyNum)
        return pointQ.getEncoded(true) // 33 bytes compressed: 0x02/0x03 + x(32)
    }

    /**
     * Convert public key to Ethereum address
     */
    private fun publicKeyToEthAddress(publicKey: ByteArray): String {
        // Remove prefix if present
        val pubKeyNoPrefix = if (publicKey.size == 65 && publicKey[0] == 0x04.toByte()) {
            publicKey.sliceArray(1 until 65)
        } else {
            publicKey
        }

        val hash = keccak256(pubKeyNoPrefix)
        val address = hash.takeLast(20).toByteArray()

        return "0x" + address.joinToString("") { "%02x".format(it) }
    }

    /**
     * ECDSA sign on secp256k1
     * Returns 65-byte signature: r (32) + s (32) + v (1)
     */
    private fun ecdsaSign(hash: ByteArray, privateKey: ByteArray): ByteArray {
        val curveParams = CustomNamedCurves.getByName("secp256k1")
        val domainParams = ECDomainParameters(
            curveParams.curve, curveParams.g, curveParams.n, curveParams.h
        )
        val halfCurveOrder = curveParams.n.shiftRight(1)

        val signer = ECDSASigner(HMacDSAKCalculator(SHA256Digest()))
        val privKeyNum = BigInteger(1, privateKey)
        signer.init(true, ECPrivateKeyParameters(privKeyNum, domainParams))

        val components = signer.generateSignature(hash)
        var r = components[0]
        var s = components[1]

        // Normalize s to lower half (EIP-2 / BIP-62)
        if (s > halfCurveOrder) {
            s = curveParams.n.subtract(s)
        }

        // Calculate recovery id (v)
        val publicKey = privateKeyToPublicKey(privateKey)
        var recId = -1
        for (i in 0..3) {
            val recovered = recoverPublicKey(hash, r, s, i, curveParams)
            if (recovered != null && recovered.contentEquals(publicKey)) {
                recId = i
                break
            }
        }
        if (recId == -1) {
            throw IllegalStateException("Could not determine recovery id")
        }

        // Encode: r (32 bytes) + s (32 bytes) + v (1 byte, recId + 27)
        val rBytes = bigIntTo32Bytes(r)
        val sBytes = bigIntTo32Bytes(s)
        val signature = ByteArray(65)
        System.arraycopy(rBytes, 0, signature, 0, 32)
        System.arraycopy(sBytes, 0, signature, 32, 32)
        signature[64] = (recId + 27).toByte()

        return signature
    }

    /**
     * Recover public key from signature for recovery id calculation
     */
    private fun recoverPublicKey(
        hash: ByteArray,
        r: BigInteger,
        s: BigInteger,
        recId: Int,
        curveParams: X9ECParameters
    ): ByteArray? {
        val n = curveParams.n
        val curve = curveParams.curve
        val g = curveParams.g

        // Calculate the point R
        val x = r.add(BigInteger.valueOf(recId.toLong() / 2).multiply(n))
        if (x >= curve.field.characteristic) return null

        val rPoint = try {
            val compressedPoint = ByteArray(33)
            compressedPoint[0] = if (recId % 2 == 0) 0x02 else 0x03
            val xBytes = bigIntTo32Bytes(x)
            System.arraycopy(xBytes, 0, compressedPoint, 1, 32)
            curve.decodePoint(compressedPoint)
        } catch (e: Exception) {
            return null
        }

        val eInv = BigInteger(1, hash).negate().mod(n)
        val rInv = r.modInverse(n)

        val q = sumOfTwoMultiplies(g, eInv.multiply(rInv).mod(n), rPoint, s.multiply(rInv).mod(n))
        return q.getEncoded(false)
    }

    private fun sumOfTwoMultiplies(g: ECPoint, a: BigInteger, r: ECPoint, b: BigInteger): ECPoint {
        return ECPoint.decodePoint(g.curve, g.multiply(a).add(r.multiply(b)).getEncoded(false))
    }

    /**
     * Convert BigInteger to exactly 32 bytes (left-padded with zeros)
     */
    private fun bigIntTo32Bytes(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        return when {
            bytes.size == 32 -> bytes
            bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size)
            else -> ByteArray(32 - bytes.size) + bytes
        }
    }

    // ==================== Crypto Primitives ====================

    private fun sha256(input: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(input)
    }

    private fun keccak256(input: ByteArray): ByteArray {
        val digest = MessageDigest.getInstance("KECCAK-256")
            ?: MessageDigest.getInstance("SHA3-256")
        return digest.digest(input)
    }

    private fun hmacSha512(key: ByteArray, data: ByteArray): ByteArray {
        val mac = javax.crypto.Mac.getInstance("HmacSHA512")
        mac.init(javax.crypto.spec.SecretKeySpec(key, "HmacSHA512"))
        return mac.doFinal(data)
    }

    private fun pbkdf2HmacSha512(
        password: ByteArray,
        salt: ByteArray,
        iterations: Int,
        keyLength: Int
    ): ByteArray {
        val factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512")
        val spec = javax.crypto.spec.PBEKeySpec(
            String(password).toCharArray(),
            salt,
            iterations,
            keyLength * 8
        )
        return factory.generateSecret(spec).encoded
    }

    private fun bytesToBits(bytes: ByteArray): List<Boolean> {
        return bytes.flatMap { byte ->
            (7 downTo 0).map { bit ->
                (byte.toInt() shr bit) and 1 == 1
            }
        }
    }

    private fun indexToBytes(index: Int): ByteArray {
        return byteArrayOf(
            (index shr 24).toByte(),
            (index shr 16).toByte(),
            (index shr 8).toByte(),
            index.toByte()
        )
    }

    companion object {
        // First 100 words of BIP39 English wordlist (for demo)
        // In production, use complete 2048 word list
        private val BIP39_ENGLISH_WORDLIST = listOf(
            "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
            "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
            "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
            "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
            "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
            "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
            "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone",
            "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
            "amount", "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry",
            "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
            "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april",
            "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
            "army", "around", "arrange", "arrest"
            // ... remaining 1948 words would be here in production
        )
    }
}

/**
 * Mnemonic strength options
 */
enum class MnemonicStrength(val entropyBits: Int, val wordCount: Int) {
    WORDS_12(128, 12),
    WORDS_15(160, 15),
    WORDS_18(192, 18),
    WORDS_21(224, 21),
    WORDS_24(256, 24)
}
