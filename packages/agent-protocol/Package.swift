// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CcAgentProtocol",
    platforms: [
        .iOS(.v16),
        .macOS(.v12),
    ],
    products: [
        .library(name: "CcAgentProtocol", targets: ["CcAgentProtocol"]),
    ],
    targets: [
        .target(
            name: "CcAgentProtocol",
            path: "generated/swift",
            sources: ["CcAgentProtocol.swift"]
        ),
    ]
)
