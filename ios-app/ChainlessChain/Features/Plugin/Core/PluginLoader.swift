//
//  PluginLoader.swift
//  ChainlessChain
//
//  插件加载器
//  负责插件的加载和解析
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Plugin Loader

/// 插件加载器
public class PluginLoader {
    public static let shared = PluginLoader()

    // MARK: - Private Properties

    private let manifestFileName = "plugin.json"
    private let supportedVersions = ["1.0", "1.1"]

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[PluginLoader] 初始化完成")
    }

    // MARK: - Public Methods

    /// 从URL加载插件
    public func loadPlugin(from url: URL) async throws -> Plugin {
        Logger.shared.info("[PluginLoader] 加载插件: \(url.lastPathComponent)")

        // 检查是否是目录
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            throw PluginError.notFound(url.path)
        }

        // 获取清单路径
        let manifestUrl: URL
        if isDirectory.boolValue {
            manifestUrl = url.appendingPathComponent(manifestFileName)
        } else if url.pathExtension == "zip" {
            // 解压并获取清单
            let extractedUrl = try await extractPlugin(from: url)
            manifestUrl = extractedUrl.appendingPathComponent(manifestFileName)
        } else if url.lastPathComponent == manifestFileName {
            manifestUrl = url
        } else {
            throw PluginError.loadFailed("不支持的插件格式")
        }

        // 读取清单
        guard FileManager.default.fileExists(atPath: manifestUrl.path) else {
            throw PluginError.loadFailed("找不到插件清单文件")
        }

        let manifestData = try Data(contentsOf: manifestUrl)
        let rawManifest = try JSONDecoder().decode(RawPluginManifest.self, from: manifestData)

        // 验证清单版本
        guard supportedVersions.contains(rawManifest.manifestVersion) else {
            throw PluginError.versionMismatch("不支持的清单版本: \(rawManifest.manifestVersion)")
        }

        // 构建插件对象
        let plugin = buildPlugin(from: rawManifest, sourceUrl: url)

        Logger.shared.info("[PluginLoader] 插件加载成功: \(plugin.name) v\(plugin.version)")

        return plugin
    }

    /// 加载插件动作
    public func loadActions(for plugin: Plugin) async throws -> [String: PluginAction] {
        Logger.shared.info("[PluginLoader] 加载动作: \(plugin.name)")

        var actions: [String: PluginAction] = [:]

        for actionDef in plugin.manifest.actions {
            let action = PluginAction(
                id: actionDef.id,
                name: actionDef.name,
                description: actionDef.description,
                icon: actionDef.icon,
                shortcut: actionDef.shortcut,
                inputSchema: convertSchema(actionDef.inputSchema),
                outputSchema: convertSchema(actionDef.outputSchema),
                isAsync: actionDef.isAsync,
                timeout: actionDef.timeout
            )

            actions[action.id] = action
        }

        Logger.shared.info("[PluginLoader] 加载了 \(actions.count) 个动作")

        return actions
    }

    /// 重新加载插件
    public func reloadPlugin(_ plugin: Plugin) async throws -> Plugin {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let pluginPath = documentsPath.appendingPathComponent("Plugins/\(plugin.id)")

        return try await loadPlugin(from: pluginPath)
    }

    /// 检查插件更新
    public func checkForUpdates(_ plugin: Plugin) async throws -> PluginUpdateInfo? {
        // 这里应该调用远程API检查更新
        // 简化实现，返回nil表示没有更新
        return nil
    }

    // MARK: - Private Methods

    private func extractPlugin(from zipUrl: URL) async throws -> URL {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("plugin_extract_\(UUID().uuidString)")

        try FileManager.default.createDirectory(
            at: tempDirectory,
            withIntermediateDirectories: true
        )

        // 使用系统解压功能
        // 注意：iOS上可能需要使用ZIPFoundation或类似库
        do {
            try await unzipFile(at: zipUrl, to: tempDirectory)
            return tempDirectory
        } catch {
            throw PluginError.loadFailed("解压失败: \(error.localizedDescription)")
        }
    }

    private func unzipFile(at source: URL, to destination: URL) async throws {
        // 简化的解压实现
        // 实际应该使用ZIPFoundation或其他库
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-o", source.path, "-d", destination.path]

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            throw PluginError.loadFailed("解压失败")
        }
    }

    private func buildPlugin(from manifest: RawPluginManifest, sourceUrl: URL) -> Plugin {
        // 构建权限
        let permissions = PluginPermissions(
            filesystem: FileSystemPermission(
                read: manifest.permissions?.filesystem?.read ?? false,
                write: manifest.permissions?.filesystem?.write ?? false,
                execute: manifest.permissions?.filesystem?.execute ?? false,
                allowedPaths: manifest.permissions?.filesystem?.allowedPaths ?? [],
                deniedPaths: manifest.permissions?.filesystem?.deniedPaths ?? []
            ),
            network: NetworkPermission(
                http: manifest.permissions?.network?.http ?? false,
                websocket: manifest.permissions?.network?.websocket ?? false,
                allowedDomains: manifest.permissions?.network?.allowedDomains ?? [],
                deniedDomains: manifest.permissions?.network?.deniedDomains ?? []
            ),
            system: SystemPermission(
                clipboard: manifest.permissions?.system?.clipboard ?? false,
                notifications: manifest.permissions?.system?.notifications ?? false,
                shell: manifest.permissions?.system?.shell ?? false
            ),
            ai: AIPermission(
                chat: manifest.permissions?.ai?.chat ?? false,
                embedding: manifest.permissions?.ai?.embedding ?? false,
                toolUse: manifest.permissions?.ai?.toolUse ?? false
            ),
            blockchain: BlockchainPermission(
                read: manifest.permissions?.blockchain?.read ?? false,
                sign: manifest.permissions?.blockchain?.sign ?? false,
                transfer: manifest.permissions?.blockchain?.transfer ?? false
            )
        )

        // 构建清单
        let pluginManifest = PluginManifest(
            manifestVersion: manifest.manifestVersion,
            pluginVersion: manifest.version,
            minAppVersion: manifest.minAppVersion,
            maxAppVersion: manifest.maxAppVersion,
            entryPoint: manifest.entryPoint,
            mainClass: manifest.mainClass,
            dependencies: manifest.dependencies?.map { dep in
                PluginDependency(
                    pluginId: dep.pluginId,
                    version: dep.version,
                    optional: dep.optional ?? false
                )
            } ?? [],
            actions: manifest.actions?.map { action in
                PluginActionDefinition(
                    id: action.id,
                    name: action.name,
                    description: action.description,
                    icon: action.icon,
                    shortcut: action.shortcut,
                    handler: action.handler,
                    inputSchema: action.inputSchema,
                    outputSchema: action.outputSchema,
                    isAsync: action.isAsync ?? false,
                    timeout: action.timeout ?? 30,
                    retryCount: action.retryCount ?? 0
                )
            } ?? [],
            triggers: manifest.triggers?.map { trigger in
                PluginTrigger(
                    id: trigger.id,
                    event: trigger.event,
                    handler: trigger.handler,
                    conditions: trigger.conditions?.map { cond in
                        TriggerCondition(
                            field: cond.field,
                            operator: cond.operator,
                            value: cond.value
                        )
                    },
                    debounce: trigger.debounce
                )
            } ?? [],
            uiExtensions: manifest.uiExtensions?.map { ext in
                UIExtension(
                    id: ext.id,
                    type: UIExtensionType(rawValue: ext.type) ?? .menuItem,
                    location: ext.location,
                    icon: ext.icon,
                    title: ext.title,
                    handler: ext.handler
                )
            } ?? [],
            settings: manifest.settings?.map { setting in
                PluginSetting(
                    id: setting.id,
                    key: setting.key,
                    type: SettingType(rawValue: setting.type) ?? .string,
                    title: setting.title,
                    description: setting.description,
                    defaultValue: setting.defaultValue.map { AnyCodable($0) },
                    options: setting.options?.map { opt in
                        SettingOption(value: opt.value, label: opt.label)
                    },
                    validation: setting.validation.map { val in
                        SettingValidation(
                            minLength: val.minLength,
                            maxLength: val.maxLength,
                            pattern: val.pattern,
                            min: val.min,
                            max: val.max
                        )
                    }
                )
            } ?? [],
            resources: manifest.resources ?? [],
            localizations: manifest.localizations?.mapValues { loc in
                PluginLocalization(
                    name: loc.name,
                    description: loc.description,
                    strings: loc.strings ?? [:]
                )
            } ?? [:]
        )

        return Plugin(
            id: manifest.id ?? UUID().uuidString,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? "",
            author: manifest.author ?? "Unknown",
            homepage: manifest.homepage,
            icon: manifest.icon,
            category: PluginCategory(rawValue: manifest.category ?? "utility") ?? .utility,
            tags: manifest.tags ?? [],
            permissions: permissions,
            manifest: pluginManifest,
            isEnabled: true,
            isInstalled: false
        )
    }

    private func convertSchema(_ schema: [String: SchemaField]?) -> PluginSchema? {
        guard let schema = schema else { return nil }

        return PluginSchema(
            type: "object",
            properties: schema.mapValues { field in
                PluginSchemaProperty(
                    type: field.type,
                    description: field.description,
                    defaultValue: field.defaultValue.map { AnyCodable($0) },
                    enumValues: field.enumValues
                )
            },
            required: schema.filter { $0.value.required }.map { $0.key }
        )
    }
}

// MARK: - Raw Plugin Manifest

/// 原始插件清单（用于JSON解析）
private struct RawPluginManifest: Codable {
    let manifestVersion: String
    let id: String?
    let name: String
    let version: String
    let description: String?
    let author: String?
    let homepage: String?
    let icon: String?
    let category: String?
    let tags: [String]?
    let minAppVersion: String?
    let maxAppVersion: String?
    let entryPoint: String?
    let mainClass: String?
    let dependencies: [RawDependency]?
    let permissions: RawPermissions?
    let actions: [RawAction]?
    let triggers: [RawTrigger]?
    let uiExtensions: [RawUIExtension]?
    let settings: [RawSetting]?
    let resources: [String]?
    let localizations: [String: RawLocalization]?
}

private struct RawDependency: Codable {
    let pluginId: String
    let version: String
    let optional: Bool?
}

private struct RawPermissions: Codable {
    let filesystem: RawFSPermission?
    let network: RawNetworkPermission?
    let system: RawSystemPermission?
    let ai: RawAIPermission?
    let blockchain: RawBlockchainPermission?
}

private struct RawFSPermission: Codable {
    let read: Bool?
    let write: Bool?
    let execute: Bool?
    let allowedPaths: [String]?
    let deniedPaths: [String]?
}

private struct RawNetworkPermission: Codable {
    let http: Bool?
    let websocket: Bool?
    let allowedDomains: [String]?
    let deniedDomains: [String]?
}

private struct RawSystemPermission: Codable {
    let clipboard: Bool?
    let notifications: Bool?
    let shell: Bool?
}

private struct RawAIPermission: Codable {
    let chat: Bool?
    let embedding: Bool?
    let toolUse: Bool?
}

private struct RawBlockchainPermission: Codable {
    let read: Bool?
    let sign: Bool?
    let transfer: Bool?
}

private struct RawAction: Codable {
    let id: String
    let name: String
    let description: String?
    let icon: String?
    let shortcut: String?
    let handler: String
    let inputSchema: [String: SchemaField]?
    let outputSchema: [String: SchemaField]?
    let isAsync: Bool?
    let timeout: TimeInterval?
    let retryCount: Int?
}

private struct RawTrigger: Codable {
    let id: String
    let event: String
    let handler: String
    let conditions: [RawCondition]?
    let debounce: TimeInterval?
}

private struct RawCondition: Codable {
    let field: String
    let `operator`: String
    let value: String
}

private struct RawUIExtension: Codable {
    let id: String
    let type: String
    let location: String
    let icon: String?
    let title: String?
    let handler: String?
}

private struct RawSetting: Codable {
    let id: String
    let key: String
    let type: String
    let title: String
    let description: String?
    let defaultValue: String?
    let options: [RawSettingOption]?
    let validation: RawValidation?
}

private struct RawSettingOption: Codable {
    let value: String
    let label: String
}

private struct RawValidation: Codable {
    let minLength: Int?
    let maxLength: Int?
    let pattern: String?
    let min: Double?
    let max: Double?
}

private struct RawLocalization: Codable {
    let name: String?
    let description: String?
    let strings: [String: String]?
}

// MARK: - Plugin Update Info

/// 插件更新信息
public struct PluginUpdateInfo {
    public let pluginId: String
    public let currentVersion: String
    public let latestVersion: String
    public let downloadUrl: String
    public let changelog: String?
    public let size: Int
    public let mandatory: Bool
}
