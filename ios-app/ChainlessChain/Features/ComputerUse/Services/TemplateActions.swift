//
//  TemplateActions.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Pre-built action templates
//  Adapted from: desktop-app-vue/src/main/browser/actions/template-actions.js
//

import Foundation
import WebKit

// MARK: - Template Definition

/// A pre-defined action template
public struct CUTemplate: Identifiable, Codable {
    public let id: String
    public let name: String
    public let description: String
    public let category: String
    public let parameters: [CUTemplateParam]
    public let steps: [CUTemplateStep]

    public init(
        id: String,
        name: String,
        description: String,
        category: String,
        parameters: [CUTemplateParam] = [],
        steps: [CUTemplateStep]
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.category = category
        self.parameters = parameters
        self.steps = steps
    }
}

/// Template parameter definition
public struct CUTemplateParam: Codable {
    public let name: String
    public let type: String // "string", "number", "boolean"
    public let description: String
    public let required: Bool
    public let defaultValue: String?

    public init(name: String, type: String, description: String, required: Bool = true, defaultValue: String? = nil) {
        self.name = name
        self.type = type
        self.description = description
        self.required = required
        self.defaultValue = defaultValue
    }
}

/// A step within a template
public struct CUTemplateStep: Codable {
    public let action: CUActionType
    public let params: [String: String] // Values can reference template params as ${paramName}
    public let delay: Double

    public init(action: CUActionType, params: [String: String], delay: Double = 500) {
        self.action = action
        self.params = params
        self.delay = delay
    }
}

// MARK: - TemplateActions

/// Manages and executes pre-built action templates
public class TemplateActions {
    public static let shared = TemplateActions()

    private var templates: [String: CUTemplate] = [:]
    private let auditLogger = CUAuditLogger.shared

    private init() {
        registerBuiltinTemplates()
        Logger.shared.info("[TemplateActions] Initialized with \(templates.count) templates")
    }

    // MARK: - Template Management

    /// Register a template
    public func register(_ template: CUTemplate) {
        templates[template.id] = template
    }

    /// Get a template by ID
    public func getTemplate(id: String) -> CUTemplate? {
        templates[id]
    }

    /// Get all templates
    public func getAllTemplates() -> [CUTemplate] {
        Array(templates.values).sorted { $0.name < $1.name }
    }

    /// Get templates by category
    public func getTemplates(category: String) -> [CUTemplate] {
        templates.values.filter { $0.category == category }.sorted { $0.name < $1.name }
    }

    // MARK: - Execute Template

    /// Execute a template with provided parameters
    @MainActor
    public func execute(
        templateId: String,
        params: [String: String],
        webView: WKWebView,
        agent: ComputerUseAgent
    ) async throws -> [ComputerUseResult] {
        guard let template = templates[templateId] else {
            throw CUTemplateError.templateNotFound(templateId)
        }

        // Validate required params
        for param in template.parameters where param.required {
            if params[param.name] == nil && param.defaultValue == nil {
                throw CUTemplateError.missingParameter(param.name)
            }
        }

        // Build effective params (merge defaults)
        var effectiveParams = params
        for param in template.parameters {
            if effectiveParams[param.name] == nil, let defaultVal = param.defaultValue {
                effectiveParams[param.name] = defaultVal
            }
        }

        var results: [ComputerUseResult] = []

        for step in template.steps {
            // Substitute params in step
            var resolvedParams: [String: AnyCodableValue] = [:]
            for (key, value) in step.params {
                resolvedParams[key] = .string(substituteParams(value, with: effectiveParams))
            }

            // Apply delay
            if step.delay > 0 {
                try await Task.sleep(nanoseconds: UInt64(step.delay * 1_000_000))
            }

            // Execute via agent
            let result = try await agent.execute(action: step.action, params: resolvedParams, webView: webView)
            results.append(result)

            if !result.success {
                Logger.shared.warning("[TemplateActions] Step failed in template '\(templateId)': \(result.error ?? "")")
                break
            }
        }

        auditLogger.log(
            action: .navigate,
            params: ["template": .string(templateId), "stepsCompleted": .int(results.count)],
            success: results.allSatisfy { $0.success },
            duration: results.reduce(0) { $0 + $1.duration }
        )

        return results
    }

    // MARK: - Variable Substitution

    /// Replace ${varName} placeholders with actual values
    private func substituteParams(_ template: String, with params: [String: String]) -> String {
        var result = template
        for (key, value) in params {
            result = result.replacingOccurrences(of: "${\(key)}", with: value)
        }
        return result
    }

    // MARK: - Built-in Templates

    private func registerBuiltinTemplates() {
        // Form fill
        register(CUTemplate(
            id: "form:fill",
            name: "Auto Fill Form",
            description: "Fill form fields by selector",
            category: "form",
            parameters: [
                CUTemplateParam(name: "selector", type: "string", description: "CSS selector for the input field"),
                CUTemplateParam(name: "value", type: "string", description: "Value to fill")
            ],
            steps: [
                CUTemplateStep(action: .click, params: ["selector": "${selector}"], delay: 300),
                CUTemplateStep(action: .type, params: ["text": "${value}"], delay: 200)
            ]
        ))

        // Login
        register(CUTemplate(
            id: "auth:login",
            name: "Login",
            description: "Fill username and password, then submit",
            category: "auth",
            parameters: [
                CUTemplateParam(name: "usernameSelector", type: "string", description: "Username field selector",
                                defaultValue: "input[name='username'],input[type='email']"),
                CUTemplateParam(name: "passwordSelector", type: "string", description: "Password field selector",
                                defaultValue: "input[name='password'],input[type='password']"),
                CUTemplateParam(name: "submitSelector", type: "string", description: "Submit button selector",
                                defaultValue: "button[type='submit']"),
                CUTemplateParam(name: "username", type: "string", description: "Username"),
                CUTemplateParam(name: "password", type: "string", description: "Password")
            ],
            steps: [
                CUTemplateStep(action: .click, params: ["selector": "${usernameSelector}"], delay: 500),
                CUTemplateStep(action: .type, params: ["text": "${username}"], delay: 300),
                CUTemplateStep(action: .click, params: ["selector": "${passwordSelector}"], delay: 300),
                CUTemplateStep(action: .type, params: ["text": "${password}"], delay: 300),
                CUTemplateStep(action: .click, params: ["selector": "${submitSelector}"], delay: 500)
            ]
        ))

        // Search
        register(CUTemplate(
            id: "search:query",
            name: "Search Query",
            description: "Type a query and submit search",
            category: "search",
            parameters: [
                CUTemplateParam(name: "selector", type: "string", description: "Search input selector",
                                defaultValue: "input[type='search'],input[name='q']"),
                CUTemplateParam(name: "query", type: "string", description: "Search query")
            ],
            steps: [
                CUTemplateStep(action: .click, params: ["selector": "${selector}"], delay: 300),
                CUTemplateStep(action: .type, params: ["text": "${query}"], delay: 200),
                CUTemplateStep(action: .key, params: ["key": "Enter"], delay: 500)
            ]
        ))

        // Screenshot
        register(CUTemplate(
            id: "utility:screenshot",
            name: "Take Screenshot",
            description: "Capture the current page",
            category: "utility",
            parameters: [],
            steps: [
                CUTemplateStep(action: .screenshot, params: [:], delay: 0)
            ]
        ))

        // Navigate and wait
        register(CUTemplate(
            id: "navigation:goto",
            name: "Navigate to URL",
            description: "Navigate to a URL and wait for load",
            category: "navigation",
            parameters: [
                CUTemplateParam(name: "url", type: "string", description: "Target URL"),
                CUTemplateParam(name: "waitMs", type: "number", description: "Wait time after navigation",
                                required: false, defaultValue: "2000")
            ],
            steps: [
                CUTemplateStep(action: .navigate, params: ["url": "${url}"], delay: 0),
                CUTemplateStep(action: .wait, params: ["duration": "${waitMs}"], delay: 0)
            ]
        ))

        // Scroll to bottom
        register(CUTemplate(
            id: "navigation:scrollToBottom",
            name: "Scroll to Bottom",
            description: "Scroll page to bottom in steps",
            category: "navigation",
            parameters: [
                CUTemplateParam(name: "steps", type: "number", description: "Number of scroll steps",
                                required: false, defaultValue: "5")
            ],
            steps: [
                CUTemplateStep(action: .scroll, params: ["x": "0", "y": "0", "deltaX": "0", "deltaY": "500"], delay: 800),
                CUTemplateStep(action: .scroll, params: ["x": "0", "y": "0", "deltaX": "0", "deltaY": "500"], delay: 800),
                CUTemplateStep(action: .scroll, params: ["x": "0", "y": "0", "deltaX": "0", "deltaY": "500"], delay: 800),
                CUTemplateStep(action: .scroll, params: ["x": "0", "y": "0", "deltaX": "0", "deltaY": "500"], delay: 800),
                CUTemplateStep(action: .scroll, params: ["x": "0", "y": "0", "deltaX": "0", "deltaY": "500"], delay: 800)
            ]
        ))
    }
}

// MARK: - Errors

enum CUTemplateError: LocalizedError {
    case templateNotFound(String)
    case missingParameter(String)

    var errorDescription: String? {
        switch self {
        case .templateNotFound(let id): return "Template not found: \(id)"
        case .missingParameter(let name): return "Missing required parameter: \(name)"
        }
    }
}
