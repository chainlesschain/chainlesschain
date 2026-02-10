package com.chainlesschain.android.core.blockchain.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray

/**
 * ABI definition for smart contracts
 */
@Serializable
data class ContractABI(
    val entries: List<ABIEntry>
) {
    /**
     * Get function entry by name
     */
    fun getFunction(name: String): ABIEntry? {
        return entries.find { it.type == ABIType.FUNCTION && it.name == name }
    }

    /**
     * Get event entry by name
     */
    fun getEvent(name: String): ABIEntry? {
        return entries.find { it.type == ABIType.EVENT && it.name == name }
    }

    /**
     * Get all functions
     */
    fun functions(): List<ABIEntry> {
        return entries.filter { it.type == ABIType.FUNCTION }
    }

    /**
     * Get all events
     */
    fun events(): List<ABIEntry> {
        return entries.filter { it.type == ABIType.EVENT }
    }

    companion object {
        private val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

        /**
         * Parse ABI from JSON string
         */
        fun fromJson(jsonString: String): ContractABI {
            val jsonArray = json.parseToJsonElement(jsonString).jsonArray
            val entries: List<ABIEntry> = json.decodeFromJsonElement(jsonArray)
            return ContractABI(entries)
        }

        // Common ERC20 ABI
        val ERC20 = ContractABI(
            listOf(
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "name",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "string")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "symbol",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "string")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "decimals",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "uint8")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "totalSupply",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "uint256")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "balanceOf",
                    inputs = listOf(ABIParam("account", "address")),
                    outputs = listOf(ABIParam("", "uint256")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "transfer",
                    inputs = listOf(
                        ABIParam("to", "address"),
                        ABIParam("amount", "uint256")
                    ),
                    outputs = listOf(ABIParam("", "bool")),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "approve",
                    inputs = listOf(
                        ABIParam("spender", "address"),
                        ABIParam("amount", "uint256")
                    ),
                    outputs = listOf(ABIParam("", "bool")),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "allowance",
                    inputs = listOf(
                        ABIParam("owner", "address"),
                        ABIParam("spender", "address")
                    ),
                    outputs = listOf(ABIParam("", "uint256")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "transferFrom",
                    inputs = listOf(
                        ABIParam("from", "address"),
                        ABIParam("to", "address"),
                        ABIParam("amount", "uint256")
                    ),
                    outputs = listOf(ABIParam("", "bool")),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.EVENT,
                    name = "Transfer",
                    inputs = listOf(
                        ABIParam("from", "address", indexed = true),
                        ABIParam("to", "address", indexed = true),
                        ABIParam("value", "uint256", indexed = false)
                    )
                ),
                ABIEntry(
                    type = ABIType.EVENT,
                    name = "Approval",
                    inputs = listOf(
                        ABIParam("owner", "address", indexed = true),
                        ABIParam("spender", "address", indexed = true),
                        ABIParam("value", "uint256", indexed = false)
                    )
                )
            )
        )

        // Common ERC721 ABI
        val ERC721 = ContractABI(
            listOf(
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "name",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "string")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "symbol",
                    inputs = emptyList(),
                    outputs = listOf(ABIParam("", "string")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "tokenURI",
                    inputs = listOf(ABIParam("tokenId", "uint256")),
                    outputs = listOf(ABIParam("", "string")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "balanceOf",
                    inputs = listOf(ABIParam("owner", "address")),
                    outputs = listOf(ABIParam("", "uint256")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "ownerOf",
                    inputs = listOf(ABIParam("tokenId", "uint256")),
                    outputs = listOf(ABIParam("", "address")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "safeTransferFrom",
                    inputs = listOf(
                        ABIParam("from", "address"),
                        ABIParam("to", "address"),
                        ABIParam("tokenId", "uint256")
                    ),
                    outputs = emptyList(),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "transferFrom",
                    inputs = listOf(
                        ABIParam("from", "address"),
                        ABIParam("to", "address"),
                        ABIParam("tokenId", "uint256")
                    ),
                    outputs = emptyList(),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "approve",
                    inputs = listOf(
                        ABIParam("to", "address"),
                        ABIParam("tokenId", "uint256")
                    ),
                    outputs = emptyList(),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "setApprovalForAll",
                    inputs = listOf(
                        ABIParam("operator", "address"),
                        ABIParam("approved", "bool")
                    ),
                    outputs = emptyList(),
                    stateMutability = "nonpayable"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "getApproved",
                    inputs = listOf(ABIParam("tokenId", "uint256")),
                    outputs = listOf(ABIParam("", "address")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.FUNCTION,
                    name = "isApprovedForAll",
                    inputs = listOf(
                        ABIParam("owner", "address"),
                        ABIParam("operator", "address")
                    ),
                    outputs = listOf(ABIParam("", "bool")),
                    stateMutability = "view"
                ),
                ABIEntry(
                    type = ABIType.EVENT,
                    name = "Transfer",
                    inputs = listOf(
                        ABIParam("from", "address", indexed = true),
                        ABIParam("to", "address", indexed = true),
                        ABIParam("tokenId", "uint256", indexed = true)
                    )
                ),
                ABIEntry(
                    type = ABIType.EVENT,
                    name = "Approval",
                    inputs = listOf(
                        ABIParam("owner", "address", indexed = true),
                        ABIParam("approved", "address", indexed = true),
                        ABIParam("tokenId", "uint256", indexed = true)
                    )
                ),
                ABIEntry(
                    type = ABIType.EVENT,
                    name = "ApprovalForAll",
                    inputs = listOf(
                        ABIParam("owner", "address", indexed = true),
                        ABIParam("operator", "address", indexed = true),
                        ABIParam("approved", "bool", indexed = false)
                    )
                )
            )
        )
    }
}

/**
 * ABI entry types
 */
@Serializable
enum class ABIType {
    @SerialName("function")
    FUNCTION,

    @SerialName("event")
    EVENT,

    @SerialName("constructor")
    CONSTRUCTOR,

    @SerialName("fallback")
    FALLBACK,

    @SerialName("receive")
    RECEIVE,

    @SerialName("error")
    ERROR
}

/**
 * ABI entry (function, event, etc.)
 */
@Serializable
data class ABIEntry(
    @SerialName("type")
    val type: ABIType,

    @SerialName("name")
    val name: String? = null,

    @SerialName("inputs")
    val inputs: List<ABIParam> = emptyList(),

    @SerialName("outputs")
    val outputs: List<ABIParam> = emptyList(),

    @SerialName("stateMutability")
    val stateMutability: String? = null,

    @SerialName("anonymous")
    val anonymous: Boolean = false
) {
    /**
     * Check if this is a view/pure function
     */
    val isReadOnly: Boolean
        get() = stateMutability == "view" || stateMutability == "pure"

    /**
     * Check if this is payable
     */
    val isPayable: Boolean
        get() = stateMutability == "payable"

    /**
     * Get function signature (e.g., "transfer(address,uint256)")
     */
    fun getSignature(): String {
        val inputTypes = inputs.joinToString(",") { it.type }
        return "${name ?: ""}($inputTypes)"
    }
}

/**
 * ABI parameter
 */
@Serializable
data class ABIParam(
    @SerialName("name")
    val name: String,

    @SerialName("type")
    val type: String,

    @SerialName("indexed")
    val indexed: Boolean = false,

    @SerialName("components")
    val components: List<ABIParam>? = null,

    @SerialName("internalType")
    val internalType: String? = null
) {
    /**
     * Check if this is an array type
     */
    val isArray: Boolean
        get() = type.endsWith("[]")

    /**
     * Check if this is a dynamic type
     */
    val isDynamic: Boolean
        get() = type == "string" || type == "bytes" || isArray

    /**
     * Get base type (without array suffix)
     */
    val baseType: String
        get() = type.removeSuffix("[]")
}
