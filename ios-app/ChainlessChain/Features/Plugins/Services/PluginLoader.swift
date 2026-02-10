import Foundation
import ZIPFoundation

// MARK: - PluginLoader
/// Plugin loading and installation
/// Ported from PC: plugins/plugin-loader.js
///
/// Features:
/// - Load plugins from various sources (local, ZIP, URL)
/// - Validate plugin manifests
/// - Install plugins to plugin directory
/// - Manage plugin dependencies
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Plugin Loader Errors

enum PluginLoaderError: Error, LocalizedError {
    case manifestNotFound
    case invalidManifest(String)
    case invalidVersion(String)
    case invalidPluginId(String)
    case entryFileNotFound(String)
    case unsupportedSource(String)
    case installationFailed(String)
    case unzipFailed(String)
    case downloadFailed(String)
    case dependencyMissing([String])
    case dependencyIncompatible(String)

    var errorDescription: String? {
        switch self {
        case .manifestNotFound:
            return "Cannot find plugin.json or package.json"
        case .invalidManifest(let reason):
            return "Invalid manifest: \(reason)"
        case .invalidVersion(let version):
            return "Invalid version format: \(version), should be x.y.z"
        case .invalidPluginId(let id):
            return "Invalid plugin ID: \(id), only lowercase letters, numbers, dots, and dashes allowed"
        case .entryFileNotFound(let path):
            return "Plugin entry file not found: \(path)"
        case .unsupportedSource(let source):
            return "Unsupported plugin source: \(source)"
        case .installationFailed(let reason):
            return "Plugin installation failed: \(reason)"
        case .unzipFailed(let reason):
            return "Failed to unzip plugin: \(reason)"
        case .downloadFailed(let reason):
            return "Failed to download plugin: \(reason)"
        case .dependencyMissing(let deps):
            return "Missing dependencies: \(deps.joined(separator: ", "))"
        case .dependencyIncompatible(let info):
            return "Incompatible dependency: \(info)"
        }
    }
}

// MARK: - Plugin Source Type

/// Types of plugin sources
enum PluginSourceType {
    case localDirectory(URL)
    case zipFile(URL)
    case remoteURL(URL)
    case bundled(String)
}

// MARK: - Plugin Loader

/// Loads and installs plugins from various sources
class PluginLoader {

    // MARK: - Properties

    private let logger = Logger.shared
    private let fileManager = FileManager.default

    /// Plugin installation directory
    let pluginsDirectory: URL

    /// Temporary directory for downloads/extracts
    let tempDirectory: URL

    // MARK: - Initialization

    init() {
        // Get app support directory
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appDirectory = appSupport.appendingPathComponent("ChainlessChain")

        // Set up directories
        self.pluginsDirectory = appDirectory.appendingPathComponent("plugins")
        self.tempDirectory = fileManager.temporaryDirectory.appendingPathComponent("chainlesschain-plugins")

        // Ensure directories exist
        ensureDirectories()
    }

    // MARK: - Directory Management

    /// Ensure required directories exist
    private func ensureDirectories() {
        let directories = [
            pluginsDirectory,
            pluginsDirectory.appendingPathComponent("official"),
            pluginsDirectory.appendingPathComponent("community"),
            pluginsDirectory.appendingPathComponent("custom"),
            tempDirectory
        ]

        for dir in directories {
            if !fileManager.fileExists(atPath: dir.path) {
                try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
            }
        }
    }

    // MARK: - Source Resolution

    /// Resolve plugin source to a local path
    /// - Parameter source: Plugin source (path, URL, or bundle name)
    /// - Returns: Resolved local path
    func resolve(source: String) async throws -> URL {
        logger.info("[PluginLoader] Resolving source: \(source)")

        // Check if it's a local path
        let localURL = URL(fileURLWithPath: source)
        if fileManager.fileExists(atPath: source) {
            var isDirectory: ObjCBool = false
            fileManager.fileExists(atPath: source, isDirectory: &isDirectory)

            if isDirectory.boolValue {
                logger.info("[PluginLoader] Identified as local directory")
                return localURL
            }

            if source.hasSuffix(".zip") {
                logger.info("[PluginLoader] Identified as ZIP file")
                return try await extractZip(from: localURL)
            }
        }

        // Check if it's a remote URL
        if source.hasPrefix("https://") || source.hasPrefix("http://") {
            guard let url = URL(string: source) else {
                throw PluginLoaderError.unsupportedSource(source)
            }
            logger.info("[PluginLoader] Identified as remote URL")
            return try await downloadPlugin(from: url)
        }

        // Check if it's a bundled plugin
        if let bundleURL = Bundle.main.url(forResource: source, withExtension: nil, subdirectory: "Plugins") {
            logger.info("[PluginLoader] Identified as bundled plugin")
            return bundleURL
        }

        throw PluginLoaderError.unsupportedSource(source)
    }

    // MARK: - Manifest Loading

    /// Load and validate plugin manifest
    /// - Parameter pluginPath: Path to plugin directory
    /// - Returns: Parsed manifest
    func loadManifest(from pluginPath: URL) throws -> PluginManifest {
        let manifestPath = pluginPath.appendingPathComponent("plugin.json")
        let packagePath = pluginPath.appendingPathComponent("package.json")

        // Try plugin.json first
        if fileManager.fileExists(atPath: manifestPath.path) {
            let data = try Data(contentsOf: manifestPath)
            let manifest = try JSONDecoder().decode(PluginManifest.self, from: data)
            try validateManifest(manifest)
            return manifest
        }

        // Fall back to package.json
        if fileManager.fileExists(atPath: packagePath.path) {
            return try parsePackageJson(at: packagePath)
        }

        throw PluginLoaderError.manifestNotFound
    }

    /// Parse package.json as plugin manifest
    private func parsePackageJson(at path: URL) throws -> PluginManifest {
        let data = try Data(contentsOf: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PluginLoaderError.invalidManifest("Cannot parse package.json")
        }

        // Check for chainlesschain config section
        guard let chainlessConfig = json["chainlesschain"] as? [String: Any] else {
            throw PluginLoaderError.invalidManifest("Missing chainlesschain config in package.json")
        }

        // Build manifest from package.json + chainlesschain config
        let id = (chainlessConfig["id"] as? String) ?? (json["name"] as? String) ?? ""
        let name = (json["name"] as? String) ?? id
        let version = (json["version"] as? String) ?? "1.0.0"

        let manifest = PluginManifest(
            id: id,
            name: name,
            version: version,
            author: json["author"] as? String,
            description: json["description"] as? String,
            homepage: json["homepage"] as? String,
            license: json["license"] as? String,
            main: (json["main"] as? String) ?? "index.js",
            category: PluginCategory(rawValue: chainlessConfig["category"] as? String ?? "custom") ?? .custom,
            permissions: parsePermissions(chainlessConfig["permissions"]),
            dependencies: (json["dependencies"] as? [String: String]) ?? [:]
        )

        try validateManifest(manifest)
        return manifest
    }

    /// Parse permissions array
    private func parsePermissions(_ raw: Any?) -> [PluginPermission] {
        guard let array = raw as? [String] else { return [] }
        return array.compactMap { PluginPermission(rawValue: $0) }
    }

    /// Validate manifest required fields
    private func validateManifest(_ manifest: PluginManifest) throws {
        // Check required fields
        if manifest.id.isEmpty {
            throw PluginLoaderError.invalidManifest("Missing required field: id")
        }
        if manifest.name.isEmpty {
            throw PluginLoaderError.invalidManifest("Missing required field: name")
        }
        if manifest.version.isEmpty {
            throw PluginLoaderError.invalidManifest("Missing required field: version")
        }

        // Validate version format (x.y.z)
        let versionRegex = try! NSRegularExpression(pattern: #"^\d+\.\d+\.\d+"#)
        let versionRange = NSRange(manifest.version.startIndex..., in: manifest.version)
        if versionRegex.firstMatch(in: manifest.version, range: versionRange) == nil {
            throw PluginLoaderError.invalidVersion(manifest.version)
        }

        // Validate plugin ID format
        let idRegex = try! NSRegularExpression(pattern: #"^[a-z0-9.-]+$"#)
        let idRange = NSRange(manifest.id.startIndex..., in: manifest.id)
        if idRegex.firstMatch(in: manifest.id, range: idRange) == nil {
            throw PluginLoaderError.invalidPluginId(manifest.id)
        }

        logger.info("[PluginLoader] Manifest validation passed: \(manifest.id)")
    }

    // MARK: - Installation

    /// Install plugin to plugins directory
    /// - Parameters:
    ///   - sourcePath: Source plugin path
    ///   - manifest: Plugin manifest
    /// - Returns: Installed path
    func install(from sourcePath: URL, manifest: PluginManifest) throws -> URL {
        let category = manifest.category.rawValue
        let targetPath = pluginsDirectory
            .appendingPathComponent(category)
            .appendingPathComponent(manifest.id)

        logger.info("[PluginLoader] Installing plugin: \(manifest.id) -> \(targetPath.path)")

        // Remove existing if present
        if fileManager.fileExists(atPath: targetPath.path) {
            logger.warning("[PluginLoader] Target path exists, will be replaced")
            try fileManager.removeItem(at: targetPath)
        }

        // Create target directory
        try fileManager.createDirectory(at: targetPath, withIntermediateDirectories: true)

        // Copy files
        try copyPluginFiles(from: sourcePath, to: targetPath)

        logger.info("[PluginLoader] Plugin installed successfully: \(targetPath.path)")

        return targetPath
    }

    /// Copy plugin files excluding node_modules
    private func copyPluginFiles(from source: URL, to destination: URL) throws {
        let contents = try fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: nil)

        for item in contents {
            let itemName = item.lastPathComponent

            // Skip node_modules
            if itemName == "node_modules" {
                continue
            }

            let destItem = destination.appendingPathComponent(itemName)

            var isDirectory: ObjCBool = false
            fileManager.fileExists(atPath: item.path, isDirectory: &isDirectory)

            if isDirectory.boolValue {
                try fileManager.createDirectory(at: destItem, withIntermediateDirectories: true)
                try copyPluginFiles(from: item, to: destItem)
            } else {
                try fileManager.copyItem(at: item, to: destItem)
            }
        }
    }

    /// Uninstall plugin
    /// - Parameter pluginPath: Path to installed plugin
    func uninstall(at pluginPath: URL) throws {
        if fileManager.fileExists(atPath: pluginPath.path) {
            logger.info("[PluginLoader] Uninstalling plugin: \(pluginPath.path)")
            try fileManager.removeItem(at: pluginPath)
            logger.info("[PluginLoader] Plugin removed")
        }
    }

    // MARK: - ZIP Handling

    /// Extract ZIP file to temporary directory
    private func extractZip(from zipPath: URL) async throws -> URL {
        let extractPath = tempDirectory.appendingPathComponent("extract_\(Date().timeIntervalSince1970)")

        try fileManager.createDirectory(at: extractPath, withIntermediateDirectories: true)

        do {
            try fileManager.unzipItem(at: zipPath, to: extractPath)
            logger.info("[PluginLoader] ZIP extracted to: \(extractPath.path)")
            return extractPath
        } catch {
            throw PluginLoaderError.unzipFailed(error.localizedDescription)
        }
    }

    // MARK: - Download

    /// Download plugin from remote URL
    private func downloadPlugin(from url: URL) async throws -> URL {
        logger.info("[PluginLoader] Downloading plugin from: \(url)")

        let downloadPath = tempDirectory.appendingPathComponent("download_\(Date().timeIntervalSince1970).zip")

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw PluginLoaderError.downloadFailed("HTTP error")
            }

            try data.write(to: downloadPath)
            logger.info("[PluginLoader] Downloaded to: \(downloadPath.path)")

            // Extract if it's a ZIP
            if url.pathExtension.lowercased() == "zip" {
                return try await extractZip(from: downloadPath)
            }

            return downloadPath
        } catch let error as PluginLoaderError {
            throw error
        } catch {
            throw PluginLoaderError.downloadFailed(error.localizedDescription)
        }
    }

    // MARK: - Code Loading

    /// Load plugin code information
    /// - Parameter pluginPath: Path to plugin
    /// - Returns: Code info including entry path and manifest
    func loadCode(from pluginPath: URL) throws -> PluginCodeInfo {
        let manifest = try loadManifest(from: pluginPath)
        let entryFile = manifest.main
        let entryPath = pluginPath.appendingPathComponent(entryFile)

        if !fileManager.fileExists(atPath: entryPath.path) {
            throw PluginLoaderError.entryFileNotFound(entryPath.path)
        }

        // Read code content
        let code = try String(contentsOf: entryPath, encoding: .utf8)

        return PluginCodeInfo(
            code: code,
            entryPath: entryPath,
            manifest: manifest
        )
    }

    // MARK: - Dependency Resolution

    /// Resolve plugin dependencies
    /// - Parameters:
    ///   - manifest: Plugin manifest
    ///   - installedPlugins: Currently installed plugins
    /// - Returns: Dependency resolution result
    func resolveDependencies(
        manifest: PluginManifest,
        installedPlugins: [String: PluginInfo]
    ) -> DependencyResolutionResult {
        guard !manifest.dependencies.isEmpty else {
            return DependencyResolutionResult(missing: [], incompatible: [], resolved: true)
        }

        logger.info("[PluginLoader] Resolving dependencies: \(manifest.dependencies.keys)")

        var missing: [PluginDependency] = []
        var incompatible: [(name: String, required: String, installed: String)] = []

        for (depName, versionConstraint) in manifest.dependencies {
            // Check if it's a plugin dependency
            if depName.hasPrefix("@chainlesschain/") || depName.hasPrefix("chainlesschain-") {
                if let installed = installedPlugins[depName] {
                    // Check version compatibility
                    if !isVersionCompatible(installed.manifest.version, with: versionConstraint) {
                        incompatible.append((
                            name: depName,
                            required: versionConstraint,
                            installed: installed.manifest.version
                        ))
                    }
                } else {
                    missing.append(PluginDependency(
                        pluginId: manifest.id,
                        dependencyId: depName,
                        type: .plugin,
                        version: versionConstraint
                    ))
                }
            }
            // System dependencies would be checked here
        }

        let resolved = missing.isEmpty && incompatible.isEmpty

        if !resolved {
            if !missing.isEmpty {
                logger.warning("[PluginLoader] Missing dependencies: \(missing.map { $0.dependencyId })")
            }
            if !incompatible.isEmpty {
                logger.warning("[PluginLoader] Incompatible dependencies: \(incompatible)")
            }
        }

        return DependencyResolutionResult(
            missing: missing,
            incompatible: incompatible.map { "\($0.name) (need \($0.required), have \($0.installed))" },
            resolved: resolved
        )
    }

    /// Simple version compatibility check
    private func isVersionCompatible(_ version: String, with constraint: String) -> Bool {
        // Simple implementation - exact match or prefix match
        if constraint.hasPrefix("^") {
            let major = constraint.dropFirst().components(separatedBy: ".").first ?? ""
            let versionMajor = version.components(separatedBy: ".").first ?? ""
            return major == versionMajor
        }
        if constraint.hasPrefix(">=") {
            let required = String(constraint.dropFirst(2))
            return compareVersions(version, required) >= 0
        }
        if constraint.hasPrefix(">") {
            let required = String(constraint.dropFirst())
            return compareVersions(version, required) > 0
        }
        return version.hasPrefix(constraint.replacingOccurrences(of: "x", with: ""))
    }

    /// Compare semantic versions
    private func compareVersions(_ v1: String, _ v2: String) -> Int {
        let parts1 = v1.components(separatedBy: ".").compactMap { Int($0) }
        let parts2 = v2.components(separatedBy: ".").compactMap { Int($0) }

        for i in 0..<max(parts1.count, parts2.count) {
            let p1 = i < parts1.count ? parts1[i] : 0
            let p2 = i < parts2.count ? parts2[i] : 0
            if p1 != p2 {
                return p1 - p2
            }
        }
        return 0
    }

    // MARK: - Cleanup

    /// Clean up temporary files
    func cleanupTemp() {
        do {
            let contents = try fileManager.contentsOfDirectory(at: tempDirectory, includingPropertiesForKeys: nil)
            for item in contents {
                try? fileManager.removeItem(at: item)
            }
            logger.info("[PluginLoader] Temp directory cleaned")
        } catch {
            logger.warning("[PluginLoader] Failed to clean temp: \(error)")
        }
    }
}

// MARK: - Supporting Types

/// Plugin code information
struct PluginCodeInfo {
    let code: String
    let entryPath: URL
    let manifest: PluginManifest
}

/// Dependency resolution result
struct DependencyResolutionResult {
    let missing: [PluginDependency]
    let incompatible: [String]
    let resolved: Bool
}
