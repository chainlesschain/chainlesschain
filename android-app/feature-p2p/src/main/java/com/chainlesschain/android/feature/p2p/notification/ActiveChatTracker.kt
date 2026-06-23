package com.chainlesschain.android.feature.p2p.notification

import javax.inject.Inject
import javax.inject.Singleton

/**
 * 跟踪当前**前台正在查看**的聊天对端 DID。
 *
 * 用于消息通知抑制：只有当用户正盯着「与该 peer 的聊天」时才不弹通知。
 * 这比单纯的「app 是否前台」更精确——app 在前台但停在好友列表 / 别的聊天时，
 * 收到某 peer 的消息仍应弹通知。
 *
 * 由 P2PChatViewModel 在 loadChat/onChatScreenHidden/onCleared 维护，
 * 由 MessageNotifier 读取。@Singleton 进程内唯一。
 */
@Singleton
class ActiveChatTracker @Inject constructor() {
    @Volatile
    var activePeerId: String? = null
        private set

    /** 进入与 [peerId] 的聊天界面（前台）。 */
    fun enter(peerId: String) {
        activePeerId = peerId
    }

    /** 离开与 [peerId] 的聊天界面。仅当当前记录的就是它时才清，避免竞态误清。 */
    fun leave(peerId: String) {
        if (activePeerId == peerId) activePeerId = null
    }
}
