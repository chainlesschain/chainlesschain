//
//  HookScriptExecutor.swift
//  ChainlessChain
//
//  钩子脚本执行器
//  执行JavaScript、Python、Bash脚本
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import JavaScriptCore
import CoreCommon

// MARK: - Hook Script Executor

/// 钩子脚本执行器
public class HookScriptExecutor {
    public static let shared = HookScriptExecutor()

    // MARK: - Properties

    private let jsContext: JSContext
    private let maxExecutionTime: TimeInterval = 30

    // MARK: - Initialization

    private init() {
        jsContext = JSContext()
        setupJavaScriptEnvironment()
        Logger.shared.info("[HookScriptExecutor] 初始化完成")
    }

    // MARK: - Public Methods

    /// 执行脚本
    public func executeScript(
        script: String,
        language: ScriptLanguage,
        context: HookContext
    ) async throws -> HookResponse {
        Logger.shared.debug("[HookScriptExecutor] 执行\(language.displayName)脚本")

        switch language {
        case .javascript:
            return try await executeJavaScript(script, context: context)
        case .python:
            return try await executePython(script, context: context)
        case .bash:
            return try await executeBash(script, context: context)
        }
    }

    /// 执行脚本文件
    public func executeScriptFile(
        path: String,
        context: HookContext
    ) async throws -> HookResponse {
        let url = URL(fileURLWithPath: path)
        let script = try String(contentsOf: url, encoding: .utf8)

        let language: ScriptLanguage
        switch url.pathExtension.lowercased() {
        case "js": language = .javascript
        case "py": language = .python
        case "sh": language = .bash
        default:
            throw HookExecutorError.unsupportedLanguage(url.pathExtension)
        }

        return try await executeScript(script: script, language: language, context: context)
    }

    /// 验证脚本语法
    public func validateScript(script: String, language: ScriptLanguage) -> ValidationResult {
        switch language {
        case .javascript:
            return validateJavaScript(script)
        case .python:
            return validatePython(script)
        case .bash:
            return validateBash(script)
        }
    }

    // MARK: - JavaScript Execution

    private func setupJavaScriptEnvironment() {
        // 设置异常处理
        jsContext.exceptionHandler = { [weak self] context, exception in
            if let error = exception?.toString() {
                Logger.shared.error("[HookScriptExecutor] JS异常: \(error)")
            }
        }

        // 添加console对象
        let consoleLog: @convention(block) (String) -> Void = { message in
            Logger.shared.debug("[HookScript] \(message)")
        }

        let consoleError: @convention(block) (String) -> Void = { message in
            Logger.shared.error("[HookScript] \(message)")
        }

        let console = JSValue(newObjectIn: jsContext)
        console?.setValue(unsafeBitCast(consoleLog, to: JSValue.self), forProperty: "log")
        console?.setValue(unsafeBitCast(consoleError, to: JSValue.self), forProperty: "error")
        jsContext.setObject(console, forKeyedSubscript: "console" as NSString)

        // 添加常用工具函数
        jsContext.evaluateScript("""
            function JSON_stringify(obj) { return JSON.stringify(obj); }
            function JSON_parse(str) { return JSON.parse(str); }
        """)
    }

    private func executeJavaScript(_ script: String, context: HookContext) async throws -> HookResponse {
        // 准备上下文数据
        let contextData = try JSONEncoder().encode(context)
        let contextJson = String(data: contextData, encoding: .utf8) ?? "{}"

        // 构建执行脚本
        let wrappedScript = """
        (function() {
            var hookContext = \(contextJson);
            var result = { action: 'continue', data: null, message: null };

            try {
                \(script)
            } catch (e) {
                result.action = 'error';
                result.message = e.toString();
            }

            return JSON.stringify(result);
        })();
        """

        // 执行
        guard let jsResult = jsContext.evaluateScript(wrappedScript),
              let resultString = jsResult.toString(),
              let resultData = resultString.data(using: .utf8) else {
            throw HookExecutorError.executionFailed("JavaScript执行失败")
        }

        // 解析结果
        let response = try JSONDecoder().decode(ScriptResult.self, from: resultData)

        return HookResponse(
            action: HookResult(rawValue: response.action) ?? .continue,
            data: response.data,
            message: response.message
        )
    }

    private func validateJavaScript(_ script: String) -> ValidationResult {
        let testScript = "(function() { \(script) })"

        jsContext.evaluateScript(testScript)

        if let exception = jsContext.exception {
            return ValidationResult(
                isValid: false,
                errors: [exception.toString() ?? "语法错误"]
            )
        }

        return ValidationResult(isValid: true, errors: [])
    }

    // MARK: - Python Execution

    private func executePython(_ script: String, context: HookContext) async throws -> HookResponse {
        // 准备上下文数据
        let contextData = try JSONEncoder().encode(context)
        let contextJson = String(data: contextData, encoding: .utf8) ?? "{}"

        // 创建临时脚本文件
        let tempDir = FileManager.default.temporaryDirectory
        let scriptFile = tempDir.appendingPathComponent("hook_script_\(UUID().uuidString).py")
        let resultFile = tempDir.appendingPathComponent("hook_result_\(UUID().uuidString).json")

        defer {
            try? FileManager.default.removeItem(at: scriptFile)
            try? FileManager.default.removeItem(at: resultFile)
        }

        // 构建Python脚本
        let wrappedScript = """
        import json
        import sys

        hook_context = json.loads('''\(contextJson)''')
        result = {'action': 'continue', 'data': None, 'message': None}

        try:
            \(script.components(separatedBy: "\n").map { "    " + $0 }.joined(separator: "\n"))
        except Exception as e:
            result['action'] = 'error'
            result['message'] = str(e)

        with open('\(resultFile.path)', 'w') as f:
            json.dump(result, f)
        """

        try wrappedScript.write(to: scriptFile, atomically: true, encoding: .utf8)

        // 执行Python
        let output = try await runProcess(
            executable: "/usr/bin/python3",
            arguments: [scriptFile.path],
            timeout: maxExecutionTime
        )

        // 读取结果
        guard FileManager.default.fileExists(atPath: resultFile.path),
              let resultData = FileManager.default.contents(atPath: resultFile.path) else {
            throw HookExecutorError.executionFailed(output)
        }

        let response = try JSONDecoder().decode(ScriptResult.self, from: resultData)

        return HookResponse(
            action: HookResult(rawValue: response.action) ?? .continue,
            data: response.data,
            message: response.message
        )
    }

    private func validatePython(_ script: String) -> ValidationResult {
        // 基本语法检查
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-m", "py_compile", "-"]

        let inputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardInput = inputPipe
        process.standardError = errorPipe

        do {
            try process.run()
            inputPipe.fileHandleForWriting.write(script.data(using: .utf8) ?? Data())
            inputPipe.fileHandleForWriting.closeFile()
            process.waitUntilExit()

            if process.terminationStatus != 0 {
                let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let error = String(data: errorData, encoding: .utf8) ?? "语法错误"
                return ValidationResult(isValid: false, errors: [error])
            }

            return ValidationResult(isValid: true, errors: [])
        } catch {
            return ValidationResult(isValid: false, errors: [error.localizedDescription])
        }
    }

    // MARK: - Bash Execution

    private func executeBash(_ script: String, context: HookContext) async throws -> HookResponse {
        // 准备环境变量
        var environment = ProcessInfo.processInfo.environment
        environment["HOOK_EVENT"] = context.event
        environment["HOOK_DATA"] = try? String(data: JSONEncoder().encode(context.data), encoding: .utf8)

        // 执行
        let output = try await runProcess(
            executable: "/bin/bash",
            arguments: ["-c", script],
            environment: environment,
            timeout: maxExecutionTime
        )

        // 解析输出
        // 约定：脚本通过输出JSON来返回结果
        if let jsonStart = output.range(of: "{"),
           let jsonEnd = output.range(of: "}", options: .backwards),
           let resultData = String(output[jsonStart.lowerBound...jsonEnd.upperBound]).data(using: .utf8) {
            do {
                let response = try JSONDecoder().decode(ScriptResult.self, from: resultData)
                return HookResponse(
                    action: HookResult(rawValue: response.action) ?? .continue,
                    data: response.data,
                    message: response.message
                )
            } catch {
                // 无法解析JSON，继续执行
            }
        }

        // 默认返回继续
        return HookResponse(action: .continue, data: nil, message: output.isEmpty ? nil : output)
    }

    private func validateBash(_ script: String) -> ValidationResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-n", "-c", script]

        let errorPipe = Pipe()
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus != 0 {
                let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let error = String(data: errorData, encoding: .utf8) ?? "语法错误"
                return ValidationResult(isValid: false, errors: [error])
            }

            return ValidationResult(isValid: true, errors: [])
        } catch {
            return ValidationResult(isValid: false, errors: [error.localizedDescription])
        }
    }

    // MARK: - Process Execution

    private func runProcess(
        executable: String,
        arguments: [String],
        environment: [String: String]? = nil,
        timeout: TimeInterval
    ) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        if let env = environment {
            process.environment = env
        }

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()

        // 超时控制
        let timeoutTask = Task {
            try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            if process.isRunning {
                process.terminate()
            }
        }

        process.waitUntilExit()
        timeoutTask.cancel()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()

        let output = String(data: outputData, encoding: .utf8) ?? ""
        let error = String(data: errorData, encoding: .utf8) ?? ""

        if process.terminationStatus != 0 && !error.isEmpty {
            throw HookExecutorError.executionFailed(error)
        }

        return output
    }
}

// MARK: - Supporting Types

/// 钩子上下文
public struct HookContext: Codable {
    public let event: String
    public let timestamp: Date
    public var data: [String: AnyCodable]

    public init(
        event: String,
        timestamp: Date = Date(),
        data: [String: AnyCodable] = [:]
    ) {
        self.event = event
        self.timestamp = timestamp
        self.data = data
    }
}

/// 钩子响应
public struct HookResponse {
    public let action: HookResult
    public let data: [String: Any]?
    public let message: String?

    public init(
        action: HookResult,
        data: [String: Any]? = nil,
        message: String? = nil
    ) {
        self.action = action
        self.data = data
        self.message = message
    }
}

/// 脚本结果
private struct ScriptResult: Codable {
    let action: String
    let data: [String: AnyCodable]?
    let message: String?
}

/// 验证结果
public struct ValidationResult {
    public let isValid: Bool
    public let errors: [String]
}

/// 执行器错误
public enum HookExecutorError: Error, LocalizedError {
    case unsupportedLanguage(String)
    case executionFailed(String)
    case timeout
    case scriptNotFound(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedLanguage(let lang):
            return "不支持的脚本语言: \(lang)"
        case .executionFailed(let message):
            return "执行失败: \(message)"
        case .timeout:
            return "脚本执行超时"
        case .scriptNotFound(let path):
            return "脚本未找到: \(path)"
        }
    }
}

// MARK: - AnyCodable for Codable

extension AnyCodable {
    var dictValue: [String: Any]? {
        return value as? [String: Any]
    }
}
