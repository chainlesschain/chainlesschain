package com.chainlesschain.android.core.blockchain.rpc

import com.chainlesschain.android.core.blockchain.model.GasEstimate
import com.chainlesschain.android.core.blockchain.model.GasPriceTiers
import com.chainlesschain.android.core.blockchain.model.NetworkConfig
import com.chainlesschain.android.core.common.Result
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import timber.log.Timber
import java.math.BigInteger
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Blockchain JSON-RPC 2.0 client
 */
@Singleton
class BlockchainRPCClient @Inject constructor() {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val cache = RPCCache()

    private var httpClient: OkHttpClient = createHttpClient(30_000L)

    private fun createHttpClient(timeout: Long): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(timeout, TimeUnit.MILLISECONDS)
            .readTimeout(timeout, TimeUnit.MILLISECONDS)
            .writeTimeout(timeout, TimeUnit.MILLISECONDS)
            .build()
    }

    /**
     * Execute RPC call
     */
    suspend fun <T> call(
        config: NetworkConfig,
        method: String,
        params: List<JsonElement> = emptyList(),
        parseResult: (JsonElement) -> T
    ): Result<T> = withContext(Dispatchers.IO) {
        try {
            // Check cache
            if (config.enableCache && method !in RPCCache.NON_CACHEABLE_METHODS) {
                val cacheKey = RPCCache.generateKey(config.chain.chainId, method, params)
                val cached = cache.get<T>(cacheKey)
                if (cached != null) {
                    Timber.d("RPC cache hit: $method")
                    return@withContext Result.success(cached)
                }
            }

            val request = RPCRequest(
                method = method,
                params = params
            )

            val response = executeRequest(config, request)

            if (response.error != null) {
                return@withContext Result.error(
                    RPCException(response.error),
                    "RPC Error: ${response.error.message}"
                )
            }

            val result = response.result?.let { parseResult(it) }
                ?: return@withContext Result.error(
                    IllegalStateException("Empty result"),
                    "Empty RPC result"
                )

            // Cache result
            if (config.enableCache && method !in RPCCache.NON_CACHEABLE_METHODS) {
                val cacheKey = RPCCache.generateKey(config.chain.chainId, method, params)
                val ttl = getCacheTtl(method, config.cacheTtlMs)
                cache.put(cacheKey, result as Any, ttl)
            }

            Result.success(result)
        } catch (e: Exception) {
            Timber.e(e, "RPC call failed: $method")
            Result.error(e, e.message)
        }
    }

    /**
     * Execute raw RPC request
     */
    private suspend fun executeRequest(
        config: NetworkConfig,
        rpcRequest: RPCRequest
    ): RPCResponse<JsonElement> {
        val requestBody = json.encodeToString(rpcRequest)
            .toRequestBody("application/json".toMediaType())

        val httpRequest = Request.Builder()
            .url(config.getFullRpcUrl())
            .post(requestBody)
            .header("Content-Type", "application/json")
            .build()

        val response = httpClient.newCall(httpRequest).execute()

        if (!response.isSuccessful) {
            throw RPCException(
                RPCError(
                    code = response.code,
                    message = "HTTP ${response.code}: ${response.message}"
                )
            )
        }

        val responseBody = response.body?.string()
            ?: throw IllegalStateException("Empty response body")

        return json.decodeFromString(responseBody)
    }

    /**
     * Execute batch RPC calls
     */
    suspend fun batchCall(
        config: NetworkConfig,
        requests: List<Pair<String, List<JsonElement>>>
    ): Result<List<JsonElement?>> = withContext(Dispatchers.IO) {
        try {
            val rpcRequests = requests.mapIndexed { index, (method, params) ->
                RPCRequest(
                    method = method,
                    params = params,
                    id = index.toLong()
                )
            }

            val requestBody = json.encodeToString(rpcRequests)
                .toRequestBody("application/json".toMediaType())

            val httpRequest = Request.Builder()
                .url(config.getFullRpcUrl())
                .post(requestBody)
                .header("Content-Type", "application/json")
                .build()

            val response = httpClient.newCall(httpRequest).execute()

            if (!response.isSuccessful) {
                return@withContext Result.error(
                    RPCException(RPCError(response.code, "HTTP ${response.code}")),
                    "Batch request failed"
                )
            }

            val responseBody = response.body?.string()
                ?: return@withContext Result.error(
                    IllegalStateException("Empty response"),
                    "Empty batch response"
                )

            val responses: List<RPCResponse<JsonElement>> = json.decodeFromString(responseBody)
            val results = responses.sortedBy { it.id }.map { it.result }

            Result.success(results)
        } catch (e: Exception) {
            Timber.e(e, "Batch RPC call failed")
            Result.error(e, e.message)
        }
    }

    // ==================== Convenience Methods ====================

    /**
     * Get account balance
     */
    suspend fun getBalance(
        config: NetworkConfig,
        address: String,
        blockTag: String = RPCRequest.Companion.BlockTags.LATEST
    ): Result<BigInteger> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GET_BALANCE,
            params = listOf(JsonPrimitive(address), JsonPrimitive(blockTag))
        ) { result ->
            parseHexToBigInteger(result.jsonPrimitive.content)
        }
    }

    /**
     * Get transaction count (nonce)
     */
    suspend fun getTransactionCount(
        config: NetworkConfig,
        address: String,
        blockTag: String = RPCRequest.Companion.BlockTags.PENDING
    ): Result<Long> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GET_TRANSACTION_COUNT,
            params = listOf(JsonPrimitive(address), JsonPrimitive(blockTag))
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content)
        }
    }

    /**
     * Get current gas price
     */
    suspend fun getGasPrice(config: NetworkConfig): Result<Long> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GAS_PRICE,
            params = emptyList()
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content)
        }
    }

    /**
     * Get max priority fee per gas (EIP-1559)
     */
    suspend fun getMaxPriorityFeePerGas(config: NetworkConfig): Result<Long> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_MAX_PRIORITY_FEE_PER_GAS,
            params = emptyList()
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content)
        }
    }

    /**
     * Estimate gas for transaction
     */
    suspend fun estimateGas(
        config: NetworkConfig,
        from: String?,
        to: String,
        value: String? = null,
        data: String? = null
    ): Result<Long> {
        val txObject = buildJsonObject {
            from?.let { put("from", it) }
            put("to", to)
            value?.let { put("value", it) }
            data?.let { put("data", it) }
        }

        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_ESTIMATE_GAS,
            params = listOf(txObject)
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content)
        }
    }

    /**
     * Get gas estimate with price tiers
     */
    suspend fun getGasEstimate(
        config: NetworkConfig,
        gasLimit: Long
    ): Result<GasEstimate> = withContext(Dispatchers.IO) {
        val gasPriceResult = getGasPrice(config)
        if (gasPriceResult is Result.Error) {
            return@withContext Result.error(
                gasPriceResult.exception,
                gasPriceResult.message
            )
        }

        val gasPrice = (gasPriceResult as Result.Success).data
        val costWei = gasLimit * gasPrice
        val costEth = costWei.toDouble() / 1e18

        Result.success(
            GasEstimate(
                gasLimit = gasLimit,
                gasPrice = gasPrice,
                estimatedCostWei = costWei,
                estimatedCostEth = costEth
            )
        )
    }

    /**
     * Send raw transaction
     */
    suspend fun sendRawTransaction(
        config: NetworkConfig,
        signedTx: String
    ): Result<String> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_SEND_RAW_TRANSACTION,
            params = listOf(JsonPrimitive(signedTx))
        ) { result ->
            result.jsonPrimitive.content
        }
    }

    /**
     * Get transaction by hash
     */
    suspend fun getTransactionByHash(
        config: NetworkConfig,
        txHash: String
    ): Result<JsonObject?> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GET_TRANSACTION_BY_HASH,
            params = listOf(JsonPrimitive(txHash))
        ) { result ->
            if (result is JsonNull) null else result.jsonObject
        }
    }

    /**
     * Get transaction receipt
     */
    suspend fun getTransactionReceipt(
        config: NetworkConfig,
        txHash: String
    ): Result<JsonObject?> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GET_TRANSACTION_RECEIPT,
            params = listOf(JsonPrimitive(txHash))
        ) { result ->
            if (result is JsonNull) null else result.jsonObject
        }
    }

    /**
     * Call contract method (read-only)
     */
    suspend fun call(
        config: NetworkConfig,
        to: String,
        data: String,
        blockTag: String = RPCRequest.Companion.BlockTags.LATEST
    ): Result<String> {
        val txObject = buildJsonObject {
            put("to", to)
            put("data", data)
        }

        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_CALL,
            params = listOf(txObject, JsonPrimitive(blockTag))
        ) { result ->
            result.jsonPrimitive.content
        }
    }

    /**
     * Get current block number
     */
    suspend fun getBlockNumber(config: NetworkConfig): Result<Long> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_BLOCK_NUMBER,
            params = emptyList()
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content)
        }
    }

    /**
     * Get chain ID
     */
    suspend fun getChainId(config: NetworkConfig): Result<Int> {
        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_CHAIN_ID,
            params = emptyList()
        ) { result ->
            parseHexToLong(result.jsonPrimitive.content).toInt()
        }
    }

    /**
     * Get logs
     */
    suspend fun getLogs(
        config: NetworkConfig,
        fromBlock: String,
        toBlock: String,
        address: String? = null,
        topics: List<String>? = null
    ): Result<List<JsonObject>> {
        val filter = buildJsonObject {
            put("fromBlock", fromBlock)
            put("toBlock", toBlock)
            address?.let { put("address", it) }
            topics?.let { put("topics", JsonArray(it.map { t -> JsonPrimitive(t) })) }
        }

        return call(
            config = config,
            method = RPCRequest.Companion.Methods.ETH_GET_LOGS,
            params = listOf(filter)
        ) { result ->
            result.jsonArray.map { it.jsonObject }
        }
    }

    // ==================== Helpers ====================

    private fun parseHexToLong(hex: String): Long {
        val cleanHex = hex.removePrefix("0x")
        return if (cleanHex.isEmpty()) 0L else cleanHex.toLong(16)
    }

    private fun parseHexToBigInteger(hex: String): BigInteger {
        val cleanHex = hex.removePrefix("0x")
        return if (cleanHex.isEmpty()) BigInteger.ZERO else BigInteger(cleanHex, 16)
    }

    private fun getCacheTtl(method: String, defaultTtl: Long): Long {
        return when (method) {
            RPCRequest.Companion.Methods.ETH_BLOCK_NUMBER -> RPCCache.Companion.TTL.BLOCK_NUMBER
            RPCRequest.Companion.Methods.ETH_GAS_PRICE -> RPCCache.Companion.TTL.GAS_PRICE
            RPCRequest.Companion.Methods.ETH_MAX_PRIORITY_FEE_PER_GAS -> RPCCache.Companion.TTL.GAS_PRICE
            RPCRequest.Companion.Methods.ETH_GET_BALANCE -> RPCCache.Companion.TTL.BALANCE
            RPCRequest.Companion.Methods.ETH_CHAIN_ID -> RPCCache.Companion.TTL.CHAIN_ID
            RPCRequest.Companion.Methods.ETH_GET_CODE -> RPCCache.Companion.TTL.CODE
            RPCRequest.Companion.Methods.ETH_GET_LOGS -> RPCCache.Companion.TTL.LOGS
            else -> defaultTtl
        }
    }

    /**
     * Clear cache for a specific chain
     */
    fun clearCache(chainId: Int) {
        cache.invalidatePrefix("$chainId:")
    }

    /**
     * Clear all cache
     */
    fun clearAllCache() {
        cache.clear()
    }
}

/**
 * RPC Exception
 */
class RPCException(
    val error: RPCError
) : Exception("RPC Error ${error.code}: ${error.message}")
