package com.chainlesschain.android.core.blockchain.rpc

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * JSON-RPC 2.0 Request
 */
@Serializable
data class RPCRequest(
    @SerialName("jsonrpc")
    val jsonrpc: String = "2.0",

    @SerialName("method")
    val method: String,

    @SerialName("params")
    val params: List<JsonElement> = emptyList(),

    @SerialName("id")
    val id: Long = System.currentTimeMillis()
) {
    companion object {
        /**
         * Common Ethereum RPC methods
         */
        object Methods {
            // Account methods
            const val ETH_GET_BALANCE = "eth_getBalance"
            const val ETH_GET_TRANSACTION_COUNT = "eth_getTransactionCount"
            const val ETH_GET_CODE = "eth_getCode"
            const val ETH_GET_STORAGE_AT = "eth_getStorageAt"

            // Transaction methods
            const val ETH_SEND_RAW_TRANSACTION = "eth_sendRawTransaction"
            const val ETH_GET_TRANSACTION_BY_HASH = "eth_getTransactionByHash"
            const val ETH_GET_TRANSACTION_RECEIPT = "eth_getTransactionReceipt"
            const val ETH_CALL = "eth_call"
            const val ETH_ESTIMATE_GAS = "eth_estimateGas"

            // Block methods
            const val ETH_BLOCK_NUMBER = "eth_blockNumber"
            const val ETH_GET_BLOCK_BY_NUMBER = "eth_getBlockByNumber"
            const val ETH_GET_BLOCK_BY_HASH = "eth_getBlockByHash"

            // Gas methods
            const val ETH_GAS_PRICE = "eth_gasPrice"
            const val ETH_MAX_PRIORITY_FEE_PER_GAS = "eth_maxPriorityFeePerGas"
            const val ETH_FEE_HISTORY = "eth_feeHistory"

            // Chain methods
            const val ETH_CHAIN_ID = "eth_chainId"
            const val NET_VERSION = "net_version"

            // Log methods
            const val ETH_GET_LOGS = "eth_getLogs"

            // Subscription (WebSocket)
            const val ETH_SUBSCRIBE = "eth_subscribe"
            const val ETH_UNSUBSCRIBE = "eth_unsubscribe"
        }

        /**
         * Block tags
         */
        object BlockTags {
            const val LATEST = "latest"
            const val PENDING = "pending"
            const val EARLIEST = "earliest"
            const val SAFE = "safe"
            const val FINALIZED = "finalized"
        }
    }
}

/**
 * JSON-RPC 2.0 Response
 */
@Serializable
data class RPCResponse<T>(
    @SerialName("jsonrpc")
    val jsonrpc: String = "2.0",

    @SerialName("id")
    val id: Long,

    @SerialName("result")
    val result: T? = null,

    @SerialName("error")
    val error: RPCError? = null
) {
    val isSuccess: Boolean
        get() = error == null && result != null
}

/**
 * JSON-RPC 2.0 Error
 */
@Serializable
data class RPCError(
    @SerialName("code")
    val code: Int,

    @SerialName("message")
    val message: String,

    @SerialName("data")
    val data: JsonElement? = null
) {
    companion object {
        // Standard JSON-RPC errors
        const val PARSE_ERROR = -32700
        const val INVALID_REQUEST = -32600
        const val METHOD_NOT_FOUND = -32601
        const val INVALID_PARAMS = -32602
        const val INTERNAL_ERROR = -32603

        // Ethereum specific errors
        const val EXECUTION_ERROR = 3
        const val INSUFFICIENT_FUNDS = -32000
        const val NONCE_TOO_LOW = -32000
        const val GAS_TOO_LOW = -32000
    }
}

/**
 * Batch RPC request
 */
@Serializable
data class BatchRPCRequest(
    val requests: List<RPCRequest>
)

/**
 * Batch RPC response
 */
@Serializable
data class BatchRPCResponse<T>(
    val responses: List<RPCResponse<T>>
)
