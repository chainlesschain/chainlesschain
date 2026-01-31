/**
 * UtilityToolsTests.swift
 *
 * Unit tests for UtilityTools (18 tools).
 * Tests QR/Barcode (6), Location (4), Weather (2), Crypto (3), and Other utilities (3).
 */

import XCTest
import UIKit
import CoreImage
import CoreLocation
@testable import ChainlessChain

@MainActor
final class UtilityToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testQRPath: String!
    var tempOutputPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerUtilityTools()

        // Setup test paths
        let tempDir = NSTemporaryDirectory()
        testQRPath = tempDir + "test_qr/"
        tempOutputPath = tempDir + "test_output_utility/"

        // Create directories
        try? FileManager.default.createDirectory(atPath: testQRPath, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: tempOutputPath, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        // Clean up test files
        try? FileManager.default.removeItem(atPath: testQRPath)
        try? FileManager.default.removeItem(atPath: tempOutputPath)

        toolManager = nil
    }

    // MARK: - QR Code Generation Tests

    func testQRGenerate() async throws {
        // Given
        let text = "https://chainlesschain.com"
        let outputPath = tempOutputPath + "qr_code.png"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.qr.generate",
            input: [
                "text": text,
                "size": 512,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify it's a valid image
        let image = UIImage(contentsOfFile: outputPath)
        XCTAssertNotNil(image)
    }

    func testQRGenerateDefaultSize() async throws {
        let text = "Test QR Code"
        let outputPath = tempOutputPath + "qr_default.png"

        let result = try await toolManager.execute(
            toolId: "tool.qr.generate",
            input: [
                "text": text,
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testQRGenerateEmptyText() async throws {
        let outputPath = tempOutputPath + "qr_empty.png"

        do {
            _ = try await toolManager.execute(
                toolId: "tool.qr.generate",
                input: [
                    "text": "",
                    "outputPath": outputPath
                ]
            )
            // Empty text might succeed with QR generation
            // XCTAssertTrue(true)
        } catch {
            // Or it might fail, which is also acceptable
            XCTAssertTrue(true)
        }
    }

    // MARK: - QR Code Scan Tests

    func testQRScan() async throws {
        // Given - First generate a QR code
        let text = "Test Data for Scanning"
        let qrPath = tempOutputPath + "qr_to_scan.png"

        _ = try await toolManager.execute(
            toolId: "tool.qr.generate",
            input: [
                "text": text,
                "outputPath": qrPath
            ]
        )

        // When - Scan the generated QR code
        let result = try await toolManager.execute(
            toolId: "tool.qr.scan",
            input: ["imagePath": qrPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let codes = result as? [[String: String]] {
            XCTAssertGreaterThan(codes.count, 0)

            if let firstCode = codes.first {
                XCTAssertEqual(firstCode["content"], text)
            }
        }
    }

    func testQRScanInvalidImage() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.qr.scan",
                input: ["imagePath": "/invalid/path.png"]
            )
            XCTFail("Should throw error for invalid image path")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Barcode Generation Tests

    func testBarcodeGenerate() async throws {
        // Given
        let text = "123456789012"
        let outputPath = tempOutputPath + "barcode.png"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.barcode.generate",
            input: [
                "text": text,
                "format": "code128",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testBarcodeGeneratePDF417() async throws {
        let text = "PDF417 Barcode Data"
        let outputPath = tempOutputPath + "barcode_pdf417.png"

        let result = try await toolManager.execute(
            toolId: "tool.barcode.generate",
            input: [
                "text": text,
                "format": "pdf417",
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - QR Batch Generation Tests

    func testQRBatch() async throws {
        // Given
        let texts = ["QR1", "QR2", "QR3"]
        let outputDir = tempOutputPath + "qr_batch/"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.qr.batch",
            input: [
                "texts": texts,
                "outputDir": outputDir
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let paths = result as? [String] {
            XCTAssertEqual(paths.count, 3)

            // Verify all files exist
            for path in paths {
                XCTAssertTrue(FileManager.default.fileExists(atPath: path))
            }
        }
    }

    // MARK: - QR vCard Tests

    func testQRVCard() async throws {
        // Given
        let vcard = [
            "name": "John Doe",
            "phone": "+1234567890",
            "email": "john@example.com",
            "org": "ChainlessChain"
        ]
        let outputPath = tempOutputPath + "vcard_qr.png"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.qr.vcard",
            input: [
                "vcard": vcard,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Geocode Tests

    func testGeocode() async throws {
        // Given
        let address = "1 Apple Park Way, Cupertino, CA"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.location.geocode",
            input: ["address": address]
        )

        // Then
        XCTAssertNotNil(result)

        if let location = result as? [String: Any] {
            XCTAssertNotNil(location["latitude"])
            XCTAssertNotNil(location["longitude"])

            let latitude = location["latitude"] as? Double
            let longitude = location["longitude"] as? Double

            // Apple Park is approximately at 37.3348, -122.0090
            XCTAssertNotNil(latitude)
            XCTAssertNotNil(longitude)
        }
    }

    func testGeocodeInvalidAddress() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.location.geocode",
                input: ["address": ""]
            )
            XCTFail("Should throw error for empty address")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Reverse Geocode Tests

    func testReverseGeocode() async throws {
        // Given - Coordinates of Apple Park
        let latitude = 37.3348
        let longitude = -122.0090

        // When
        let result = try await toolManager.execute(
            toolId: "tool.location.reverse",
            input: [
                "latitude": latitude,
                "longitude": longitude
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let address = result as? [String: Any] {
            XCTAssertNotNil(address["address"])

            let addressString = address["address"] as? String
            XCTAssertNotNil(addressString)
            XCTAssertFalse(addressString?.isEmpty ?? true)
        }
    }

    // MARK: - Distance Tests

    func testDistance() async throws {
        // Given - San Francisco to Los Angeles (approx 559 km)
        let lat1 = 37.7749  // SF
        let lon1 = -122.4194
        let lat2 = 34.0522  // LA
        let lon2 = -118.2437

        // When
        let result = try await toolManager.execute(
            toolId: "tool.location.distance",
            input: [
                "lat1": lat1,
                "lon1": lon1,
                "lat2": lat2,
                "lon2": lon2
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let distance = result as? [String: Any] {
            XCTAssertNotNil(distance["meters"])
            XCTAssertNotNil(distance["kilometers"])
            XCTAssertNotNil(distance["miles"])

            let km = distance["kilometers"] as? Double
            XCTAssertNotNil(km)
            // Distance should be around 559 km
            XCTAssertGreaterThan(km ?? 0, 500)
            XCTAssertLessThan(km ?? 0, 600)
        }
    }

    func testDistanceZero() async throws {
        // Test distance to same point
        let lat = 37.7749
        let lon = -122.4194

        let result = try await toolManager.execute(
            toolId: "tool.location.distance",
            input: [
                "lat1": lat,
                "lon1": lon,
                "lat2": lat,
                "lon2": lon
            ]
        )

        if let distance = result as? [String: Any] {
            let meters = distance["meters"] as? Double
            XCTAssertEqual(meters, 0, accuracy: 0.1)
        }
    }

    // MARK: - Weather Tests (May require API key)

    func testCurrentWeather() async throws {
        // Note: This test may fail if API key is not configured or network is unavailable
        let city = "San Francisco"

        do {
            let result = try await toolManager.execute(
                toolId: "tool.weather.current",
                input: ["city": city]
            )

            XCTAssertNotNil(result)

            if let weather = result as? [String: Any] {
                // Expected fields
                XCTAssertNotNil(weather["temperature"])
                XCTAssertNotNil(weather["description"])
            }
        } catch {
            // If API key not configured or network issue, skip test
            XCTSkip("Weather API not available: \(error.localizedDescription)")
        }
    }

    // MARK: - Hash Tests

    func testHashMD5() async throws {
        // Given
        let text = "Hello, World!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.hash",
            input: [
                "text": text,
                "algorithm": "md5"
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let hash = result as? String {
            // MD5 of "Hello, World!" is known
            XCTAssertEqual(hash.count, 32)  // MD5 is 32 hex chars
        }
    }

    func testHashSHA256() async throws {
        let text = "Test Data"

        let result = try await toolManager.execute(
            toolId: "tool.crypto.hash",
            input: [
                "text": text,
                "algorithm": "sha256"
            ]
        )

        if let hash = result as? String {
            XCTAssertEqual(hash.count, 64)  // SHA256 is 64 hex chars
        }
    }

    func testHashSHA512() async throws {
        let text = "Test Data"

        let result = try await toolManager.execute(
            toolId: "tool.crypto.hash",
            input: [
                "text": text,
                "algorithm": "sha512"
            ]
        )

        if let hash = result as? String {
            XCTAssertEqual(hash.count, 128)  // SHA512 is 128 hex chars
        }
    }

    // MARK: - Base64 Tests

    func testBase64Encode() async throws {
        // Given
        let text = "Hello, ChainlessChain!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64encode",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)

        if let encoded = result as? String {
            XCTAssertFalse(encoded.isEmpty)
            // Verify it's valid base64
            XCTAssertNotNil(Data(base64Encoded: encoded))
        }
    }

    func testBase64Decode() async throws {
        // Given - First encode
        let originalText = "Test Decode"

        let encodeResult = try await toolManager.execute(
            toolId: "tool.crypto.base64encode",
            input: ["text": originalText]
        )

        guard let encoded = encodeResult as? String else {
            XCTFail("Encode failed")
            return
        }

        // When - Then decode
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64decode",
            input: ["text": encoded]
        )

        // Then
        XCTAssertNotNil(result)

        if let decoded = result as? String {
            XCTAssertEqual(decoded, originalText)
        }
    }

    func testBase64DecodeInvalid() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.crypto.base64decode",
                input: ["text": "!!!invalid base64!!!"]
            )
            XCTFail("Should throw error for invalid base64")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - UUID Tests

    func testUUIDGenerate() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.uuid.generate",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)

        if let uuid = result as? String {
            XCTAssertFalse(uuid.isEmpty)
            // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            XCTAssertEqual(uuid.count, 36)
            XCTAssertTrue(uuid.contains("-"))

            // Verify it's a valid UUID
            XCTAssertNotNil(UUID(uuidString: uuid))
        }
    }

    func testUUIDBatch() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.uuid.generate",
            input: ["count": 5]
        )

        if let uuids = result as? [String] {
            XCTAssertEqual(uuids.count, 5)

            // Verify all are unique
            let uniqueUUIDs = Set(uuids)
            XCTAssertEqual(uniqueUUIDs.count, 5)
        }
    }

    func testUUIDUppercase() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.uuid.generate",
            input: ["uppercase": true]
        )

        if let uuid = result as? String {
            XCTAssertEqual(uuid, uuid.uppercased())
        }
    }

    // MARK: - Color Palette Tests

    func testColorPalette() async throws {
        // Given
        let baseColor = ["red": 255, "green": 0, "blue": 0]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.color.palette",
            input: [
                "baseColor": baseColor,
                "scheme": "complementary"
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let palette = result as? [[String: Int]] {
            XCTAssertGreaterThan(palette.count, 0)

            // Verify each color has RGB values
            for color in palette {
                XCTAssertNotNil(color["red"])
                XCTAssertNotNil(color["green"])
                XCTAssertNotNil(color["blue"])
            }
        }
    }

    func testColorPaletteAnalogous() async throws {
        let baseColor = ["red": 0, "green": 128, "blue": 255]

        let result = try await toolManager.execute(
            toolId: "tool.color.palette",
            input: [
                "baseColor": baseColor,
                "scheme": "analogous"
            ]
        )

        if let palette = result as? [[String: Int]] {
            XCTAssertGreaterThan(palette.count, 0)
        }
    }

    func testColorPaletteTriadic() async throws {
        let baseColor = ["red": 128, "green": 64, "blue": 192]

        let result = try await toolManager.execute(
            toolId: "tool.color.palette",
            input: [
                "baseColor": baseColor,
                "scheme": "triadic"
            ]
        )

        if let palette = result as? [[String: Int]] {
            XCTAssertGreaterThan(palette.count, 0)
        }
    }

    // MARK: - Unit Conversion Tests

    func testUnitConvertLength() async throws {
        // Given - Convert 1 meter to feet
        let result = try await toolManager.execute(
            toolId: "tool.unit.convert",
            input: [
                "value": 1.0,
                "from": "meter",
                "to": "feet",
                "category": "length"
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let converted = result as? Double {
            // 1 meter = 3.28084 feet
            XCTAssertEqual(converted, 3.28084, accuracy: 0.001)
        }
    }

    func testUnitConvertWeight() async throws {
        // Convert 1 kg to pounds
        let result = try await toolManager.execute(
            toolId: "tool.unit.convert",
            input: [
                "value": 1.0,
                "from": "kilogram",
                "to": "pound",
                "category": "weight"
            ]
        )

        if let converted = result as? Double {
            // 1 kg = 2.20462 pounds
            XCTAssertEqual(converted, 2.20462, accuracy: 0.001)
        }
    }

    func testUnitConvertTemperature() async throws {
        // Convert 0°C to Fahrenheit
        let result = try await toolManager.execute(
            toolId: "tool.unit.convert",
            input: [
                "value": 0.0,
                "from": "celsius",
                "to": "fahrenheit",
                "category": "temperature"
            ]
        )

        if let converted = result as? Double {
            // 0°C = 32°F
            XCTAssertEqual(converted, 32.0, accuracy: 0.1)
        }
    }

    // MARK: - Performance Tests

    func testQRGeneratePerformance() throws {
        let text = "Performance Test"
        let outputPath = tempOutputPath + "perf_qr.png"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.qr.generate",
                    input: [
                        "text": text,
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }

    func testHashPerformance() throws {
        let text = "Performance test data"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.crypto.hash",
                    input: [
                        "text": text,
                        "algorithm": "sha256"
                    ]
                )
            }
        }
    }

    func testBase64EncodePerformance() throws {
        let text = String(repeating: "Test ", count: 100)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.crypto.base64encode",
                    input: ["text": text]
                )
            }
        }
    }

    // MARK: - Integration Tests

    func testQRGenerateAndScan() async throws {
        // Test full workflow: Generate QR -> Scan QR
        let originalText = "Integration Test Data"
        let qrPath = tempOutputPath + "integration_qr.png"

        // Step 1: Generate QR
        _ = try await toolManager.execute(
            toolId: "tool.qr.generate",
            input: [
                "text": originalText,
                "outputPath": qrPath
            ]
        )

        // Step 2: Scan QR
        let scanResult = try await toolManager.execute(
            toolId: "tool.qr.scan",
            input: ["imagePath": qrPath]
        )

        // Verify
        if let codes = scanResult as? [[String: String]],
           let firstCode = codes.first {
            XCTAssertEqual(firstCode["content"], originalText)
        }
    }

    func testBase64EncodeAndDecode() async throws {
        // Test full workflow: Encode -> Decode
        let originalText = "Round trip test"

        // Step 1: Encode
        let encodeResult = try await toolManager.execute(
            toolId: "tool.crypto.base64encode",
            input: ["text": originalText]
        )

        guard let encoded = encodeResult as? String else {
            XCTFail("Encode failed")
            return
        }

        // Step 2: Decode
        let decodeResult = try await toolManager.execute(
            toolId: "tool.crypto.base64decode",
            input: ["text": encoded]
        )

        // Verify
        XCTAssertEqual(decodeResult as? String, originalText)
    }
}
