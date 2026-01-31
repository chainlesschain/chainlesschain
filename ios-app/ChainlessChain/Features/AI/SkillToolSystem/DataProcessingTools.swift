import Foundation

// MARK: - Data Processing Tools (8 tools)
// JSON: 3 tools | XML: 2 tools | Data Transform: 3 tools

public class DataProcessingTools {

    // MARK: - JSON Tools (3 tools)

    /// Tool: tool.json.validate - JSON验证
    public static let jsonValidateTool = Tool(
        id: "tool.json.validate",
        name: "JSON验证",
        description: "验证JSON字符串的格式是否正确",
        category: .utility,
        parameters: [
            ToolParameter(name: "json", type: .string, description: "JSON字符串", required: true)
        ],
        executor: jsonValidateExecutor
    )

    private static let jsonValidateExecutor: ToolExecutor = { input in
        guard let jsonString = input.getString("json") else {
            return .failure(error: "缺少JSON字符串")
        }

        guard let data = jsonString.data(using: .utf8) else {
            return .failure(error: "字符串编码失败")
        }

        do {
            let jsonObject = try JSONSerialization.jsonObject(with: data, options: [])

            var objectType = "unknown"
            if jsonObject is [String: Any] {
                objectType = "object"
            } else if jsonObject is [Any] {
                objectType = "array"
            }

            return .success(data: [
                "valid": true,
                "type": objectType,
                "message": "JSON格式正确"
            ])
        } catch {
            return .success(data: [
                "valid": false,
                "type": "invalid",
                "message": "JSON格式错误: \(error.localizedDescription)"
            ])
        }
    }

    /// Tool: tool.json.format - JSON格式化
    public static let jsonFormatTool = Tool(
        id: "tool.json.format",
        name: "JSON格式化",
        description: "美化或压缩JSON字符串",
        category: .utility,
        parameters: [
            ToolParameter(name: "json", type: .string, description: "JSON字符串", required: true),
            ToolParameter(name: "pretty", type: .boolean, description: "是否美化（默认true）", required: false)
        ],
        executor: jsonFormatExecutor
    )

    private static let jsonFormatExecutor: ToolExecutor = { input in
        guard let jsonString = input.getString("json") else {
            return .failure(error: "缺少JSON字符串")
        }

        let pretty = input.getBoolean("pretty") ?? true

        guard let data = jsonString.data(using: .utf8) else {
            return .failure(error: "字符串编码失败")
        }

        do {
            let jsonObject = try JSONSerialization.jsonObject(with: data, options: [])

            let options: JSONSerialization.WritingOptions = pretty ? [.prettyPrinted, .sortedKeys] : []
            let formattedData = try JSONSerialization.data(withJSONObject: jsonObject, options: options)

            guard let formattedString = String(data: formattedData, encoding: .utf8) else {
                return .failure(error: "格式化失败")
            }

            return .success(data: [
                "formatted": formattedString,
                "originalLength": jsonString.count,
                "formattedLength": formattedString.count
            ])
        } catch {
            return .failure(error: "JSON解析失败: \(error.localizedDescription)")
        }
    }

    /// Tool: tool.json.query - JSON路径查询
    public static let jsonQueryTool = Tool(
        id: "tool.json.query",
        name: "JSON路径查询",
        description: "使用JSONPath查询JSON数据",
        category: .utility,
        parameters: [
            ToolParameter(name: "json", type: .string, description: "JSON字符串", required: true),
            ToolParameter(name: "path", type: .string, description: "查询路径（如$.users[0].name）", required: true)
        ],
        executor: jsonQueryExecutor
    )

    private static let jsonQueryExecutor: ToolExecutor = { input in
        guard let jsonString = input.getString("json"),
              let path = input.getString("path") else {
            return .failure(error: "缺少JSON字符串或查询路径")
        }

        guard let data = jsonString.data(using: .utf8) else {
            return .failure(error: "字符串编码失败")
        }

        do {
            let jsonObject = try JSONSerialization.jsonObject(with: data, options: [])

            // 简化的路径查询实现（支持基本的点号和数组索引）
            let pathComponents = path.replacingOccurrences(of: "$.", with: "")
                .components(separatedBy: ".")

            var current: Any = jsonObject

            for component in pathComponents {
                // 检查是否为数组索引
                if component.contains("[") && component.contains("]") {
                    let parts = component.components(separatedBy: "[")
                    let key = parts[0]
                    let indexStr = parts[1].replacingOccurrences(of: "]", with: "")

                    if !key.isEmpty {
                        if let dict = current as? [String: Any] {
                            current = dict[key] ?? NSNull()
                        }
                    }

                    if let index = Int(indexStr), let array = current as? [Any] {
                        if index >= 0 && index < array.count {
                            current = array[index]
                        } else {
                            return .failure(error: "数组索引越界: \(index)")
                        }
                    }
                } else {
                    if let dict = current as? [String: Any] {
                        current = dict[component] ?? NSNull()
                    } else {
                        return .failure(error: "无效的路径: \(component)")
                    }
                }
            }

            // 将结果转换为字符串
            var resultString = ""
            if let dict = current as? [String: Any],
               let resultData = try? JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted),
               let str = String(data: resultData, encoding: .utf8) {
                resultString = str
            } else if let array = current as? [Any],
                      let resultData = try? JSONSerialization.data(withJSONObject: array, options: .prettyPrinted),
                      let str = String(data: resultData, encoding: .utf8) {
                resultString = str
            } else if current is NSNull {
                resultString = "null"
            } else {
                resultString = String(describing: current)
            }

            return .success(data: [
                "result": resultString,
                "path": path
            ])
        } catch {
            return .failure(error: "JSON解析失败: \(error.localizedDescription)")
        }
    }

    // MARK: - XML Tools (2 tools)

    /// Tool: tool.xml.validate - XML验证
    public static let xmlValidateTool = Tool(
        id: "tool.xml.validate",
        name: "XML验证",
        description: "验证XML字符串的格式是否正确",
        category: .utility,
        parameters: [
            ToolParameter(name: "xml", type: .string, description: "XML字符串", required: true)
        ],
        executor: xmlValidateExecutor
    )

    private static let xmlValidateExecutor: ToolExecutor = { input in
        guard let xmlString = input.getString("xml") else {
            return .failure(error: "缺少XML字符串")
        }

        guard let data = xmlString.data(using: .utf8) else {
            return .failure(error: "字符串编码失败")
        }

        let parser = XMLParser(data: data)
        let delegate = XMLValidationDelegate()
        parser.delegate = delegate

        let success = parser.parse()

        if success {
            return .success(data: [
                "valid": true,
                "message": "XML格式正确"
            ])
        } else {
            let error = parser.parserError?.localizedDescription ?? "未知错误"
            return .success(data: [
                "valid": false,
                "message": "XML格式错误: \(error)"
            ])
        }
    }

    /// Tool: tool.xml.toJson - XML转JSON
    public static let xmlToJsonTool = Tool(
        id: "tool.xml.tojson",
        name: "XML转JSON",
        description: "将XML字符串转换为JSON格式",
        category: .utility,
        parameters: [
            ToolParameter(name: "xml", type: .string, description: "XML字符串", required: true)
        ],
        executor: xmlToJsonExecutor
    )

    private static let xmlToJsonExecutor: ToolExecutor = { input in
        guard let xmlString = input.getString("xml") else {
            return .failure(error: "缺少XML字符串")
        }

        guard let data = xmlString.data(using: .utf8) else {
            return .failure(error: "字符串编码失败")
        }

        let parser = XMLParser(data: data)
        let delegate = XMLToJSONDelegate()
        parser.delegate = delegate

        if parser.parse() {
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: delegate.result, options: .prettyPrinted)
                guard let jsonString = String(data: jsonData, encoding: .utf8) else {
                    return .failure(error: "JSON转换失败")
                }

                return .success(data: ["json": jsonString])
            } catch {
                return .failure(error: "JSON序列化失败: \(error.localizedDescription)")
            }
        } else {
            return .failure(error: "XML解析失败: \(parser.parserError?.localizedDescription ?? "未知错误")")
        }
    }

    // MARK: - Data Transform Tools (3 tools)

    /// Tool: tool.data.merge - 合并多个JSON对象
    public static let dataMergeTool = Tool(
        id: "tool.data.merge",
        name: "数据合并",
        description: "合并多个JSON对象为一个",
        category: .utility,
        parameters: [
            ToolParameter(name: "objects", type: .array, description: "JSON对象数组", required: true),
            ToolParameter(name: "strategy", type: .string, description: "冲突策略（overwrite/skip，默认overwrite）", required: false)
        ],
        executor: dataMergeExecutor
    )

    private static let dataMergeExecutor: ToolExecutor = { input in
        guard let objects = input.getArray("objects") as? [[String: Any]] else {
            return .failure(error: "缺少JSON对象数组")
        }

        let strategy = input.getString("strategy") ?? "overwrite"

        var merged: [String: Any] = [:]

        for obj in objects {
            for (key, value) in obj {
                if strategy == "skip" && merged[key] != nil {
                    continue // 跳过已存在的键
                }
                merged[key] = value
            }
        }

        return .success(data: merged)
    }

    /// Tool: tool.data.filter - 过滤数据
    public static let dataFilterTool = Tool(
        id: "tool.data.filter",
        name: "数据过滤",
        description: "根据条件过滤JSON数组",
        category: .utility,
        parameters: [
            ToolParameter(name: "data", type: .array, description: "数据数组", required: true),
            ToolParameter(name: "field", type: .string, description: "字段名", required: true),
            ToolParameter(name: "operator", type: .string, description: "操作符（eq/ne/gt/lt/contains）", required: true),
            ToolParameter(name: "value", type: .string, description: "比较值", required: true)
        ],
        executor: dataFilterExecutor
    )

    private static let dataFilterExecutor: ToolExecutor = { input in
        guard let data = input.getArray("data") as? [[String: Any]],
              let field = input.getString("field"),
              let op = input.getString("operator"),
              let value = input.getString("value") else {
            return .failure(error: "缺少必需参数")
        }

        let filtered = data.filter { item in
            guard let fieldValue = item[field] else { return false }

            let fieldStr = String(describing: fieldValue)

            switch op.lowercased() {
            case "eq": // 等于
                return fieldStr == value
            case "ne": // 不等于
                return fieldStr != value
            case "gt": // 大于
                if let fieldNum = Double(fieldStr), let valueNum = Double(value) {
                    return fieldNum > valueNum
                }
                return false
            case "lt": // 小于
                if let fieldNum = Double(fieldStr), let valueNum = Double(value) {
                    return fieldNum < valueNum
                }
                return false
            case "contains": // 包含
                return fieldStr.lowercased().contains(value.lowercased())
            default:
                return false
            }
        }

        return .success(data: [
            "filtered": filtered,
            "count": filtered.count,
            "originalCount": data.count
        ])
    }

    /// Tool: tool.data.transform - 数据转换
    public static let dataTransformTool = Tool(
        id: "tool.data.transform",
        name: "数据转换",
        description: "对数组中的每个对象应用转换规则",
        category: .utility,
        parameters: [
            ToolParameter(name: "data", type: .array, description: "数据数组", required: true),
            ToolParameter(name: "mapping", type: .object, description: "字段映射规则（如{\"oldName\":\"newName\"}）", required: true)
        ],
        executor: dataTransformExecutor
    )

    private static let dataTransformExecutor: ToolExecutor = { input in
        guard let data = input.getArray("data") as? [[String: Any]],
              let mapping = input.getObject("mapping") as? [String: String] else {
            return .failure(error: "缺少必需参数")
        }

        var transformed: [[String: Any]] = []

        for item in data {
            var newItem: [String: Any] = [:]

            // 应用映射
            for (oldKey, value) in item {
                let newKey = mapping[oldKey] ?? oldKey
                newItem[newKey] = value
            }

            transformed.append(newItem)
        }

        return .success(data: [
            "transformed": transformed,
            "count": transformed.count
        ])
    }

    // MARK: - 工具注册

    public static func registerAll() {
        let toolManager = ToolManager.shared

        // JSON工具 (3个)
        toolManager.register(jsonValidateTool)
        toolManager.register(jsonFormatTool)
        toolManager.register(jsonQueryTool)

        // XML工具 (2个)
        toolManager.register(xmlValidateTool)
        toolManager.register(xmlToJsonTool)

        // Data Transform工具 (3个)
        toolManager.register(dataMergeTool)
        toolManager.register(dataFilterTool)
        toolManager.register(dataTransformTool)
    }
}

// MARK: - XML Parser Delegates

private class XMLValidationDelegate: NSObject, XMLParserDelegate {
    // 仅用于验证，不需要实现具体方法
}

private class XMLToJSONDelegate: NSObject, XMLParserDelegate {
    var result: [String: Any] = [:]
    private var currentElement = ""
    private var currentText = ""
    private var stack: [[String: Any]] = []

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName
        currentText = ""

        var element: [String: Any] = [:]
        if !attributeDict.isEmpty {
            element["@attributes"] = attributeDict
        }

        stack.append(element)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        guard var element = stack.popLast() else { return }

        if !currentText.isEmpty {
            element["text"] = currentText
        }

        if stack.isEmpty {
            result[elementName] = element
        } else {
            var parent = stack.removeLast()
            if var children = parent[elementName] as? [[String: Any]] {
                children.append(element)
                parent[elementName] = children
            } else if let existingElement = parent[elementName] as? [String: Any] {
                parent[elementName] = [existingElement, element]
            } else {
                parent[elementName] = element
            }
            stack.append(parent)
        }

        currentText = ""
    }
}
