import Foundation
import CryptoKit

/// 安全引擎
///
/// 负责安全扫描、漏洞检测、加密解密等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/security-engine.js
public class SecurityEngine: BaseAIEngine {

    public static let shared = SecurityEngine()

    private init() {
        super.init(
            type: .security,
            name: "安全引擎",
            description: "处理安全扫描、漏洞检测、加密解密等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "vulnerability_scan",
                name: "漏洞扫描",
                description: "扫描代码和依赖中的安全漏洞"
            ),
            AIEngineCapability(
                id: "code_security_audit",
                name: "代码安全审计",
                description: "审计代码的安全性问题"
            ),
            AIEngineCapability(
                id: "dependency_check",
                name: "依赖检查",
                description: "检查第三方依赖的安全问题"
            ),
            AIEngineCapability(
                id: "encrypt",
                name: "加密",
                description: "加密敏感数据"
            ),
            AIEngineCapability(
                id: "decrypt",
                name: "解密",
                description: "解密加密数据"
            ),
            AIEngineCapability(
                id: "hash",
                name: "哈希计算",
                description: "计算数据的哈希值"
            ),
            AIEngineCapability(
                id: "password_strength",
                name: "密码强度检测",
                description: "检测密码强度并提供建议"
            ),
            AIEngineCapability(
                id: "certificate_verify",
                name: "证书验证",
                description: "验证SSL/TLS证书"
            ),
            AIEngineCapability(
                id: "sensitive_data_detect",
                name: "敏感数据检测",
                description: "检测代码中的敏感信息泄露"
            ),
            AIEngineCapability(
                id: "security_report",
                name: "安全报告",
                description: "生成全面的安全分析报告"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        Logger.shared.info("安全引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("安全引擎执行任务: \(task)")

        switch task {
        case "scan":
            return try await scanVulnerabilities(parameters: parameters)

        case "audit":
            return try await auditCodeSecurity(parameters: parameters)

        case "check_dependencies":
            return try await checkDependencies(parameters: parameters)

        case "encrypt":
            return try await encryptData(parameters: parameters)

        case "decrypt":
            return try await decryptData(parameters: parameters)

        case "hash":
            return try await calculateHash(parameters: parameters)

        case "password_strength":
            return try await checkPasswordStrength(parameters: parameters)

        case "detect_sensitive":
            return try await detectSensitiveData(parameters: parameters)

        case "generate_report":
            return try await generateSecurityReport(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 漏洞扫描

    /// 扫描漏洞
    private func scanVulnerabilities(parameters: [String: Any]) async throws -> [String: Any] {
        guard let targetPath = parameters["targetPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少targetPath参数")
        }

        let scanType = parameters["scanType"] as? String ?? "comprehensive" // quick, comprehensive, deep

        // 扫描常见的安全问题
        var vulnerabilities: [[String: Any]] = []

        // 1. SQL注入检测
        let sqlInjectionIssues = try await scanForSQLInjection(path: targetPath)
        vulnerabilities.append(contentsOf: sqlInjectionIssues)

        // 2. XSS检测
        let xssIssues = try await scanForXSS(path: targetPath)
        vulnerabilities.append(contentsOf: xssIssues)

        // 3. 硬编码密钥检测
        let hardcodedSecretsIssues = try await scanForHardcodedSecrets(path: targetPath)
        vulnerabilities.append(contentsOf: hardcodedSecretsIssues)

        // 按严重程度分类
        let critical = vulnerabilities.filter { ($0["severity"] as? String) == "critical" }
        let high = vulnerabilities.filter { ($0["severity"] as? String) == "high" }
        let medium = vulnerabilities.filter { ($0["severity"] as? String) == "medium" }
        let low = vulnerabilities.filter { ($0["severity"] as? String) == "low" }

        return [
            "vulnerabilities": vulnerabilities,
            "total": vulnerabilities.count,
            "bySeverity": [
                "critical": critical.count,
                "high": high.count,
                "medium": medium.count,
                "low": low.count
            ],
            "scanType": scanType,
            "targetPath": targetPath,
            "timestamp": Date().timeIntervalSince1970
        ]
    }

    /// 扫描SQL注入
    private func scanForSQLInjection(path: String) async throws -> [[String: Any]] {
        var issues: [[String: Any]] = []

        // 扫描目标目录下的Swift文件
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(atPath: path) else {
            return issues
        }

        let sqlPatterns = [
            "\\\"SELECT.*\\+",
            "\\\"INSERT.*\\+",
            "\\\"UPDATE.*\\+",
            "\\\"DELETE.*\\+"
        ]

        while let file = enumerator.nextObject() as? String {
            guard file.hasSuffix(".swift") else { continue }

            let filePath = (path as NSString).appendingPathComponent(file)
            guard let content = try? String(contentsOfFile: filePath, encoding: .utf8) else { continue }

            for (lineNumber, line) in content.components(separatedBy: .newlines).enumerated() {
                for pattern in sqlPatterns {
                    if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                       regex.firstMatch(in: line, options: [], range: NSRange(line.startIndex..., in: line)) != nil {
                        issues.append([
                            "type": "SQL Injection",
                            "severity": "critical",
                            "file": file,
                            "line": lineNumber + 1,
                            "description": "潜在的SQL注入漏洞：直接拼接用户输入到SQL查询",
                            "recommendation": "使用参数化查询替代字符串拼接"
                        ])
                    }
                }
            }
        }

        return issues
    }

    /// 扫描XSS
    private func scanForXSS(path: String) async throws -> [[String: Any]] {
        var issues: [[String: Any]] = []

        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(atPath: path) else {
            return issues
        }

        // 检查WebView中的不安全内容加载
        let xssPatterns = [
            "loadHTMLString.*\\(",
            "evaluateJavaScript.*\\(",
            "WKUserContentController.*addUserScript"
        ]

        while let file = enumerator.nextObject() as? String {
            guard file.hasSuffix(".swift") else { continue }

            let filePath = (path as NSString).appendingPathComponent(file)
            guard let content = try? String(contentsOfFile: filePath, encoding: .utf8) else { continue }

            for (lineNumber, line) in content.components(separatedBy: .newlines).enumerated() {
                for pattern in xssPatterns {
                    if let regex = try? NSRegularExpression(pattern: pattern, options: []),
                       regex.firstMatch(in: line, options: [], range: NSRange(line.startIndex..., in: line)) != nil {
                        issues.append([
                            "type": "XSS",
                            "severity": "high",
                            "file": file,
                            "line": lineNumber + 1,
                            "description": "潜在的XSS漏洞：WebView加载动态内容",
                            "recommendation": "验证和转义所有用户输入后再加载到WebView"
                        ])
                    }
                }
            }
        }

        return issues
    }

    /// 扫描硬编码密钥
    private func scanForHardcodedSecrets(path: String) async throws -> [[String: Any]] {
        var issues: [[String: Any]] = []

        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(atPath: path) else {
            return issues
        }

        let secretPatterns = [
            ("password\\s*=\\s*\\\"[^\\\"]+\\\"", "密码"),
            ("apiKey\\s*=\\s*\\\"[^\\\"]+\\\"", "API密钥"),
            ("secret\\s*=\\s*\\\"[^\\\"]+\\\"", "密钥"),
            ("token\\s*=\\s*\\\"[^\\\"]+\\\"", "令牌"),
            ("privateKey\\s*=\\s*\\\"[^\\\"]+\\\"", "私钥")
        ]

        while let file = enumerator.nextObject() as? String {
            guard file.hasSuffix(".swift") && !file.contains("Test") else { continue }

            let filePath = (path as NSString).appendingPathComponent(file)
            guard let content = try? String(contentsOfFile: filePath, encoding: .utf8) else { continue }

            for (lineNumber, line) in content.components(separatedBy: .newlines).enumerated() {
                for (pattern, type) in secretPatterns {
                    if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                       regex.firstMatch(in: line, options: [], range: NSRange(line.startIndex..., in: line)) != nil {
                        issues.append([
                            "type": "Hardcoded Secret",
                            "severity": "critical",
                            "file": file,
                            "line": lineNumber + 1,
                            "description": "硬编码的\(type)",
                            "recommendation": "使用Keychain、环境变量或安全配置文件存储敏感信息"
                        ])
                    }
                }
            }
        }

        return issues
    }

    // MARK: - 代码安全审计

    /// 审计代码安全
    private func auditCodeSecurity(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "swift"

        // 使用LLM进行深度安全分析
        let prompt = """
        请对以下\(language)代码进行全面的安全审计：

        ```\(language)
        \(code)
        ```

        请检查：
        1. OWASP Top 10漏洞
        2. 输入验证问题
        3. 认证和授权缺陷
        4. 敏感数据暴露
        5. 安全配置错误
        6. 已知的不安全实践

        对每个发现的问题，请提供：
        - 问题描述
        - 严重程度（critical/high/medium/low）
        - 影响范围
        - 修复建议
        - 修复代码示例（如适用）
        """

        let auditResult = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个资深的应用安全专家，精通OWASP安全标准和各种安全最佳实践。"
        )

        return [
            "auditResult": auditResult,
            "language": language,
            "codeLength": code.count,
            "timestamp": Date().timeIntervalSince1970
        ]
    }

    /// 检查依赖安全
    private func checkDependencies(parameters: [String: Any]) async throws -> [String: Any] {
        guard let projectPath = parameters["projectPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少projectPath参数")
        }

        var vulnerableDeps: [[String: Any]] = []

        // 解析Package.swift
        let packagePath = (projectPath as NSString).appendingPathComponent("Package.swift")
        if FileManager.default.fileExists(atPath: packagePath),
           let content = try? String(contentsOfFile: packagePath, encoding: .utf8) {
            // 使用LLM分析依赖
            let prompt = """
            请分析以下Swift Package.swift文件中的依赖，检查是否有已知的安全漏洞：

            \(content)

            请列出可能存在安全问题的依赖及其CVE编号（如有）。
            """

            let analysis = try await generateWithLLM(
                prompt: prompt,
                systemPrompt: "你是一个软件安全专家，熟悉常见的开源依赖漏洞。"
            )

            // 解析分析结果
            if analysis.contains("CVE") || analysis.contains("漏洞") || analysis.contains("vulnerability") {
                vulnerableDeps.append([
                    "name": "详见分析结果",
                    "analysis": analysis,
                    "severity": "medium",
                    "description": "发现潜在的依赖安全问题"
                ])
            }
        }

        // 解析Podfile
        let podfilePath = (projectPath as NSString).appendingPathComponent("Podfile")
        if FileManager.default.fileExists(atPath: podfilePath) {
            vulnerableDeps.append([
                "note": "检测到Podfile，建议使用pod audit检查依赖安全"
            ])
        }

        return [
            "vulnerableDependencies": vulnerableDeps,
            "total": vulnerableDeps.count,
            "projectPath": projectPath
        ]
    }

    // MARK: - 加密解密（使用CryptoKit）

    /// 加密数据
    private func encryptData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? String,
              let password = parameters["password"] as? String else {
            throw AIEngineError.invalidParameters("缺少data或password参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "AES256-GCM"

        // 使用密码派生密钥
        let key = deriveKey(from: password)

        // 使用AES-GCM加密
        let plainData = Data(data.utf8)
        let sealedBox = try AES.GCM.seal(plainData, using: key)

        // 组合nonce + ciphertext + tag
        guard let combined = sealedBox.combined else {
            throw AIEngineError.executionFailed("加密失败")
        }

        let encrypted = combined.base64EncodedString()

        return [
            "encrypted": encrypted,
            "algorithm": algorithm,
            "originalLength": data.count,
            "encryptedLength": encrypted.count
        ]
    }

    /// 解密数据
    private func decryptData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let encryptedData = parameters["encryptedData"] as? String,
              let password = parameters["password"] as? String else {
            throw AIEngineError.invalidParameters("缺少encryptedData或password参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "AES256-GCM"

        // 使用密码派生密钥
        let key = deriveKey(from: password)

        // 解码Base64
        guard let combined = Data(base64Encoded: encryptedData) else {
            throw AIEngineError.executionFailed("无效的加密数据格式")
        }

        // 使用AES-GCM解密
        let sealedBox = try AES.GCM.SealedBox(combined: combined)
        let decryptedData = try AES.GCM.open(sealedBox, using: key)

        guard let decrypted = String(data: decryptedData, encoding: .utf8) else {
            throw AIEngineError.executionFailed("解密后的数据无法转换为字符串")
        }

        return [
            "decrypted": decrypted,
            "algorithm": algorithm
        ]
    }

    /// 从密码派生密钥
    private func deriveKey(from password: String) -> SymmetricKey {
        // 使用SHA256作为简单的密钥派生（生产环境应使用PBKDF2或Argon2）
        let passwordData = Data(password.utf8)
        let hash = SHA256.hash(data: passwordData)
        return SymmetricKey(data: hash)
    }

    /// 计算哈希
    private func calculateHash(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? String else {
            throw AIEngineError.invalidParameters("缺少data参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "SHA256"
        let inputData = Data(data.utf8)

        let hash: String
        switch algorithm.uppercased() {
        case "SHA256":
            let digest = SHA256.hash(data: inputData)
            hash = digest.compactMap { String(format: "%02x", $0) }.joined()

        case "SHA384":
            let digest = SHA384.hash(data: inputData)
            hash = digest.compactMap { String(format: "%02x", $0) }.joined()

        case "SHA512":
            let digest = SHA512.hash(data: inputData)
            hash = digest.compactMap { String(format: "%02x", $0) }.joined()

        case "MD5":
            // MD5已被弃用，但仍支持旧系统兼容
            let digest = Insecure.MD5.hash(data: inputData)
            hash = digest.compactMap { String(format: "%02x", $0) }.joined()

        default:
            throw AIEngineError.invalidParameters("不支持的哈希算法: \(algorithm)")
        }

        return [
            "hash": hash,
            "algorithm": algorithm,
            "inputLength": data.count
        ]
    }

    // MARK: - 密码安全

    /// 检查密码强度
    private func checkPasswordStrength(parameters: [String: Any]) async throws -> [String: Any] {
        guard let password = parameters["password"] as? String else {
            throw AIEngineError.invalidParameters("缺少password参数")
        }

        var score = 0
        var feedback: [String] = []

        // 长度检查
        if password.count >= 12 {
            score += 2
        } else if password.count >= 8 {
            score += 1
        } else {
            feedback.append("密码长度至少应为8个字符")
        }

        // 复杂度检查
        let hasUppercase = password.rangeOfCharacter(from: .uppercaseLetters) != nil
        let hasLowercase = password.rangeOfCharacter(from: .lowercaseLetters) != nil
        let hasNumbers = password.rangeOfCharacter(from: .decimalDigits) != nil
        let hasSpecialChars = password.rangeOfCharacter(from: CharacterSet(charactersIn: "!@#$%^&*()_+-=[]{}|;:,.<>?")) != nil

        if hasUppercase { score += 1 } else { feedback.append("建议添加大写字母") }
        if hasLowercase { score += 1 } else { feedback.append("建议添加小写字母") }
        if hasNumbers { score += 1 } else { feedback.append("建议添加数字") }
        if hasSpecialChars { score += 1 } else { feedback.append("建议添加特殊字符") }

        // 常见密码检查
        let commonPasswords = ["password", "123456", "admin", "welcome", "qwerty", "letmein"]
        if commonPasswords.contains(password.lowercased()) {
            score = 0
            feedback.append("这是一个常见的弱密码")
        }

        // 连续字符检查
        if containsConsecutiveChars(password) {
            score = max(0, score - 1)
            feedback.append("避免使用连续的字符（如123、abc）")
        }

        let strength: String
        if score >= 6 {
            strength = "strong"
        } else if score >= 4 {
            strength = "medium"
        } else {
            strength = "weak"
        }

        // 计算熵
        let entropy = calculatePasswordEntropy(password)

        return [
            "strength": strength,
            "score": score,
            "maxScore": 7,
            "entropy": entropy,
            "feedback": feedback
        ]
    }

    /// 检查是否包含连续字符
    private func containsConsecutiveChars(_ password: String) -> Bool {
        let sequences = ["0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba"]
        let lowercased = password.lowercased()

        for sequence in sequences {
            for i in 0..<(sequence.count - 2) {
                let start = sequence.index(sequence.startIndex, offsetBy: i)
                let end = sequence.index(start, offsetBy: 3)
                let substring = String(sequence[start..<end])

                if lowercased.contains(substring) {
                    return true
                }
            }
        }
        return false
    }

    /// 计算密码熵
    private func calculatePasswordEntropy(_ password: String) -> Double {
        var charsetSize = 0

        if password.rangeOfCharacter(from: .lowercaseLetters) != nil { charsetSize += 26 }
        if password.rangeOfCharacter(from: .uppercaseLetters) != nil { charsetSize += 26 }
        if password.rangeOfCharacter(from: .decimalDigits) != nil { charsetSize += 10 }
        if password.rangeOfCharacter(from: CharacterSet(charactersIn: "!@#$%^&*()_+-=[]{}|;:,.<>?")) != nil { charsetSize += 32 }

        guard charsetSize > 0 else { return 0 }

        let entropy = Double(password.count) * log2(Double(charsetSize))
        return round(entropy * 10) / 10
    }

    // MARK: - 敏感数据检测

    /// 检测敏感数据
    private func detectSensitiveData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        var detectedIssues: [[String: Any]] = []

        // 检测常见的敏感数据模式
        let patterns: [(String, String, String)] = [
            ("API.*Key.*[:=].*[\"'][^\"']+[\"']", "API密钥", "critical"),
            ("password.*[:=].*[\"'][^\"']+[\"']", "密码", "critical"),
            ("token.*[:=].*[\"'][^\"']+[\"']", "令牌", "high"),
            ("secret.*[:=].*[\"'][^\"']+[\"']", "密钥", "critical"),
            ("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}", "电子邮件", "medium"),
            ("\\b\\d{3}-\\d{2}-\\d{4}\\b", "社保号", "critical"),
            ("\\b(?:\\d{4}[- ]?){3}\\d{4}\\b", "信用卡号", "critical"),
            ("\\b1[3-9]\\d{9}\\b", "手机号", "medium"),
            ("\\b\\d{15,18}\\b", "身份证号", "critical")
        ]

        for (pattern, type, severity) in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let range = NSRange(content.startIndex..., in: content)
                let matches = regex.matches(in: content, options: [], range: range)

                for match in matches {
                    if let matchRange = Range(match.range, in: content) {
                        var matchedText = String(content[matchRange])

                        // 脱敏处理
                        if matchedText.count > 8 {
                            let startIndex = matchedText.index(matchedText.startIndex, offsetBy: 4)
                            let endIndex = matchedText.index(matchedText.endIndex, offsetBy: -4)
                            matchedText = String(matchedText[..<startIndex]) + "****" + String(matchedText[endIndex...])
                        }

                        detectedIssues.append([
                            "type": type,
                            "severity": severity,
                            "value": matchedText,
                            "position": match.range.location,
                            "length": match.range.length,
                            "recommendation": "请确保\(type)信息安全存储，避免在代码中硬编码"
                        ])
                    }
                }
            }
        }

        return [
            "issues": detectedIssues,
            "count": detectedIssues.count,
            "contentLength": content.count
        ]
    }

    // MARK: - 安全报告

    /// 生成安全报告
    private func generateSecurityReport(parameters: [String: Any]) async throws -> [String: Any] {
        guard let projectPath = parameters["projectPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少projectPath参数")
        }

        // 执行所有安全检查
        let vulnScan = try await scanVulnerabilities(parameters: ["targetPath": projectPath])
        let depCheck = try await checkDependencies(parameters: ["projectPath": projectPath])

        let totalVulnerabilities = vulnScan["total"] as? Int ?? 0
        let vulnerableDeps = depCheck["total"] as? Int ?? 0
        let bySeverity = vulnScan["bySeverity"] as? [String: Int] ?? [:]

        // 计算安全评分
        let criticalCount = bySeverity["critical"] ?? 0
        let highCount = bySeverity["high"] ?? 0
        let mediumCount = bySeverity["medium"] ?? 0
        let lowCount = bySeverity["low"] ?? 0

        var score = 100
        score -= criticalCount * 20
        score -= highCount * 10
        score -= mediumCount * 5
        score -= lowCount * 2
        score -= vulnerableDeps * 5
        score = max(0, min(100, score))

        let grade: String
        if score >= 90 {
            grade = "A"
        } else if score >= 80 {
            grade = "B"
        } else if score >= 70 {
            grade = "C"
        } else if score >= 60 {
            grade = "D"
        } else {
            grade = "F"
        }

        // 使用LLM生成报告摘要
        let prompt = """
        请为以下安全扫描结果生成执行摘要：

        扫描项目：\(projectPath)
        安全评分：\(score)/100 (等级: \(grade))
        总漏洞数：\(totalVulnerabilities)
        - 严重：\(criticalCount)
        - 高危：\(highCount)
        - 中危：\(mediumCount)
        - 低危：\(lowCount)
        脆弱依赖：\(vulnerableDeps)

        请提供：
        1. 总体安全状况评估
        2. 最关键的安全风险
        3. 优先修复建议
        4. 安全改进建议
        """

        let summary = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个安全分析专家，擅长总结安全扫描结果并提供实用建议。"
        )

        return [
            "score": score,
            "grade": grade,
            "summary": summary,
            "vulnerabilities": vulnScan,
            "dependencies": depCheck,
            "projectPath": projectPath,
            "timestamp": Date().timeIntervalSince1970
        ]
    }
}
