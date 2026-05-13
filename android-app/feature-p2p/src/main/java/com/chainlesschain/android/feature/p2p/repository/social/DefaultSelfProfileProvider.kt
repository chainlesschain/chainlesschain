package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.realtime.SelfProfileProvider
import com.chainlesschain.android.core.p2p.realtime.SelfProfileSnapshot
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 默认自身资料提供者
 *
 * 当远端通过 [com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager.queryProfile] 询问
 * 本机 DID 对应的资料时，由本类响应。当前从 [DIDManager] 取 DID，nickname 用 DID 末 8 位生成占位
 * （与 [com.chainlesschain.android.feature.p2p.viewmodel.social.MyQRCodeViewModel] 的占位规则一致），
 * 直到完整的 SelfProfileStore（昵称/头像/简介编辑界面 + 持久化）落地后替换本实现。
 *
 * 注意：返回 null 表示"本机尚未生成 DID"——RealtimeEventManager 会忽略响应而非发空包，
 * 远端 [searchUserByDid] 走超时 path 显示"未找到"。
 */
@Singleton
class DefaultSelfProfileProvider @Inject constructor(
    private val didManager: DIDManager
) : SelfProfileProvider {

    override suspend fun loadSelfProfile(): SelfProfileSnapshot? {
        val did = didManager.getCurrentDID() ?: return null
        return SelfProfileSnapshot(
            did = did,
            // 占位 nickname：与 MyQRCodeViewModel.kt L100 同规则
            nickname = "用户${did.takeLast(8)}",
            avatarUrl = null,
            bio = null
        )
    }
}
