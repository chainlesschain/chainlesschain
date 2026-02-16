package com.chainlesschain.android.remote.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.chainlesschain.android.remote.commands.ClipboardCommands
import com.chainlesschain.android.remote.commands.ClipboardContentType
import com.chainlesschain.android.remote.events.RemoteEventDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 本地剪贴板管理器
 *
 * 管理Android本地剪贴板，支持与PC剪贴板同步
 */
@Singleton
class LocalClipboardManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val clipboardCommands: ClipboardCommands,
    private val eventDispatcher: RemoteEventDispatcher
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val clipboardManager: ClipboardManager =
        context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: error("ClipboardManager system service unavailable")

    @Volatile
    private var lastLocalContent: String? = null
    @Volatile
    private var isListening = false

    // Sync state
    private val _syncEnabled = MutableStateFlow(false)
    val syncEnabled: StateFlow<Boolean> = _syncEnabled.asStateFlow()

    private val _lastSyncTime = MutableStateFlow<Long?>(null)
    val lastSyncTime: StateFlow<Long?> = _lastSyncTime.asStateFlow()

    // Current clipboard content
    private val _currentContent = MutableStateFlow<String?>(null)
    val currentContent: StateFlow<String?> = _currentContent.asStateFlow()

    init {
        // Listen for PC clipboard changes
        scope.launch {
            eventDispatcher.clipboardChanges.collect { event ->
                if (_syncEnabled.value) {
                    handlePCClipboardChange(event.content, event.contentType)
                }
            }
        }
    }

    /**
     * Enable or disable clipboard sync
     */
    fun setSyncEnabled(enabled: Boolean) {
        _syncEnabled.value = enabled
        if (enabled) {
            startListening()
        } else {
            stopListening()
        }
    }

    /**
     * Get current local clipboard content
     */
    fun getLocalClipboard(): String? {
        return try {
            val clip = clipboardManager.primaryClip
            if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).text?.toString()
            } else {
                null
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to get local clipboard")
            null
        }
    }

    /**
     * Set local clipboard content
     */
    fun setLocalClipboard(content: String) {
        try {
            val clip = ClipData.newPlainText("ChainlessChain Sync", content)
            clipboardManager.setPrimaryClip(clip)
            lastLocalContent = content
            _currentContent.value = content
            Timber.d("Local clipboard set: ${content.take(50)}...")
        } catch (e: Exception) {
            Timber.e(e, "Failed to set local clipboard")
        }
    }

    /**
     * Push local clipboard to PC
     */
    suspend fun pushToPC(): Result<Unit> {
        val content = getLocalClipboard()
        if (content.isNullOrEmpty()) {
            return Result.failure(Exception("Local clipboard is empty"))
        }

        return clipboardCommands.pushToPC(content).map {
            _lastSyncTime.value = System.currentTimeMillis()
            Timber.d("Pushed to PC: ${content.take(50)}...")
        }
    }

    /**
     * Pull PC clipboard to local
     */
    suspend fun pullFromPC(): Result<Unit> {
        return clipboardCommands.pullFromPC().map { response ->
            if (response.success && response.content != null) {
                setLocalClipboard(response.content)
                _lastSyncTime.value = System.currentTimeMillis()
                Timber.d("Pulled from PC: ${response.content.take(50)}...")
            }
        }
    }

    /**
     * Start watching PC clipboard for changes
     */
    suspend fun startWatchingPC(interval: Long = 1000): Result<Unit> {
        return clipboardCommands.watch(interval).map {
            Timber.d("Started watching PC clipboard")
        }
    }

    /**
     * Stop watching PC clipboard
     */
    suspend fun stopWatchingPC(): Result<Unit> {
        return clipboardCommands.unwatch().map {
            Timber.d("Stopped watching PC clipboard")
        }
    }

    /**
     * Start listening for local clipboard changes
     */
    private fun startListening() {
        if (isListening) return

        clipboardManager.addPrimaryClipChangedListener(clipboardChangeListener)
        isListening = true
        Timber.d("Started listening for local clipboard changes")
    }

    /**
     * Stop listening for local clipboard changes
     */
    private fun stopListening() {
        if (!isListening) return

        clipboardManager.removePrimaryClipChangedListener(clipboardChangeListener)
        isListening = false
        Timber.d("Stopped listening for local clipboard changes")
    }

    private val clipboardChangeListener = ClipboardManager.OnPrimaryClipChangedListener {
        val content = getLocalClipboard()

        // Avoid infinite loops - don't push if we just received from PC
        if (content != null && content != lastLocalContent) {
            lastLocalContent = content
            _currentContent.value = content

            if (_syncEnabled.value) {
                scope.launch {
                    pushToPC()
                }
            }
        }
    }

    /**
     * Handle PC clipboard change event
     */
    private fun handlePCClipboardChange(content: String, contentType: String) {
        if (contentType != "text" && contentType != "html") {
            Timber.d("Ignoring non-text clipboard change: $contentType")
            return
        }

        // Avoid setting if it's the same as what we just pushed
        if (content != lastLocalContent) {
            setLocalClipboard(content)
            _lastSyncTime.value = System.currentTimeMillis()
            Timber.d("Synced from PC: ${content.take(50)}...")
        }
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        stopListening()
    }
}
