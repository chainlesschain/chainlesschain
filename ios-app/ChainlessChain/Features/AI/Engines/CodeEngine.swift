import Foundation

/// 代码引擎
///
/// 负责代码生成、分析、重构、测试等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/code-engine.js
public class CodeEngine: BaseAIEngine {

    public static let shared = CodeEngine()

    // 支持的编程语言
    public enum ProgrammingLanguage: String, CaseIterable {
        case swift = "swift"
        case python = "python"
        case javascript = "javascript"
        case typescript = "typescript"
        case java = "java"
        case kotlin = "kotlin"
        case go = "go"
        case rust = "rust"
        case c = "c"
        case cpp = "cpp"
        case csharp = "csharp"
        case ruby = "ruby"
        case php = "php"
        case sql = "sql"
        case html = "html"
        case css = "css"

        var displayName: String {
            switch self {
            case .swift: return "Swift"
            case .python: return "Python"
            case .javascript: return "JavaScript"
            case .typescript: return "TypeScript"
            case .java: return "Java"
            case .kotlin: return "Kotlin"
            case .go: return "Go"
            case .rust: return "Rust"
            case .c: return "C"
            case .cpp: return "C++"
            case .csharp: return "C#"
            case .ruby: return "Ruby"
            case .php: return "PHP"
            case .sql: return "SQL"
            case .html: return "HTML"
            case .css: return "CSS"
            }
        }

        var fileExtension: String {
            switch self {
            case .swift: return ".swift"
            case .python: return ".py"
            case .javascript: return ".js"
            case .typescript: return ".ts"
            case .java: return ".java"
            case .kotlin: return ".kt"
            case .go: return ".go"
            case .rust: return ".rs"
            case .c: return ".c"
            case .cpp: return ".cpp"
            case .csharp: return ".cs"
            case .ruby: return ".rb"
            case .php: return ".php"
            case .sql: return ".sql"
            case .html: return ".html"
            case .css: return ".css"
            }
        }
    }

    // 代码复杂度级别
    public enum ComplexityLevel: String {
        case simple = "simple"
        case moderate = "moderate"
        case complex = "complex"
    }

    private init() {
        super.init(
            type: .code,
            name: "代码引擎",
            description: "处理代码生成、分析、重构、测试等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "generate",
                name: "代码生成",
                description: "根据需求描述生成代码"
            ),
            AIEngineCapability(
                id: "explain",
                name: "代码解释",
                description: "解释代码的功能和实现逻辑"
            ),
            AIEngineCapability(
                id: "review",
                name: "代码审查",
                description: "审查代码质量并提供改进建议"
            ),
            AIEngineCapability(
                id: "refactor",
                name: "代码重构",
                description: "优化代码结构和性能"
            ),
            AIEngineCapability(
                id: "test",
                name: "测试生成",
                description: "生成单元测试代码"
            ),
            AIEngineCapability(
                id: "document",
                name: "文档生成",
                description: "生成代码文档和注释"
            ),
            AIEngineCapability(
                id: "bug_fix",
                name: "Bug修复",
                description: "诊断和修复代码中的Bug"
            ),
            AIEngineCapability(
                id: "convert",
                name: "语言转换",
                description: "在不同编程语言间转换代码"
            ),
            AIEngineCapability(
                id: "complexity_analysis",
                name: "复杂度分析",
                description: "分析代码的时间和空间复杂度"
            ),
            AIEngineCapability(
                id: "security_audit",
                name: "安全审计",
                description: "检测代码中的安全漏洞"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 注册代码相关的技能和工具
        Logger.shared.info("代码引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("代码引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "generate":
            return try await generateCode(parameters: parameters)

        case "explain":
            return try await explainCode(parameters: parameters)

        case "review":
            return try await reviewCode(parameters: parameters)

        case "refactor":
            return try await refactorCode(parameters: parameters)

        case "test":
            return try await generateTests(parameters: parameters)

        case "document":
            return try await generateDocumentation(parameters: parameters)

        case "bug_fix":
            return try await fixBug(parameters: parameters)

        case "convert":
            return try await convertLanguage(parameters: parameters)

        case "complexity":
            return try await analyzeComplexity(parameters: parameters)

        case "security":
            return try await auditSecurity(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 代码生成

    /// 生成代码
    private func generateCode(parameters: [String: Any]) async throws -> [String: Any] {
        guard let description = parameters["description"] as? String else {
            throw AIEngineError.invalidParameters("缺少description参数")
        }

        let language = parameters["language"] as? String ?? "swift"
        let style = parameters["style"] as? String ?? "clean" // clean, minimal, verbose
        let includeComments = parameters["includeComments"] as? Bool ?? true
        let includeTests = parameters["includeTests"] as? Bool ?? false

        // 构建提示词
        let prompt = """
        请用\(language)语言实现以下功能：

        需求描述：
        \(description)

        要求：
        - 代码风格：\(style)
        - \(includeComments ? "包含详细注释" : "无需注释")
        - 遵循\(language)最佳实践
        - 代码清晰易读
        - 考虑边界情况和错误处理

        请只返回代码，不要包含解释性文字。
        """

        let code = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个专业的\(language)开发者，擅长编写高质量、可维护的代码。"
        )

        // 清理代码（移除markdown代码块标记）
        let cleanedCode = cleanCodeOutput(code)

        var result: [String: Any] = [
            "code": cleanedCode,
            "language": language,
            "linesOfCode": cleanedCode.components(separatedBy: .newlines).count
        ]

        // 如果需要测试，生成测试代码
        if includeTests {
            let testCode = try await generateTestsForCode(
                code: cleanedCode,
                language: language
            )
            result["testCode"] = testCode
        }

        return result
    }

    // MARK: - 代码解释

    /// 解释代码
    private func explainCode(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"
        let detail = parameters["detail"] as? String ?? "moderate" // brief, moderate, detailed

        let detailInstruction: String
        switch detail {
        case "brief":
            detailInstruction = "用1-2句话简要说明代码功能"
        case "detailed":
            detailInstruction = "详细解释每个函数、每行代码的作用和实现逻辑"
        default:
            detailInstruction = "解释代码的主要功能、关键逻辑和实现方式"
        }

        let prompt = """
        请解释以下\(language)代码：

        ```\(language)
        \(code)
        ```

        要求：
        - \(detailInstruction)
        - 说明代码的时间和空间复杂度
        - 指出可能的优化点
        """

        let explanation = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个代码分析专家，擅长用通俗易懂的语言解释复杂的代码逻辑。"
        )

        return [
            "explanation": explanation,
            "language": language,
            "codeLength": code.count
        ]
    }

    // MARK: - 代码审查

    /// 审查代码
    private func reviewCode(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"
        let focusAreas = parameters["focusAreas"] as? [String] ?? [
            "性能", "可读性", "安全性", "最佳实践"
        ]

        let prompt = """
        请审查以下\(language)代码并提供改进建议：

        ```\(language)
        \(code)
        ```

        审查重点：
        \(focusAreas.map { "- \($0)" }.joined(separator: "\n"))

        请提供：
        1. 代码质量评分（0-10分）
        2. 发现的问题清单（按严重程度排序）
        3. 具体的改进建议
        4. 改进后的代码示例（如果需要）
        """

        let review = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个资深的代码审查专家，擅长发现代码中的潜在问题并提供建设性的改进建议。"
        )

        // 解析审查结果（简化实现）
        let issues = extractIssues(from: review)

        return [
            "review": review,
            "issues": issues,
            "language": language,
            "focusAreas": focusAreas
        ]
    }

    // MARK: - 代码重构

    /// 重构代码
    private func refactorCode(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"
        let goals = parameters["goals"] as? [String] ?? ["可读性", "性能", "可维护性"]

        let prompt = """
        请重构以下\(language)代码：

        原始代码：
        ```\(language)
        \(code)
        ```

        重构目标：
        \(goals.map { "- \($0)" }.joined(separator: "\n"))

        要求：
        1. 保持功能不变
        2. 改进代码结构
        3. 提高代码质量
        4. 添加必要的注释
        5. 遵循设计模式和最佳实践

        请提供重构后的代码和改进说明。
        """

        let response = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个代码重构专家，擅长优化代码结构和提高代码质量。"
        )

        // 提取重构后的代码
        let refactoredCode = extractCode(from: response, language: language)

        return [
            "originalCode": code,
            "refactoredCode": refactoredCode,
            "explanation": response,
            "language": language,
            "goals": goals
        ]
    }

    // MARK: - 测试生成

    /// 生成测试代码
    private func generateTests(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "swift"
        let framework = parameters["framework"] as? String ?? "XCTest"
        let coverage = parameters["coverage"] as? String ?? "comprehensive" // basic, comprehensive

        let testCode = try await generateTestsForCode(
            code: code,
            language: language,
            framework: framework,
            coverage: coverage
        )

        return [
            "testCode": testCode,
            "language": language,
            "framework": framework,
            "coverage": coverage
        ]
    }

    /// 为代码生成测试
    private func generateTestsForCode(
        code: String,
        language: String,
        framework: String = "XCTest",
        coverage: String = "comprehensive"
    ) async throws -> String {
        let prompt = """
        请为以下\(language)代码生成\(framework)单元测试：

        ```\(language)
        \(code)
        ```

        测试要求：
        - 覆盖度：\(coverage)
        - 测试正常情况
        - 测试边界情况
        - 测试错误处理
        - 使用清晰的测试命名
        - 添加必要的测试注释

        请只返回测试代码。
        """

        let testCode = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个测试专家，擅长编写全面的单元测试。"
        )

        return cleanCodeOutput(testCode)
    }

    // MARK: - 文档生成

    /// 生成文档
    private func generateDocumentation(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"
        let format = parameters["format"] as? String ?? "markdown" // markdown, javadoc, inline

        let prompt = """
        请为以下\(language)代码生成\(format)格式的文档：

        ```\(language)
        \(code)
        ```

        文档要求：
        - 描述功能和用途
        - 说明参数和返回值
        - 提供使用示例
        - 注明注意事项
        - 包含复杂度分析

        \(format == "inline" ? "请生成可以直接插入代码中的注释" : "请生成独立的文档")
        """

        let documentation = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个技术文档专家，擅长编写清晰、准确的API文档。"
        )

        return [
            "documentation": documentation,
            "format": format,
            "language": language
        ]
    }

    // MARK: - Bug修复

    /// 修复Bug
    private func fixBug(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"
        let bugDescription = parameters["bugDescription"] as? String
        let errorMessage = parameters["errorMessage"] as? String

        var bugInfo = ""
        if let description = bugDescription {
            bugInfo += "\nBug描述：\(description)"
        }
        if let error = errorMessage {
            bugInfo += "\n错误信息：\(error)"
        }

        let prompt = """
        请诊断并修复以下\(language)代码中的Bug：

        代码：
        ```\(language)
        \(code)
        ```
        \(bugInfo)

        请提供：
        1. Bug原因分析
        2. 修复后的代码
        3. 修复说明
        4. 如何避免类似问题的建议
        """

        let response = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个Bug诊断专家，擅长快速定位和修复代码问题。"
        )

        // 提取修复后的代码
        let fixedCode = extractCode(from: response, language: language)

        return [
            "originalCode": code,
            "fixedCode": fixedCode,
            "analysis": response,
            "language": language
        ]
    }

    // MARK: - 语言转换

    /// 转换编程语言
    private func convertLanguage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String,
              let fromLanguage = parameters["from"] as? String,
              let toLanguage = parameters["to"] as? String else {
            throw AIEngineError.invalidParameters("缺少code、from或to参数")
        }

        let prompt = """
        请将以下\(fromLanguage)代码转换为\(toLanguage)：

        ```\(fromLanguage)
        \(code)
        ```

        转换要求：
        - 保持功能完全一致
        - 使用\(toLanguage)的惯用写法
        - 遵循\(toLanguage)最佳实践
        - 添加必要的注释说明差异
        - 确保类型安全
        """

        let convertedCode = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个多语言开发专家，精通各种编程语言之间的转换。"
        )

        return [
            "originalCode": code,
            "convertedCode": cleanCodeOutput(convertedCode),
            "fromLanguage": fromLanguage,
            "toLanguage": toLanguage
        ]
    }

    // MARK: - 复杂度分析

    /// 分析代码复杂度
    private func analyzeComplexity(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"

        let prompt = """
        请分析以下\(language)代码的复杂度：

        ```\(language)
        \(code)
        ```

        请提供：
        1. 时间复杂度（Big O表示法）
        2. 空间复杂度（Big O表示法）
        3. 循环复杂度（McCabe复杂度）
        4. 复杂度分析说明
        5. 性能优化建议
        """

        let analysis = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个算法复杂度分析专家，擅长精确评估代码的性能特征。"
        )

        // 简单的复杂度级别判断（基于代码长度和嵌套）
        let level = estimateComplexityLevel(code: code)

        return [
            "analysis": analysis,
            "complexityLevel": level.rawValue,
            "language": language,
            "linesOfCode": code.components(separatedBy: .newlines).count
        ]
    }

    // MARK: - 安全审计

    /// 安全审计
    private func auditSecurity(parameters: [String: Any]) async throws -> [String: Any] {
        guard let code = parameters["code"] as? String else {
            throw AIEngineError.invalidParameters("缺少code参数")
        }

        let language = parameters["language"] as? String ?? "auto"

        let prompt = """
        请对以下\(language)代码进行安全审计：

        ```\(language)
        \(code)
        ```

        检查项目：
        - SQL注入风险
        - XSS跨站脚本攻击
        - CSRF跨站请求伪造
        - 不安全的密码存储
        - 敏感信息泄露
        - 不安全的随机数生成
        - 权限控制缺陷
        - 其他OWASP Top 10漏洞

        请提供：
        1. 安全风险等级（低/中/高/严重）
        2. 发现的安全问题清单
        3. 修复建议
        4. 修复后的安全代码示例
        """

        let auditResult = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个应用安全专家，擅长发现和修复代码中的安全漏洞。"
        )

        // 提取风险级别（简化实现）
        let riskLevel = extractRiskLevel(from: auditResult)

        return [
            "auditResult": auditResult,
            "riskLevel": riskLevel,
            "language": language,
            "timestamp": Date().timeIntervalSince1970
        ]
    }

    // MARK: - 辅助方法

    /// 清理LLM输出的代码（移除markdown标记）
    private func cleanCodeOutput(_ output: String) -> String {
        var cleaned = output.trimmingCharacters(in: .whitespacesAndNewlines)

        // 移除代码块标记
        let patterns = [
            "^```[a-z]*\\n",  // 开始标记
            "\\n```$"         // 结束标记
        ]

        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
                let range = NSRange(cleaned.startIndex..., in: cleaned)
                cleaned = regex.stringByReplacingMatches(
                    in: cleaned,
                    options: [],
                    range: range,
                    withTemplate: ""
                )
            }
        }

        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 从响应中提取代码
    private func extractCode(from response: String, language: String) -> String {
        // 尝试提取代码块
        let pattern = "```\(language)\\n([\\s\\S]*?)\\n```"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(response.startIndex..., in: response)
            if let match = regex.firstMatch(in: response, options: [], range: range),
               let codeRange = Range(match.range(at: 1), in: response) {
                return String(response[codeRange])
            }
        }

        // 如果没有找到代码块，返回清理后的完整响应
        return cleanCodeOutput(response)
    }

    /// 从审查结果中提取问题列表
    private func extractIssues(from review: String) -> [[String: String]] {
        // 简化实现：返回空数组
        // 实际应用中需要更复杂的解析逻辑
        return []
    }

    /// 估算代码复杂度级别
    private func estimateComplexityLevel(code: String) -> ComplexityLevel {
        let lines = code.components(separatedBy: .newlines).count

        // 统计嵌套层级（通过大括号）
        var maxNesting = 0
        var currentNesting = 0

        for char in code {
            if char == "{" {
                currentNesting += 1
                maxNesting = max(maxNesting, currentNesting)
            } else if char == "}" {
                currentNesting -= 1
            }
        }

        // 简单的复杂度判断
        if lines < 20 && maxNesting < 3 {
            return .simple
        } else if lines < 100 && maxNesting < 5 {
            return .moderate
        } else {
            return .complex
        }
    }

    /// 从审计结果中提取风险级别
    private func extractRiskLevel(from audit: String) -> String {
        let lowerAudit = audit.lowercased()

        if lowerAudit.contains("严重") || lowerAudit.contains("critical") {
            return "critical"
        } else if lowerAudit.contains("高") || lowerAudit.contains("high") {
            return "high"
        } else if lowerAudit.contains("中") || lowerAudit.contains("medium") {
            return "medium"
        } else {
            return "low"
        }
    }
}
