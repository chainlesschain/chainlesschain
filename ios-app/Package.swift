// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "ChainlessChain",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(
            name: "CoreCommon",
            targets: ["CoreCommon"]
        ),
        .library(
            name: "CoreSecurity",
            targets: ["CoreSecurity"]
        ),
        // CoreDatabase 暂移除 — 依赖 sqlcipher/sqlcipher repo 但该 repo
        // 是 C 库，根目录无 Package.swift，SPM 无法 resolve。
        // 待替换为有 SPM 支持的 SQLCipher fork 后恢复。Modules/CoreDatabase/
        // 源文件保留，不删。
        .library(
            name: "CoreDID",
            targets: ["CoreDID"]
        ),
        .library(
            name: "CoreE2EE",
            targets: ["CoreE2EE"]
        ),
        .library(
            name: "CoreP2P",
            targets: ["CoreP2P"]
        ),
    ],
    dependencies: [
        // libsignal dep removed — signalapp/libsignal repo root 无 Package.swift
        // (Swift bindings 在 swift/ 子目录)，SPM 无法 resolve。CoreE2EE 源码
        // 实际未 import LibSignalClient，是 dead declaration。
        // SQLCipher dep removed alongside CoreDatabase target — see note above.
        // WebRTC
        .package(
            url: "https://github.com/stasel/WebRTC.git",
            from: "120.0.0"
        ),
        // WebSocket
        .package(
            url: "https://github.com/daltoniam/Starscream.git",
            from: "4.0.0"
        ),
        // Crypto
        .package(
            url: "https://github.com/krzyzanowskim/CryptoSwift.git",
            from: "1.8.0"
        ),
        // Codable utilities
        .package(
            url: "https://github.com/Flight-School/AnyCodable.git",
            from: "0.6.0"
        ),
        // WalletCore / WalletConnectSwiftV2 deps removed along with
        // CoreBlockchain target — Modules/CoreBlockchain/ directory does
        // not exist (declared but never created).
    ],
    targets: [
        // MARK: - Core Modules

        .target(
            name: "CoreCommon",
            dependencies: [
                "AnyCodable"
            ],
            path: "Modules/CoreCommon"
        ),

        .target(
            name: "CoreSecurity",
            dependencies: [
                "CoreCommon",
                "CryptoSwift"
            ],
            path: "Modules/CoreSecurity"
        ),

        // CoreDatabase target removed (sqlcipher dep unavailable via SPM).

        .target(
            name: "CoreDID",
            dependencies: [
                "CoreCommon",
                "CoreSecurity",
                "CryptoSwift"
            ],
            path: "Modules/CoreDID"
        ),

        .target(
            name: "CoreE2EE",
            dependencies: [
                "CoreCommon",
                "CoreSecurity",
                "CoreDID"
            ],
            path: "Modules/CoreE2EE"
        ),

        .target(
            name: "CoreP2P",
            dependencies: [
                "CoreCommon",
                // CoreE2EE 暂从 CoreP2P deps 移除 — grep 显示 Modules/CoreP2P/
                // 实际不 import CoreE2EE，是 stale 声明。CoreE2EE transitively
                // 拉 CoreSecurity，而 CoreSecurity/CryptoManager.swift 用
                // `Data.bytes`（CryptoSwift 1.10 已无此扩展，需改 Array(data)）
                // 阻塞编译。修 CryptoManager 后再恢复此 dep。
                .product(name: "WebRTC", package: "WebRTC"),
                "Starscream"
            ],
            path: "Modules/CoreP2P"
        ),

        // MARK: - Test Targets

        .testTarget(
            name: "CoreCommonTests",
            dependencies: ["CoreCommon"],
            path: "Tests/CoreCommonTests"
        ),

        .testTarget(
            name: "CoreSecurityTests",
            dependencies: ["CoreSecurity"],
            path: "Tests/CoreSecurityTests"
        ),

        // CoreDatabaseTests removed alongside CoreDatabase target.

        .testTarget(
            name: "CoreDIDTests",
            dependencies: ["CoreDID"],
            path: "Tests/CoreDIDTests"
        ),

        .testTarget(
            name: "CoreE2EETests",
            dependencies: ["CoreE2EE"],
            path: "Tests/CoreE2EETests"
        ),

        .testTarget(
            name: "CoreP2PTests",
            dependencies: ["CoreP2P"],
            path: "Tests/CoreP2PTests"
        ),
    ]
)
