import Foundation
import Combine

// MARK: - PluginManager
/// Central plugin management coordinator
/// Ported from PC: plugins/plugin-manager.js
///
/// Features:
/// - Plugin lifecycle management (install, load, enable, disable, uninstall)
/// - Extension point management
/// - Plugin dependency resolution
/// - Event coordination
/// - UI registry for plugin-registered pages/menus/components
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Plugin Manager Errors

enum PluginManagerError: Error, LocalizedError {
    case notInitialized
    case pluginNotFound(String)
    case pluginAlreadyInstalled(String)
    case pluginAlreadyLoaded(String)
    case incompatibleVersion(String)
    case permissionDenied(String)
    case loadFailed(String)
    case installFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "Plugin manager not initialized"
        case .pluginNotFound(let id):
            return "Plugin not found: \(id)"
        case .pluginAlreadyInstalled(let id):
            return "Plugin already installed: \(id)"
        case .pluginAlreadyLoaded(let id):
            return "Plugin already loaded: \(id)"
        case .incompatibleVersion(let info):
            return "Incompatible version: \(info)"
        case .permissionDenied(let reason):
            return "Permission denied: \(reason)"
        case .loadFailed(let reason):
            return "Load failed: \(reason)"
        case .installFailed(let reason):
            return "Install failed: \(reason)"
        }
    }
}

// MARK: - Plugin Events

enum PluginManagerEvent {
    case initialized(pluginCount: Int)
    case installing(source: String)
    case installed(pluginId: String)
    case installFailed(source: String, error: String)
    case loading(pluginId: String)
    case loaded(pluginId: String)
    case loadFailed(pluginId: String, error: String)
    case enabling(pluginId: String)
    case enabled(pluginId: String)
    case enableFailed(pluginId: String, error: String)
    case disabling(pluginId: String)
    case disabled(pluginId: String)
    case uninstalling(pluginId: String)
    case uninstalled(pluginId: String)
    case uiPageRegistered(pluginId: String, pageId: String)
    case uiMenuRegistered(pluginId: String, menuId: String)
    case uiComponentRegistered(pluginId: String, componentId: String)
    case extensionError(extensionId: String, error: String)
}

// MARK: - Plugin Manager

/// Central coordinator for plugin system
@MainActor
class PluginManager: ObservableObject, PluginAPIProvider, PluginSandboxDelegate {

    // MARK: - Properties

    private let logger = Logger.shared

    /// Plugin loader
    private let loader: PluginLoader

    /// Plugin registry (database)
    private var registry: PluginRegistry

    /// Runtime state
    private var plugins: [String: LoadedPlugin] = [:]

    /// Extension points
    private var extensionPoints: [String: ExtensionPoint] = [:]

    /// UI Registry
    private var uiRegistry = UIRegistry()

    /// Initialization status
    @Published private(set) var isInitialized = false

    /// Event publisher
    let events = PassthroughSubject<PluginManagerEvent, Never>()

    /// Current app version
    private let appVersion: String

    // MARK: - Singleton

    static let shared = PluginManager()

    // MARK: - Initialization

    private init() {
        self.loader = PluginLoader()
        self.registry = PluginRegistry()
        self.appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.7.0"
    }

    // MARK: - Initialization

    /// Initialize the plugin manager
    func initialize() async throws {
        logger.info("[PluginManager] Initializing...")

        do {
            // Initialize registry
            try await registry.initialize()

            // Register built-in extension points
            registerBuiltInExtensionPoints()

            // Load enabled plugins
            let enabledPlugins = try await registry.getInstalledPlugins(enabled: true)
            logger.info("[PluginManager] Found \(enabledPlugins.count) enabled plugins")

            for pluginInfo in enabledPlugins {
                do {
                    try await loadPlugin(pluginInfo.id)
                    logger.info("[PluginManager] Plugin loaded: \(pluginInfo.id)")
                } catch {
                    logger.error("[PluginManager] Failed to load plugin: \(pluginInfo.id) - \(error)")
                    try? await registry.recordError(pluginInfo.id, error: error)
                }
            }

            isInitialized = true
            events.send(.initialized(pluginCount: enabledPlugins.count))
            logger.info("[PluginManager] Initialization complete")

        } catch {
            logger.error("[PluginManager] Initialization failed: \(error)")
            throw error
        }
    }

    // MARK: - Extension Points

    /// Register built-in extension points
    private func registerBuiltInExtensionPoints() {
        // UI extension points
        registerExtensionPoint("ui.page") { [weak self] context in
            await self?.handleUIPageExtension(context)
        }
        registerExtensionPoint("ui.menu") { [weak self] context in
            await self?.handleUIMenuExtension(context)
        }
        registerExtensionPoint("ui.component") { [weak self] context in
            await self?.handleUIComponentExtension(context)
        }

        // Data extension points
        registerExtensionPoint("data.importer") { [weak self] context in
            await self?.handleDataImporterExtension(context)
        }
        registerExtensionPoint("data.exporter") { [weak self] context in
            await self?.handleDataExporterExtension(context)
        }

        // AI extension points
        registerExtensionPoint("ai.llm-provider") { [weak self] context in
            await self?.handleAILLMProviderExtension(context)
        }
        registerExtensionPoint("ai.function-tool") { [weak self] context in
            await self?.handleAIFunctionToolExtension(context)
        }

        // Lifecycle hooks
        registerExtensionPoint("lifecycle.hook") { [weak self] context in
            await self?.handleLifecycleHookExtension(context)
        }

        logger.info("[PluginManager] Built-in extension points registered")
    }

    /// Register an extension point
    func registerExtensionPoint(_ name: String, handler: @escaping (ExtensionContext) async -> Any?) {
        extensionPoints[name] = ExtensionPoint(name: name, handler: handler, extensions: [])
    }

    // MARK: - Installation

    /// Install a plugin from source
    func installPlugin(from source: String) async throws -> PluginInstallResult {
        events.send(.installing(source: source))

        do {
            // Resolve source
            logger.info("[PluginManager] Resolving source: \(source)")
            let pluginPath = try await loader.resolve(source: source)

            // Load manifest
            let manifest = try loader.loadManifest(from: pluginPath)

            // Check compatibility
            try checkCompatibility(manifest)

            // Check if already installed
            if let existing = try? await registry.getPlugin(manifest.id), existing != nil {
                throw PluginManagerError.pluginAlreadyInstalled(manifest.id)
            }

            // Resolve dependencies
            let installedPlugins = try await getInstalledPluginsMap()
            let depResult = loader.resolveDependencies(manifest: manifest, installedPlugins: installedPlugins)
            if !depResult.resolved {
                logger.warning("[PluginManager] Dependency issues: \(depResult)")
            }

            // Request permissions (simplified - auto-grant for now)
            let granted = await requestPermissions(manifest)
            if !granted {
                throw PluginManagerError.permissionDenied("User denied permissions")
            }

            // Install to plugins directory
            let installedPath = try loader.install(from: pluginPath, manifest: manifest)

            // Register in database
            try await registry.register(manifest: manifest, path: installedPath)

            events.send(.installed(pluginId: manifest.id))
            logger.info("[PluginManager] Plugin installed: \(manifest.id)")

            return .success(pluginId: manifest.id, path: installedPath.path)

        } catch {
            events.send(.installFailed(source: source, error: error.localizedDescription))
            logger.error("[PluginManager] Install failed: \(error)")
            throw error
        }
    }

    /// Check version compatibility
    private func checkCompatibility(_ manifest: PluginManifest) throws {
        guard let compat = manifest.compatibility,
              let required = compat.chainlesschain else {
            logger.warning("[PluginManager] Plugin has no compatibility declaration, skipping check")
            return
        }

        logger.info("[PluginManager] Checking compatibility: need \(required), have \(appVersion)")

        // Simple version check
        if required.hasPrefix(">=") {
            let minVersion = String(required.dropFirst(2))
            if compareVersions(appVersion, minVersion) < 0 {
                throw PluginManagerError.incompatibleVersion(
                    "Plugin \(manifest.id) requires >= \(minVersion), current is \(appVersion)"
                )
            }
        }

        logger.info("[PluginManager] Compatibility check passed")
    }

    /// Compare semantic versions
    private func compareVersions(_ v1: String, _ v2: String) -> Int {
        let parts1 = v1.components(separatedBy: ".").compactMap { Int($0) }
        let parts2 = v2.components(separatedBy: ".").compactMap { Int($0) }

        for i in 0..<max(parts1.count, parts2.count) {
            let p1 = i < parts1.count ? parts1[i] : 0
            let p2 = i < parts2.count ? parts2[i] : 0
            if p1 != p2 { return p1 - p2 }
        }
        return 0
    }

    /// Request user permission grant
    private func requestPermissions(_ manifest: PluginManifest) async -> Bool {
        let permissions = manifest.permissions

        if permissions.isEmpty {
            return true
        }

        logger.info("[PluginManager] Plugin requests permissions: \(permissions)")

        // For now, auto-grant all permissions
        // In production, show UI dialog
        for permission in permissions {
            try? await registry.updatePermission(manifest.id, permission: permission, granted: true)
        }

        return true
    }

    // MARK: - Loading

    /// Load a plugin
    func loadPlugin(_ pluginId: String) async throws {
        if plugins[pluginId] != nil {
            logger.warning("[PluginManager] Plugin already loaded: \(pluginId)")
            return
        }

        guard let pluginInfo = try await registry.getPlugin(pluginId) else {
            throw PluginManagerError.pluginNotFound(pluginId)
        }

        events.send(.loading(pluginId: pluginId))

        do {
            logger.info("[PluginManager] Loading plugin: \(pluginId)")

            // Create sandbox
            let sandbox = PluginSandbox(
                pluginId: pluginId,
                pluginPath: URL(fileURLWithPath: pluginInfo.path),
                manifest: pluginInfo.manifest,
                apiProvider: self
            )
            sandbox.delegate = self

            // Load in sandbox
            try await sandbox.load()

            // Store loaded plugin
            plugins[pluginId] = LoadedPlugin(
                id: pluginId,
                manifest: pluginInfo.manifest,
                state: .loaded,
                sandbox: sandbox
            )

            // Update database state
            try await registry.updatePluginState(pluginId, state: .loaded)

            events.send(.loaded(pluginId: pluginId))
            logger.info("[PluginManager] Plugin loaded: \(pluginId)")

        } catch {
            events.send(.loadFailed(pluginId: pluginId, error: error.localizedDescription))
            try? await registry.recordError(pluginId, error: error)
            logger.error("[PluginManager] Plugin load failed: \(pluginId) - \(error)")
            throw error
        }
    }

    // MARK: - Enable/Disable

    /// Enable a plugin
    func enablePlugin(_ pluginId: String) async throws {
        if plugins[pluginId] == nil {
            try await loadPlugin(pluginId)
        }

        guard var plugin = plugins[pluginId] else {
            throw PluginManagerError.pluginNotFound(pluginId)
        }

        if plugin.state == .enabled {
            logger.info("[PluginManager] Plugin already enabled: \(pluginId)")
            return
        }

        events.send(.enabling(pluginId: pluginId))

        do {
            logger.info("[PluginManager] Enabling plugin: \(pluginId)")

            try await plugin.sandbox.enable()

            // Register extensions
            try await registerPluginExtensions(pluginId)

            plugin.state = .enabled
            plugins[pluginId] = plugin

            try await registry.updatePluginState(pluginId, state: .enabled)
            try await registry.updateEnabled(pluginId, enabled: true)

            events.send(.enabled(pluginId: pluginId))
            logger.info("[PluginManager] Plugin enabled: \(pluginId)")

        } catch {
            events.send(.enableFailed(pluginId: pluginId, error: error.localizedDescription))
            try? await registry.recordError(pluginId, error: error)
            throw error
        }
    }

    /// Disable a plugin
    func disablePlugin(_ pluginId: String) async throws {
        guard var plugin = plugins[pluginId], plugin.state == .enabled else {
            logger.info("[PluginManager] Plugin not enabled: \(pluginId)")
            return
        }

        events.send(.disabling(pluginId: pluginId))

        do {
            logger.info("[PluginManager] Disabling plugin: \(pluginId)")

            // Unregister extensions
            unregisterPluginExtensions(pluginId)

            try await plugin.sandbox.disable()

            plugin.state = .disabled
            plugins[pluginId] = plugin

            try await registry.updatePluginState(pluginId, state: .disabled)
            try await registry.updateEnabled(pluginId, enabled: false)

            events.send(.disabled(pluginId: pluginId))
            logger.info("[PluginManager] Plugin disabled: \(pluginId)")

        } catch {
            try? await registry.recordError(pluginId, error: error)
            throw error
        }
    }

    // MARK: - Uninstall

    /// Uninstall a plugin
    func uninstallPlugin(_ pluginId: String) async throws {
        // Disable first
        if plugins[pluginId] != nil {
            try await disablePlugin(pluginId)
        }

        events.send(.uninstalling(pluginId: pluginId))

        do {
            logger.info("[PluginManager] Uninstalling plugin: \(pluginId)")

            // Destroy sandbox
            if let plugin = plugins[pluginId] {
                try await plugin.sandbox.unload()
                plugin.sandbox.destroy()
                plugins.removeValue(forKey: pluginId)
            }

            // Remove from filesystem
            if let pluginInfo = try await registry.getPlugin(pluginId) {
                try loader.uninstall(at: URL(fileURLWithPath: pluginInfo.path))
            }

            // Remove from database
            try await registry.unregister(pluginId)

            events.send(.uninstalled(pluginId: pluginId))
            logger.info("[PluginManager] Plugin uninstalled: \(pluginId)")

        } catch {
            throw error
        }
    }

    // MARK: - Query

    /// Get all plugins
    func getPlugins(enabled: Bool? = nil, category: PluginCategory? = nil) async throws -> [PluginInfo] {
        return try await registry.getInstalledPlugins(enabled: enabled, category: category)
    }

    /// Get single plugin
    func getPlugin(_ pluginId: String) async throws -> PluginInfo? {
        return try await registry.getPlugin(pluginId)
    }

    /// Get installed plugins as map
    private func getInstalledPluginsMap() async throws -> [String: PluginInfo] {
        let plugins = try await registry.getInstalledPlugins()
        var map: [String: PluginInfo] = [:]
        for plugin in plugins {
            map[plugin.id] = plugin
        }
        return map
    }

    // MARK: - Extension Points

    /// Register plugin extensions from manifest
    private func registerPluginExtensions(_ pluginId: String) async throws {
        guard let plugin = plugins[pluginId] else { return }

        for ext in plugin.manifest.extensionPoints {
            do {
                try await registry.registerExtension(
                    pluginId: pluginId,
                    extensionPoint: ext.point.rawValue,
                    config: ext.config,
                    priority: ext.priority
                )
                logger.info("[PluginManager] Registered extension: \(pluginId) -> \(ext.point.rawValue)")
            } catch {
                logger.error("[PluginManager] Failed to register extension: \(error)")
            }
        }
    }

    /// Unregister plugin extensions
    private func unregisterPluginExtensions(_ pluginId: String) {
        Task {
            try? await registry.unregisterExtensions(pluginId)
        }

        // Unregister UI
        unregisterPluginUI(pluginId)

        logger.info("[PluginManager] Unregistered extensions: \(pluginId)")
    }

    /// Trigger extension point
    func triggerExtensionPoint(_ name: String, context: ExtensionContext) async -> [Any] {
        guard let point = extensionPoints[name] else {
            logger.warning("[PluginManager] Unknown extension point: \(name)")
            return []
        }

        var results: [Any] = []

        for ext in point.extensions {
            do {
                if let result = await ext.handler(context) {
                    results.append(result)
                }
            } catch {
                logger.error("[PluginManager] Extension execution failed: \(error)")
                events.send(.extensionError(extensionId: ext.id, error: error.localizedDescription))
            }
        }

        return results
    }

    // MARK: - Extension Handlers

    private func handleUIPageExtension(_ context: ExtensionContext) async -> Any? {
        let pluginId = context.pluginId
        let config = context.config

        guard let path = config["path"]?.stringValue else {
            logger.error("[PluginManager] Page extension missing path")
            return nil
        }

        let pageId = "plugin:\(pluginId):\(path)"

        let page = PluginRegisteredPage(
            id: pageId,
            pluginId: pluginId,
            path: "/plugin/\(pluginId)\(path)",
            originalPath: path,
            title: config["title"]?.stringValue ?? pluginId,
            icon: config["icon"]?.stringValue ?? "AppstoreOutlined",
            componentPath: config["componentPath"]?.stringValue,
            requireAuth: config["requireAuth"]?.boolValue ?? false,
            meta: [:],
            registeredAt: Date()
        )

        uiRegistry.pages[pageId] = page
        events.send(.uiPageRegistered(pluginId: pluginId, pageId: pageId))
        logger.info("[PluginManager] Page registered: \(pageId)")

        return ["success": true, "pageId": pageId]
    }

    private func handleUIMenuExtension(_ context: ExtensionContext) async -> Any? {
        let pluginId = context.pluginId
        let config = context.config

        let label = config["label"]?.stringValue ?? pluginId
        let menuId = "plugin:\(pluginId):\(config["id"]?.stringValue ?? label)"

        let menu = PluginRegisteredMenu(
            id: menuId,
            pluginId: pluginId,
            label: label,
            icon: config["icon"]?.stringValue ?? "AppstoreOutlined",
            action: config["action"]?.stringValue,
            route: config["route"]?.stringValue.map { "/plugin/\(pluginId)\($0)" },
            position: PluginRegisteredMenu.MenuPosition(rawValue: config["position"]?.stringValue ?? "sidebar") ?? .sidebar,
            order: config["order"]?.intValue ?? 100,
            parent: config["parent"]?.stringValue,
            children: [],
            visible: config["visible"]?.boolValue ?? true,
            registeredAt: Date()
        )

        uiRegistry.menus[menuId] = menu
        events.send(.uiMenuRegistered(pluginId: pluginId, menuId: menuId))
        logger.info("[PluginManager] Menu registered: \(menuId)")

        return ["success": true, "menuId": menuId]
    }

    private func handleUIComponentExtension(_ context: ExtensionContext) async -> Any? {
        let pluginId = context.pluginId
        let config = context.config

        guard let name = config["name"]?.stringValue else {
            logger.error("[PluginManager] Component extension missing name")
            return nil
        }

        let componentId = "plugin:\(pluginId):\(name)"

        let component = PluginRegisteredComponent(
            id: componentId,
            pluginId: pluginId,
            name: name,
            componentPath: config["componentPath"]?.stringValue,
            slot: config["slot"]?.stringValue,
            props: [:],
            order: config["order"]?.intValue ?? 100,
            registeredAt: Date()
        )

        uiRegistry.components[componentId] = component
        events.send(.uiComponentRegistered(pluginId: pluginId, componentId: componentId))
        logger.info("[PluginManager] Component registered: \(componentId)")

        return ["success": true, "componentId": componentId]
    }

    private func handleDataImporterExtension(_ context: ExtensionContext) async -> Any? {
        logger.info("[PluginManager] Data importer extension: \(context)")
        return nil
    }

    private func handleDataExporterExtension(_ context: ExtensionContext) async -> Any? {
        logger.info("[PluginManager] Data exporter extension: \(context)")
        return nil
    }

    private func handleAILLMProviderExtension(_ context: ExtensionContext) async -> Any? {
        logger.info("[PluginManager] AI LLM provider extension: \(context)")
        return nil
    }

    private func handleAIFunctionToolExtension(_ context: ExtensionContext) async -> Any? {
        logger.info("[PluginManager] AI function tool extension: \(context)")
        return nil
    }

    private func handleLifecycleHookExtension(_ context: ExtensionContext) async -> Any? {
        logger.info("[PluginManager] Lifecycle hook extension: \(context)")
        return nil
    }

    // MARK: - UI Registry

    /// Get registered pages
    func getRegisteredPages(pluginId: String? = nil) -> [PluginRegisteredPage] {
        var pages = Array(uiRegistry.pages.values)
        if let pluginId = pluginId {
            pages = pages.filter { $0.pluginId == pluginId }
        }
        return pages
    }

    /// Get registered menus
    func getRegisteredMenus(position: PluginRegisteredMenu.MenuPosition? = nil, pluginId: String? = nil) -> [PluginRegisteredMenu] {
        var menus = Array(uiRegistry.menus.values)
        if let position = position {
            menus = menus.filter { $0.position == position }
        }
        if let pluginId = pluginId {
            menus = menus.filter { $0.pluginId == pluginId }
        }
        return menus.sorted { $0.order < $1.order }
    }

    /// Get registered components
    func getRegisteredComponents(slot: String? = nil, pluginId: String? = nil) -> [PluginRegisteredComponent] {
        var components = Array(uiRegistry.components.values)
        if let slot = slot {
            components = components.filter { $0.slot == slot }
        }
        if let pluginId = pluginId {
            components = components.filter { $0.pluginId == pluginId }
        }
        return components.sorted { $0.order < $1.order }
    }

    /// Unregister plugin UI
    private func unregisterPluginUI(_ pluginId: String) {
        uiRegistry.pages = uiRegistry.pages.filter { $0.value.pluginId != pluginId }
        uiRegistry.menus = uiRegistry.menus.filter { $0.value.pluginId != pluginId }
        uiRegistry.components = uiRegistry.components.filter { $0.value.pluginId != pluginId }
        logger.info("[PluginManager] UI unregistered for: \(pluginId)")
    }

    // MARK: - Permissions

    /// Get plugin permissions
    func getPluginPermissions(_ pluginId: String) async throws -> [PluginPermissionGrant] {
        return try await registry.getPluginPermissions(pluginId)
    }

    /// Update plugin permission
    func updatePluginPermission(_ pluginId: String, permission: PluginPermission, granted: Bool) async throws {
        try await registry.updatePermission(pluginId, permission: permission, granted: granted)
    }

    /// Get plugins directory
    var pluginsDirectory: URL {
        loader.pluginsDirectory
    }

    // MARK: - PluginAPIProvider

    func buildAPI(for pluginId: String, manifest: PluginManifest) -> [String: Any] {
        // Build plugin API object
        return [
            "pluginId": pluginId,
            "version": manifest.version,
            "storage": buildStorageAPI(pluginId: pluginId),
            "log": { [weak self] (message: String) in
                self?.logger.info("[Plugin:\(pluginId)] \(message)")
            }
        ]
    }

    private func buildStorageAPI(pluginId: String) -> [String: Any] {
        return [
            "get": { [weak self] (key: String) async -> Any? in
                return try? await self?.registry.getPluginSetting(pluginId, key: key)
            },
            "set": { [weak self] (key: String, value: Any) async in
                try? await self?.registry.setPluginSetting(pluginId, key: key, value: value)
            }
        ]
    }

    func checkPermission(_ permission: PluginPermission, for pluginId: String) -> Bool {
        // Check if permission was granted
        Task {
            if let grants = try? await registry.getPluginPermissions(pluginId) {
                return grants.first { $0.permission == permission }?.granted ?? false
            }
            return false
        }
        return false
    }

    // MARK: - PluginSandboxDelegate

    nonisolated func sandbox(_ sandbox: PluginSandbox, didLoad pluginId: String) {
        Task { @MainActor in
            logger.info("[PluginManager] Sandbox loaded: \(pluginId)")
        }
    }

    nonisolated func sandbox(_ sandbox: PluginSandbox, didEnable pluginId: String) {
        Task { @MainActor in
            logger.info("[PluginManager] Sandbox enabled: \(pluginId)")
        }
    }

    nonisolated func sandbox(_ sandbox: PluginSandbox, didDisable pluginId: String) {
        Task { @MainActor in
            logger.info("[PluginManager] Sandbox disabled: \(pluginId)")
        }
    }

    nonisolated func sandbox(_ sandbox: PluginSandbox, didUnload pluginId: String) {
        Task { @MainActor in
            logger.info("[PluginManager] Sandbox unloaded: \(pluginId)")
        }
    }

    nonisolated func sandbox(_ sandbox: PluginSandbox, didFailWithError error: Error, pluginId: String) {
        Task { @MainActor in
            logger.error("[PluginManager] Sandbox error: \(pluginId) - \(error)")
        }
    }

    nonisolated func sandbox(_ sandbox: PluginSandbox, didLogMessage message: String, level: String, pluginId: String) {
        Task { @MainActor in
            switch level {
            case "error":
                logger.error("[Plugin:\(pluginId)] \(message)")
            case "warn":
                logger.warning("[Plugin:\(pluginId)] \(message)")
            default:
                logger.info("[Plugin:\(pluginId)] \(message)")
            }
        }
    }
}

// MARK: - Supporting Types

/// Loaded plugin runtime state
struct LoadedPlugin {
    let id: String
    let manifest: PluginManifest
    var state: PluginState
    let sandbox: PluginSandbox
}

/// Extension point definition
struct ExtensionPoint {
    let name: String
    let handler: (ExtensionContext) async -> Any?
    var extensions: [Extension]
}

/// Extension instance
struct Extension {
    let id: String
    let pluginId: String
    let handler: (ExtensionContext) async throws -> Any?
}

/// Extension context
struct ExtensionContext {
    let pluginId: String
    let config: [String: AnyCodableValue]
}

/// UI registry storage
struct UIRegistry {
    var pages: [String: PluginRegisteredPage] = [:]
    var menus: [String: PluginRegisteredMenu] = [:]
    var components: [String: PluginRegisteredComponent] = [:]
}

// MARK: - Plugin Registry (Database)

/// Plugin registry for database operations
class PluginRegistry {
    private let logger = Logger.shared

    func initialize() async throws {
        logger.info("[PluginRegistry] Initializing...")
        // Database initialization would happen here
    }

    func getInstalledPlugins(enabled: Bool? = nil, category: PluginCategory? = nil) async throws -> [PluginInfo] {
        // Would query database
        return []
    }

    func getPlugin(_ pluginId: String) async throws -> PluginInfo? {
        // Would query database
        return nil
    }

    func register(manifest: PluginManifest, path: URL) async throws {
        logger.info("[PluginRegistry] Registering: \(manifest.id)")
        // Would insert into database
    }

    func unregister(_ pluginId: String) async throws {
        logger.info("[PluginRegistry] Unregistering: \(pluginId)")
        // Would delete from database
    }

    func updatePluginState(_ pluginId: String, state: PluginState) async throws {
        // Would update database
    }

    func updateEnabled(_ pluginId: String, enabled: Bool) async throws {
        // Would update database
    }

    func recordError(_ pluginId: String, error: Error) async throws {
        // Would log to database
    }

    func updatePermission(_ pluginId: String, permission: PluginPermission, granted: Bool) async throws {
        // Would update database
    }

    func getPluginPermissions(_ pluginId: String) async throws -> [PluginPermissionGrant] {
        return []
    }

    func registerExtension(pluginId: String, extensionPoint: String, config: [String: AnyCodableValue], priority: Int) async throws {
        // Would insert into database
    }

    func unregisterExtensions(_ pluginId: String) async throws {
        // Would delete from database
    }

    func getPluginSetting(_ pluginId: String, key: String) async throws -> Any? {
        return nil
    }

    func setPluginSetting(_ pluginId: String, key: String, value: Any) async throws {
        // Would update database
    }
}
