import Foundation
import JavaScriptCore

// MARK: - PluginSandbox
/// Plugin sandbox for isolated execution
/// Ported from PC: plugins/plugin-sandbox.js
///
/// Features:
/// - Isolated JavaScript execution via JavaScriptCore
/// - Secure global object with limited access
/// - Timeout control for operations
/// - Lifecycle hook management
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Sandbox Errors

enum PluginSandboxError: Error, LocalizedError {
    case notLoaded
    case loadTimeout
    case hookTimeout(String)
    case methodTimeout(String)
    case invalidPluginExport
    case methodNotFound(String)
    case executionFailed(String)
    case securityViolation(String)

    var errorDescription: String? {
        switch self {
        case .notLoaded:
            return "Plugin not loaded"
        case .loadTimeout:
            return "Plugin load timed out"
        case .hookTimeout(let hook):
            return "Hook '\(hook)' execution timed out"
        case .methodTimeout(let method):
            return "Method '\(method)' execution timed out"
        case .invalidPluginExport:
            return "Plugin must export a valid constructor or object"
        case .methodNotFound(let method):
            return "Plugin method not found: \(method)"
        case .executionFailed(let reason):
            return "Execution failed: \(reason)"
        case .securityViolation(let reason):
            return "Security violation: \(reason)"
        }
    }
}

// MARK: - Sandbox Delegate

protocol PluginSandboxDelegate: AnyObject {
    func sandbox(_ sandbox: PluginSandbox, didLoad pluginId: String)
    func sandbox(_ sandbox: PluginSandbox, didEnable pluginId: String)
    func sandbox(_ sandbox: PluginSandbox, didDisable pluginId: String)
    func sandbox(_ sandbox: PluginSandbox, didUnload pluginId: String)
    func sandbox(_ sandbox: PluginSandbox, didFailWithError error: Error, pluginId: String)
    func sandbox(_ sandbox: PluginSandbox, didLogMessage message: String, level: String, pluginId: String)
}

// MARK: - Plugin Sandbox

/// Sandbox environment for plugin execution
@MainActor
class PluginSandbox: ObservableObject {

    // MARK: - Properties

    let pluginId: String
    let pluginPath: URL
    let manifest: PluginManifest

    private let logger = Logger.shared
    private var jsContext: JSContext?
    private var pluginInstance: JSValue?

    weak var delegate: PluginSandboxDelegate?

    /// Timeout settings (milliseconds)
    struct Timeouts {
        var load: TimeInterval = 10.0
        var hook: TimeInterval = 5.0
        var method: TimeInterval = 30.0
    }
    var timeouts = Timeouts()

    /// Current state
    @Published private(set) var state: PluginState = .created

    /// Plugin API provider
    private var apiProvider: PluginAPIProvider?

    // MARK: - Initialization

    init(pluginId: String, pluginPath: URL, manifest: PluginManifest, apiProvider: PluginAPIProvider?) {
        self.pluginId = pluginId
        self.pluginPath = pluginPath
        self.manifest = manifest
        self.apiProvider = apiProvider
    }

    // MARK: - Loading

    /// Load plugin code in sandbox
    func load() async throws {
        logger.info("[PluginSandbox] Loading plugin: \(pluginId)")
        state = .loading

        do {
            // Create JavaScript context
            jsContext = JSContext()
            guard let context = jsContext else {
                throw PluginSandboxError.executionFailed("Failed to create JS context")
            }

            // Set up sandbox environment
            setupSandboxEnvironment(context)

            // Read plugin code
            let entryFile = manifest.main
            let entryPath = pluginPath.appendingPathComponent(entryFile)

            guard FileManager.default.fileExists(atPath: entryPath.path) else {
                throw PluginSandboxError.executionFailed("Entry file not found: \(entryPath.path)")
            }

            let code = try String(contentsOf: entryPath, encoding: .utf8)

            // Execute plugin code with timeout
            let result = try await withTimeout(timeouts.load) {
                return try self.executePluginCode(code, in: context)
            }

            // Validate plugin export
            guard let instance = result, !instance.isUndefined else {
                throw PluginSandboxError.invalidPluginExport
            }

            pluginInstance = instance

            // Validate plugin interface
            validatePluginInterface()

            state = .loaded
            delegate?.sandbox(self, didLoad: pluginId)
            logger.info("[PluginSandbox] Plugin loaded successfully: \(pluginId)")

        } catch {
            state = .error
            delegate?.sandbox(self, didFailWithError: error, pluginId: pluginId)
            logger.error("[PluginSandbox] Plugin load failed: \(pluginId) - \(error)")
            throw error
        }
    }

    /// Set up sandbox environment with limited global access
    private func setupSandboxEnvironment(_ context: JSContext) {
        // Exception handler
        context.exceptionHandler = { [weak self] ctx, exception in
            guard let self = self else { return }
            let message = exception?.toString() ?? "Unknown error"
            self.logger.error("[PluginSandbox] JS Exception: \(message)")
            self.delegate?.sandbox(self, didLogMessage: message, level: "error", pluginId: self.pluginId)
        }

        // Console logging
        let consoleLog: @convention(block) (String) -> Void = { [weak self] message in
            guard let self = self else { return }
            self.logger.info("[Plugin:\(self.pluginId)] \(message)")
            self.delegate?.sandbox(self, didLogMessage: message, level: "info", pluginId: self.pluginId)
        }

        let consoleWarn: @convention(block) (String) -> Void = { [weak self] message in
            guard let self = self else { return }
            self.logger.warning("[Plugin:\(self.pluginId)] \(message)")
            self.delegate?.sandbox(self, didLogMessage: message, level: "warn", pluginId: self.pluginId)
        }

        let consoleError: @convention(block) (String) -> Void = { [weak self] message in
            guard let self = self else { return }
            self.logger.error("[Plugin:\(self.pluginId)] \(message)")
            self.delegate?.sandbox(self, didLogMessage: message, level: "error", pluginId: self.pluginId)
        }

        // Create console object
        let console = JSValue(newObjectIn: context)
        console?.setObject(consoleLog, forKeyedSubscript: "log" as NSString)
        console?.setObject(consoleWarn, forKeyedSubscript: "warn" as NSString)
        console?.setObject(consoleError, forKeyedSubscript: "error" as NSString)
        context.setObject(console, forKeyedSubscript: "console" as NSString)

        // setTimeout (limited to 60 seconds)
        let setTimeout: @convention(block) (JSValue, Double) -> Int32 = { callback, delay in
            let limitedDelay = min(delay, 60000)
            let id = Int32.random(in: 1...Int32.max)

            DispatchQueue.main.asyncAfter(deadline: .now() + limitedDelay / 1000) {
                callback.call(withArguments: [])
            }

            return id
        }
        context.setObject(setTimeout, forKeyedSubscript: "setTimeout" as NSString)

        // setInterval (minimum 100ms)
        let setInterval: @convention(block) (JSValue, Double) -> Int32 = { callback, delay in
            let limitedDelay = max(delay, 100)
            let id = Int32.random(in: 1...Int32.max)

            Timer.scheduledTimer(withTimeInterval: limitedDelay / 1000, repeats: true) { _ in
                callback.call(withArguments: [])
            }

            return id
        }
        context.setObject(setInterval, forKeyedSubscript: "setInterval" as NSString)

        // Plugin API (chainlesschain global)
        if let apiProvider = apiProvider {
            let api = apiProvider.buildAPI(for: pluginId, manifest: manifest)
            context.setObject(api, forKeyedSubscript: "chainlesschain" as NSString)
        }

        // Module system
        let moduleExports = JSValue(newObjectIn: context)
        let module = JSValue(newObjectIn: context)
        module?.setObject(moduleExports, forKeyedSubscript: "exports" as NSString)
        context.setObject(module, forKeyedSubscript: "module" as NSString)
        context.setObject(moduleExports, forKeyedSubscript: "exports" as NSString)

        // Create require function
        let require: @convention(block) (String) -> JSValue? = { [weak self] moduleName in
            return self?.handleRequire(moduleName, context: context)
        }
        context.setObject(require, forKeyedSubscript: "require" as NSString)

        // __dirname and __filename
        context.setObject(pluginPath.path, forKeyedSubscript: "__dirname" as NSString)
        context.setObject(pluginPath.appendingPathComponent(manifest.main).path, forKeyedSubscript: "__filename" as NSString)
    }

    /// Handle require calls with security restrictions
    private func handleRequire(_ moduleName: String, context: JSContext) -> JSValue? {
        // Allowed built-in modules
        let allowedModules = ["crypto", "path", "url", "events", "util"]

        if allowedModules.contains(moduleName) {
            // Return mock implementations for allowed modules
            return createMockModule(moduleName, context: context)
        }

        // Relative paths within plugin directory
        if moduleName.hasPrefix(".") || moduleName.hasPrefix("/") {
            let resolvedPath = pluginPath.appendingPathComponent(moduleName)

            // Security check: must be within plugin directory
            guard resolvedPath.path.hasPrefix(pluginPath.path) else {
                logger.error("[PluginSandbox] Security: Blocked require outside plugin directory: \(moduleName)")
                return nil
            }

            // Load the file
            if let code = try? String(contentsOf: resolvedPath, encoding: .utf8) {
                context.evaluateScript(code)
                return context.objectForKeyedSubscript("module")?.objectForKeyedSubscript("exports")
            }
        }

        logger.warning("[PluginSandbox] Blocked require: \(moduleName)")
        return nil
    }

    /// Create mock implementations for allowed modules
    private func createMockModule(_ name: String, context: JSContext) -> JSValue? {
        let mock = JSValue(newObjectIn: context)

        switch name {
        case "crypto":
            // Basic crypto functions
            let randomUUID: @convention(block) () -> String = {
                UUID().uuidString
            }
            mock?.setObject(randomUUID, forKeyedSubscript: "randomUUID" as NSString)

        case "path":
            // Path utilities
            let join: @convention(block) ([String]) -> String = { parts in
                parts.joined(separator: "/")
            }
            mock?.setObject(join, forKeyedSubscript: "join" as NSString)

            let basename: @convention(block) (String) -> String = { path in
                URL(fileURLWithPath: path).lastPathComponent
            }
            mock?.setObject(basename, forKeyedSubscript: "basename" as NSString)

        case "events":
            // Basic EventEmitter
            let EventEmitter: @convention(block) () -> JSValue? = { [weak context] in
                guard let ctx = context else { return nil }
                let emitter = JSValue(newObjectIn: ctx)
                let listeners = JSValue(newObjectIn: ctx)
                emitter?.setObject(listeners, forKeyedSubscript: "_listeners" as NSString)
                return emitter
            }
            mock?.setObject(EventEmitter, forKeyedSubscript: "EventEmitter" as NSString)

        default:
            break
        }

        return mock
    }

    /// Execute plugin code and return the export
    private func executePluginCode(_ code: String, in context: JSContext) throws -> JSValue? {
        // Wrap code in IIFE to get exports
        let wrappedCode = """
        (function() {
            \(code)
            return module.exports;
        })()
        """

        let result = context.evaluateScript(wrappedCode)

        // Check for exceptions
        if let exception = context.exception {
            throw PluginSandboxError.executionFailed(exception.toString())
        }

        // If result is a constructor, instantiate it
        if let constructor = result, constructor.isObject {
            // Check if it's a class/constructor
            if let instance = constructor.construct(withArguments: []) {
                return instance
            }
            return constructor
        }

        return result
    }

    /// Validate plugin implements expected interface
    private func validatePluginInterface() {
        guard let instance = pluginInstance else { return }

        let optionalMethods = ["onLoad", "onUnload", "onEnable", "onDisable"]

        for method in optionalMethods {
            if let methodValue = instance.objectForKeyedSubscript(method),
               !methodValue.isUndefined && !methodValue.isNull {
                // Method exists - verify it's a function
                if !methodValue.isObject {
                    logger.warning("[PluginSandbox] \(method) should be a function")
                }
            }
        }
    }

    // MARK: - Lifecycle Hooks

    /// Call plugin hook with timeout
    func callHook(_ hookName: String, arguments: [Any] = []) async throws -> Any? {
        guard let instance = pluginInstance else {
            throw PluginSandboxError.notLoaded
        }

        guard let hook = instance.objectForKeyedSubscript(hookName),
              !hook.isUndefined && !hook.isNull else {
            logger.info("[PluginSandbox] Plugin has no \(hookName) hook, skipping")
            return nil
        }

        logger.info("[PluginSandbox] Calling hook: \(pluginId).\(hookName)")

        do {
            let result = try await withTimeout(timeouts.hook) {
                return hook.call(withArguments: arguments)
            }

            logger.info("[PluginSandbox] Hook executed successfully: \(pluginId).\(hookName)")
            return result?.toObject()

        } catch {
            logger.error("[PluginSandbox] Hook execution failed: \(pluginId).\(hookName) - \(error)")
            throw PluginSandboxError.hookTimeout(hookName)
        }
    }

    /// Enable plugin
    func enable() async throws {
        guard state != .enabled else {
            logger.info("[PluginSandbox] Plugin already enabled: \(pluginId)")
            return
        }

        state = .enabling

        do {
            _ = try await callHook("onEnable")
            state = .enabled
            delegate?.sandbox(self, didEnable: pluginId)
            logger.info("[PluginSandbox] Plugin enabled: \(pluginId)")
        } catch {
            state = .error
            throw error
        }
    }

    /// Disable plugin
    func disable() async throws {
        guard state == .enabled else {
            logger.info("[PluginSandbox] Plugin not enabled: \(pluginId)")
            return
        }

        do {
            _ = try await callHook("onDisable")
            state = .disabled
            delegate?.sandbox(self, didDisable: pluginId)
            logger.info("[PluginSandbox] Plugin disabled: \(pluginId)")
        } catch {
            state = .error
            throw error
        }
    }

    /// Unload plugin
    func unload() async throws {
        do {
            _ = try await callHook("onUnload")
            pluginInstance = nil
            jsContext = nil
            state = .unloaded
            delegate?.sandbox(self, didUnload: pluginId)
            logger.info("[PluginSandbox] Plugin unloaded: \(pluginId)")
        } catch {
            state = .error
            throw error
        }
    }

    // MARK: - Method Calls

    /// Call plugin method
    func callMethod(_ methodName: String, arguments: [Any] = []) async throws -> Any? {
        guard let instance = pluginInstance else {
            throw PluginSandboxError.notLoaded
        }

        guard let method = instance.objectForKeyedSubscript(methodName),
              !method.isUndefined && !method.isNull else {
            throw PluginSandboxError.methodNotFound(methodName)
        }

        logger.info("[PluginSandbox] Calling method: \(pluginId).\(methodName)")

        do {
            let result = try await withTimeout(timeouts.method) {
                return method.call(withArguments: arguments)
            }

            logger.info("[PluginSandbox] Method executed successfully: \(pluginId).\(methodName)")
            return result?.toObject()

        } catch {
            logger.error("[PluginSandbox] Method execution failed: \(pluginId).\(methodName) - \(error)")
            throw PluginSandboxError.methodTimeout(methodName)
        }
    }

    // MARK: - Getters

    /// Get plugin instance
    func getInstance() -> JSValue? {
        return pluginInstance
    }

    /// Get current state
    func getState() -> PluginState {
        return state
    }

    // MARK: - Cleanup

    /// Destroy sandbox
    func destroy() {
        pluginInstance = nil
        jsContext = nil
        state = .destroyed
        logger.info("[PluginSandbox] Sandbox destroyed: \(pluginId)")
    }

    // MARK: - Helpers

    /// Execute with timeout
    private func withTimeout<T>(_ timeout: TimeInterval, operation: @escaping () throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                throw PluginSandboxError.loadTimeout
            }

            guard let result = try await group.next() else {
                throw PluginSandboxError.loadTimeout
            }

            group.cancelAll()
            return result
        }
    }
}

// MARK: - Plugin API Provider Protocol

/// Protocol for providing plugin APIs
protocol PluginAPIProvider: AnyObject {
    func buildAPI(for pluginId: String, manifest: PluginManifest) -> [String: Any]
    func checkPermission(_ permission: PluginPermission, for pluginId: String) -> Bool
}
