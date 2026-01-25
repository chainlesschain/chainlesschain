import Foundation
import LocalAuthentication

/// 生物识别签名服务
/// 使用Face ID/Touch ID进行钱包操作认证
class BiometricSigner {
    static let shared = BiometricSigner()

    private init() {}

    /// 检查生物识别是否可用
    func biometricAvailable() -> (available: Bool, biometryType: LABiometryType) {
        let context = LAContext()
        var error: NSError?

        let canEvaluate = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        )

        return (canEvaluate, context.biometryType)
    }

    /// 使用生物识别认证
    /// - Parameter reason: 认证原因（显示给用户）
    /// - Returns: 认证是否成功
    func authenticateWithBiometric(reason: String = "验证身份以访问钱包") async throws -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "取消"
        context.localizedFallbackTitle = "使用密码"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            if let error = error {
                throw BiometricError.notAvailable(error.localizedDescription)
            }
            throw BiometricError.notAvailable("生物识别不可用")
        }

        return try await withCheckedThrowingContinuation { continuation in
            context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            ) { success, error in
                if success {
                    continuation.resume(returning: true)
                } else if let error = error {
                    let laError = error as? LAError
                    switch laError?.code {
                    case .userCancel, .systemCancel, .appCancel:
                        continuation.resume(returning: false)
                    case .userFallback:
                        continuation.resume(throwing: BiometricError.fallbackRequested)
                    case .biometryNotAvailable:
                        continuation.resume(throwing: BiometricError.notAvailable("生物识别不可用"))
                    case .biometryNotEnrolled:
                        continuation.resume(throwing: BiometricError.notEnrolled)
                    case .biometryLockout:
                        continuation.resume(throwing: BiometricError.lockout)
                    default:
                        continuation.resume(throwing: BiometricError.failed(error.localizedDescription))
                    }
                } else {
                    continuation.resume(returning: false)
                }
            }
        }
    }

    /// 使用生物识别解锁钱包
    /// - Parameters:
    ///   - walletId: 钱包ID
    ///   - password: 钱包密码
    /// - Returns: 解锁的私钥
    func unlockWalletWithBiometric(walletId: String, password: String) async throws -> String {
        // 1. 先进行生物识别认证
        let authenticated = try await authenticateWithBiometric(reason: "解锁钱包")

        guard authenticated else {
            throw BiometricError.authenticationFailed
        }

        // 2. 认证成功后解锁钱包
        return try await WalletManager.shared.unlockWallet(walletId: walletId, password: password)
    }

    /// 使用生物识别签名交易
    /// - Parameters:
    ///   - transaction: 交易请求
    ///   - walletId: 钱包ID
    ///   - password: 钱包密码
    /// - Returns: 签名后的交易
    func signTransactionWithBiometric(
        transaction: TransactionRequest,
        walletId: String,
        password: String
    ) async throws -> String {
        // 1. 生物识别认证
        let authenticated = try await authenticateWithBiometric(
            reason: "签名交易\n发送 \(transaction.value) Wei 到 \(transaction.to)"
        )

        guard authenticated else {
            throw BiometricError.authenticationFailed
        }

        // 2. 解锁钱包获取私钥
        let privateKey = try await WalletManager.shared.unlockWallet(
            walletId: walletId,
            password: password
        )

        // 3. 使用私钥签名交易
        // TODO: 集成 WalletCore 或 web3.swift 进行交易签名
        // let signedTx = try signTransaction(transaction, privateKey: privateKey)

        // 4. 签名完成后立即锁定钱包
        WalletManager.shared.lockWallet(walletId: walletId)

        // 临时返回（实际需要实现签名）
        throw WalletError.networkError("签名功能需要集成WalletCore或web3.swift")
    }

    /// 获取生物识别类型名称
    func biometricTypeName() -> String {
        let (available, biometryType) = biometricAvailable()

        guard available else {
            return "不可用"
        }

        switch biometryType {
        case .faceID:
            return "Face ID"
        case .touchID:
            return "Touch ID"
        case .none:
            return "无"
        @unknown default:
            return "未知"
        }
    }
}

// MARK: - 生物识别错误

enum BiometricError: LocalizedError {
    case notAvailable(String)
    case notEnrolled
    case lockout
    case fallbackRequested
    case authenticationFailed
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notAvailable(let reason):
            return "生物识别不可用: \(reason)"
        case .notEnrolled:
            return "未设置生物识别，请在系统设置中启用Face ID或Touch ID"
        case .lockout:
            return "生物识别已锁定，请使用密码"
        case .fallbackRequested:
            return "用户选择使用密码"
        case .authenticationFailed:
            return "生物识别认证失败"
        case .failed(let reason):
            return "认证失败: \(reason)"
        }
    }
}
