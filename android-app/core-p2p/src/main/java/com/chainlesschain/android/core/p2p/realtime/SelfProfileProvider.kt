package com.chainlesschain.android.core.p2p.realtime

import kotlinx.serialization.Serializable

/**
 * 自身资料提供者
 *
 * 当远程节点用 [RealtimeEventManager.queryProfile] 询问本机 DID 对应的资料时，
 * 由 app 层（feature-p2p / 个人资料模块）注入实现，返回当前用户的展示信息。
 *
 * 默认实现见 `DefaultSelfProfileProvider` ——返回基于 DID 的占位 nickname，
 * 直到正式的 SelfProfileStore（昵称/头像/简介编辑界面）落地后替换。
 *
 * 设计要点：
 * - 该接口 **只**返回公开可见的资料，调用方不能信任此对端的回答（远程发的字串没经
 *   identity 签名），但可作 UI 显示用。后续可以叠加 DID 签名 + 校验。
 * - 实现需 thread-safe（响应在 IO 协程上跑）。
 */
interface SelfProfileProvider {
    /**
     * 返回本机当前 DID 的展示资料；如本机没有 DID（未登录）返回 null，
     * RealtimeEventManager 会跳过响应。
     */
    suspend fun loadSelfProfile(): SelfProfileSnapshot?
}

/**
 * 自身资料快照（公开可见信息）
 *
 * Bio/Avatar 为 null 表示"未设置"，UI 应按 fallback 显示。
 */
@Serializable
data class SelfProfileSnapshot(
    val did: String,
    val nickname: String,
    val avatarUrl: String? = null,
    val bio: String? = null
)
