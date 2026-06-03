package com.chainlesschain.android.core.blockchain.contract

import java.math.BigInteger

/**
 * ABI decoder for smart contract return values and events
 */
object ABIDecoder {

    /**
     * Decode function return value
     */
    fun decodeReturn(types: List<String>, data: String): List<Any> {
        val cleanData = data.removePrefix("0x")
        return decodeParameters(types, cleanData)
    }

    /**
     * Decode function return using ABI entry
     */
    fun decodeReturn(entry: ABIEntry, data: String): List<Any> {
        require(entry.type == ABIType.FUNCTION) { "Entry must be a function" }
        val types = entry.outputs.map { it.type }
        return decodeReturn(types, data)
    }

    /**
     * Decode event log
     */
    fun decodeEvent(
        entry: ABIEntry,
        topics: List<String>,
        data: String
    ): Map<String, Any> {
        require(entry.type == ABIType.EVENT) { "Entry must be an event" }

        val result = mutableMapOf<String, Any>()
        var topicIndex = if (entry.anonymous) 0 else 1 // Skip event signature topic
        var dataOffset = 0
        val cleanData = data.removePrefix("0x")

        for (param in entry.inputs) {
            if (param.indexed) {
                // Indexed parameters are in topics
                if (topicIndex < topics.size) {
                    result[param.name] = decodeTopicValue(param.type, topics[topicIndex])
                    topicIndex++
                }
            } else {
                // Non-indexed parameters are in data
                val (value, newOffset) = decodeValueWithOffset(param.type, cleanData, dataOffset)
                result[param.name] = value
                dataOffset = newOffset
            }
        }

        return result
    }

    /**
     * Decode parameters from hex string
     */
    fun decodeParameters(types: List<String>, data: String): List<Any> {
        val results = mutableListOf<Any>()
        var offset = 0

        for (type in types) {
            val (value, newOffset) = decodeValueWithOffset(type, data, offset)
            results.add(value)
            offset = if (isDynamicType(type)) offset + 64 else newOffset
        }

        return results
    }

    /**
     * Safe substring that validates bounds before extracting
     */
    private fun safeSubstring(data: String, start: Int, end: Int): String {
        require(start >= 0 && end >= start && end <= data.length) {
            "ABI data too short: need $end chars but got ${data.length}"
        }
        return data.substring(start, end)
    }

    /**
     * Decode value with offset tracking
     */
    private fun decodeValueWithOffset(type: String, data: String, offset: Int): Pair<Any, Int> {
        return when {
            type.startsWith("uint") -> {
                val value = decodeUint(safeSubstring(data, offset, offset + 64))
                Pair(value, offset + 64)
            }
            type.startsWith("int") -> {
                val value = decodeInt(safeSubstring(data, offset, offset + 64))
                Pair(value, offset + 64)
            }
            type == "address" -> {
                val value = decodeAddress(safeSubstring(data, offset, offset + 64))
                Pair(value, offset + 64)
            }
            type == "bool" -> {
                val value = decodeBool(safeSubstring(data, offset, offset + 64))
                Pair(value, offset + 64)
            }
            type == "bytes32" -> {
                val value = decodeBytes32(safeSubstring(data, offset, offset + 64))
                Pair(value, offset + 64)
            }
            type == "bytes" -> {
                val pointerOffset = decodeUint(safeSubstring(data, offset, offset + 64)).toInt() * 2
                val value = decodeDynamicBytes(data, pointerOffset)
                Pair(value, offset + 64)
            }
            type == "string" -> {
                val pointerOffset = decodeUint(safeSubstring(data, offset, offset + 64)).toInt() * 2
                val value = decodeString(data, pointerOffset)
                Pair(value, offset + 64)
            }
            type.endsWith("[]") -> {
                val pointerOffset = decodeUint(safeSubstring(data, offset, offset + 64)).toInt() * 2
                val value = decodeArray(type, data, pointerOffset)
                Pair(value, offset + 64)
            }
            else -> throw IllegalArgumentException("Unsupported type: $type")
        }
    }

    /**
     * Decode topic value (always 32 bytes, padded)
     */
    private fun decodeTopicValue(type: String, topic: String): Any {
        val cleanTopic = topic.removePrefix("0x")
        return when {
            type.startsWith("uint") -> decodeUint(cleanTopic)
            type.startsWith("int") -> decodeInt(cleanTopic)
            type == "address" -> decodeAddress(cleanTopic)
            type == "bool" -> decodeBool(cleanTopic)
            type == "bytes32" -> decodeBytes32(cleanTopic)
            // Dynamic types in topics are their keccak256 hash
            type == "string" || type == "bytes" || type.endsWith("[]") -> "0x$cleanTopic"
            else -> "0x$cleanTopic"
        }
    }

    /**
     * Decode uint (any size)
     */
    private fun decodeUint(hex: String): BigInteger {
        return if (hex.isEmpty()) BigInteger.ZERO else BigInteger(hex, 16)
    }

    /**
     * Decode int (any size, two's complement)
     */
    private fun decodeInt(hex: String): BigInteger {
        val unsigned = BigInteger(hex, 16)
        val maxPositive = BigInteger.ONE.shiftLeft(255)
        return if (unsigned >= maxPositive) {
            unsigned.subtract(BigInteger.ONE.shiftLeft(256))
        } else {
            unsigned
        }
    }

    /**
     * Decode address
     */
    private fun decodeAddress(hex: String): String {
        return "0x" + hex.takeLast(40).lowercase()
    }

    /**
     * Decode bool
     */
    private fun decodeBool(hex: String): Boolean {
        return hex.takeLast(1) == "1"
    }

    /**
     * Decode bytes32
     */
    private fun decodeBytes32(hex: String): String {
        return "0x$hex"
    }

    /**
     * Decode dynamic bytes
     */
    private fun decodeDynamicBytes(data: String, offset: Int): ByteArray {
        val length = decodeUint(safeSubstring(data, offset, offset + 64)).toInt()
        require(length >= 0) { "Invalid bytes length: $length" }
        val bytesHex = safeSubstring(data, offset + 64, offset + 64 + length * 2)
        return bytesHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    /**
     * Decode string
     */
    private fun decodeString(data: String, offset: Int): String {
        val bytes = decodeDynamicBytes(data, offset)
        return String(bytes, Charsets.UTF_8)
    }

    /**
     * Decode array
     */
    private fun decodeArray(type: String, data: String, offset: Int): List<Any> {
        val elementType = type.removeSuffix("[]")
        val length = decodeUint(safeSubstring(data, offset, offset + 64)).toInt()
        require(length in 0..10000) { "Invalid array length: $length" }

        val results = mutableListOf<Any>()
        var elementOffset = offset + 64

        for (i in 0 until length) {
            val (value, newOffset) = decodeValueWithOffset(elementType, data, elementOffset)
            results.add(value)
            elementOffset = newOffset
        }

        return results
    }

    /**
     * Check if type is dynamic
     */
    private fun isDynamicType(type: String): Boolean {
        return type == "string" || type == "bytes" || type.endsWith("[]")
    }

    /**
     * Decode single return value
     */
    inline fun <reified T> decodeSingle(data: String): T {
        val cleanData = data.removePrefix("0x")
        val type = when (T::class) {
            BigInteger::class -> "uint256"
            Boolean::class -> "bool"
            String::class -> if (cleanData.length == 64) "address" else "string"
            ByteArray::class -> "bytes"
            else -> throw IllegalArgumentException("Unsupported type: ${T::class}")
        }
        val results = decodeParameters(listOf(type), cleanData)
        @Suppress("UNCHECKED_CAST")
        return (results.firstOrNull() ?: throw IllegalStateException("ABI decode returned empty results")) as T
    }

    /**
     * Try to decode revert reason
     */
    fun decodeRevertReason(data: String): String? {
        val cleanData = data.removePrefix("0x")

        // Check for Error(string) selector: 0x08c379a0
        if (cleanData.startsWith("08c379a0") && cleanData.length >= 8 + 64 + 64) {
            return try {
                decodeString(cleanData.substring(8), 0)
            } catch (e: Exception) {
                null
            }
        }

        // Check for Panic(uint256) selector: 0x4e487b71
        if (cleanData.startsWith("4e487b71") && cleanData.length >= 8 + 64) {
            val panicCode = decodeUint(cleanData.substring(8, 8 + 64))
            return getPanicReason(panicCode.toInt())
        }

        return null
    }

    /**
     * Get panic reason from code
     */
    private fun getPanicReason(code: Int): String {
        return when (code) {
            0x00 -> "Generic compiler panic"
            0x01 -> "Assertion failed"
            0x11 -> "Arithmetic overflow/underflow"
            0x12 -> "Division by zero"
            0x21 -> "Invalid enum value"
            0x22 -> "Incorrectly encoded storage byte array"
            0x31 -> "Pop on empty array"
            0x32 -> "Array index out of bounds"
            0x41 -> "Too much memory allocated"
            0x51 -> "Internal function call error"
            else -> "Unknown panic code: 0x${code.toString(16)}"
        }
    }
}
