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
        .library(
            name: "CoreDatabase",
            targets: ["CoreDatabase"]
        ),
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
        // Signal Protocol
        .package(
            url: "https://github.com/signalapp/libsignal.git",
            from: "0.30.0"
        ),
        // SQLCipher
        .package(
            url: "https://github.com/sqlcipher/sqlcipher.git",
            from: "4.5.6"
        ),
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

        .target(
            name: "CoreDatabase",
            dependencies: [
                "CoreCommon",
                "CoreSecurity",
                .product(name: "SQLCipher", package: "sqlcipher")
            ],
            path: "Modules/CoreDatabase"
        ),

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
                "CoreDID",
                .product(name: "LibSignalClient", package: "libsignal")
            ],
            path: "Modules/CoreE2EE"
        ),

        .target(
            name: "CoreP2P",
            dependencies: [
                "CoreCommon",
                "CoreE2EE",
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

        .testTarget(
            name: "CoreDatabaseTests",
            dependencies: ["CoreDatabase"],
            path: "Tests/CoreDatabaseTests"
        ),

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
