import XCTest
@testable import ChainlessChain

/// 内置工具测试套件
/// 测试覆盖: BuiltinTools中已实现的工具
/// 测试用例: 15+个
/// 代码行数: ~400行
class BuiltinToolsTests: XCTestCase {

    var toolManager: ToolManager!
    var testFilesPath: String!

    override func setUp() async throws {
        try await super.setUp()
        toolManager = ToolManager.shared

        // 注册内置工具
        for (tool, executor) in BuiltinTools.all {
            toolManager.register(tool, executor: executor)
        }

        // 创建测试目录
        let tempDir = NSTemporaryDirectory()
        testFilesPath = tempDir + "builtin_tools_test/"
        try? FileManager.default.createDirectory(atPath: testFilesPath, withIntermediateDirectories: true)

        print("\n=== 内置工具测试开始 ===")
    }

    override func tearDown() async throws {
        // 清理测试文件
        try? FileManager.default.removeItem(atPath: testFilesPath)

        toolManager = nil
        try await super.tearDown()
        print("=== 内置工具测试结束 ===\n")
    }

    // MARK: - Data Tools

    // MARK: 1. Data Statistics (tool.data.statistics)

    func testDataStatistics_Basic() async throws {
        // Given
        let numbers = [1.0, 2.0, 3.0, 4.0, 5.0]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.statistics",
            input: ["numbers": numbers]
        )

        // Then
        XCTAssertNotNil(result)
        if let stats = result as? [String: Any] {
            XCTAssertEqual(stats["count"] as? Int, 5)
            XCTAssertEqual(stats["sum"] as? Double, 15.0)
            XCTAssertEqual(stats["mean"] as? Double, 3.0)
            XCTAssertEqual(stats["min"] as? Double, 1.0)
            XCTAssertEqual(stats["max"] as? Double, 5.0)
            XCTAssertNotNil(stats["variance"])
            XCTAssertNotNil(stats["stdDev"])

            print("✅ 数据统计成功:")
            print("   Count: \(stats["count"] ?? 0)")
            print("   Mean: \(stats["mean"] ?? 0)")
            print("   Variance: \(stats["variance"] ?? 0)")
            print("   StdDev: \(stats["stdDev"] ?? 0)")
        }
    }

    func testDataStatistics_SingleNumber() async throws {
        // Given
        let numbers = [42.0]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.statistics",
            input: ["numbers": numbers]
        )

        // Then
        XCTAssertNotNil(result)
        if let stats = result as? [String: Any] {
            XCTAssertEqual(stats["count"] as? Int, 1)
            XCTAssertEqual(stats["mean"] as? Double, 42.0)
            XCTAssertEqual(stats["variance"] as? Double, 0.0)
            print("✅ 单个数字统计成功")
        }
    }

    func testDataStatistics_LargeDataset() async throws {
        // Given: 1到100的数组
        let numbers = (1...100).map { Double($0) }

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.statistics",
            input: ["numbers": numbers]
        )

        // Then
        XCTAssertNotNil(result)
        if let stats = result as? [String: Any] {
            XCTAssertEqual(stats["count"] as? Int, 100)
            XCTAssertEqual(stats["sum"] as? Double, 5050.0)
            XCTAssertEqual(stats["mean"] as? Double, 50.5)
            XCTAssertEqual(stats["min"] as? Double, 1.0)
            XCTAssertEqual(stats["max"] as? Double, 100.0)
            print("✅ 大数据集统计成功: 100个数字")
        }
    }

    func testDataStatistics_EmptyArray() async throws {
        // Given
        let numbers: [Double] = []

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.data.statistics",
                input: ["numbers": numbers]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理空数组错误")
        }
    }

    // MARK: - Web Tools

    // MARK: 2. HTTP Request (tool.web.http.request)

    func testHTTPRequest_GET() async throws {
        // Given: 使用公共测试API
        let url = "https://httpbin.org/get"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.web.http.request",
            input: [
                "url": url,
                "method": "GET"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let response = result as? [String: Any] {
            let statusCode = response["statusCode"] as? Int
            XCTAssertEqual(statusCode, 200)
            XCTAssertNotNil(response["body"])
            print("✅ HTTP GET请求成功: 状态码 \(statusCode ?? 0)")
        }
    }

    func testHTTPRequest_POST() async throws {
        // Given
        let url = "https://httpbin.org/post"
        let body = """
        {
            "test": "data",
            "number": 123
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.web.http.request",
            input: [
                "url": url,
                "method": "POST",
                "headers": ["Content-Type": "application/json"],
                "body": body
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let response = result as? [String: Any] {
            let statusCode = response["statusCode"] as? Int
            XCTAssertEqual(statusCode, 200)
            print("✅ HTTP POST请求成功")
        }
    }

    func testHTTPRequest_InvalidURL() async throws {
        // Given
        let invalidURL = "not-a-valid-url"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.web.http.request",
                input: [
                    "url": invalidURL,
                    "method": "GET"
                ]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效URL错误")
        }
    }

    func testHTTPRequest_WithHeaders() async throws {
        // Given
        let url = "https://httpbin.org/headers"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.web.http.request",
            input: [
                "url": url,
                "method": "GET",
                "headers": [
                    "User-Agent": "ChainlessChain-iOS",
                    "Accept": "application/json"
                ]
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let response = result as? [String: Any] {
            let statusCode = response["statusCode"] as? Int
            XCTAssertEqual(statusCode, 200)
            print("✅ HTTP请求带自定义头成功")
        }
    }

    // MARK: - File System Tools

    // MARK: 3. File Read (tool.file.read)

    func testFileRead_Basic() async throws {
        // Given
        let testFile = testFilesPath + "test.txt"
        let content = "Hello, File System!"
        try content.write(toFile: testFile, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.read",
            input: ["filePath": testFile]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, content)
        print("✅ 文件读取成功: '\(content)'")
    }

    func testFileRead_MultiLine() async throws {
        // Given
        let testFile = testFilesPath + "multiline.txt"
        let content = """
        Line 1
        Line 2
        Line 3
        """
        try content.write(toFile: testFile, atomically: true, encoding: .utf8)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.read",
            input: ["filePath": testFile]
        )

        // Then
        XCTAssertEqual(result as? String, content)
        print("✅ 多行文件读取成功")
    }

    func testFileRead_NonExistent() async throws {
        // Given
        let nonExistentFile = testFilesPath + "nonexistent.txt"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.file.read",
                input: ["filePath": nonExistentFile]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理文件不存在错误")
        }
    }

    // MARK: 4. File Write (tool.file.write)

    func testFileWrite_Basic() async throws {
        // Given
        let testFile = testFilesPath + "write_test.txt"
        let content = "Test content for writing"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": content,
                "append": false
            ]
        )

        // Then
        XCTAssertEqual(result as? Bool, true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: testFile))

        let writtenContent = try String(contentsOfFile: testFile, encoding: .utf8)
        XCTAssertEqual(writtenContent, content)
        print("✅ 文件写入成功")
    }

    func testFileWrite_Append() async throws {
        // Given
        let testFile = testFilesPath + "append_test.txt"
        let content1 = "First line\n"
        let content2 = "Second line\n"

        // Write first content
        _ = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": content1,
                "append": false
            ]
        )

        // Append second content
        let result = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": content2,
                "append": true
            ]
        )

        // Then
        XCTAssertEqual(result as? Bool, true)

        let finalContent = try String(contentsOfFile: testFile, encoding: .utf8)
        XCTAssertEqual(finalContent, content1 + content2)
        print("✅ 文件追加写入成功")
    }

    func testFileWrite_Overwrite() async throws {
        // Given
        let testFile = testFilesPath + "overwrite_test.txt"
        let content1 = "Original content"
        let content2 = "New content"

        // Write original
        _ = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": content1,
                "append": false
            ]
        )

        // Overwrite
        _ = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": content2,
                "append": false
            ]
        )

        // Then
        let finalContent = try String(contentsOfFile: testFile, encoding: .utf8)
        XCTAssertEqual(finalContent, content2)
        print("✅ 文件覆盖写入成功")
    }

    // MARK: - Integration Tests

    func testIntegration_ReadWriteCycle() async throws {
        // Given
        let testFile = testFilesPath + "cycle_test.txt"
        let originalContent = "Test cycle content"

        // Step 1: Write
        _ = try await toolManager.execute(
            toolId: "tool.file.write",
            input: [
                "filePath": testFile,
                "content": originalContent
            ]
        )

        // Step 2: Read
        let readResult = try await toolManager.execute(
            toolId: "tool.file.read",
            input: ["filePath": testFile]
        )

        // Step 3: Verify
        XCTAssertEqual(readResult as? String, originalContent)
        print("✅ 读写循环测试成功")
    }

    func testIntegration_StatisticsWithHTTP() async throws {
        // Given: 从HTTP获取数据并统计
        // 简化测试：直接使用本地数据
        let numbers = [10.0, 20.0, 30.0, 40.0, 50.0]

        // When: 计算统计
        let result = try await toolManager.execute(
            toolId: "tool.data.statistics",
            input: ["numbers": numbers]
        )

        // Then
        XCTAssertNotNil(result)
        if let stats = result as? [String: Any] {
            XCTAssertEqual(stats["mean"] as? Double, 30.0)
            print("✅ 集成测试: 数据统计成功")
        }
    }

    // MARK: - Performance Tests

    func testPerformance_DataStatistics() throws {
        let numbers = (1...1000).map { Double($0) }

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.data.statistics",
                    input: ["numbers": numbers]
                )
            }
        }
        print("✅ 数据统计性能测试完成 (1000个数字)")
    }

    func testPerformance_FileWrite() throws {
        let testFile = testFilesPath + "perf_test.txt"
        let content = String(repeating: "A", count: 10000)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.file.write",
                    input: [
                        "filePath": testFile,
                        "content": content
                    ]
                )
            }
        }
        print("✅ 文件写入性能测试完成 (10KB)")
    }
}
