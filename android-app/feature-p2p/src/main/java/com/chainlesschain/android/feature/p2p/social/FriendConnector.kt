package com.chainlesschain.android.feature.p2p.social

/**
 * VM-facing seam：加好友成功后触发好友 P2P 自动接通 (FAMILY-67 对称件)。
 *
 * 接口放在 feature-p2p（[com.chainlesschain.android.feature.p2p.viewmodel.social.AddFriendViewModel]
 * 所在模块）便于 VM 注入 + 纯单测；真实现 `com.chainlesschain.android.sync.FriendSyncConnector` 在
 * `:app`（依赖 P2PClient 等），由 :app 的 DI 模块 @Binds 绑定。default no-op 让未绑定时（理论上不会）
 * 也安全。
 */
interface FriendConnector {
    fun onFriendAdded()

    /** 未绑定实现时的安全兜底（生产恒被 :app 的 FriendSyncConnector 覆盖）。 */
    object NoOp : FriendConnector {
        override fun onFriendAdded() {}
    }
}
