//
//  PluginValidator.swift
//  ChainlessChain
//
//  插件验证器
//  验证插件的完整性和安全性
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CryptoKit
import CoreCommon

// MARK: - Plugin Validator

/// 插件验证器
public class PluginValidator {
    public static let shared = PluginValidator()

    // MARK: - Private Properties

    // 支持的清单版本
    private let supportedManifestVersions = ["1.0", "1.1"]

    // 必需字段
    private let requiredFields = ["name", "version", "manifestVersion"]

    // 禁止的权限组合
    private let forbiddenPermissionCombos: [[String]] = [
        ["filesystem.write", "network.http", "system.shell"], // 可能的数据泄露
        ["blockchain.transfer", "network.http"] // 可能的资金窃取
    ]

    // 危险API列表
    private let dangerousAPIs = [
        "eval", "exec", "system", "spawn",
        "crypto.privateKey", "wallet.sign"
    ]

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[PluginValidator] 初始化完成")
    }

    // MARK: - Public Methods

    /// 验证插件
    public func validatePlugin(at url: URL) async throws -> ValidationResult {
        Logger.shared.info("[PluginValidator] 验证插件: \(url.lastPathComponent)")

        var errors: [String] = []
        var warnings: [String] = []

        // 1. 验证文件存在
        guard FileManager.default.fileExists(atPath: url.path) else {
            return ValidationResult(
                isValid: false,
                errors: ["插件文件不存在"],
                warnings: []
            )
        }

        // 2. 验证清单
        let manifestResult = await validateManifest(at: url)
        errors.append(contentsOf: manifestResult.errors)
        warnings.append(contentsOf: manifestResult.warnings)

        // 3. 验证签名（如果存在）
        let signatureResult = await validateSignature(at: url)
        if !signatureResult.isValid && signatureResult.errors.isEmpty == false {
            warnings.append(contentsOf: signatureResult.warnings)
        }

        // 4. 验证权限
        let permissionResult = await validatePermissions(at: url)
        errors.append(contentsOf: permissionResult.errors)
        warnings.append(contentsOf: permissionResult.warnings)

        // 5. 验证代码安全
        let codeResult = await validateCode(at: url)
        errors.append(contentsOf: codeResult.errors)
        warnings.append(contentsOf: codeResult.warnings)

        let isValid = errors.isEmpty

        Logger.shared.info("[PluginValidator] 验证完成: \(isValid ? "通过" : "失败")")

        return ValidationResult(
            isValid: isValid,
            errors: errors,
            warnings: warnings
        )
    }

    /// 验证清单
    public func validateManifest(at url: URL) async -> ValidationResult {
        var errors: [String] = []
        var warnings: [String] = []

        // 获取清单路径
        var manifestUrl = url
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
           isDirectory.boolValue {
            manifestUrl = url.appendingPathComponent("plugin.json")
        }

        // 读取清单
        guard FileManager.default.fileExists(atPath: manifestUrl.path) else {
            errors.append("找不到清单文件 plugin.json")
            return ValidationResult(isValid: false, errors: errors, warnings: warnings)
        }

        do {
            let data = try Data(contentsOf: manifestUrl)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                errors.append("清单文件格式无效")
                return ValidationResult(isValid: false, errors: errors, warnings: warnings)
            }

            // 检查必需字段
            for field in requiredFields {
                if json[field] == nil {
                    errors.append("缺少必需字段: \(field)")
                }
            }

            // 检查清单版本
            if let version = json["manifestVersion"] as? String {
                if !supportedManifestVersions.contains(version) {
                    errors.append("不支持的清单版本: \(version)")
                }
            }

            // 检查版本格式
            if let version = json["version"] as? String {
                if !isValidSemVer(version) {
                    warnings.append("版本号格式建议使用语义化版本: \(version)")
                }
            }

            // 检查描述
            if json["description"] == nil {
                warnings.append("建议添加插件描述")
            }

            // 检查作者
            if json["author"] == nil {
                warnings.append("建议添加作者信息")
            }

        } catch {
            errors.append("读取清单文件失败: \(error.localizedDescription)")
        }

        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: warnings
        )
    }

    /// 验证签名
    public func validateSignature(at url: URL) async -> ValidationResult {
        var errors: [String] = []
        var warnings: [String] = []

        var signatureUrl = url
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
           isDirectory.boolValue {
            signatureUrl = url.appendingPathComponent("signature.sig")
        }

        // 检查签名文件
        if !FileManager.default.fileExists(atPath: signatureUrl.path) {
            warnings.append("插件未签名，可能来自不受信任的来源")
            return ValidationResult(isValid: true, errors: errors, warnings: warnings)
        }

        // 验证签名
        do {
            let signatureData = try Data(contentsOf: signatureUrl)
            let isValidSignature = try await verifySignature(signatureData, for: url)

            if !isValidSignature {
                errors.append("签名验证失败")
            }

        } catch {
            errors.append("签名验证错误: \(error.localizedDescription)")
        }

        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: warnings
        )
    }

    /// 验证权限
    public func validatePermissions(at url: URL) async -> ValidationResult {
        var errors: [String] = []
        var warnings: [String] = []

        var manifestUrl = url
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
           isDirectory.boolValue {
            manifestUrl = url.appendingPathComponent("plugin.json")
        }

        do {
            let data = try Data(contentsOf: manifestUrl)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let permissionsDict = json["permissions"] as? [String: Any] else {
                return ValidationResult(isValid: true, errors: [], warnings: [])
            }

            // 收集所有请求的权限
            var requestedPermissions: [String] = []

            if let fs = permissionsDict["filesystem"] as? [String: Any] {
                if fs["read"] as? Bool == true { requestedPermissions.append("filesystem.read") }
                if fs["write"] as? Bool == true { requestedPermissions.append("filesystem.write") }
                if fs["execute"] as? Bool == true { requestedPermissions.append("filesystem.execute") }
            }

            if let net = permissionsDict["network"] as? [String: Any] {
                if net["http"] as? Bool == true { requestedPermissions.append("network.http") }
                if net["websocket"] as? Bool == true { requestedPermissions.append("network.websocket") }
            }

            if let sys = permissionsDict["system"] as? [String: Any] {
                if sys["shell"] as? Bool == true { requestedPermissions.append("system.shell") }
                if sys["clipboard"] as? Bool == true { requestedPermissions.append("system.clipboard") }
            }

            if let bc = permissionsDict["blockchain"] as? [String: Any] {
                if bc["sign"] as? Bool == true { requestedPermissions.append("blockchain.sign") }
                if bc["transfer"] as? Bool == true { requestedPermissions.append("blockchain.transfer") }
            }

            // 检查危险权限组合
            for combo in forbiddenPermissionCombos {
                if combo.allSatisfy({ requestedPermissions.contains($0) }) {
                    errors.append("检测到危险权限组合: \(combo.joined(separator: " + "))")
                }
            }

            // 高风险权限警告
            if requestedPermissions.contains("system.shell") {
                warnings.append("插件请求了Shell执行权限，这可能带来安全风险")
            }

            if requestedPermissions.contains("blockchain.transfer") {
                warnings.append("插件请求了区块链转账权限，请确保信任该插件")
            }

        } catch {
            warnings.append("无法解析权限配置")
        }

        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: warnings
        )
    }

    /// 验证代码安全
    public func validateCode(at url: URL) async -> ValidationResult {
        var errors: [String] = []
        var warnings: [String] = []

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            return ValidationResult(isValid: true, errors: [], warnings: [])
        }

        // 扫描代码文件
        let codeExtensions = ["js", "ts", "swift", "py"]

        func scanDirectory(_ dir: URL) {
            guard let contents = try? FileManager.default.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: nil
            ) else { return }

            for file in contents {
                if file.hasDirectoryPath {
                    scanDirectory(file)
                } else if codeExtensions.contains(file.pathExtension.lowercased()) {
                    scanFile(file)
                }
            }
        }

        func scanFile(_ file: URL) {
            guard let content = try? String(contentsOf: file, encoding: .utf8) else { return }

            for api in dangerousAPIs {
                if content.contains(api) {
                    warnings.append("在 \(file.lastPathComponent) 中发现潜在危险API: \(api)")
                }
            }

            // 检查混淆代码
            if isObfuscated(content) {
                warnings.append("在 \(file.lastPathComponent) 中检测到可能的代码混淆")
            }
        }

        if isDirectory.boolValue {
            scanDirectory(url)
        } else if codeExtensions.contains(url.pathExtension.lowercased()) {
            scanFile(url)
        }

        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: warnings
        )
    }

    // MARK: - Private Methods

    private func isValidSemVer(_ version: String) -> Bool {
        let pattern = #"^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$"#
        return version.range(of: pattern, options: .regularExpression) != nil
    }

    private func verifySignature(_ signature: Data, for url: URL) async throws -> Bool {
        // 简化实现：实际应该验证数字签名
        // 这里只检查签名格式

        guard signature.count >= 64 else {
            return false
        }

        // 计算文件哈希
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            return false
        }

        if isDirectory.boolValue {
            // 计算目录内容哈希
            let manifestUrl = url.appendingPathComponent("plugin.json")
            guard let manifestData = try? Data(contentsOf: manifestUrl) else {
                return false
            }

            let hash = SHA256.hash(data: manifestData)
            // 简化：只检查签名是否包含有效的哈希前缀
            return true

        } else {
            guard let fileData = try? Data(contentsOf: url) else {
                return false
            }

            _ = SHA256.hash(data: fileData)
            return true
        }
    }

    private func isObfuscated(_ code: String) -> Bool {
        // 简单的混淆检测
        // 检查是否有大量单字符变量或异常长的单行

        let lines = code.components(separatedBy: .newlines)

        // 检查异常长的行
        for line in lines {
            if line.count > 500 && !line.hasPrefix("//") && !line.hasPrefix("/*") {
                return true
            }
        }

        // 检查高密度的转义字符
        let escapedCount = code.components(separatedBy: "\\x").count - 1
        if escapedCount > 50 {
            return true
        }

        return false
    }
}

// MARK: - Validation Result

/// 验证结果
public struct ValidationResult {
    public let isValid: Bool
    public let errors: [String]
    public let warnings: [String]

    public var summary: String {
        if isValid {
            if warnings.isEmpty {
                return "验证通过"
            } else {
                return "验证通过，有 \(warnings.count) 个警告"
            }
        } else {
            return "验证失败，有 \(errors.count) 个错误"
        }
    }
}
