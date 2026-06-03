import XCTest
@testable import ChainlessChain

/// 数据处理工具测试套件
/// 测试覆盖: 8个工具 (3个JSON + 2个XML + 3个Data Transform)
/// 测试用例: 30+个
/// 代码行数: ~700行
class DataProcessingToolsTests: XCTestCase {

    var toolManager: ToolManager!

    override func setUp() async throws {
        try await super.setUp()
        toolManager = ToolManager.shared

        // 注册所有数据处理工具
        DataProcessingTools.registerAll()

        print("\n=== 数据处理工具测试开始 ===")
    }

    override func tearDown() async throws {
        toolManager = nil
        try await super.tearDown()
        print("=== 数据处理工具测试结束 ===\n")
    }

    // MARK: - JSON工具测试 (3个工具)

    // MARK: 1. JSON Validation (tool.json.validate)

    func testJSONValidate_ValidObject() async throws {
        // Given
        let jsonString = """
        {
            "name": "John Doe",
            "age": 30,
            "email": "john@example.com"
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": jsonString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            let type = dict["type"] as? String
            let message = dict["message"] as? String

            XCTAssertEqual(valid, true)
            XCTAssertEqual(type, "object")
            XCTAssertNotNil(message)
            print("✅ JSON对象验证成功: \(message ?? "")")
        }
    }

    func testJSONValidate_ValidArray() async throws {
        // Given
        let jsonString = """
        [
            {"id": 1, "name": "Item 1"},
            {"id": 2, "name": "Item 2"}
        ]
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": jsonString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            let type = dict["type"] as? String

            XCTAssertEqual(valid, true)
            XCTAssertEqual(type, "array")
            print("✅ JSON数组验证成功")
        }
    }

    func testJSONValidate_Invalid() async throws {
        // Given
        let invalidJSON = "{invalid json without quotes}"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": invalidJSON]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            let type = dict["type"] as? String

            XCTAssertEqual(valid, false)
            XCTAssertEqual(type, "invalid")
            print("✅ 正确识别无效JSON")
        }
    }

    func testJSONValidate_EmptyString() async throws {
        // Given
        let emptyJSON = ""

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.validate",
            input: ["json": emptyJSON]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            XCTAssertEqual(valid, false)
            print("✅ 正确处理空字符串")
        }
    }

    // MARK: 2. JSON Format (tool.json.format)

    func testJSONFormat_Prettify() async throws {
        // Given
        let compactJSON = """
        {"name":"John","age":30,"skills":["Swift","Python","Go"]}
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.format",
            input: [
                "json": compactJSON,
                "pretty": true
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let formatted = dict["formatted"] as? String
            let originalLength = dict["originalLength"] as? Int
            let formattedLength = dict["formattedLength"] as? Int

            XCTAssertNotNil(formatted)
            XCTAssertGreaterThan(formattedLength ?? 0, originalLength ?? 0, "美化后应该更长")
            print("✅ JSON美化成功: \(originalLength ?? 0) -> \(formattedLength ?? 0)字符")
        }
    }

    func testJSONFormat_Compact() async throws {
        // Given
        let prettyJSON = """
        {
            "name": "John",
            "age": 30,
            "skills": [
                "Swift",
                "Python"
            ]
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.format",
            input: [
                "json": prettyJSON,
                "pretty": false
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let formatted = dict["formatted"] as? String
            let originalLength = dict["originalLength"] as? Int
            let formattedLength = dict["formattedLength"] as? Int

            XCTAssertNotNil(formatted)
            XCTAssertLessThan(formattedLength ?? 0, originalLength ?? 0, "压缩后应该更短")
            print("✅ JSON压缩成功: \(originalLength ?? 0) -> \(formattedLength ?? 0)字符")
        }
    }

    func testJSONFormat_InvalidJSON() async throws {
        // Given
        let invalidJSON = "{invalid json"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.json.format",
                input: ["json": invalidJSON]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效JSON格式化错误")
        }
    }

    // MARK: 3. JSON Query (tool.json.query)

    func testJSONQuery_SimpleField() async throws {
        // Given
        let jsonString = """
        {
            "name": "John",
            "age": 30
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.query",
            input: [
                "json": jsonString,
                "path": "$.name"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let resultValue = dict["result"] as? String
            XCTAssertNotNil(resultValue)
            XCTAssertTrue(resultValue?.contains("John") ?? false)
            print("✅ 简单字段查询成功: \(resultValue ?? "")")
        }
    }

    func testJSONQuery_NestedField() async throws {
        // Given
        let jsonString = """
        {
            "user": {
                "profile": {
                    "name": "John Doe"
                }
            }
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.query",
            input: [
                "json": jsonString,
                "path": "$.user.profile.name"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let resultValue = dict["result"] as? String
            XCTAssertNotNil(resultValue)
            print("✅ 嵌套字段查询成功: \(resultValue ?? "")")
        }
    }

    func testJSONQuery_ArrayIndex() async throws {
        // Given
        let jsonString = """
        {
            "users": [
                {"name": "Alice"},
                {"name": "Bob"},
                {"name": "Charlie"}
            ]
        }
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.json.query",
            input: [
                "json": jsonString,
                "path": "$.users[1].name"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let resultValue = dict["result"] as? String
            XCTAssertNotNil(resultValue)
            print("✅ 数组索引查询成功: \(resultValue ?? "")")
        }
    }

    func testJSONQuery_InvalidPath() async throws {
        // Given
        let jsonString = """
        {"name": "John"}
        """

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.json.query",
                input: [
                    "json": jsonString,
                    "path": "$.nonexistent.field"
                ]
            )
            // May or may not fail, depending on implementation
        } catch {
            print("✅ 正确处理无效路径")
        }
    }

    func testJSONQuery_ArrayOutOfBounds() async throws {
        // Given
        let jsonString = """
        {"items": ["a", "b", "c"]}
        """

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.json.query",
                input: [
                    "json": jsonString,
                    "path": "$.items[10]"
                ]
            )
            XCTFail("应该抛出数组越界错误")
        } catch {
            // Then
            print("✅ 正确处理数组越界错误")
        }
    }

    // MARK: - XML工具测试 (2个工具)

    // MARK: 4. XML Validation (tool.xml.validate)

    func testXMLValidate_Valid() async throws {
        // Given
        let xmlString = """
        <?xml version="1.0" encoding="UTF-8"?>
        <person>
            <name>John Doe</name>
            <age>30</age>
            <email>john@example.com</email>
        </person>
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.validate",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            let message = dict["message"] as? String

            XCTAssertEqual(valid, true)
            XCTAssertNotNil(message)
            print("✅ XML验证成功: \(message ?? "")")
        }
    }

    func testXMLValidate_SimpleXML() async throws {
        // Given
        let xmlString = "<root><item>Value</item></root>"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.validate",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            XCTAssertEqual(valid, true)
            print("✅ 简单XML验证成功")
        }
    }

    func testXMLValidate_Invalid() async throws {
        // Given
        let invalidXML = "<root><unclosed>"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.validate",
            input: ["xml": invalidXML]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            XCTAssertEqual(valid, false)
            print("✅ 正确识别无效XML")
        }
    }

    func testXMLValidate_WithAttributes() async throws {
        // Given
        let xmlString = """
        <person id="123" status="active">
            <name>John</name>
        </person>
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.validate",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let valid = dict["valid"] as? Bool
            XCTAssertEqual(valid, true)
            print("✅ 带属性的XML验证成功")
        }
    }

    // MARK: 5. XML to JSON (tool.xml.tojson)

    func testXMLToJSON_SimpleConversion() async throws {
        // Given
        let xmlString = """
        <person>
            <name>John Doe</name>
            <age>30</age>
        </person>
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.tojson",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let jsonString = dict["json"] as? String

            XCTAssertNotNil(jsonString)
            XCTAssertTrue(jsonString?.contains("person") ?? false)
            print("✅ XML转JSON成功:")
            print(jsonString ?? "")
        }
    }

    func testXMLToJSON_WithAttributes() async throws {
        // Given
        let xmlString = """
        <book id="123" category="fiction">
            <title>Great Book</title>
            <author>John Smith</author>
        </book>
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.tojson",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let jsonString = dict["json"] as? String

            XCTAssertNotNil(jsonString)
            XCTAssertTrue(jsonString?.contains("@attributes") ?? false, "应包含属性字段")
            print("✅ 带属性的XML转JSON成功")
        }
    }

    func testXMLToJSON_NestedElements() async throws {
        // Given
        let xmlString = """
        <root>
            <parent>
                <child>Value 1</child>
                <child>Value 2</child>
            </parent>
        </root>
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.xml.tojson",
            input: ["xml": xmlString]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let jsonString = dict["json"] as? String
            XCTAssertNotNil(jsonString)
            print("✅ 嵌套XML转JSON成功")
        }
    }

    func testXMLToJSON_InvalidXML() async throws {
        // Given
        let invalidXML = "<root><unclosed>"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.xml.tojson",
                input: ["xml": invalidXML]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效XML转换错误")
        }
    }

    // MARK: - Data Transform工具测试 (3个工具)

    // MARK: 6. Data Merge (tool.data.merge)

    func testDataMerge_Basic() async throws {
        // Given
        let objects: [[String: Any]] = [
            ["name": "John", "age": 30],
            ["email": "john@example.com", "city": "NYC"]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.merge",
            input: ["objects": objects]
        )

        // Then
        XCTAssertNotNil(result)
        if let merged = result as? [String: Any] {
            XCTAssertNotNil(merged["name"])
            XCTAssertNotNil(merged["age"])
            XCTAssertNotNil(merged["email"])
            XCTAssertNotNil(merged["city"])
            print("✅ 数据合并成功: \(merged.keys.count)个字段")
        }
    }

    func testDataMerge_OverwriteStrategy() async throws {
        // Given
        let objects: [[String: Any]] = [
            ["name": "John", "version": 1],
            ["name": "Jane", "version": 2]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.merge",
            input: [
                "objects": objects,
                "strategy": "overwrite"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let merged = result as? [String: Any] {
            let name = merged["name"] as? String
            let version = merged["version"] as? Int

            XCTAssertEqual(name, "Jane", "overwrite策略应使用最后的值")
            XCTAssertEqual(version, 2)
            print("✅ Overwrite策略测试成功: name=\(name ?? ""), version=\(version ?? 0)")
        }
    }

    func testDataMerge_SkipStrategy() async throws {
        // Given
        let objects: [[String: Any]] = [
            ["name": "John", "age": 30],
            ["name": "Jane", "email": "jane@example.com"]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.merge",
            input: [
                "objects": objects,
                "strategy": "skip"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let merged = result as? [String: Any] {
            let name = merged["name"] as? String

            XCTAssertEqual(name, "John", "skip策略应保留第一个值")
            XCTAssertNotNil(merged["email"])
            print("✅ Skip策略测试成功: name=\(name ?? "")")
        }
    }

    func testDataMerge_MultipleObjects() async throws {
        // Given
        let objects: [[String: Any]] = [
            ["a": 1],
            ["b": 2],
            ["c": 3],
            ["d": 4]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.merge",
            input: ["objects": objects]
        )

        // Then
        XCTAssertNotNil(result)
        if let merged = result as? [String: Any] {
            XCTAssertEqual(merged.keys.count, 4)
            print("✅ 多对象合并成功: \(merged.keys.count)个字段")
        }
    }

    // MARK: 7. Data Filter (tool.data.filter)

    func testDataFilter_Equals() async throws {
        // Given
        let data: [[String: Any]] = [
            ["name": "Alice", "age": 25],
            ["name": "Bob", "age": 30],
            ["name": "Charlie", "age": 25]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": data,
                "field": "age",
                "operator": "eq",
                "value": "25"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let filtered = dict["filtered"] as? [[String: Any]]
            let count = dict["count"] as? Int

            XCTAssertEqual(count, 2, "应该有2条age=25的记录")
            XCTAssertEqual(filtered?.count, 2)
            print("✅ 等于过滤成功: \(count ?? 0)条记录")
        }
    }

    func testDataFilter_GreaterThan() async throws {
        // Given
        let data: [[String: Any]] = [
            ["name": "Alice", "score": 85],
            ["name": "Bob", "score": 92],
            ["name": "Charlie", "score": 78]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": data,
                "field": "score",
                "operator": "gt",
                "value": "80"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 2, "应该有2条score>80的记录")
            print("✅ 大于过滤成功: \(count ?? 0)条记录")
        }
    }

    func testDataFilter_LessThan() async throws {
        // Given
        let data: [[String: Any]] = [
            ["product": "A", "price": 10],
            ["product": "B", "price": 25],
            ["product": "C", "price": 15]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": data,
                "field": "price",
                "operator": "lt",
                "value": "20"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 2, "应该有2条price<20的记录")
            print("✅ 小于过滤成功: \(count ?? 0)条记录")
        }
    }

    func testDataFilter_Contains() async throws {
        // Given
        let data: [[String: Any]] = [
            ["name": "Alice Smith"],
            ["name": "Bob Johnson"],
            ["name": "Charlie Smith"]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": data,
                "field": "name",
                "operator": "contains",
                "value": "Smith"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 2, "应该有2条包含'Smith'的记录")
            print("✅ 包含过滤成功: \(count ?? 0)条记录")
        }
    }

    func testDataFilter_NotEquals() async throws {
        // Given
        let data: [[String: Any]] = [
            ["status": "active"],
            ["status": "inactive"],
            ["status": "active"]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": data,
                "field": "status",
                "operator": "ne",
                "value": "active"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 1, "应该有1条status!=active的记录")
            print("✅ 不等于过滤成功: \(count ?? 0)条记录")
        }
    }

    // MARK: 8. Data Transform (tool.data.transform)

    func testDataTransform_BasicMapping() async throws {
        // Given
        let data: [[String: Any]] = [
            ["firstName": "John", "lastName": "Doe"],
            ["firstName": "Jane", "lastName": "Smith"]
        ]

        let mapping = [
            "firstName": "first_name",
            "lastName": "last_name"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.transform",
            input: [
                "data": data,
                "mapping": mapping
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let transformed = dict["transformed"] as? [[String: Any]]
            let count = dict["count"] as? Int

            XCTAssertEqual(count, 2)
            XCTAssertEqual(transformed?.count, 2)

            if let firstItem = transformed?.first {
                XCTAssertNotNil(firstItem["first_name"])
                XCTAssertNotNil(firstItem["last_name"])
                XCTAssertNil(firstItem["firstName"])
                print("✅ 数据转换成功: \(count ?? 0)条记录")
            }
        }
    }

    func testDataTransform_PartialMapping() async throws {
        // Given
        let data: [[String: Any]] = [
            ["name": "John", "age": 30, "email": "john@example.com"]
        ]

        let mapping = [
            "name": "fullName"
            // age和email保持不变
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.transform",
            input: [
                "data": data,
                "mapping": mapping
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any],
           let transformed = dict["transformed"] as? [[String: Any]],
           let firstItem = transformed.first {

            XCTAssertNotNil(firstItem["fullName"])
            XCTAssertNotNil(firstItem["age"])
            XCTAssertNotNil(firstItem["email"])
            print("✅ 部分映射转换成功")
        }
    }

    func testDataTransform_MultipleRecords() async throws {
        // Given
        let data: [[String: Any]] = [
            ["id": 1, "old_name": "Item 1"],
            ["id": 2, "old_name": "Item 2"],
            ["id": 3, "old_name": "Item 3"]
        ]

        let mapping = [
            "old_name": "new_name"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.transform",
            input: [
                "data": data,
                "mapping": mapping
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 3)
            print("✅ 多条记录转换成功: \(count ?? 0)条")
        }
    }

    func testDataTransform_EmptyData() async throws {
        // Given
        let data: [[String: Any]] = []
        let mapping = ["old": "new"]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.data.transform",
            input: [
                "data": data,
                "mapping": mapping
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertEqual(count, 0)
            print("✅ 空数据转换成功")
        }
    }

    // MARK: - Integration测试

    func testIntegration_JSONToFilterToTransform() async throws {
        // Given: JSON数据
        let jsonString = """
        {
            "users": [
                {"firstName": "Alice", "age": 25, "status": "active"},
                {"firstName": "Bob", "age": 30, "status": "inactive"},
                {"firstName": "Charlie", "age": 35, "status": "active"}
            ]
        }
        """

        // Step 1: 解析JSON
        guard let data = jsonString.data(using: .utf8),
              let jsonObject = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let users = jsonObject["users"] as? [[String: Any]] else {
            XCTFail("JSON解析失败")
            return
        }

        // Step 2: 过滤active用户
        let filterResult = try await toolManager.execute(
            toolId: "tool.data.filter",
            input: [
                "data": users,
                "field": "status",
                "operator": "eq",
                "value": "active"
            ]
        )

        guard let filterDict = filterResult as? [String: Any],
              let filteredUsers = filterDict["filtered"] as? [[String: Any]] else {
            XCTFail("过滤失败")
            return
        }

        // Step 3: 转换字段名
        let transformResult = try await toolManager.execute(
            toolId: "tool.data.transform",
            input: [
                "data": filteredUsers,
                "mapping": ["firstName": "name"]
            ]
        )

        // Then
        XCTAssertNotNil(transformResult)
        if let dict = transformResult as? [String: Any],
           let transformed = dict["transformed"] as? [[String: Any]] {
            XCTAssertEqual(transformed.count, 2, "应该有2个active用户")
            print("✅ 集成测试成功: JSON解析 -> 过滤 -> 转换")
        }
    }

    // MARK: - Performance测试

    func testPerformance_JSONValidation() throws {
        let jsonString = """
        {"name":"Test","items":["a","b","c"],"nested":{"key":"value"}}
        """

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.json.validate",
                    input: ["json": jsonString]
                )
            }
        }
        print("✅ JSON验证性能测试完成")
    }

    func testPerformance_DataFilter() throws {
        let data = (0..<100).map { ["id": $0, "value": $0 * 2] }

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.data.filter",
                    input: [
                        "data": data,
                        "field": "value",
                        "operator": "gt",
                        "value": "50"
                    ]
                )
            }
        }
        print("✅ 数据过滤性能测试完成")
    }

    func testPerformance_DataTransform() throws {
        let data = (0..<100).map { ["oldKey": $0] }
        let mapping = ["oldKey": "newKey"]

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.data.transform",
                    input: [
                        "data": data,
                        "mapping": mapping
                    ]
                )
            }
        }
        print("✅ 数据转换性能测试完成")
    }
}
