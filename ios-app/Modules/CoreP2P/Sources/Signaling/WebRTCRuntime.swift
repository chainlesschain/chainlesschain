import Foundation
import WebRTC

/// WebRTC SDK 全局运行时 — Phase 2.1。
///
/// **关键约束**：`RTCInitializeSSL()` + `RTCPeerConnectionFactory` 全 app
/// 生命周期**仅初始化一次**。Features/Social/Services/WebRTCManager.swift
/// 已经在自己的 init 里做过；Phase 2 RemoteWebRTCClient 必须**复用**同一份
/// runtime，否则 SSL 状态 / encoder factory 重复初始化会 crash 或泄漏。
///
/// **Why actor**：多个 client (Phase 2 RemoteWebRTC + 既有 WebRTCManager) 可能
/// 并发访问 `factory`；actor 串行化避免 race。访问开销 ≈ 几纳秒，可忽略。
///
/// **生命周期**：进程启动后第一次 `WebRTCRuntime.shared.peerConnectionFactory()`
/// 调用时初始化 SSL + factory；之后所有调用返同一 factory 实例。无显式 dispose
/// — 进程退出时 OS 回收。
public actor WebRTCRuntime {
    public static let shared = WebRTCRuntime()

    private var initialized = false
    private var _factory: RTCPeerConnectionFactory?

    private init() {}

    /// 拿 shared `RTCPeerConnectionFactory` — 首次调用 lazy 初始化。
    public func peerConnectionFactory() async -> RTCPeerConnectionFactory {
        if !initialized {
            RTCInitializeSSL()
            let encoderFactory = RTCDefaultVideoEncoderFactory()
            let decoderFactory = RTCDefaultVideoDecoderFactory()
            _factory = RTCPeerConnectionFactory(
                encoderFactory: encoderFactory,
                decoderFactory: decoderFactory
            )
            initialized = true
        }
        return _factory!
    }

    /// 仅供测试 — 重置内部 state 让下次 peerConnectionFactory() 重新初始化。
    /// **生产禁调** — 会让现有 PeerConnection 引用悬空。
    internal func _testReset() {
        _factory = nil
        initialized = false
        RTCCleanupSSL()
    }
}
