//
//  PluginPermissions.swift
//  ChainlessChain
//
//  插件权限定义
//  定义插件可申请的各类权限
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation

// MARK: - Plugin Permissions

/// 插件权限集
public struct PluginPermissions: Codable {
    // 文件系统权限
    public var filesystem: FileSystemPermission

    // 网络权限
    public var network: NetworkPermission

    // 系统权限
    public var system: SystemPermission

    // AI权限
    public var ai: AIPermission

    // 区块链权限
    public var blockchain: BlockchainPermission

    public init(
        filesystem: FileSystemPermission = FileSystemPermission(),
        network: NetworkPermission = NetworkPermission(),
        system: SystemPermission = SystemPermission(),
        ai: AIPermission = AIPermission(),
        blockchain: BlockchainPermission = BlockchainPermission()
    ) {
        self.filesystem = filesystem
        self.network = network
        self.system = system
        self.ai = ai
        self.blockchain = blockchain
    }

    /// 获取所有已授权的权限列表
    public var grantedPermissions: [String] {
        var permissions: [String] = []

        if filesystem.read { permissions.append("filesystem.read") }
        if filesystem.write { permissions.append("filesystem.write") }
        if filesystem.execute { permissions.append("filesystem.execute") }

        if network.http { permissions.append("network.http") }
        if network.websocket { permissions.append("network.websocket") }

        if system.clipboard { permissions.append("system.clipboard") }
        if system.notifications { permissions.append("system.notifications") }
        if system.shell { permissions.append("system.shell") }

        if ai.chat { permissions.append("ai.chat") }
        if ai.embedding { permissions.append("ai.embedding") }
        if ai.toolUse { permissions.append("ai.toolUse") }

        if blockchain.read { permissions.append("blockchain.read") }
        if blockchain.sign { permissions.append("blockchain.sign") }
        if blockchain.transfer { permissions.append("blockchain.transfer") }

        return permissions
    }
}

// MARK: - File System Permission

/// 文件系统权限
public struct FileSystemPermission: Codable {
    public var read: Bool
    public var write: Bool
    public var execute: Bool
    public var allowedPaths: [String]
    public var deniedPaths: [String]
    public var maxFileSize: Int // 字节

    public init(
        read: Bool = false,
        write: Bool = false,
        execute: Bool = false,
        allowedPaths: [String] = [],
        deniedPaths: [String] = [],
        maxFileSize: Int = 10 * 1024 * 1024 // 10MB
    ) {
        self.read = read
        self.write = write
        self.execute = execute
        self.allowedPaths = allowedPaths
        self.deniedPaths = deniedPaths
        self.maxFileSize = maxFileSize
    }

    /// 检查路径是否允许
    public func isPathAllowed(_ path: String) -> Bool {
        // 检查禁止路径
        for denied in deniedPaths {
            if path.hasPrefix(denied) {
                return false
            }
        }

        // 如果指定了允许路径，必须在允许列表中
        if !allowedPaths.isEmpty {
            for allowed in allowedPaths {
                if path.hasPrefix(allowed) {
                    return true
                }
            }
            return false
        }

        return true
    }
}

// MARK: - Network Permission

/// 网络权限
public struct NetworkPermission: Codable {
    public var http: Bool
    public var websocket: Bool
    public var allowedDomains: [String]
    public var deniedDomains: [String]
    public var maxRequestsPerMinute: Int

    public init(
        http: Bool = false,
        websocket: Bool = false,
        allowedDomains: [String] = [],
        deniedDomains: [String] = [],
        maxRequestsPerMinute: Int = 60
    ) {
        self.http = http
        self.websocket = websocket
        self.allowedDomains = allowedDomains
        self.deniedDomains = deniedDomains
        self.maxRequestsPerMinute = maxRequestsPerMinute
    }

    /// 检查域名是否允许
    public func isDomainAllowed(_ domain: String) -> Bool {
        for denied in deniedDomains {
            if domain.hasSuffix(denied) || domain == denied {
                return false
            }
        }

        if !allowedDomains.isEmpty {
            for allowed in allowedDomains {
                if domain.hasSuffix(allowed) || domain == allowed {
                    return true
                }
            }
            return false
        }

        return true
    }
}

// MARK: - System Permission

/// 系统权限
public struct SystemPermission: Codable {
    public var clipboard: Bool
    public var notifications: Bool
    public var shell: Bool
    public var camera: Bool
    public var microphone: Bool
    public var location: Bool
    public var contacts: Bool
    public var calendar: Bool

    public init(
        clipboard: Bool = false,
        notifications: Bool = false,
        shell: Bool = false,
        camera: Bool = false,
        microphone: Bool = false,
        location: Bool = false,
        contacts: Bool = false,
        calendar: Bool = false
    ) {
        self.clipboard = clipboard
        self.notifications = notifications
        self.shell = shell
        self.camera = camera
        self.microphone = microphone
        self.location = location
        self.contacts = contacts
        self.calendar = calendar
    }
}

// MARK: - AI Permission

/// AI权限
public struct AIPermission: Codable {
    public var chat: Bool
    public var embedding: Bool
    public var toolUse: Bool
    public var modelSelection: Bool
    public var maxTokensPerRequest: Int
    public var maxRequestsPerHour: Int

    public init(
        chat: Bool = false,
        embedding: Bool = false,
        toolUse: Bool = false,
        modelSelection: Bool = false,
        maxTokensPerRequest: Int = 4096,
        maxRequestsPerHour: Int = 100
    ) {
        self.chat = chat
        self.embedding = embedding
        self.toolUse = toolUse
        self.modelSelection = modelSelection
        self.maxTokensPerRequest = maxTokensPerRequest
        self.maxRequestsPerHour = maxRequestsPerHour
    }
}

// MARK: - Blockchain Permission

/// 区块链权限
public struct BlockchainPermission: Codable {
    public var read: Bool
    public var sign: Bool
    public var transfer: Bool
    public var contract: Bool
    public var allowedChains: [String]
    public var maxTransactionValue: Double

    public init(
        read: Bool = false,
        sign: Bool = false,
        transfer: Bool = false,
        contract: Bool = false,
        allowedChains: [String] = [],
        maxTransactionValue: Double = 0
    ) {
        self.read = read
        self.sign = sign
        self.transfer = transfer
        self.contract = contract
        self.allowedChains = allowedChains
        self.maxTransactionValue = maxTransactionValue
    }

    /// 检查链是否允许
    public func isChainAllowed(_ chainId: String) -> Bool {
        if allowedChains.isEmpty {
            return true
        }
        return allowedChains.contains(chainId)
    }
}
