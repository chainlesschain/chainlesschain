package com.chainlesschain.android.remote.events

import com.chainlesschain.android.remote.commands.ClipboardChangeEvent
import com.chainlesschain.android.remote.commands.NotificationReceivedEvent
import com.chainlesschain.android.remote.commands.WorkflowCompletedEvent
import com.chainlesschain.android.remote.commands.WorkflowProgressEvent
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.data.MessageTypes
import com.chainlesschain.android.remote.p2p.P2PClient
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程事件分发器
 *
 * 监听P2P事件并分发到对应的事件流，供UI层订阅
 */
@Singleton
class RemoteEventDispatcher @Inject constructor(
    private val p2pClient: P2PClient
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val gson = Gson()

    // Clipboard events
    private val _clipboardChanges = MutableSharedFlow<ClipboardChangeEvent>(
        replay = 1,
        extraBufferCapacity = 8
    )
    val clipboardChanges: SharedFlow<ClipboardChangeEvent> = _clipboardChanges.asSharedFlow()

    // Notification events
    private val _notificationReceived = MutableSharedFlow<NotificationReceivedEvent>(
        replay = 0,
        extraBufferCapacity = 16
    )
    val notificationReceived: SharedFlow<NotificationReceivedEvent> = _notificationReceived.asSharedFlow()

    // Workflow progress events
    private val _workflowProgress = MutableSharedFlow<WorkflowProgressEvent>(
        replay = 0,
        extraBufferCapacity = 16
    )
    val workflowProgress: SharedFlow<WorkflowProgressEvent> = _workflowProgress.asSharedFlow()

    // Workflow completed events
    private val _workflowCompleted = MutableSharedFlow<WorkflowCompletedEvent>(
        replay = 0,
        extraBufferCapacity = 8
    )
    val workflowCompleted: SharedFlow<WorkflowCompletedEvent> = _workflowCompleted.asSharedFlow()

    // Generic events (for custom handling)
    private val _genericEvents = MutableSharedFlow<EventNotification>(
        replay = 0,
        extraBufferCapacity = 32
    )
    val genericEvents: SharedFlow<EventNotification> = _genericEvents.asSharedFlow()

    init {
        startListening()
    }

    private fun startListening() {
        scope.launch {
            p2pClient.events.collect { event ->
                try {
                    dispatchEvent(event)
                } catch (e: Exception) {
                    Timber.e(e, "Failed to dispatch event: ${event.method}")
                }
            }
        }
    }

    private suspend fun dispatchEvent(event: EventNotification) {
        Timber.d("[EventDispatcher] Received event: ${event.method}")

        when (event.method) {
            // Clipboard change event
            "clipboard.change", MessageTypes.CLIPBOARD_CHANGE -> {
                val clipboardEvent = parseEvent<ClipboardChangeEvent>(event)
                if (clipboardEvent != null) {
                    _clipboardChanges.emit(clipboardEvent)
                    Timber.d("[EventDispatcher] Clipboard change dispatched: ${clipboardEvent.contentType}")
                }
            }

            // Notification received event
            "notification.received", MessageTypes.NOTIFICATION_RECEIVED -> {
                val notifEvent = parseEvent<NotificationReceivedEvent>(event)
                if (notifEvent != null) {
                    _notificationReceived.emit(notifEvent)
                    Timber.d("[EventDispatcher] Notification dispatched: ${notifEvent.title}")
                }
            }

            // Workflow progress event
            "workflow.progress", MessageTypes.WORKFLOW_PROGRESS -> {
                val progressEvent = parseEvent<WorkflowProgressEvent>(event)
                if (progressEvent != null) {
                    _workflowProgress.emit(progressEvent)
                    Timber.d("[EventDispatcher] Workflow progress: ${progressEvent.workflowName} - ${progressEvent.progress}%")
                }
            }

            // Workflow completed event
            "workflow.completed", MessageTypes.WORKFLOW_COMPLETED -> {
                val completedEvent = parseEvent<WorkflowCompletedEvent>(event)
                if (completedEvent != null) {
                    _workflowCompleted.emit(completedEvent)
                    Timber.d("[EventDispatcher] Workflow completed: ${completedEvent.workflowName} - success=${completedEvent.success}")
                }
            }

            // Unknown/custom events
            else -> {
                _genericEvents.emit(event)
                Timber.d("[EventDispatcher] Generic event dispatched: ${event.method}")
            }
        }
    }

    private inline fun <reified T> parseEvent(event: EventNotification): T? {
        return try {
            val json = gson.toJson(event.params)
            gson.fromJson(json, T::class.java)
        } catch (e: Exception) {
            Timber.e(e, "Failed to parse event: ${event.method}")
            null
        }
    }

    /**
     * Get the latest clipboard content (if available)
     */
    fun getLastClipboardContent(): ClipboardChangeEvent? {
        return _clipboardChanges.replayCache.firstOrNull()
    }
}
