import Foundation

/// Skill manifest 验签接口 — Phase 3.1 forward-compat（与 Android #21 A.3 AI-3 同模式）。
///
/// **当前 stage**：Phase 3 v0.1 不 enforce signature verification（push-based
/// `updateFromRemote` 来源即可信）。`NoOpManifestVerifier` 默认 accept everything。
///
/// **未来**：Marketplace M0 上线时，app 启动注入真验签 implementation
/// (Ed25519 + SLH-DSA hybrid，与 Phase 1 PQC 路径同) via
/// `RemoteSkillRegistry.setManifestVerifier(_:)`。
public protocol ManifestSignatureVerifier: AnyObject, Sendable {
    /// 验证 skill manifest 签名是否有效。
    /// - Parameters:
    ///   - manifestJson: skill list 的 JSON 字符串
    ///   - signature: base64 签名
    ///   - publicKey: base64 公钥（hybrid 时可能含多份）
    /// - Returns: true = 签名有效，false = 无效（caller 拒绝接受 manifest）
    func verify(manifestJson: String, signature: String?, publicKey: String?) async -> Bool
}

/// 默认 NoOp impl — accept everything。Phase 3 v0.1 默认。
public final class NoOpManifestVerifier: ManifestSignatureVerifier {
    public init() {}

    public func verify(manifestJson: String, signature: String?, publicKey: String?) async -> Bool {
        true  // Phase 3 v0.1 信任 push-based update 来源
    }
}
