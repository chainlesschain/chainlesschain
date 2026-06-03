//
//  ComputerUseResult.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Unified result type
//  Adapted from: desktop-app-vue/src/main/browser/computer-use-agent.js
//

import Foundation

// MARK: - Computer Use Result

/// Unified result type for all Computer Use operations
public struct ComputerUseResult: Codable {
    /// Whether the operation succeeded
    public let success: Bool

    /// The action type that was executed
    public let action: CUActionType

    /// Result data (screenshots, extracted text, coordinates, etc.)
    public let data: [String: AnyCodableValue]?

    /// Error message if failed
    public let error: String?

    /// Execution duration in milliseconds
    public let duration: Double

    /// Timestamp of execution
    public let timestamp: Date

    public init(
        success: Bool,
        action: CUActionType,
        data: [String: AnyCodableValue]? = nil,
        error: String? = nil,
        duration: Double = 0
    ) {
        self.success = success
        self.action = action
        self.data = data
        self.error = error
        self.duration = duration
        self.timestamp = Date()
    }

    // MARK: - Factory Methods

    /// Create a success result
    public static func ok(
        action: CUActionType,
        data: [String: AnyCodableValue] = [:],
        duration: Double = 0
    ) -> ComputerUseResult {
        ComputerUseResult(
            success: true,
            action: action,
            data: data,
            duration: duration
        )
    }

    /// Create a failure result
    public static func fail(
        action: CUActionType,
        error: String,
        duration: Double = 0
    ) -> ComputerUseResult {
        ComputerUseResult(
            success: false,
            action: action,
            error: error,
            duration: duration
        )
    }
}

// MARK: - AnyCodableValue

/// A type-erased Codable value for flexible result data
public enum AnyCodableValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([AnyCodableValue])
    case dictionary([String: AnyCodableValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let val = try? container.decode(String.self) { self = .string(val) }
        else if let val = try? container.decode(Int.self) { self = .int(val) }
        else if let val = try? container.decode(Double.self) { self = .double(val) }
        else if let val = try? container.decode(Bool.self) { self = .bool(val) }
        else if let val = try? container.decode([AnyCodableValue].self) { self = .array(val) }
        else if let val = try? container.decode([String: AnyCodableValue].self) { self = .dictionary(val) }
        else { self = .null }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let val): try container.encode(val)
        case .int(let val): try container.encode(val)
        case .double(let val): try container.encode(val)
        case .bool(let val): try container.encode(val)
        case .array(let val): try container.encode(val)
        case .dictionary(let val): try container.encode(val)
        case .null: try container.encodeNil()
        }
    }

    /// Convenience initializer from Any
    public static func from(_ value: Any) -> AnyCodableValue {
        switch value {
        case let v as String: return .string(v)
        case let v as Int: return .int(v)
        case let v as Double: return .double(v)
        case let v as Bool: return .bool(v)
        case let v as [Any]: return .array(v.map { from($0) })
        case let v as [String: Any]: return .dictionary(v.mapValues { from($0) })
        default: return .null
        }
    }

    /// Extract as String
    public var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    /// Extract as Int
    public var intValue: Int? {
        if case .int(let v) = self { return v }
        return nil
    }

    /// Extract as Double
    public var doubleValue: Double? {
        if case .double(let v) = self { return v }
        if case .int(let v) = self { return Double(v) }
        return nil
    }

    /// Extract as Bool
    public var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }
}
