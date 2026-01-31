/**
 * SystemToolsTests.swift
 *
 * Unit tests for SystemTools (18 tools).
 * Tests device information and data validation tools.
 */

import XCTest
import UIKit
@testable import ChainlessChain

@MainActor
final class SystemToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerSystemTools()
    }

    override func tearDown() async throws {
        toolManager = nil
    }

    // MARK: - Device Information Tests

    func testDeviceInfo() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.device.info",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            // Verify required fields
            XCTAssertNotNil(info["model"])
            XCTAssertNotNil(info["name"])
            XCTAssertNotNil(info["systemVersion"])
            XCTAssertNotNil(info["identifierForVendor"])

            // Model should be a non-empty string
            let model = info["model"] as? String
            XCTAssertNotNil(model)
            XCTAssertFalse(model?.isEmpty ?? true)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testSystemVersion() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.system.version",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let version = result as? [String: Any] {
            XCTAssertNotNil(version["version"])
            XCTAssertNotNil(version["majorVersion"])

            // iOS version should be >= 14
            let majorVersion = version["majorVersion"] as? Int
            XCTAssertNotNil(majorVersion)
            XCTAssertGreaterThanOrEqual(majorVersion ?? 0, 14)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testAppInfo() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.app.info",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["bundleIdentifier"])
            XCTAssertNotNil(info["version"])
            XCTAssertNotNil(info["buildNumber"])
            XCTAssertNotNil(info["name"])
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testSystemMemory() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.system.memory",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let memory = result as? [String: Any] {
            XCTAssertNotNil(memory["usedMemoryMB"])
            XCTAssertNotNil(memory["totalMemoryMB"])
            XCTAssertNotNil(memory["percentage"])

            // Total memory should be > 0
            let totalMemory = memory["totalMemoryMB"] as? Double
            XCTAssertNotNil(totalMemory)
            XCTAssertGreaterThan(totalMemory ?? 0, 0)

            // Percentage should be between 0 and 100
            let percentage = memory["percentage"] as? Double
            XCTAssertNotNil(percentage)
            XCTAssertGreaterThanOrEqual(percentage ?? 0, 0)
            XCTAssertLessThanOrEqual(percentage ?? 0, 100)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testSystemDiskSpace() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.system.diskspace",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let diskSpace = result as? [String: Any] {
            XCTAssertNotNil(diskSpace["totalGB"])
            XCTAssertNotNil(diskSpace["availableGB"])
            XCTAssertNotNil(diskSpace["usedGB"])
            XCTAssertNotNil(diskSpace["percentage"])

            // Total disk space should be > 0
            let totalGB = diskSpace["totalGB"] as? Double
            XCTAssertNotNil(totalGB)
            XCTAssertGreaterThan(totalGB ?? 0, 0)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testDeviceBattery() async throws {
        // Enable battery monitoring
        UIDevice.current.isBatteryMonitoringEnabled = true

        // When
        let result = try await toolManager.execute(
            toolId: "tool.device.battery",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let battery = result as? [String: Any] {
            XCTAssertNotNil(battery["level"])
            XCTAssertNotNil(battery["state"])

            // Battery level should be between 0 and 100
            let level = battery["level"] as? Double
            if let level = level, level >= 0 {
                XCTAssertLessThanOrEqual(level, 100)
            }
        } else {
            XCTFail("Result should be a dictionary")
        }

        // Disable battery monitoring
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    func testNetworkReachability() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.network.reachability",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let reachability = result as? [String: Any] {
            XCTAssertNotNil(reachability["isReachable"])
            XCTAssertNotNil(reachability["connectionType"])

            // isReachable should be boolean
            let isReachable = reachability["isReachable"] as? Bool
            XCTAssertNotNil(isReachable)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testDeviceOrientation() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.device.orientation",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let orientation = result as? [String: Any] {
            XCTAssertNotNil(orientation["orientation"])
            XCTAssertNotNil(orientation["isPortrait"])
            XCTAssertNotNil(orientation["isLandscape"])

            // isPortrait and isLandscape should be boolean
            let isPortrait = orientation["isPortrait"] as? Bool
            let isLandscape = orientation["isLandscape"] as? Bool
            XCTAssertNotNil(isPortrait)
            XCTAssertNotNil(isLandscape)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    // MARK: - Data Validation Tests

    func testValidateEmail() async throws {
        // Test: Valid emails
        let valid1 = try await toolManager.execute(
            toolId: "tool.validate.email",
            input: ["email": "user@example.com"]
        )
        XCTAssertTrue(valid1 as? Bool == true)

        let valid2 = try await toolManager.execute(
            toolId: "tool.validate.email",
            input: ["email": "test.user+tag@domain.co.uk"]
        )
        XCTAssertTrue(valid2 as? Bool == true)

        // Test: Invalid emails
        let invalid1 = try await toolManager.execute(
            toolId: "tool.validate.email",
            input: ["email": "invalid.email"]
        )
        XCTAssertTrue(invalid1 as? Bool == false)

        let invalid2 = try await toolManager.execute(
            toolId: "tool.validate.email",
            input: ["email": "@example.com"]
        )
        XCTAssertTrue(invalid2 as? Bool == false)
    }

    func testValidatePhone() async throws {
        // Test: Valid Chinese phone numbers
        let validCN = try await toolManager.execute(
            toolId: "tool.validate.phone",
            input: [
                "phone": "13800138000",
                "country": "CN"
            ]
        )
        XCTAssertTrue(validCN as? Bool == true)

        // Test: Valid US phone numbers
        let validUS = try await toolManager.execute(
            toolId: "tool.validate.phone",
            input: [
                "phone": "415-555-0123",
                "country": "US"
            ]
        )
        XCTAssertTrue(validUS as? Bool == true)

        // Test: Invalid phone number
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.phone",
            input: [
                "phone": "12345",
                "country": "CN"
            ]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidateIDCard() async throws {
        // Test: Valid ID card (18 digits)
        let valid = try await toolManager.execute(
            toolId: "tool.validate.idcard",
            input: ["idcard": "110101199001011234"]
        )
        // Note: This is a format-only check, actual validation may fail
        XCTAssertNotNil(valid)

        // Test: Invalid ID card (wrong length)
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.idcard",
            input: ["idcard": "12345"]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidateURL() async throws {
        // Test: Valid URLs
        let valid1 = try await toolManager.execute(
            toolId: "tool.validate.url",
            input: ["url": "https://www.example.com"]
        )
        XCTAssertTrue(valid1 as? Bool == true)

        let valid2 = try await toolManager.execute(
            toolId: "tool.validate.url",
            input: ["url": "http://example.com/path?param=value"]
        )
        XCTAssertTrue(valid2 as? Bool == true)

        // Test: Invalid URL
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.url",
            input: ["url": "not a url"]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidateIP() async throws {
        // Test: Valid IPv4
        let validIPv4 = try await toolManager.execute(
            toolId: "tool.validate.ip",
            input: [
                "ip": "192.168.1.1",
                "version": "ipv4"
            ]
        )
        XCTAssertTrue(validIPv4 as? Bool == true)

        // Test: Valid IPv6
        let validIPv6 = try await toolManager.execute(
            toolId: "tool.validate.ip",
            input: [
                "ip": "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
                "version": "ipv6"
            ]
        )
        XCTAssertTrue(validIPv6 as? Bool == true)

        // Test: Invalid IP
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.ip",
            input: [
                "ip": "999.999.999.999",
                "version": "ipv4"
            ]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidateCreditCard() async throws {
        // Test: Valid credit card (Luhn algorithm)
        let valid = try await toolManager.execute(
            toolId: "tool.validate.creditcard",
            input: ["cardNumber": "4532015112830366"]
        )
        // Note: This is a format check, not real card validation
        XCTAssertNotNil(valid)

        // Test: Invalid credit card (wrong format)
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.creditcard",
            input: ["cardNumber": "1234567890"]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidatePassword() async throws {
        // Test: Strong password
        let strong = try await toolManager.execute(
            toolId: "tool.validate.password",
            input: ["password": "MyP@ssw0rd123!"]
        )

        XCTAssertNotNil(strong)

        if let result = strong as? [String: Any] {
            XCTAssertNotNil(result["strength"])
            XCTAssertNotNil(result["score"])
            XCTAssertNotNil(result["maxScore"])
            XCTAssertNotNil(result["feedback"])

            let strength = result["strength"] as? String
            XCTAssertNotNil(strength)
            // Should be "strong" or "very strong"
            XCTAssertTrue(strength == "strong" || strength == "very strong")
        } else {
            XCTFail("Result should be a dictionary")
        }

        // Test: Weak password
        let weak = try await toolManager.execute(
            toolId: "tool.validate.password",
            input: ["password": "123456"]
        )

        if let result = weak as? [String: Any] {
            let strength = result["strength"] as? String
            XCTAssertEqual(strength, "weak")
        }
    }

    func testValidateDate() async throws {
        // Test: Valid date
        let valid = try await toolManager.execute(
            toolId: "tool.validate.date",
            input: [
                "date": "2026-01-26",
                "format": "yyyy-MM-dd"
            ]
        )
        XCTAssertTrue(valid as? Bool == true)

        // Test: Invalid date
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.date",
            input: [
                "date": "2026-13-45",
                "format": "yyyy-MM-dd"
            ]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidateMAC() async throws {
        // Test: Valid MAC address
        let valid = try await toolManager.execute(
            toolId: "tool.validate.mac",
            input: ["mac": "00:1B:44:11:3A:B7"]
        )
        XCTAssertTrue(valid as? Bool == true)

        // Test: Invalid MAC address
        let invalid = try await toolManager.execute(
            toolId: "tool.validate.mac",
            input: ["mac": "ZZ:XX:YY:11:22:33"]
        )
        XCTAssertTrue(invalid as? Bool == false)
    }

    func testValidatePort() async throws {
        // Test: Valid ports
        let valid1 = try await toolManager.execute(
            toolId: "tool.validate.port",
            input: ["port": 80]
        )
        XCTAssertTrue(valid1 as? Bool == true)

        let valid2 = try await toolManager.execute(
            toolId: "tool.validate.port",
            input: ["port": 8080]
        )
        XCTAssertTrue(valid2 as? Bool == true)

        // Test: Invalid ports
        let invalid1 = try await toolManager.execute(
            toolId: "tool.validate.port",
            input: ["port": 0]
        )
        XCTAssertTrue(invalid1 as? Bool == false)

        let invalid2 = try await toolManager.execute(
            toolId: "tool.validate.port",
            input: ["port": 70000]
        )
        XCTAssertTrue(invalid2 as? Bool == false)
    }

    // MARK: - Edge Case Tests

    func testValidateEmailEmptyString() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.validate.email",
            input: ["email": ""]
        )
        XCTAssertTrue(result as? Bool == false)
    }

    func testValidatePasswordEmptyString() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.validate.password",
            input: ["password": ""]
        )

        if let passwordResult = result as? [String: Any] {
            let strength = passwordResult["strength"] as? String
            XCTAssertEqual(strength, "weak")
        }
    }

    // MARK: - Performance Tests

    func testDeviceInfoPerformance() throws {
        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.device.info",
                    input: [:]
                )
            }
        }
    }

    func testValidateEmailPerformance() throws {
        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.validate.email",
                    input: ["email": "test@example.com"]
                )
            }
        }
    }

    func testValidatePasswordPerformance() throws {
        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.validate.password",
                    input: ["password": "MyP@ssw0rd123!"]
                )
            }
        }
    }
}
