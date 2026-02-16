package com.chainlesschain.android.core.blockchain.contract

import java.math.BigInteger
import java.security.MessageDigest

/**
 * ABI encoder for smart contract function calls
 * Implements Ethereum ABI encoding specification
 */
object ABIEncoder {

    /**
     * Encode function call with parameters
     */
    fun encodeFunction(
        functionName: String,
        paramTypes: List<String>,
        params: List<Any>
    ): String {
        val selector = getFunctionSelector(functionName, paramTypes)
        val encodedParams = encodeParameters(paramTypes, params)
        return selector + encodedParams
    }

    /**
     * Encode function call using ABI entry
     */
    fun encodeFunction(entry: ABIEntry, params: List<Any>): String {
        require(entry.type == ABIType.FUNCTION) { "Entry must be a function" }

        val paramTypes = entry.inputs.map { it.type }
        val name = entry.name ?: throw IllegalArgumentException("ABI entry name is null")
        return encodeFunction(name, paramTypes, params)
    }

    /**
     * Get function selector (first 4 bytes of keccak256 hash)
     */
    fun getFunctionSelector(functionName: String, paramTypes: List<String>): String {
        val signature = "$functionName(${paramTypes.joinToString(",")})"
        val hash = keccak256(signature.toByteArray())
        return "0x" + hash.take(4).joinToString("") { "%02x".format(it) }
    }

    /**
     * Encode parameters according to ABI specification
     */
    fun encodeParameters(types: List<String>, values: List<Any>): String {
        require(types.size == values.size) { "Types and values count mismatch" }

        val heads = mutableListOf<String>()
        val tails = mutableListOf<String>()

        var dynamicOffset = types.size * 32

        for (i in types.indices) {
            val type = types[i]
            val value = values[i]

            if (isDynamicType(type)) {
                // Dynamic type: encode offset in head, actual data in tail
                heads.add(encodeUint256(BigInteger.valueOf(dynamicOffset.toLong())))
                val encodedValue = encodeValue(type, value)
                tails.add(encodedValue)
                dynamicOffset += encodedValue.length / 2
            } else {
                // Static type: encode directly in head
                heads.add(encodeValue(type, value))
            }
        }

        return heads.joinToString("") + tails.joinToString("")
    }

    /**
     * Encode single value
     */
    fun encodeValue(type: String, value: Any): String {
        return when {
            type.startsWith("uint") -> encodeUint(type, value)
            type.startsWith("int") -> encodeInt(type, value)
            type == "address" -> encodeAddress(value as String)
            type == "bool" -> encodeBool(value as Boolean)
            type == "bytes32" -> encodeBytes32(value)
            type == "bytes" -> encodeDynamicBytes(value)
            type == "string" -> encodeString(value as String)
            type.endsWith("[]") -> encodeArray(type, value as List<*>)
            else -> throw IllegalArgumentException("Unsupported type: $type")
        }
    }

    /**
     * Encode uint (uint8, uint16, ..., uint256)
     */
    private fun encodeUint(type: String, value: Any): String {
        val bigInt = when (value) {
            is BigInteger -> value
            is Long -> BigInteger.valueOf(value)
            is Int -> BigInteger.valueOf(value.toLong())
            is String -> BigInteger(value.removePrefix("0x"), if (value.startsWith("0x")) 16 else 10)
            else -> throw IllegalArgumentException("Cannot convert $value to BigInteger")
        }
        return encodeUint256(bigInt)
    }

    /**
     * Encode int (int8, int16, ..., int256)
     */
    private fun encodeInt(type: String, value: Any): String {
        val bigInt = when (value) {
            is BigInteger -> value
            is Long -> BigInteger.valueOf(value)
            is Int -> BigInteger.valueOf(value.toLong())
            is String -> BigInteger(value.removePrefix("0x"), if (value.startsWith("0x")) 16 else 10)
            else -> throw IllegalArgumentException("Cannot convert $value to BigInteger")
        }
        return encodeInt256(bigInt)
    }

    /**
     * Encode uint256
     */
    private fun encodeUint256(value: BigInteger): String {
        require(value >= BigInteger.ZERO) { "Value must be non-negative" }
        return value.toString(16).padStart(64, '0')
    }

    /**
     * Encode int256 (two's complement)
     */
    private fun encodeInt256(value: BigInteger): String {
        return if (value >= BigInteger.ZERO) {
            value.toString(16).padStart(64, '0')
        } else {
            // Two's complement for negative numbers
            val positive = value.add(BigInteger.ONE.shiftLeft(256))
            positive.toString(16).padStart(64, 'f')
        }
    }

    /**
     * Encode address (20 bytes, left-padded to 32 bytes)
     */
    private fun encodeAddress(address: String): String {
        val cleanAddress = address.removePrefix("0x").lowercase()
        require(cleanAddress.length == 40) { "Invalid address length" }
        return cleanAddress.padStart(64, '0')
    }

    /**
     * Encode bool
     */
    private fun encodeBool(value: Boolean): String {
        return if (value) {
            "0".repeat(63) + "1"
        } else {
            "0".repeat(64)
        }
    }

    /**
     * Encode bytes32
     */
    private fun encodeBytes32(value: Any): String {
        val bytes = when (value) {
            is ByteArray -> value
            is String -> value.removePrefix("0x").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            else -> throw IllegalArgumentException("Cannot encode bytes32 from $value")
        }
        require(bytes.size <= 32) { "bytes32 too long" }
        return bytes.joinToString("") { "%02x".format(it) }.padEnd(64, '0')
    }

    /**
     * Encode dynamic bytes
     */
    private fun encodeDynamicBytes(value: Any): String {
        val bytes = when (value) {
            is ByteArray -> value
            is String -> value.removePrefix("0x").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            else -> throw IllegalArgumentException("Cannot encode bytes from $value")
        }

        val length = encodeUint256(BigInteger.valueOf(bytes.size.toLong()))
        val data = bytes.joinToString("") { "%02x".format(it) }
        val paddedData = data.padEnd((data.length + 63) / 64 * 64, '0')

        return length + paddedData
    }

    /**
     * Encode string
     */
    private fun encodeString(value: String): String {
        val bytes = value.toByteArray(Charsets.UTF_8)
        return encodeDynamicBytes(bytes)
    }

    /**
     * Encode array
     */
    private fun encodeArray(type: String, values: List<*>): String {
        val elementType = type.removeSuffix("[]")
        val length = encodeUint256(BigInteger.valueOf(values.size.toLong()))

        val elements = values.map { encodeValue(elementType, it ?: throw IllegalArgumentException("Null element in ABI array")) }
        return length + elements.joinToString("")
    }

    /**
     * Check if type is dynamic
     */
    private fun isDynamicType(type: String): Boolean {
        return type == "string" || type == "bytes" || type.endsWith("[]")
    }

    /**
     * Keccak256 hash
     */
    private fun keccak256(input: ByteArray): ByteArray {
        val digest = MessageDigest.getInstance("KECCAK-256")
            ?: MessageDigest.getInstance("SHA3-256")
        return digest.digest(input)
    }
}
