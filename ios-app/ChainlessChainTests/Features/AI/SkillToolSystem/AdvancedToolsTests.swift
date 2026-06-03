/**
 * AdvancedToolsTests.swift
 *
 * Unit tests for AdvancedTools (22 tools).
 * Tests file operations, math calculations, and string processing.
 */

import XCTest
@testable import ChainlessChain

@MainActor
final class AdvancedToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testFilesPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerAdvancedTools()

        // Setup test directory
        let tempDir = NSTemporaryDirectory()
        testFilesPath = tempDir + "advanced_tools_test/"
        try? FileManager.default.createDirectory(atPath: testFilesPath, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(atPath: testFilesPath)
        toolManager = nil
    }

    // MARK: - File Operation Tests

    func testFileWrite() async throws {
        // Given
        let filePath = testFilesPath + "test.txt"
        let content = "Hello, ChainlessChain!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "path": filePath,
                "content": content,
                "append": false
            ]
        )

        // Then
        XCTAssertTrue(result as? Bool == true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: filePath))

        let savedContent = try String(contentsOfFile: filePath, encoding: .utf8)
        XCTAssertEqual(savedContent, content)
    }

    func testFileRead() async throws {
        // Given
        let filePath = testFilesPath + "read_test.txt"
        let content = "Test content for reading"
        try content.write(toFile: filePath, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.read",
            input: ["path": filePath]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, content)
    }

    func testFileExists() async throws {
        // Given
        let existingPath = testFilesPath + "existing.txt"
        let nonExistingPath = testFilesPath + "non_existing.txt"
        try "content".write(toFile: existingPath, atomically: true, encoding: .utf8)

        // When - Test existing file
        let existsResult = try await toolManager.execute(
            toolId: "tool.file.exists",
            input: ["path": existingPath]
        )

        // Then
        XCTAssertTrue(existsResult as? Bool == true)

        // When - Test non-existing file
        let notExistsResult = try await toolManager.execute(
            toolId: "tool.file.exists",
            input: ["path": nonExistingPath]
        )

        // Then
        XCTAssertTrue(notExistsResult as? Bool == false)
    }

    func testFileDelete() async throws {
        // Given
        let filePath = testFilesPath + "to_delete.txt"
        try "content".write(toFile: filePath, atomically: true, encoding: .utf8)
        XCTAssertTrue(FileManager.default.fileExists(atPath: filePath))

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.delete",
            input: ["path": filePath]
        )

        // Then
        XCTAssertTrue(result as? Bool == true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: filePath))
    }

    func testFileInfo() async throws {
        // Given
        let filePath = testFilesPath + "info_test.txt"
        let content = "Test content"
        try content.write(toFile: filePath, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.info",
            input: ["path": filePath]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["size"])
            XCTAssertNotNil(info["creationDate"])
            XCTAssertNotNil(info["modificationDate"])
            XCTAssertNotNil(info["isDirectory"])
            XCTAssertEqual(info["isDirectory"] as? Bool, false)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testFileList() async throws {
        // Given
        let dir = testFilesPath + "list_test/"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try "file1".write(toFile: dir + "file1.txt", atomically: true, encoding: .utf8)
        try "file2".write(toFile: dir + "file2.txt", atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.list",
            input: [
                "path": dir,
                "recursive": false
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let files = result as? [String] {
            XCTAssertEqual(files.count, 2)
            XCTAssertTrue(files.contains("file1.txt"))
            XCTAssertTrue(files.contains("file2.txt"))
        } else {
            XCTFail("Result should be an array")
        }
    }

    func testFileCopy() async throws {
        // Given
        let sourcePath = testFilesPath + "source.txt"
        let destPath = testFilesPath + "destination.txt"
        let content = "Copy test"
        try content.write(toFile: sourcePath, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.copy",
            input: [
                "source": sourcePath,
                "destination": destPath
            ]
        )

        // Then
        XCTAssertTrue(result as? Bool == true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: destPath))

        let copiedContent = try String(contentsOfFile: destPath, encoding: .utf8)
        XCTAssertEqual(copiedContent, content)
    }

    func testFileMove() async throws {
        // Given
        let sourcePath = testFilesPath + "move_source.txt"
        let destPath = testFilesPath + "move_dest.txt"
        let content = "Move test"
        try content.write(toFile: sourcePath, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.move",
            input: [
                "source": sourcePath,
                "destination": destPath
            ]
        )

        // Then
        XCTAssertTrue(result as? Bool == true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: sourcePath))
        XCTAssertTrue(FileManager.default.fileExists(atPath: destPath))

        let movedContent = try String(contentsOfFile: destPath, encoding: .utf8)
        XCTAssertEqual(movedContent, content)
    }

    // MARK: - Math Calculation Tests

    func testMathCalculate() async throws {
        // Test 1: Simple addition
        let result1 = try await toolManager.execute(
            toolId: "tool.math.calculate",
            input: ["expression": "2 + 3"]
        )
        XCTAssertEqual(result1 as? Double, 5.0)

        // Test 2: Complex expression
        let result2 = try await toolManager.execute(
            toolId: "tool.math.calculate",
            input: ["expression": "2 * (3 + 4) - 5"]
        )
        XCTAssertEqual(result2 as? Double, 9.0)

        // Test 3: Division
        let result3 = try await toolManager.execute(
            toolId: "tool.math.calculate",
            input: ["expression": "10 / 2"]
        )
        XCTAssertEqual(result3 as? Double, 5.0)
    }

    func testMathRandom() async throws {
        // Test: Generate random number between 1 and 10
        let result = try await toolManager.execute(
            toolId: "tool.math.random",
            input: [
                "min": 1,
                "max": 10,
                "count": 5
            ]
        )

        XCTAssertNotNil(result)

        if let numbers = result as? [Double] {
            XCTAssertEqual(numbers.count, 5)
            for number in numbers {
                XCTAssertGreaterThanOrEqual(number, 1.0)
                XCTAssertLessThanOrEqual(number, 10.0)
            }
        } else {
            XCTFail("Result should be an array of numbers")
        }
    }

    func testMathFunction() async throws {
        // Test: sin(0) = 0
        let sinResult = try await toolManager.execute(
            toolId: "tool.math.function",
            input: [
                "function": "sin",
                "value": 0.0
            ]
        )
        XCTAssertEqual(sinResult as? Double, 0.0, accuracy: 0.0001)

        // Test: cos(0) = 1
        let cosResult = try await toolManager.execute(
            toolId: "tool.math.function",
            input: [
                "function": "cos",
                "value": 0.0
            ]
        )
        XCTAssertEqual(cosResult as? Double, 1.0, accuracy: 0.0001)

        // Test: sqrt(16) = 4
        let sqrtResult = try await toolManager.execute(
            toolId: "tool.math.function",
            input: [
                "function": "sqrt",
                "value": 16.0
            ]
        )
        XCTAssertEqual(sqrtResult as? Double, 4.0, accuracy: 0.0001)
    }

    func testMathIsPrime() async throws {
        // Test: Prime numbers
        let prime7 = try await toolManager.execute(
            toolId: "tool.math.isprime",
            input: ["number": 7]
        )
        XCTAssertTrue(prime7 as? Bool == true)

        let prime13 = try await toolManager.execute(
            toolId: "tool.math.isprime",
            input: ["number": 13]
        )
        XCTAssertTrue(prime13 as? Bool == true)

        // Test: Non-prime numbers
        let notPrime4 = try await toolManager.execute(
            toolId: "tool.math.isprime",
            input: ["number": 4]
        )
        XCTAssertTrue(notPrime4 as? Bool == false)

        let notPrime1 = try await toolManager.execute(
            toolId: "tool.math.isprime",
            input: ["number": 1]
        )
        XCTAssertTrue(notPrime1 as? Bool == false)
    }

    func testMathGCD() async throws {
        // Test: GCD(12, 18) = 6
        let result = try await toolManager.execute(
            toolId: "tool.math.gcd",
            input: [
                "a": 12,
                "b": 18
            ]
        )

        XCTAssertEqual(result as? Int, 6)
    }

    func testMathLCM() async throws {
        // Test: LCM(4, 6) = 12
        let result = try await toolManager.execute(
            toolId: "tool.math.lcm",
            input: [
                "a": 4,
                "b": 6
            ]
        )

        XCTAssertEqual(result as? Int, 12)
    }

    func testMathArrayStats() async throws {
        // Given
        let numbers = [1.0, 2.0, 3.0, 4.0, 5.0]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.math.arraystats",
            input: ["numbers": numbers]
        )

        // Then
        XCTAssertNotNil(result)

        if let stats = result as? [String: Any] {
            XCTAssertEqual(stats["count"] as? Int, 5)
            XCTAssertEqual(stats["sum"] as? Double, 15.0)
            XCTAssertEqual(stats["mean"] as? Double, 3.0)
            XCTAssertEqual(stats["median"] as? Double, 3.0)
            XCTAssertEqual(stats["min"] as? Double, 1.0)
            XCTAssertEqual(stats["max"] as? Double, 5.0)
            XCTAssertNotNil(stats["variance"])
            XCTAssertNotNil(stats["stdDev"])
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testMathPermutation_Combination() async throws {
        // Given: Calculate C(5,2) = 10
        // When
        let result = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: [
                "n": 5,
                "r": 2,
                "type": "combination"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Int, 10, "C(5,2) should equal 10")
        print("✅ 组合数C(5,2) = \(result as? Int ?? 0)")
    }

    func testMathPermutation_Permutation() async throws {
        // Given: Calculate P(5,2) = 20
        // When
        let result = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: [
                "n": 5,
                "r": 2,
                "type": "permutation"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Int, 20, "P(5,2) should equal 20")
        print("✅ 排列数P(5,2) = \(result as? Int ?? 0)")
    }

    func testMathPermutation_DefaultIsCombination() async throws {
        // Given: Default type should be combination
        // When
        let result = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: [
                "n": 4,
                "r": 2
            ]
        )

        // Then: C(4,2) = 6
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Int, 6, "Default should be combination, C(4,2) = 6")
        print("✅ 默认组合数C(4,2) = \(result as? Int ?? 0)")
    }

    func testMathPermutation_EdgeCases() async throws {
        // Test C(n, 0) = 1
        let result1 = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: ["n": 5, "r": 0, "type": "combination"]
        )
        XCTAssertEqual(result1 as? Int, 1, "C(5,0) should equal 1")

        // Test C(n, n) = 1
        let result2 = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: ["n": 5, "r": 5, "type": "combination"]
        )
        XCTAssertEqual(result2 as? Int, 1, "C(5,5) should equal 1")

        // Test C(6,3) = 20
        let result3 = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: ["n": 6, "r": 3, "type": "combination"]
        )
        XCTAssertEqual(result3 as? Int, 20, "C(6,3) should equal 20")

        print("✅ 边界测试通过: C(5,0)=1, C(5,5)=1, C(6,3)=20")
    }

    func testMathPermutation_LargerNumbers() async throws {
        // Test with larger numbers: C(10,5) = 252
        let result = try await toolManager.execute(
            toolId: "tool.math.permutation",
            input: [
                "n": 10,
                "r": 5,
                "type": "combination"
            ]
        )

        XCTAssertEqual(result as? Int, 252, "C(10,5) should equal 252")
        print("✅ 大数计算: C(10,5) = \(result as? Int ?? 0)")
    }

    // MARK: - String Processing Tests

    func testStringReverse() async throws {
        // Test
        let result = try await toolManager.execute(
            toolId: "tool.string.reverse",
            input: ["text": "Hello"]
        )

        XCTAssertEqual(result as? String, "olleH")
    }

    func testStringReplace() async throws {
        // Test: Simple replacement
        let result = try await toolManager.execute(
            toolId: "tool.string.replace",
            input: [
                "text": "Hello World",
                "pattern": "World",
                "replacement": "ChainlessChain"
            ]
        )

        XCTAssertEqual(result as? String, "Hello ChainlessChain")
    }

    func testStringReplaceRegex() async throws {
        // Test: Regex replacement
        let result = try await toolManager.execute(
            toolId: "tool.string.replace",
            input: [
                "text": "Hello 123 World 456",
                "pattern": "\\d+",
                "replacement": "XXX",
                "isRegex": true
            ]
        )

        XCTAssertEqual(result as? String, "Hello XXX World XXX")
    }

    func testStringCase() async throws {
        // Test: Uppercase
        let upper = try await toolManager.execute(
            toolId: "tool.string.case",
            input: [
                "text": "hello world",
                "type": "upper"
            ]
        )
        XCTAssertEqual(upper as? String, "HELLO WORLD")

        // Test: Lowercase
        let lower = try await toolManager.execute(
            toolId: "tool.string.case",
            input: [
                "text": "HELLO WORLD",
                "type": "lower"
            ]
        )
        XCTAssertEqual(lower as? String, "hello world")

        // Test: Capitalize
        let capitalize = try await toolManager.execute(
            toolId: "tool.string.case",
            input: [
                "text": "hello world",
                "type": "capitalize"
            ]
        )
        XCTAssertEqual(capitalize as? String, "Hello world")
    }

    func testStringTrim() async throws {
        // Test: Trim whitespace
        let result = try await toolManager.execute(
            toolId: "tool.string.trim",
            input: [
                "text": "  Hello World  ",
                "characters": " "
            ]
        )

        XCTAssertEqual(result as? String, "Hello World")
    }

    func testStringSplit() async throws {
        // Test: Split by comma
        let result = try await toolManager.execute(
            toolId: "tool.string.split",
            input: [
                "text": "apple,banana,cherry",
                "separator": ","
            ]
        )

        XCTAssertNotNil(result)

        if let parts = result as? [String] {
            XCTAssertEqual(parts.count, 3)
            XCTAssertEqual(parts[0], "apple")
            XCTAssertEqual(parts[1], "banana")
            XCTAssertEqual(parts[2], "cherry")
        } else {
            XCTFail("Result should be an array")
        }
    }

    func testStringJoin() async throws {
        // Test: Join with separator
        let result = try await toolManager.execute(
            toolId: "tool.string.join",
            input: [
                "array": ["apple", "banana", "cherry"],
                "separator": ", "
            ]
        )

        XCTAssertEqual(result as? String, "apple, banana, cherry")
    }

    // MARK: - Performance Tests

    func testMathCalculatePerformance() throws {
        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.math.calculate",
                    input: ["expression": "2 * (3 + 4) - 5"]
                )
            }
        }
    }

    func testFileWritePerformance() throws {
        let filePath = testFilesPath + "perf_test.txt"
        let content = String(repeating: "Test content ", count: 1000)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.file.write",
                    input: [
                        "path": filePath,
                        "content": content,
                        "append": false
                    ]
                )
            }
        }
    }
}
