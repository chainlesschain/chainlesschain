package com.chainlesschain.android.core.p2p.filetransfer

import timber.log.Timber
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.NetworkType
import com.chainlesschain.android.core.p2p.network.NetworkMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 网络状态变化事件
 */
sealed class NetworkStateEvent {
    /** 网络可用 */
    data class Available(val networkType: NetworkType, val isMetered: Boolean) : NetworkStateEvent()
    /** 网络不可用 */
    object Unavailable : NetworkStateEvent()
    /** 网络变为计费网络 */
    data class BecameMetered(val networkType: NetworkType) : NetworkStateEvent()
    /** 网络变为非计费网络 */
    data class BecameUnmetered(val networkType: NetworkType) : NetworkStateEvent()
}

/**
 * 传输控制策略
 */
enum class TransferPolicy {
    /** 允许所有传输 */
    ALLOW_ALL,
    /** 仅WiFi传输 */
    WIFI_ONLY,
    /** 暂停所有传输 */
    PAUSE_ALL,
    /** 根据用户设置 */
    USER_PREFERENCE
}

/**
 * 网络感知传输控制器
 *
 * 监听网络状态变化并自动控制传输：
 * - 网络断开时自动暂停所有传输
 * - 网络恢复时自动恢复传输
 * - 切换到计费网络时可选暂停
 * - 自适应调整分块大小
 */
@Singleton
class NetworkAwareTransferController @Inject constructor(
    private val networkMonitor: NetworkMonitor,
    private val fileTransferManager: FileTransferManager,
    private val progressTracker: TransferProgressTracker
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 当前网络状态
    private val _currentNetworkState = MutableStateFlow<NetworkStateEvent>(NetworkStateEvent.Unavailable)
    val currentNetworkState: StateFlow<NetworkStateEvent> = _currentNetworkState.asStateFlow()

    // 传输策略
    private val _transferPolicy = MutableStateFlow(TransferPolicy.ALLOW_ALL)
    val transferPolicy: StateFlow<TransferPolicy> = _transferPolicy.asStateFlow()

    // 计费网络暂停设置
    private var pauseOnMetered = false

    // 自动恢复设置
    private var autoResumeOnUnmetered = true

    // 被网络变化暂停的传输ID列表
    private val networkPausedTransfers = mutableSetOf<String>()

    // 网络事件
    private val _networkEvents = MutableSharedFlow<NetworkStateEvent>(replay = 1)
    val networkEvents: SharedFlow<NetworkStateEvent> = _networkEvents.asSharedFlow()

    init {
        observeNetworkChanges()
    }

    /**
     * 设置传输策略
     */
    fun setTransferPolicy(policy: TransferPolicy) {
        _transferPolicy.value = policy
        Timber.i("Transfer policy set to: $policy")

        when (policy) {
            TransferPolicy.PAUSE_ALL -> pauseAllTransfers("Policy changed to PAUSE_ALL")
            TransferPolicy.WIFI_ONLY -> {
                val currentState = _currentNetworkState.value
                if (currentState is NetworkStateEvent.Available && currentState.networkType != NetworkType.WIFI) {
                    pauseAllTransfers("WiFi only policy, current network: ${currentState.networkType}")
                }
            }
            TransferPolicy.ALLOW_ALL -> resumeNetworkPausedTransfers()
            TransferPolicy.USER_PREFERENCE -> {} // 根据用户设置处理
        }
    }

    /**
     * 设置计费网络暂停
     */
    fun setPauseOnMetered(enabled: Boolean) {
        pauseOnMetered = enabled
        Timber.i("Pause on metered: $enabled")

        if (enabled) {
            val currentState = _currentNetworkState.value
            if (currentState is NetworkStateEvent.Available && currentState.isMetered) {
                pauseAllTransfers("Metered network detected")
            }
        }
    }

    /**
     * 设置自动恢复
     */
    fun setAutoResumeOnUnmetered(enabled: Boolean) {
        autoResumeOnUnmetered = enabled
        Timber.i("Auto resume on unmetered: $enabled")
    }

    /**
     * 获取当前网络类型
     */
    fun getCurrentNetworkType(): NetworkType {
        return when (val state = _currentNetworkState.value) {
            is NetworkStateEvent.Available -> state.networkType
            is NetworkStateEvent.BecameMetered -> state.networkType
            is NetworkStateEvent.BecameUnmetered -> state.networkType
            NetworkStateEvent.Unavailable -> NetworkType.NONE
        }
    }

    /**
     * 检查当前是否为计费网络
     */
    fun isCurrentlyMetered(): Boolean {
        return when (val state = _currentNetworkState.value) {
            is NetworkStateEvent.Available -> state.isMetered
            is NetworkStateEvent.BecameMetered -> true
            is NetworkStateEvent.BecameUnmetered -> false
            NetworkStateEvent.Unavailable -> false
        }
    }

    /**
     * 检查是否应该允许传输
     */
    fun shouldAllowTransfer(): Boolean {
        val state = _currentNetworkState.value
        val policy = _transferPolicy.value

        return when {
            state is NetworkStateEvent.Unavailable -> false
            policy == TransferPolicy.PAUSE_ALL -> false
            policy == TransferPolicy.WIFI_ONLY -> {
                state is NetworkStateEvent.Available && state.networkType == NetworkType.WIFI
            }
            pauseOnMetered && state is NetworkStateEvent.Available && state.isMetered -> false
            else -> true
        }
    }

    /**
     * 获取建议的分块大小
     */
    fun getSuggestedChunkSize(fileSize: Long): Int {
        val networkType = getCurrentNetworkType()
        val isMetered = isCurrentlyMetered()
        return FileTransferMetadata.calculateOptimalChunkSize(fileSize, networkType, isMetered)
    }

    private fun observeNetworkChanges() {
        // 监听网络状态变化
        scope.launch {
            networkMonitor.networkState.collect { state ->
                handleNetworkStateChange(state)
            }
        }

        // 监听网络事件
        scope.launch {
            networkMonitor.networkEvents.collect { event ->
                handleNetworkEvent(event)
            }
        }
    }

    private suspend fun handleNetworkStateChange(state: com.chainlesschain.android.core.p2p.network.NetworkState) {
        when (state) {
            is com.chainlesschain.android.core.p2p.network.NetworkState.Connected -> {
                val networkType = mapNetworkTypeFromInfo(state.networkInfo.type)
                val isMetered = state.networkInfo.isMetered
                val previousState = _currentNetworkState.value

                val newState = NetworkStateEvent.Available(networkType, isMetered)
                _currentNetworkState.value = newState
                _networkEvents.emit(newState)

                Timber.i("Network connected: $networkType, metered: $isMetered")

                if (previousState is NetworkStateEvent.Unavailable) {
                    handleNetworkRestored(networkType, isMetered)
                }
            }
            is com.chainlesschain.android.core.p2p.network.NetworkState.Disconnected,
            is com.chainlesschain.android.core.p2p.network.NetworkState.Unavailable -> {
                handleNetworkLost()
            }
            is com.chainlesschain.android.core.p2p.network.NetworkState.Unknown -> {
                // Initial state, wait for actual network state
            }
        }
    }

    private suspend fun handleNetworkEvent(event: com.chainlesschain.android.core.p2p.network.NetworkEvent) {
        when (event) {
            is com.chainlesschain.android.core.p2p.network.NetworkEvent.Available -> {
                val networkType = mapNetworkTypeFromInfo(event.networkInfo.type)
                val isMetered = event.networkInfo.isMetered

                Timber.i("Network available: $networkType, metered: $isMetered")
            }
            is com.chainlesschain.android.core.p2p.network.NetworkEvent.Lost,
            is com.chainlesschain.android.core.p2p.network.NetworkEvent.Unavailable -> {
                handleNetworkLost()
            }
            is com.chainlesschain.android.core.p2p.network.NetworkEvent.TypeChanged -> {
                val networkType = mapNetworkTypeFromInfo(event.newType)
                val isMetered = networkMonitor.isMeteredNetwork()

                val newState = NetworkStateEvent.Available(networkType, isMetered)
                val previousState = _currentNetworkState.value
                val wasMetered = (previousState as? NetworkStateEvent.Available)?.isMetered ?: false

                _currentNetworkState.value = newState
                _networkEvents.emit(newState)

                // Check if metered status changed
                if (isMetered && !wasMetered) {
                    handleMeteredChange(true)
                } else if (!isMetered && wasMetered) {
                    handleMeteredChange(false)
                }
            }
        }
    }

    private fun handleNetworkLost() {
        Timber.w("Network lost")

        _currentNetworkState.value = NetworkStateEvent.Unavailable

        scope.launch {
            _networkEvents.emit(NetworkStateEvent.Unavailable)
        }

        pauseAllTransfers("Network unavailable")
    }

    private fun handleMeteredChange(isMetered: Boolean) {
        val currentState = _currentNetworkState.value
        if (currentState !is NetworkStateEvent.Available) return

        val networkType = currentState.networkType

        scope.launch {
            if (isMetered) {
                _currentNetworkState.value = NetworkStateEvent.Available(networkType, true)
                _networkEvents.emit(NetworkStateEvent.BecameMetered(networkType))

                if (pauseOnMetered) {
                    pauseAllTransfers("Network became metered")
                }
            } else {
                _currentNetworkState.value = NetworkStateEvent.Available(networkType, false)
                _networkEvents.emit(NetworkStateEvent.BecameUnmetered(networkType))

                if (autoResumeOnUnmetered) {
                    resumeNetworkPausedTransfers()
                }
            }
        }

        Timber.i("Metered status changed: $isMetered")
    }

    private fun handleNetworkRestored(networkType: NetworkType, isMetered: Boolean) {
        Timber.i("Network restored: $networkType, metered: $isMetered")

        // 检查策略是否允许恢复
        val shouldResume = when (_transferPolicy.value) {
            TransferPolicy.ALLOW_ALL -> !isMetered || !pauseOnMetered
            TransferPolicy.WIFI_ONLY -> networkType == NetworkType.WIFI
            TransferPolicy.PAUSE_ALL -> false
            TransferPolicy.USER_PREFERENCE -> !isMetered || !pauseOnMetered
        }

        if (shouldResume) {
            resumeNetworkPausedTransfers()
        }
    }

    private fun pauseAllTransfers(reason: String) {
        Timber.i("Pausing all transfers: $reason")

        scope.launch {
            val activeTransfers = progressTracker.getAllActiveTransfers().keys

            for (transferId in activeTransfers) {
                val progress = progressTracker.getProgress(transferId)
                if (progress?.status == FileTransferStatus.TRANSFERRING) {
                    fileTransferManager.pauseTransfer(transferId)
                    networkPausedTransfers.add(transferId)
                    Timber.d("Paused transfer: $transferId")
                }
            }

            Timber.i("Paused ${networkPausedTransfers.size} transfers due to: $reason")
        }
    }

    private fun resumeNetworkPausedTransfers() {
        if (networkPausedTransfers.isEmpty()) return

        Timber.i("Resuming ${networkPausedTransfers.size} network-paused transfers")

        scope.launch {
            val toResume = networkPausedTransfers.toList()
            networkPausedTransfers.clear()

            for (transferId in toResume) {
                try {
                    fileTransferManager.resumeTransfer(transferId)
                    Timber.d("Resumed transfer: $transferId")
                } catch (e: Exception) {
                    Timber.e(e, "Failed to resume transfer: $transferId")
                }
            }
        }
    }

    private fun mapNetworkTypeFromInfo(type: com.chainlesschain.android.core.p2p.network.NetworkType): NetworkType {
        return when (type) {
            com.chainlesschain.android.core.p2p.network.NetworkType.WIFI -> NetworkType.WIFI
            com.chainlesschain.android.core.p2p.network.NetworkType.CELLULAR -> NetworkType.CELLULAR_4G
            com.chainlesschain.android.core.p2p.network.NetworkType.ETHERNET -> NetworkType.ETHERNET
            com.chainlesschain.android.core.p2p.network.NetworkType.OTHER -> NetworkType.UNKNOWN
            com.chainlesschain.android.core.p2p.network.NetworkType.NONE -> NetworkType.NONE
        }
    }
}
