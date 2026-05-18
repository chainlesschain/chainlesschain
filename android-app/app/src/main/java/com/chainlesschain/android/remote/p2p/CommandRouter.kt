package com.chainlesschain.android.remote.p2p

/**
 * 入向 JSON-RPC 命令路由（Phase 3d M3 step D.5）
 *
 * P2PClient.handleIncoming 收到 chainlesschain:command:request 时把 (method,
 * params) 转给 CommandRouter，由具体实现按 method namespace 分发到 SyncManager
 * 等业务模块。route() 抛出的异常由 P2PClient 包成 CommandResponse error 回传。
 *
 * 设计取舍：
 *   - 不让 P2PClient 直接依赖 SyncManager（会反向跨模块 + 把同步耦合进
 *     transport 层）；通过这层 interface 让业务 module 注入自己的 router 实现
 *   - 当前唯一实现是 SyncCommandRouter（sync.* methods）；后续加其他命名空间
 *     扩展同模式
 *   - 返回 Any? — 允许 router 返回 data class 实例，P2PClient 用 Gson 序列化
 *     成 CommandResponse.result
 */
interface CommandRouter {
    /**
     * 路由命令到处理者并返回 result。method 形如 "sync.push" / "sync.pull"。
     * 未识别的 method 应抛 IllegalArgumentException 让 P2PClient 转 -32601
     * METHOD_NOT_FOUND 错误响应。
     */
    suspend fun route(method: String, params: Map<String, Any>): Any?
}
