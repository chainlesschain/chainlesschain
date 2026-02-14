package com.chainlesschain.android.core.blockchain.crypto

import java.math.BigInteger

/**
 * RLP (Recursive Length Prefix) encoder for Ethereum transaction serialization
 *
 * Encoding rules:
 * - Single byte [0x00, 0x7f]: encoded as itself
 * - String 0-55 bytes: 0x80 + length, followed by string
 * - String >55 bytes: 0xb7 + length-of-length, followed by length, followed by string
 * - List 0-55 bytes total: 0xc0 + total length, followed by concatenated items
 * - List >55 bytes total: 0xf7 + length-of-length, followed by length, followed by items
 */
object RLPEncoder {

    /**
     * Encode a single byte array item
     */
    fun encodeBytes(input: ByteArray): ByteArray {
        if (input.size == 1 && input[0].toInt() and 0xFF < 0x80) {
            return input
        }
        return encodeLength(input.size, 0x80) + input
    }

    /**
     * Encode a BigInteger (strips leading zeros, empty for zero)
     */
    fun encodeBigInteger(value: BigInteger): ByteArray {
        if (value == BigInteger.ZERO) {
            return encodeBytes(ByteArray(0))
        }
        val bytes = value.toByteArray()
        // Remove leading zero byte if present (sign byte)
        val trimmed = if (bytes.isNotEmpty() && bytes[0] == 0.toByte()) {
            bytes.copyOfRange(1, bytes.size)
        } else {
            bytes
        }
        return encodeBytes(trimmed)
    }

    /**
     * Encode a Long value
     */
    fun encodeLong(value: Long): ByteArray {
        if (value == 0L) {
            return encodeBytes(ByteArray(0))
        }
        return encodeBigInteger(BigInteger.valueOf(value))
    }

    /**
     * Encode a hex string (with or without 0x prefix)
     */
    fun encodeHexString(hex: String): ByteArray {
        val clean = hex.removePrefix("0x")
        if (clean.isEmpty() || clean == "0") {
            return encodeBytes(ByteArray(0))
        }
        val padded = if (clean.length % 2 != 0) "0$clean" else clean
        val bytes = padded.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return encodeBytes(bytes)
    }

    /**
     * Encode an address (20 bytes from hex string)
     */
    fun encodeAddress(address: String): ByteArray {
        val clean = address.removePrefix("0x")
        if (clean.isEmpty()) {
            return encodeBytes(ByteArray(0))
        }
        val bytes = clean.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return encodeBytes(bytes)
    }

    /**
     * Encode a list of already-encoded items
     */
    fun encodeList(items: List<ByteArray>): ByteArray {
        val concatenated = items.fold(ByteArray(0)) { acc, item -> acc + item }
        return encodeLength(concatenated.size, 0xc0) + concatenated
    }

    /**
     * Encode a list of items (vararg convenience)
     */
    fun encodeList(vararg items: ByteArray): ByteArray {
        return encodeList(items.toList())
    }

    /**
     * Encode length prefix
     */
    private fun encodeLength(length: Int, offset: Int): ByteArray {
        return if (length < 56) {
            byteArrayOf((length + offset).toByte())
        } else {
            val lengthBytes = toBinaryMinimal(length)
            byteArrayOf((offset + 55 + lengthBytes.size).toByte()) + lengthBytes
        }
    }

    /**
     * Convert integer to minimal byte representation (big-endian, no leading zeros)
     */
    private fun toBinaryMinimal(value: Int): ByteArray {
        val bytes = ByteArray(4)
        bytes[0] = (value shr 24).toByte()
        bytes[1] = (value shr 16).toByte()
        bytes[2] = (value shr 8).toByte()
        bytes[3] = value.toByte()

        var start = 0
        while (start < 3 && bytes[start] == 0.toByte()) start++
        return bytes.copyOfRange(start, bytes.size)
    }

    /**
     * Helper to convert hex string to byte array
     */
    fun hexToBytes(hex: String): ByteArray {
        val clean = hex.removePrefix("0x")
        if (clean.isEmpty()) return ByteArray(0)
        val padded = if (clean.length % 2 != 0) "0$clean" else clean
        return padded.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    /**
     * Helper to convert byte array to hex string
     */
    fun bytesToHex(bytes: ByteArray): String {
        return "0x" + bytes.joinToString("") { "%02x".format(it) }
    }
}
