import Foundation

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
        // 简化实现：扫描常见的SQL注入模式
        let patterns = [
            "SELECT.*FROM.*WHERE.*\\+",
            "INSERT.*INTO.*VALUES.*\\+",
            "UPDATE.*SET.*WHERE.*\\+",
            "DELETE.*FROM.*WHERE.*\\+"
        ]

        var issues: [[String: Any]] = []

        // TODO: 实际扫描文件
        // 这里返回模拟数据
        if Bool.random() {
            issues.append([
                "type": "SQL Injection",
                "severity": "critical",
                "file": "\(path)/UserController.swift",
                "line": 45,
                "description": "潜在的SQL注入漏洞：直接拼接用户输入到SQL查询"
            ])
        }

        return issues
    }

    /// 扫描XSS
    private func scanForXSS(path: String) async throws -> [[String: Any]] {
        var issues: [[String: Any]] = []

        // TODO: 扫描XSS漏洞
        if Bool.random() {
            issues.append([
                "type": "XSS",
                "severity": "high",
                "file": "\(path)/CommentView.swift",
                "line": 78,
                "description": "未转义的用户输入直接渲染到HTML"
            ])
        }

        return issues
    }

    /// 扫描硬编码密钥
    private func scanForHardcodedSecrets(path: String) async throws -> [[String: Any]] {
        let patterns = [
            "password\\s*=\\s*[\"'][^\"']+[\"']",
            "api_key\\s*=\\s*[\"'][^\"']+[\"']",
            "secret\\s*=\\s*[\"'][^\"']+[\"']",
            "token\\s*=\\s*[\"'][^\"']+[\"']"
        ]

        var issues: [[String: Any]] = []

        // TODO: 实际扫描
        if Bool.random() {
            issues.append([
                "type": "Hardcoded Secret",
                "severity": "critical",
                "file": "\(path)/Config.swift",
                "line": 12,
                "description": "硬编码的API密钥或密码"
            ])
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

        // TODO: 解析Package.swift, Podfile等依赖文件
        // 检查已知漏洞数据库（如CVE数据库）

        let mockVulnerableDeps: [[String: Any]] = [
            [
                "name": "Alamofire",
                "version": "4.5.0",
                "vulnerability": "CVE-2020-1234",
                "severity": "high",
                "recommendedVersion": "5.4.0",
                "description": "存在安全漏洞，建议升级"
            ]
        ]

        return [
            "vulnerableDependencies": mockVulnerableDeps,
            "total": mockVulnerableDeps.count,
            "projectPath": projectPath
        ]
    }

    // MARK: - 加密解密

    /// 加密数据
    private func encryptData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? String,
              let key = parameters["key"] as? String else {
            throw AIEngineError.invalidParameters("缺少data或key参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "AES256" // AES256, RSA

        // TODO: 实际加密实现
        // 使用CryptoKit或CommonCrypto

        let mockEncrypted = Data(data.utf8).base64EncodedString()

        return [
            "encrypted": mockEncrypted,
            "algorithm": algorithm,
            "originalLength": data.count,
            "encryptedLength": mockEncrypted.count
        ]
    }

    /// 解密数据
    private func decryptData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let encryptedData = parameters["encryptedData"] as? String,
              let key = parameters["key"] as? String else {
            throw AIEngineError.invalidParameters("缺少encryptedData或key参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "AES256"

        // TODO: 实际解密实现

        guard let decodedData = Data(base64Encoded: encryptedData),
              let decrypted = String(data: decodedData, encoding: .utf8) else {
            throw AIEngineError.executionFailed("解密失败")
        }

        return [
            "decrypted": decrypted,
            "algorithm": algorithm
        ]
    }

    /// 计算哈希
    private func calculateHash(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? String else {
            throw AIEngineError.invalidParameters("缺少data参数")
        }

        let algorithm = parameters["algorithm"] as? String ?? "SHA256" // MD5, SHA1, SHA256, SHA512

        // TODO: 使用CryptoKit计算实际哈希
        // 这里返回模拟值
        let mockHash = "0x\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"

        return [
            "hash": mockHash,
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
        let commonPasswords = ["password", "123456", "admin", "welcome"]
        if commonPasswords.contains(password.lowercased()) {
            score = 0
            feedback.append("这是一个常见的弱密码")
        }

        let strength: String
        if score >= 6 {
            strength = "strong"
        } else if score >= 4 {
            strength = "medium"
        } else {
            strength = "weak"
        }

        return [
            "strength": strength,
            "score": score,
            "maxScore": 7,
            "feedback": feedback
        ]
    }

    // MARK: - 敏感数据检测

    /// 检测敏感数据
    private func detectSensitiveData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        var detectedIssues: [[String: Any]] = []

        // 检测常见的敏感数据模式
        let patterns: [(String, String)] = [
            ("API.*Key.*[:=].*[\"'][^\"']+[\"']", "API密钥"),
            ("password.*[:=].*[\"'][^\"']+[\"']", "密码"),
            ("token.*[:=].*[\"'][^\"']+[\"']", "令牌"),
            ("secret.*[:=].*[\"'][^\"']+[\"']", "密钥"),
            ("\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", "电子邮件"),
            ("\\b\\d{3}-\\d{2}-\\d{4}\\b", "社保号"),
            ("\\b\\d{16}\\b", "信用卡号")
        ]

        for (pattern, type) in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let range = NSRange(content.startIndex..., in: content)
                let matches = regex.matches(in: content, options: [], range: range)

                for match in matches {
                    if let matchRange = Range(match.range, in: content) {
                        let matchedText = String(content[matchRange])
                        detectedIssues.append([
                            "type": type,
                            "value": matchedText,
                            "position": match.range.location,
                            "length": match.range.length
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
