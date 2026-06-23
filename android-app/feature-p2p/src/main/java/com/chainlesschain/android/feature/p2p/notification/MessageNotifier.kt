package com.chainlesschain.android.feature.p2p.notification

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.Lazy
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 好友消息通知。被叫端收到 P2P 消息（直连 / 信令中继 / 桌面同步）时弹通知，提示有新消息。
 *
 * 抑制规则：仅当用户**正盯着与该 peer 的聊天**（app 前台 + [ActiveChatTracker] 记录的对端==peer）
 * 时不弹（此时聊天页实时展示，不打扰）。app 在后台、或前台但停在好友列表/别的聊天时仍弹。
 * 标题用好友昵称（[FriendRepository]，备注名优先），解析失败回退缩写 DID。
 * 点击打开 app 并带 [EXTRA_OPEN_CHAT_PEER]。每个对端独立通知（id=peerId.hashCode），可堆叠。
 */
@Singleton
class MessageNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
    private val activeChatTracker: ActiveChatTracker,
    // dagger.Lazy 避免与社交仓库图潜在的构造期循环依赖
    private val friendRepository: Lazy<FriendRepository>,
) {
    private val nm: NotificationManager? = context.getSystemService(NotificationManager::class.java)

    suspend fun notifyIncoming(peerId: String, content: String) {
        if (shouldSuppress(peerId)) return // 正在看这个聊天，不打扰
        ensureChannel()
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.apply { putExtra(EXTRA_OPEN_CHAT_PEER, peerId) }
        val pi = PendingIntent.getActivity(
            context, peerId.hashCode(),
            launch ?: return,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val preview = content.take(80).ifBlank { "[新消息]" }
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("好友消息 · ${resolveDisplayName(peerId)}")
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        runCatching { nm?.notify(NOTIF_BASE + (peerId.hashCode() and 0xFFFF), notif) }
            .onFailure { Timber.w(it, "[MessageNotifier] notify failed") }
    }

    /** 仅当 app 在前台且用户正盯着与该 peer 的聊天时才抑制。 */
    private fun shouldSuppress(peerId: String): Boolean =
        isAppForeground() && activeChatTracker.activePeerId == peerId

    /** 解析好友显示名：备注名 > 昵称 > 缩写 DID。任何异常回退缩写 DID。 */
    private suspend fun resolveDisplayName(peerId: String): String {
        val friend = runCatching {
            (friendRepository.get().getFriendByDid(peerId) as? Result.Success)?.data
        }.getOrNull()
        val name = friend?.remarkName?.takeIf { it.isNotBlank() }
            ?: friend?.nickname?.takeIf { it.isNotBlank() }
        return name ?: shortDid(peerId)
    }

    private fun isAppForeground(): Boolean = runCatching {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        am.runningAppProcesses?.firstOrNull { it.pid == Process.myPid() }?.importance ==
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }.getOrDefault(false)

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = nm ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "好友消息", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "好友 P2P 加密消息新消息提醒"
            },
        )
    }

    private fun shortDid(did: String): String =
        if (did.length <= 18) did else did.take(12) + "…" + did.takeLast(4)

    companion object {
        const val CHANNEL_ID = "p2p_messages"
        const val NOTIF_BASE = 9200
        const val EXTRA_OPEN_CHAT_PEER = "open_chat_peer"
    }
}
