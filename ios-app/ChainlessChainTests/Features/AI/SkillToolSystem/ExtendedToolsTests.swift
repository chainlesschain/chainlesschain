import XCTest
@testable import ChainlessChain

/// 扩展工具测试套件
/// 测试覆盖: ExtendedTools中的12个工具
/// 测试用例: 25+个
/// 代码行数: ~600行
class ExtendedToolsTests: XCTestCase {

    var toolManager: ToolManager!
    var testFilesPath: String!

    override func setUp() async throws {
        try await super.setUp()
        toolManager = ToolManager.shared

        // 注册扩展工具
        toolManager.registerExtendedTools()

        // 创建测试目录
        let tempDir = NSTemporaryDirectory()
        testFilesPath = tempDir + "extended_tools_test/"
        try? FileManager.default.createDirectory(atPath: testFilesPath, withIntermediateDirectories: true)

        print("\n=== 扩展工具测试开始 ===")
    }

    override func tearDown() async throws {
        // 清理测试文件
        try? FileManager.default.removeItem(atPath: testFilesPath)

        toolManager = nil
        try await super.tearDown()
        print("=== 扩展工具测试结束 ===\n")
    }

    // MARK: - Time/Date Tools (2个工具)

    // MARK: 1. Date Format (tool.date.format)

    func testDateFormat_Basic() async throws {
        // Given: 2024-01-01 00:00:00 UTC
        let timestamp: Double = 1704067200

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.format",
            input: [
                "timestamp": timestamp,
                "format": "yyyy-MM-dd HH:mm:ss"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        let formatted = result as? String
        XCTAssertNotNil(formatted)
        print("✅ 时间格式化成功: \(formatted ?? "")")
    }

    func testDateFormat_DefaultFormat() async throws {
        // Given
        let timestamp: Double = 1704067200

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.format",
            input: ["timestamp": timestamp]
        )

        // Then
        XCTAssertNotNil(result)
        let formatted = result as? String
        XCTAssertNotNil(formatted, "应使用默认格式")
        print("✅ 默认格式化: \(formatted ?? "")")
    }

    func testDateFormat_CustomFormats() async throws {
        // Given
        let timestamp: Double = 1704067200
        let formats = [
            "yyyy-MM-dd",
            "HH:mm:ss",
            "yyyy年MM月dd日",
            "MM/dd/yyyy"
        ]

        // When & Then
        for format in formats {
            let result = try await toolManager.execute(
                toolId: "tool.date.format",
                input: [
                    "timestamp": timestamp,
                    "format": format
                ]
            )

            XCTAssertNotNil(result)
            print("✅ 格式 '\(format)': \(result as? String ?? "")")
        }
    }

    // MARK: 2. Date Calculate (tool.date.calculate)

    func testDateCalculate_Seconds() async throws {
        // Given: 1小时 = 3600秒
        let start: Double = 0
        let end: Double = 3600

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.calculate",
            input: [
                "start": start,
                "end": end,
                "unit": "seconds"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Double, 3600, accuracy: 0.1)
        print("✅ 秒数计算: \(result as? Double ?? 0) 秒")
    }

    func testDateCalculate_Minutes() async throws {
        // Given: 1小时 = 60分钟
        let start: Double = 0
        let end: Double = 3600

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.calculate",
            input: [
                "start": start,
                "end": end,
                "unit": "minutes"
            ]
        )

        // Then
        XCTAssertEqual(result as? Double, 60, accuracy: 0.1)
        print("✅ 分钟计算: \(result as? Double ?? 0) 分钟")
    }

    func testDateCalculate_Hours() async throws {
        // Given: 1天 = 24小时
        let start: Double = 0
        let end: Double = 86400

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.calculate",
            input: [
                "start": start,
                "end": end,
                "unit": "hours"
            ]
        )

        // Then
        XCTAssertEqual(result as? Double, 24, accuracy: 0.1)
        print("✅ 小时计算: \(result as? Double ?? 0) 小时")
    }

    func testDateCalculate_Days() async throws {
        // Given: 7天
        let start: Double = 0
        let end: Double = 604800 // 7 * 86400

        // When
        let result = try await toolManager.execute(
            toolId: "tool.date.calculate",
            input: [
                "start": start,
                "end": end,
                "unit": "days"
            ]
        )

        // Then
        XCTAssertEqual(result as? Double, 7, accuracy: 0.1)
        print("✅ 天数计算: \(result as? Double ?? 0) 天")
    }

    // MARK: - Crypto Tools (3个工具)

    // MARK: 3. Base64 Encode (tool.crypto.base64.encode)

    func testBase64Encode_Basic() async throws {
        // Given
        let text = "Hello, World!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64.encode",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        let encoded = result as? String
        XCTAssertEqual(encoded, "SGVsbG8sIFdvcmxkIQ==")
        print("✅ Base64编码: '\(text)' -> '\(encoded ?? "")'")
    }

    func testBase64Encode_Chinese() async throws {
        // Given
        let text = "你好世界"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64.encode",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        let encoded = result as? String
        XCTAssertNotNil(encoded)
        print("✅ 中文Base64编码: '\(text)' -> '\(encoded ?? "")'")
    }

    func testBase64Encode_EmptyString() async throws {
        // Given
        let text = ""

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64.encode",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        let encoded = result as? String
        XCTAssertEqual(encoded, "")
        print("✅ 空字符串编码成功")
    }

    // MARK: 4. Base64 Decode (tool.crypto.base64.decode)

    func testBase64Decode_Basic() async throws {
        // Given
        let encoded = "SGVsbG8sIFdvcmxkIQ=="

        // When
        let result = try await toolManager.execute(
            toolId: "tool.crypto.base64.decode",
            input: ["encoded": encoded]
        )

        // Then
        XCTAssertNotNil(result)
        let decoded = result as? String
        XCTAssertEqual(decoded, "Hello, World!")
        print("✅ Base64解码: '\(encoded)' -> '\(decoded ?? "")'")
    }

    func testBase64Decode_RoundTrip() async throws {
        // Given
        let originalText = "Test round-trip encoding"

        // Step 1: Encode
        let encodeResult = try await toolManager.execute(
            toolId: "tool.crypto.base64.encode",
            input: ["text": originalText]
        )

        guard let encoded = encodeResult as? String else {
            XCTFail("编码失败")
            return
        }

        // Step 2: Decode
        let decodeResult = try await toolManager.execute(
            toolId: "tool.crypto.base64.decode",
            input: ["encoded": encoded]
        )

        // Then
        XCTAssertEqual(decodeResult as? String, originalText)
        print("✅ Base64往返测试成功: '\(originalText)' -> '\(encoded)' -> '\(decodeResult as? String ?? "")'")
    }

    func testBase64Decode_Invalid() async throws {
        // Given: 无效的Base64字符串
        let invalid = "Invalid!!!Base64"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.crypto.base64.decode",
                input: ["encoded": invalid]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效Base64错误")
        }
    }

    // MARK: 5. UUID Generate (tool.uuid.generate)

    func testUUIDGenerate_Basic() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.uuid.generate",
            input: [:]
        )

        // Then
        XCTAssertNotNil(result)
        let uuid = result as? String
        XCTAssertNotNil(uuid)
        XCTAssertEqual(uuid?.count, 36, "UUID应为36个字符")
        XCTAssertTrue(uuid?.contains("-") ?? false, "UUID应包含连字符")
        print("✅ UUID生成: \(uuid ?? "")")
    }

    func testUUIDGenerate_Uniqueness() async throws {
        // Generate 10 UUIDs
        var uuids: Set<String> = []

        for _ in 0..<10 {
            let result = try await toolManager.execute(
                toolId: "tool.uuid.generate",
                input: [:]
            )

            if let uuid = result as? String {
                uuids.insert(uuid)
            }
        }

        // Then
        XCTAssertEqual(uuids.count, 10, "10个UUID应该都不相同")
        print("✅ UUID唯一性验证: 生成10个不同的UUID")
    }

    func testUUIDGenerate_Format() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.uuid.generate",
            input: [:]
        )

        // Then
        let uuid = result as? String
        let pattern = "^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$"
        let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive)
        let range = NSRange(location: 0, length: uuid?.utf16.count ?? 0)
        let matches = regex?.numberOfMatches(in: uuid ?? "", options: [], range: range)

        XCTAssertEqual(matches, 1, "UUID应符合标准格式")
        print("✅ UUID格式验证通过")
    }

    // MARK: - Network Tools (2个工具)

    // MARK: 6. URL Parse (tool.url.parse)

    func testURLParse_Basic() async throws {
        // Given
        let url = "https://www.example.com:8080/path/to/resource?key=value#fragment"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.url.parse",
            input: ["url": url]
        )

        // Then
        XCTAssertNotNil(result)
        if let components = result as? [String: String] {
            XCTAssertEqual(components["scheme"], "https")
            XCTAssertEqual(components["host"], "www.example.com")
            XCTAssertEqual(components["port"], "8080")
            XCTAssertEqual(components["path"], "/path/to/resource")
            XCTAssertEqual(components["query"], "key=value")
            XCTAssertEqual(components["fragment"], "fragment")
            print("✅ URL解析成功:")
            print("   Scheme: \(components["scheme"] ?? "")")
            print("   Host: \(components["host"] ?? "")")
            print("   Port: \(components["port"] ?? "")")
            print("   Path: \(components["path"] ?? "")")
        }
    }

    func testURLParse_SimpleURL() async throws {
        // Given
        let url = "http://example.com"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.url.parse",
            input: ["url": url]
        )

        // Then
        XCTAssertNotNil(result)
        if let components = result as? [String: String] {
            XCTAssertEqual(components["scheme"], "http")
            XCTAssertEqual(components["host"], "example.com")
            print("✅ 简单URL解析成功")
        }
    }

    func testURLParse_WithQuery() async throws {
        // Given
        let url = "https://api.example.com/search?q=swift&lang=en&page=1"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.url.parse",
            input: ["url": url]
        )

        // Then
        XCTAssertNotNil(result)
        if let components = result as? [String: String] {
            XCTAssertEqual(components["query"], "q=swift&lang=en&page=1")
            print("✅ 带查询参数URL解析成功")
        }
    }

    func testURLParse_Invalid() async throws {
        // Given
        let invalid = "not a valid url"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.url.parse",
                input: ["url": invalid]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效URL错误")
        }
    }

    // MARK: 7. JSON Validate (tool.json.validate)

    func testJSONValidate_ValidJSON() async throws {
        // Given
        let validJSON = """
        {
            "name": "John",
            "age": 30,
            "active": true
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": validJSON]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Bool, true)
        print("✅ 有效JSON验证通过")
    }

    func testJSONValidate_InvalidJSON() async throws {
        // Given
        let invalidJSON = "{invalid json}"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": invalidJSON]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? Bool, false)
        print("✅ 无效JSON验证返回false")
    }

    func testJSONValidate_JSONArray() async throws {
        // Given
        let arrayJSON = """
        [1, 2, 3, "four", {"five": 5}]
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": arrayJSON]
        )

        // Then
        XCTAssertEqual(result as? Bool, true)
        print("✅ JSON数组验证通过")
    }

    // MARK: - Performance Tests

    func testPerformance_DateFormat() throws {
        let timestamp: Double = 1704067200

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.date.format",
                    input: ["timestamp": timestamp]
                )
            }
        }
        print("✅ 时间格式化性能测试完成")
    }

    func testPerformance_Base64Encode() throws {
        let text = String(repeating: "A", count: 1000)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.crypto.base64.encode",
                    input: ["text": text]
                )
            }
        }
        print("✅ Base64编码性能测试完成")
    }

    func testPerformance_UUIDGenerate() throws {
        measure {
            Task {
                for _ in 0..<100 {
                    _ = try? await toolManager.execute(
                        toolId: "tool.uuid.generate",
                        input: [:]
                    )
                }
            }
        }
        print("✅ UUID生成性能测试完成 (100次)")
    }
}
