import XCTest
@testable import CoreCommon

final class CoreCommonTests: XCTestCase {

    // MARK: - String Extensions Tests

    func testStringIsNotEmpty() {
        XCTAssertTrue("hello".isNotEmpty)
        XCTAssertFalse("".isNotEmpty)
        XCTAssertFalse("   ".trimmingCharacters(in: .whitespaces).isNotEmpty)
    }

    func testStringTruncate() {
        let longString = "This is a very long string that needs to be truncated"
        let truncated = longString.truncate(to: 10)
        XCTAssertEqual(truncated, "This is a...")
        XCTAssertEqual(truncated.count, 13)

        let shortString = "Short"
        XCTAssertEqual(shortString.truncate(to: 10), "Short")
    }

    func testStringSHA256() {
        let input = "test"
        let hash = input.sha256()
        XCTAssertNotNil(hash)
        XCTAssertEqual(hash.count, 64) // SHA256 produces 64 hex characters
    }

    func testStringBase64Encoding() {
        let original = "Hello, World!"
        let encoded = original.base64Encoded()
        XCTAssertNotNil(encoded)
        XCTAssertEqual(encoded, "SGVsbG8sIFdvcmxkIQ==")

        let decoded = encoded!.base64Decoded()
        XCTAssertEqual(decoded, original)
    }

    // MARK: - Date Extensions Tests

    func testDateTimestampMs() {
        let date = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(date.timestampMs, 1000000)
    }

    func testDateFromTimestampMs() {
        let date = Date(timeIntervalSince1970: TimeInterval(1000000) / 1000)
        XCTAssertEqual(date.timestampMs, 1000000)
    }

    func testDateFormatted() {
        let date = Date(timeIntervalSince1970: 0)
        let formatted = date.formatted(format: "yyyy-MM-dd")
        XCTAssertNotNil(formatted)
    }

    func testDateRelativeTime() {
        let now = Date()
        let relativeTime = now.relativeTime()
        XCTAssertNotNil(relativeTime)
    }

    // MARK: - Array Extensions Tests

    func testArraySafeSubscript() {
        let array = [1, 2, 3]
        XCTAssertEqual(array[safe: 0], 1)
        XCTAssertEqual(array[safe: 2], 3)
        XCTAssertNil(array[safe: 5])
        XCTAssertNil(array[safe: -1])
    }

    func testArrayChunked() {
        let array = [1, 2, 3, 4, 5, 6, 7]
        let chunks = array.chunked(into: 3)
        XCTAssertEqual(chunks.count, 3)
        XCTAssertEqual(chunks[0], [1, 2, 3])
        XCTAssertEqual(chunks[1], [4, 5, 6])
        XCTAssertEqual(chunks[2], [7])
    }

    // MARK: - Data Extensions Tests

    func testDataHexString() {
        let data = Data([0x48, 0x65, 0x6C, 0x6C, 0x6F]) // "Hello"
        let hexString = data.hexString
        XCTAssertEqual(hexString, "48656c6c6f")
    }

    func testDataFromHexString() {
        let hexString = "48656c6c6f"
        let data = Data(hexString: hexString)
        XCTAssertNotNil(data)
        XCTAssertEqual(String(data: data!, encoding: .utf8), "Hello")
    }

    // MARK: - UUID Tests

    func testUUIDGeneration() {
        let uuid1 = UUID().uuidString
        let uuid2 = UUID().uuidString
        XCTAssertNotEqual(uuid1, uuid2)
        XCTAssertEqual(uuid1.count, 36) // Standard UUID format
    }

    // MARK: - Logger Tests

    func testLoggerDoesNotCrash() {
        // Just verify that logging doesn't crash
        Logger.shared.info("Test info message", category: "Test")
        Logger.shared.debug("Test debug message", category: "Test")
        Logger.shared.error("Test error message", category: "Test")
        Logger.shared.database("Test database message")
        XCTAssertTrue(true)
    }
}
