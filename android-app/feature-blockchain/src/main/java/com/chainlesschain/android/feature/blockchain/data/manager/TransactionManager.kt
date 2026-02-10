package com.chainlesschain.android.feature.blockchain.data.manager

import com.chainlesschain.android.core.blockchain.contract.ABIEncoder
import com.chainlesschain.android.core.blockchain.contract.ContractABI
import com.chainlesschain.android.core.blockchain.crypto.KeystoreManager
import com.chainlesschain.android.core.blockchain.crypto.WalletCoreAdapter
import com.chainlesschain.android.core.blockchain.model.GasEstimate
import com.chainlesschain.android.core.blockchain.model.NetworkConfig
import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.blockchain.rpc.BlockchainRPCClient
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.blockchain.data.repository.TransactionRepository
import com.chainlesschain.android.feature.blockchain.domain.model.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.JsonPrimitive
import timber.log.Timber
import java.math.BigInteger
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Transaction management
 * Handles transaction creation, signing, submission, and monitoring
 */
@Singleton
class TransactionManager @Inject constructor(
    private val rpcClient: BlockchainRPCClient,
    private val keystoreManager: KeystoreManager,
    private val walletCoreAdapter: WalletCoreAdapter,
    private val transactionRepository: TransactionRepository
) {
    private val _pendingTransactions = MutableStateFlow<List<PendingTransaction>>(emptyList())
    val pendingTransactions = _pendingTransactions.asStateFlow()

    /**
     * Estimate gas for a transaction
     */
    suspend fun estimateGas(
        from: String,
        to: String,
        value: String = "0x0",
        data: String? = null,
        chain: SupportedChain
    ): Result<GasEstimate> {
        val config = NetworkConfig.default(chain)

        // Estimate gas limit
        val gasLimitResult = rpcClient.estimateGas(config, from, to, value, data)
        if (gasLimitResult is Result.Error) {
            return Result.error(gasLimitResult.exception, "Failed to estimate gas")
        }

        val gasLimit = (gasLimitResult as Result.Success).data

        // Get gas price
        val gasPriceResult = rpcClient.getGasPrice(config)
        if (gasPriceResult is Result.Error) {
            return Result.error(gasPriceResult.exception, "Failed to get gas price")
        }

        val gasPrice = (gasPriceResult as Result.Success).data

        // Try to get EIP-1559 gas prices
        var maxFeePerGas: Long? = null
        var maxPriorityFeePerGas: Long? = null

        val priorityFeeResult = rpcClient.getMaxPriorityFeePerGas(config)
        if (priorityFeeResult is Result.Success) {
            maxPriorityFeePerGas = priorityFeeResult.data
            maxFeePerGas = gasPrice + maxPriorityFeePerGas
        }

        val estimatedCostWei = gasLimit * gasPrice
        val estimatedCostEth = estimatedCostWei.toDouble() / 1e18

        return Result.success(
            GasEstimate(
                gasLimit = gasLimit,
                gasPrice = gasPrice,
                maxFeePerGas = maxFeePerGas,
                maxPriorityFeePerGas = maxPriorityFeePerGas,
                estimatedCostWei = estimatedCostWei,
                estimatedCostEth = estimatedCostEth
            )
        )
    }

    /**
     * Send native token transfer
     */
    suspend fun sendNativeTransfer(
        walletId: String,
        from: String,
        to: String,
        amount: String, // In wei
        chain: SupportedChain,
        gasEstimate: GasEstimate? = null
    ): Result<Transaction> {
        Timber.d("Sending native transfer: $amount to $to")

        // Get or estimate gas
        val gas = gasEstimate ?: run {
            val result = estimateGas(from, to, "0x${BigInteger(amount).toString(16)}", null, chain)
            if (result is Result.Error) {
                return Result.error(result.exception, result.message)
            }
            (result as Result.Success).data
        }

        // Get nonce
        val config = NetworkConfig.default(chain)
        val nonceResult = rpcClient.getTransactionCount(config, from)
        if (nonceResult is Result.Error) {
            return Result.error(nonceResult.exception, "Failed to get nonce")
        }
        val nonce = (nonceResult as Result.Success).data

        // Create transaction request
        val request = TransactionRequest(
            from = from,
            to = to,
            value = "0x${BigInteger(amount).toString(16)}",
            gasLimit = gas.gasLimit,
            gasPrice = if (gas.isEip1559) null else gas.gasPrice,
            maxFeePerGas = gas.maxFeePerGas,
            maxPriorityFeePerGas = gas.maxPriorityFeePerGas,
            nonce = nonce,
            chain = chain
        )

        // Sign and send
        return signAndSendTransaction(walletId, request)
    }

    /**
     * Send ERC20 token transfer
     */
    suspend fun sendTokenTransfer(
        walletId: String,
        from: String,
        tokenAddress: String,
        to: String,
        amount: String, // Raw amount (with decimals)
        chain: SupportedChain,
        gasEstimate: GasEstimate? = null
    ): Result<Transaction> {
        Timber.d("Sending token transfer: $amount to $to")

        // Encode transfer function call
        val transferData = ABIEncoder.encodeFunction(
            "transfer",
            listOf("address", "uint256"),
            listOf(to, BigInteger(amount))
        )

        // Get or estimate gas
        val gas = gasEstimate ?: run {
            val result = estimateGas(from, tokenAddress, "0x0", transferData, chain)
            if (result is Result.Error) {
                return Result.error(result.exception, result.message)
            }
            (result as Result.Success).data
        }

        // Get nonce
        val config = NetworkConfig.default(chain)
        val nonceResult = rpcClient.getTransactionCount(config, from)
        if (nonceResult is Result.Error) {
            return Result.error(nonceResult.exception, "Failed to get nonce")
        }
        val nonce = (nonceResult as Result.Success).data

        // Create transaction request
        val request = TransactionRequest(
            from = from,
            to = tokenAddress,
            value = "0x0",
            data = transferData,
            gasLimit = gas.gasLimit,
            gasPrice = if (gas.isEip1559) null else gas.gasPrice,
            maxFeePerGas = gas.maxFeePerGas,
            maxPriorityFeePerGas = gas.maxPriorityFeePerGas,
            nonce = nonce,
            chain = chain
        )

        // Sign and send
        return signAndSendTransaction(walletId, request)
    }

    /**
     * Approve token spending
     */
    suspend fun approveToken(
        walletId: String,
        from: String,
        tokenAddress: String,
        spender: String,
        amount: String, // Max uint256 for unlimited
        chain: SupportedChain
    ): Result<Transaction> {
        Timber.d("Approving token: $tokenAddress for $spender")

        // Encode approve function call
        val approveData = ABIEncoder.encodeFunction(
            "approve",
            listOf("address", "uint256"),
            listOf(spender, BigInteger(amount))
        )

        // Estimate gas
        val gasResult = estimateGas(from, tokenAddress, "0x0", approveData, chain)
        if (gasResult is Result.Error) {
            return Result.error(gasResult.exception, gasResult.message)
        }
        val gas = (gasResult as Result.Success).data

        // Get nonce
        val config = NetworkConfig.default(chain)
        val nonceResult = rpcClient.getTransactionCount(config, from)
        if (nonceResult is Result.Error) {
            return Result.error(nonceResult.exception, "Failed to get nonce")
        }
        val nonce = (nonceResult as Result.Success).data

        // Create and send transaction
        val request = TransactionRequest(
            from = from,
            to = tokenAddress,
            value = "0x0",
            data = approveData,
            gasLimit = gas.gasLimit,
            gasPrice = if (gas.isEip1559) null else gas.gasPrice,
            maxFeePerGas = gas.maxFeePerGas,
            maxPriorityFeePerGas = gas.maxPriorityFeePerGas,
            nonce = nonce,
            chain = chain
        )

        return signAndSendTransaction(walletId, request)
    }

    /**
     * Sign and send transaction
     */
    private suspend fun signAndSendTransaction(
        walletId: String,
        request: TransactionRequest
    ): Result<Transaction> {
        // Get private key
        val pkResult = keystoreManager.retrievePrivateKey(walletId)
        if (pkResult is Result.Error) {
            return Result.error(pkResult.exception, "Failed to retrieve private key")
        }
        val privateKey = (pkResult as Result.Success).data

        try {
            // TODO: Implement proper transaction signing with RLP encoding
            // For now, we'll create a placeholder transaction

            // Build raw transaction
            val rawTx = buildRawTransaction(request)

            // Sign transaction
            val signedTx = signTransaction(rawTx, privateKey, request.chain)

            // Send transaction
            val config = NetworkConfig.default(request.chain)
            val sendResult = rpcClient.sendRawTransaction(config, signedTx)
            if (sendResult is Result.Error) {
                return Result.error(sendResult.exception, "Failed to send transaction")
            }

            val txHash = (sendResult as Result.Success).data

            // Create transaction object
            val transaction = Transaction(
                id = UUID.randomUUID().toString(),
                hash = txHash,
                chain = request.chain,
                from = request.from,
                to = request.to,
                value = request.value,
                valueFormatted = formatValue(request.value, request.chain.decimals),
                gasLimit = request.gasLimit ?: 21000L,
                gasPrice = request.gasPrice,
                maxFeePerGas = request.maxFeePerGas,
                maxPriorityFeePerGas = request.maxPriorityFeePerGas,
                nonce = request.nonce ?: 0L,
                data = request.data,
                status = TransactionStatus.PENDING,
                type = determineTransactionType(request)
            )

            // Save to database
            transactionRepository.saveTransaction(transaction)

            // Add to pending list
            addPendingTransaction(transaction)

            Timber.d("Transaction sent: $txHash")
            return Result.success(transaction)

        } finally {
            // Clear private key from memory
            privateKey.fill(0)
        }
    }

    /**
     * Monitor transaction status
     */
    suspend fun monitorTransaction(
        txHash: String,
        chain: SupportedChain,
        maxAttempts: Int = 60,
        intervalMs: Long = 5000
    ): Flow<TransactionStatus> = flow {
        val config = NetworkConfig.default(chain)
        var attempts = 0

        while (attempts < maxAttempts) {
            val receiptResult = rpcClient.getTransactionReceipt(config, txHash)

            if (receiptResult is Result.Success && receiptResult.data != null) {
                val receipt = receiptResult.data
                val status = receipt["status"]?.toString()

                val txStatus = if (status == "0x1") {
                    TransactionStatus.CONFIRMED
                } else {
                    TransactionStatus.FAILED
                }

                emit(txStatus)

                // Update in database
                updateTransactionStatus(txHash, txStatus, receipt)

                // Remove from pending
                removePendingTransaction(txHash)

                return@flow
            }

            emit(TransactionStatus.PENDING)
            delay(intervalMs)
            attempts++
        }

        // Transaction may have been dropped
        emit(TransactionStatus.DROPPED)
    }

    /**
     * Speed up transaction
     */
    suspend fun speedUpTransaction(
        walletId: String,
        originalTxHash: String,
        gasMultiplier: Double = 1.1
    ): Result<Transaction> {
        // Get original transaction
        val originalTx = transactionRepository.getTransactionByHash(originalTxHash)
            ?: return Result.error(
                IllegalArgumentException("Transaction not found"),
                "Original transaction not found"
            )

        if (originalTx.status != TransactionStatus.PENDING) {
            return Result.error(
                IllegalStateException("Transaction not pending"),
                "Can only speed up pending transactions"
            )
        }

        // Create new request with higher gas
        val newGasPrice = ((originalTx.gasPrice ?: originalTx.maxFeePerGas ?: 0L) * gasMultiplier).toLong()

        val request = TransactionRequest(
            from = originalTx.from,
            to = originalTx.to ?: "",
            value = originalTx.value,
            data = originalTx.data,
            gasLimit = originalTx.gasLimit,
            gasPrice = if (originalTx.maxFeePerGas == null) newGasPrice else null,
            maxFeePerGas = if (originalTx.maxFeePerGas != null) newGasPrice else null,
            maxPriorityFeePerGas = originalTx.maxPriorityFeePerGas?.let { (it * gasMultiplier).toLong() },
            nonce = originalTx.nonce, // Same nonce to replace
            chain = originalTx.chain
        )

        return signAndSendTransaction(walletId, request)
    }

    /**
     * Cancel transaction
     */
    suspend fun cancelTransaction(
        walletId: String,
        originalTxHash: String,
        gasMultiplier: Double = 1.1
    ): Result<Transaction> {
        val originalTx = transactionRepository.getTransactionByHash(originalTxHash)
            ?: return Result.error(
                IllegalArgumentException("Transaction not found"),
                "Original transaction not found"
            )

        if (originalTx.status != TransactionStatus.PENDING) {
            return Result.error(
                IllegalStateException("Transaction not pending"),
                "Can only cancel pending transactions"
            )
        }

        // Send 0 value to self with same nonce
        val newGasPrice = ((originalTx.gasPrice ?: originalTx.maxFeePerGas ?: 0L) * gasMultiplier).toLong()

        val request = TransactionRequest(
            from = originalTx.from,
            to = originalTx.from, // Send to self
            value = "0x0",
            gasLimit = 21000, // Minimum for transfer
            gasPrice = if (originalTx.maxFeePerGas == null) newGasPrice else null,
            maxFeePerGas = if (originalTx.maxFeePerGas != null) newGasPrice else null,
            maxPriorityFeePerGas = originalTx.maxPriorityFeePerGas?.let { (it * gasMultiplier).toLong() },
            nonce = originalTx.nonce, // Same nonce to replace
            chain = originalTx.chain
        )

        return signAndSendTransaction(walletId, request)
    }

    /**
     * Get transaction history
     */
    fun getTransactionHistory(
        address: String,
        chain: SupportedChain
    ): Flow<List<Transaction>> {
        return transactionRepository.getTransactionsForAddress(address, chain)
    }

    // ==================== Private Helpers ====================

    private fun buildRawTransaction(request: TransactionRequest): ByteArray {
        // TODO: Implement RLP encoding
        return ByteArray(0)
    }

    private fun signTransaction(
        rawTx: ByteArray,
        privateKey: ByteArray,
        chain: SupportedChain
    ): String {
        // TODO: Implement proper signing
        return "0x"
    }

    private fun formatValue(hexValue: String, decimals: Int): String {
        val value = BigInteger(hexValue.removePrefix("0x"), 16)
        val divisor = BigInteger.TEN.pow(decimals)
        val formatted = value.toBigDecimal().divide(divisor.toBigDecimal(), decimals, java.math.RoundingMode.HALF_UP)
        return formatted.stripTrailingZeros().toPlainString()
    }

    private fun determineTransactionType(request: TransactionRequest): TransactionType {
        if (request.data.isNullOrEmpty() || request.data == "0x") {
            return TransactionType.NATIVE_TRANSFER
        }

        val methodId = request.data.take(10)
        return when (methodId) {
            "0xa9059cbb" -> TransactionType.TOKEN_TRANSFER // transfer(address,uint256)
            "0x095ea7b3" -> TransactionType.TOKEN_APPROVAL // approve(address,uint256)
            "0x23b872dd" -> TransactionType.TOKEN_TRANSFER // transferFrom
            "0x42842e0e" -> TransactionType.NFT_TRANSFER // safeTransferFrom(address,address,uint256)
            else -> TransactionType.CONTRACT_CALL
        }
    }

    private fun addPendingTransaction(transaction: Transaction) {
        _pendingTransactions.value = _pendingTransactions.value + PendingTransaction(
            hash = transaction.hash,
            from = transaction.from,
            to = transaction.to,
            value = transaction.value,
            nonce = transaction.nonce,
            gasPrice = transaction.gasPrice,
            maxFeePerGas = transaction.maxFeePerGas,
            createdAt = transaction.createdAt,
            chain = transaction.chain
        )
    }

    private fun removePendingTransaction(txHash: String) {
        _pendingTransactions.value = _pendingTransactions.value.filter { it.hash != txHash }
    }

    private suspend fun updateTransactionStatus(
        txHash: String,
        status: TransactionStatus,
        receipt: kotlinx.serialization.json.JsonObject
    ) {
        val blockNumber = receipt["blockNumber"]?.toString()?.let {
            it.removePrefix("\"").removeSuffix("\"").removePrefix("0x").toLongOrNull(16)
        }
        val gasUsed = receipt["gasUsed"]?.toString()?.let {
            it.removePrefix("\"").removeSuffix("\"").removePrefix("0x").toLongOrNull(16)
        }

        transactionRepository.updateTransactionStatus(
            txHash = txHash,
            status = status,
            blockNumber = blockNumber,
            gasUsed = gasUsed
        )
    }
}
