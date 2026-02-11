//
//  PluginManifest.swift
//  ChainlessChain
//
//  插件清单定义
//  描述插件的元数据和配置
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation

// MARK: - Plugin Manifest

/// 插件清单
public struct PluginManifest: Codable {
    public var manifestVersion: String
    public var pluginVersion: String
    public var minAppVersion: String?
    public var maxAppVersion: String?

    // 入口点
    public var entryPoint: String?
    public var mainClass: String?

    // 依赖
    public var dependencies: [PluginDependency]

    // 动作定义
    public var actions: [PluginActionDefinition]

    // 触发器
    public var triggers: [PluginTrigger]

    // UI扩展
    public var uiExtensions: [UIExtension]

    // 配置项
    public var settings: [PluginSetting]

    // 资源
    public var resources: [String]

    // 本地化
    public var localizations: [String: PluginLocalization]

    public init(
        manifestVersion: String = "1.0",
        pluginVersion: String = "1.0.0",
        minAppVersion: String? = nil,
        maxAppVersion: String? = nil,
        entryPoint: String? = nil,
        mainClass: String? = nil,
        dependencies: [PluginDependency] = [],
        actions: [PluginActionDefinition] = [],
        triggers: [PluginTrigger] = [],
        uiExtensions: [UIExtension] = [],
        settings: [PluginSetting] = [],
        resources: [String] = [],
        localizations: [String: PluginLocalization] = [:]
    ) {
        self.manifestVersion = manifestVersion
        self.pluginVersion = pluginVersion
        self.minAppVersion = minAppVersion
        self.maxAppVersion = maxAppVersion
        self.entryPoint = entryPoint
        self.mainClass = mainClass
        self.dependencies = dependencies
        self.actions = actions
        self.triggers = triggers
        self.uiExtensions = uiExtensions
        self.settings = settings
        self.resources = resources
        self.localizations = localizations
    }
}

// MARK: - Plugin Dependency

/// 插件依赖
public struct PluginDependency: Codable, Identifiable {
    public var id: String { pluginId }
    public let pluginId: String
    public let version: String
    public var optional: Bool

    public init(
        pluginId: String,
        version: String,
        optional: Bool = false
    ) {
        self.pluginId = pluginId
        self.version = version
        self.optional = optional
    }
}

// MARK: - Plugin Action Definition

/// 插件动作定义
public struct PluginActionDefinition: Codable, Identifiable {
    public let id: String
    public let name: String
    public var description: String?
    public var icon: String?
    public var shortcut: String?
    public var handler: String
    public var inputSchema: [String: SchemaField]?
    public var outputSchema: [String: SchemaField]?
    public var isAsync: Bool
    public var timeout: TimeInterval
    public var retryCount: Int

    public init(
        id: String,
        name: String,
        description: String? = nil,
        icon: String? = nil,
        shortcut: String? = nil,
        handler: String,
        inputSchema: [String: SchemaField]? = nil,
        outputSchema: [String: SchemaField]? = nil,
        isAsync: Bool = false,
        timeout: TimeInterval = 30,
        retryCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.shortcut = shortcut
        self.handler = handler
        self.inputSchema = inputSchema
        self.outputSchema = outputSchema
        self.isAsync = isAsync
        self.timeout = timeout
        self.retryCount = retryCount
    }
}

/// 模式字段
public struct SchemaField: Codable {
    public let type: String
    public var description: String?
    public var required: Bool
    public var defaultValue: String?
    public var enumValues: [String]?

    public init(
        type: String,
        description: String? = nil,
        required: Bool = false,
        defaultValue: String? = nil,
        enumValues: [String]? = nil
    ) {
        self.type = type
        self.description = description
        self.required = required
        self.defaultValue = defaultValue
        self.enumValues = enumValues
    }
}

// MARK: - Plugin Trigger

/// 插件触发器
public struct PluginTrigger: Codable, Identifiable {
    public let id: String
    public let event: String
    public let handler: String
    public var conditions: [TriggerCondition]?
    public var debounce: TimeInterval?

    public init(
        id: String,
        event: String,
        handler: String,
        conditions: [TriggerCondition]? = nil,
        debounce: TimeInterval? = nil
    ) {
        self.id = id
        self.event = event
        self.handler = handler
        self.conditions = conditions
        self.debounce = debounce
    }
}

/// 触发条件
public struct TriggerCondition: Codable {
    public let field: String
    public let operator: String
    public let value: String

    public init(field: String, operator: String, value: String) {
        self.field = field
        self.operator = `operator`
        self.value = value
    }
}

// MARK: - UI Extension

/// UI扩展点
public struct UIExtension: Codable, Identifiable {
    public let id: String
    public let type: UIExtensionType
    public let location: String
    public var icon: String?
    public var title: String?
    public var handler: String?

    public init(
        id: String,
        type: UIExtensionType,
        location: String,
        icon: String? = nil,
        title: String? = nil,
        handler: String? = nil
    ) {
        self.id = id
        self.type = type
        self.location = location
        self.icon = icon
        self.title = title
        self.handler = handler
    }
}

/// UI扩展类型
public enum UIExtensionType: String, Codable {
    case menuItem = "menu_item"
    case toolbar = "toolbar"
    case sidebar = "sidebar"
    case contextMenu = "context_menu"
    case panel = "panel"
    case statusBar = "status_bar"
}

// MARK: - Plugin Setting

/// 插件设置项
public struct PluginSetting: Codable, Identifiable {
    public let id: String
    public let key: String
    public let type: SettingType
    public var title: String
    public var description: String?
    public var defaultValue: AnyCodable?
    public var options: [SettingOption]?
    public var validation: SettingValidation?

    public init(
        id: String,
        key: String,
        type: SettingType,
        title: String,
        description: String? = nil,
        defaultValue: AnyCodable? = nil,
        options: [SettingOption]? = nil,
        validation: SettingValidation? = nil
    ) {
        self.id = id
        self.key = key
        self.type = type
        self.title = title
        self.description = description
        self.defaultValue = defaultValue
        self.options = options
        self.validation = validation
    }
}

/// 设置类型
public enum SettingType: String, Codable {
    case string = "string"
    case number = "number"
    case boolean = "boolean"
    case select = "select"
    case multiSelect = "multi_select"
    case color = "color"
    case file = "file"
    case folder = "folder"
}

/// 设置选项
public struct SettingOption: Codable {
    public let value: String
    public let label: String

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }
}

/// 设置验证
public struct SettingValidation: Codable {
    public var minLength: Int?
    public var maxLength: Int?
    public var pattern: String?
    public var min: Double?
    public var max: Double?

    public init(
        minLength: Int? = nil,
        maxLength: Int? = nil,
        pattern: String? = nil,
        min: Double? = nil,
        max: Double? = nil
    ) {
        self.minLength = minLength
        self.maxLength = maxLength
        self.pattern = pattern
        self.min = min
        self.max = max
    }
}

// MARK: - Plugin Localization

/// 插件本地化
public struct PluginLocalization: Codable {
    public var name: String?
    public var description: String?
    public var strings: [String: String]

    public init(
        name: String? = nil,
        description: String? = nil,
        strings: [String: String] = [:]
    ) {
        self.name = name
        self.description = description
        self.strings = strings
    }
}
