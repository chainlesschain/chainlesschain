import Foundation
import LocalAuthentication
import CoreCommon

/// 生物识别认证管理器
public class BiometricAuthManager {
    public static let shared = BiometricAuthManager()

    private let context = LAContext()
    private let logger = Logger.shared

    private init() {}

    // MARK: - Public Methods

    /// 检查生物识别是否可用
    public func isBiometricAvailable() -> Bool {
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        if let error = error {
            logger.debug("Biometric not available: \(error.localizedDescription)", category: "Biometric")
        }

        return canEvaluate
    }

    /// 获取生物识别类型
    public func biometricType() -> BiometricType {
        guard isBiometricAvailable() else {
            return .none
        }

        switch context.biometryType {
        case .faceID:
            return .faceID
        case .touchID:
            return .touchID
        case .opticID:
            return .opticID
        case .none:
            return .none
        @unknown default:
            return .none
        }
    }

    /// 执行生物识别认证
    public func authenticate(reason: String) async throws -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "取消"
        context.localizedFallbackTitle = "使用 PIN 码"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            if let error = error {
                logger.error("Cannot evaluate biometric policy", error: error, category: "Biometric")
                throw BiometricError.notAvailable(error)
            }
            throw BiometricError.notAvailable(nil)
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )

            if success {
                logger.info("Biometric authentication succeeded", category: "Biometric")
            }

            return success
        } catch let error as LAError {
            logger.error("Biometric authentication failed", error: error, category: "Biometric")
            throw BiometricError.authenticationFailed(error)
        }
    }

    /// 执行设备密码认证（包括生物识别）
    public func authenticateWithDevicePasscode(reason: String) async throws -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "取消"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            if let error = error {
                logger.error("Cannot evaluate device passcode policy", error: error, category: "Biometric")
                throw BiometricError.notAvailable(error)
            }
            throw BiometricError.notAvailable(nil)
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )

            if success {
                logger.info("Device passcode authentication succeeded", category: "Biometric")
            }

            return success
        } catch let error as LAError {
            logger.error("Device passcode authentication failed", error: error, category: "Biometric")
            throw BiometricError.authenticationFailed(error)
        }
    }

    /// 检查生物识别是否已更改
    public func hasBiometricChanged() -> Bool {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return false
        }

        // 获取当前生物识别数据
        guard let domainState = context.evaluatedPolicyDomainState else {
            return false
        }

        // 从 UserDefaults 读取上次保存的生物识别数据
        let userDefaults = UserDefaults.standard
        let key = "lastBiometricDomainState"

        if let lastDomainState = userDefaults.data(forKey: key) {
            // 比较是否发生变化
            if domainState != lastDomainState {
                logger.warning("Biometric data has changed", category: "Biometric")
                return true
            }
        }

        // 保存当前生物识别数据
        userDefaults.set(domainState, forKey: key)
        return false
    }
}

// MARK: - Biometric Type

public enum BiometricType {
    case none
    case touchID
    case faceID
    case opticID

    public var displayName: String {
        switch self {
        case .none:
            return "无"
        case .touchID:
            return "Touch ID"
        case .faceID:
            return "Face ID"
        case .opticID:
            return "Optic ID"
        }
    }
}

// MARK: - Biometric Error

public enum BiometricError: Error, LocalizedError {
    case notAvailable(NSError?)
    case authenticationFailed(LAError)

    public var errorDescription: String? {
        switch self {
        case .notAvailable(let error):
            if let error = error {
                return "生物识别不可用: \(error.localizedDescription)"
            }
            return "生物识别不可用"
        case .authenticationFailed(let error):
            switch error.code {
            case .userCancel:
                return "用户取消认证"
            case .userFallback:
                return "用户选择使用备用认证方式"
            case .biometryNotAvailable:
                return "生物识别不可用"
            case .biometryNotEnrolled:
                return "未设置生物识别"
            case .biometryLockout:
                return "生物识别已锁定，请使用密码解锁"
            default:
                return "认证失败: \(error.localizedDescription)"
            }
        }
    }
}
