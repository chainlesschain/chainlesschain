import Foundation
import PDFKit

/// 内置工具定义
///
/// 参考：PC端 desktop-app-vue/src/main/skill-tool-system/builtin-tools.js
/// PC端 desktop-app-vue/src/main/skill-tool-system/professional-tools.js
public enum BuiltinTools {

    // MARK: - 文档工具 (Document Tools)

    /// PDF文本读取工具
    private static let pdfReadTool = Tool(
        id: "tool.document.pdf.read",
        name: "PDF文本读取",
        description: "从PDF文件中读取文本内容",
        category: .document,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "PDF文件路径",
                required: true
            ),
            ToolParameter(
                name: "pageRange",
                type: .string,
                description: "页面范围（如: 1-5）",
                required: false
            )
        ],
        returnType: .object,
        returnDescription: "提取的文本内容",
        examples: [
            ToolExample(
                description: "读取PDF全部内容",
                input: ["filePath": "/path/to/document.pdf"],
                output: "{\"text\": \"PDF content...\", \"pageCount\": 10}"
            )
        ],
        tags: ["pdf", "read"]
    )

    private static let pdfReadExecutor: ToolExecutor = { input in
        guard let filePath = input.getString("filePath") else {
            return .failure(error: "文件路径不能为空")
        }

        let fileURL = URL(fileURLWithPath: filePath)

        guard FileManager.default.fileExists(atPath: filePath) else {
            return .failure(error: "文件不存在: \(filePath)")
        }

        guard let pdfDocument = PDFDocument(url: fileURL) else {
            return .failure(error: "无法打开PDF文件")
        }

        let pageCount = pdfDocument.pageCount

        // 解析页面范围
        var startPage = 0
        var endPage = pageCount - 1

        if let pageRange = input.getString("pageRange") {
            let parts = pageRange.components(separatedBy: "-")
            if parts.count == 2,
               let start = Int(parts[0].trimmingCharacters(in: .whitespaces)),
               let end = Int(parts[1].trimmingCharacters(in: .whitespaces)) {
                startPage = max(0, start - 1)  // 转换为0-indexed
                endPage = min(pageCount - 1, end - 1)
            }
        }

        // 提取文本
        var fullText = ""
        var pageTexts: [[String: Any]] = []

        for pageIndex in startPage...endPage {
            if let page = pdfDocument.page(at: pageIndex),
               let pageText = page.string {
                fullText += pageText + "\n\n"
                pageTexts.append([
                    "page": pageIndex + 1,
                    "text": pageText
                ])
            }
        }

        return .success(data: [
            "text": fullText,
            "pageCount": pageCount,
            "extractedPages": endPage - startPage + 1,
            "pages": pageTexts
        ])
    }

    /// Word文档创建工具
    private static let wordCreateTool = Tool(
        id: "tool.document.word.create",
        name: "Word文档创建",
        description: "创建新的Word文档（DOCX格式）",
        category: .document,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "保存路径",
                required: true
            ),
            ToolParameter(
                name: "content",
                type: .string,
                description: "文档内容",
                required: true
            ),
            ToolParameter(
                name: "title",
                type: .string,
                description: "文档标题",
                required: false
            )
        ],
        returnType: .boolean,
        returnDescription: "是否创建成功",
        tags: ["word", "create"]
    )

    private static let wordCreateExecutor: ToolExecutor = { input in
        guard let filePath = input.getString("filePath"),
              let content = input.getString("content") else {
            return .failure(error: "文件路径和内容不能为空")
        }

        let title = input.getString("title") ?? "Untitled"

        // 创建简单的DOCX格式（实际上是一个ZIP文件包含XML）
        // 这里简化为创建RTF格式，完整DOCX需要复杂的XML结构
        let rtfContent = """
        {\\rtf1\\ansi\\deff0
        {\\fonttbl{\\f0 Times New Roman;}}
        {\\info{\\title \(title)}}
        \\f0\\fs24
        \\b \(title) \\b0\\par
        \\par
        \(content.replacingOccurrences(of: "\n", with: "\\par\n"))
        }
        """

        do {
            let finalPath = filePath.hasSuffix(".rtf") ? filePath : filePath + ".rtf"
            try rtfContent.write(toFile: finalPath, atomically: true, encoding: .utf8)
            return .success(data: ["success": true, "path": finalPath, "format": "RTF"])
        } catch {
            return .failure(error: "创建文档失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 数据工具 (Data Tools)

    /// 数据统计工具
    private static let dataStatisticsTool = Tool(
        id: "tool.data.statistics",
        name: "数据统计",
        description: "计算数据的统计指标（均值、方差、最值等）",
        category: .data,
        parameters: [
            ToolParameter(
                name: "numbers",
                type: .array,
                description: "数字数组",
                required: true
            )
        ],
        returnType: .object,
        returnDescription: "统计结果",
        tags: ["statistics", "math"]
    )

    private static let dataStatisticsExecutor: ToolExecutor = { input in
        guard let numbers = input.getArray("numbers") as? [Double] else {
            return .failure(error: "无效的数字数组")
        }

        guard !numbers.isEmpty else {
            return .failure(error: "数组不能为空")
        }

        let count = numbers.count
        let sum = numbers.reduce(0, +)
        let mean = sum / Double(count)
        let variance = numbers.map { pow($0 - mean, 2) }.reduce(0, +) / Double(count)
        let stdDev = sqrt(variance)
        let sortedNumbers = numbers.sorted()
        let min = sortedNumbers.first!
        let max = sortedNumbers.last!

        // 计算中位数
        let median: Double
        if count % 2 == 0 {
            median = (sortedNumbers[count / 2 - 1] + sortedNumbers[count / 2]) / 2
        } else {
            median = sortedNumbers[count / 2]
        }

        // 计算众数
        var frequencyMap: [Double: Int] = [:]
        for num in numbers {
            frequencyMap[num, default: 0] += 1
        }
        let mode = frequencyMap.max(by: { $0.value < $1.value })?.key ?? mean

        // 计算四分位数
        let q1Index = count / 4
        let q3Index = (3 * count) / 4
        let q1 = sortedNumbers[q1Index]
        let q3 = sortedNumbers[q3Index]
        let iqr = q3 - q1

        let result: [String: Any] = [
            "count": count,
            "sum": sum,
            "mean": mean,
            "median": median,
            "mode": mode,
            "variance": variance,
            "stdDev": stdDev,
            "min": min,
            "max": max,
            "range": max - min,
            "q1": q1,
            "q3": q3,
            "iqr": iqr
        ]

        return .success(data: result)
    }

    /// CSV读取工具
    private static let csvReadTool = Tool(
        id: "tool.data.csv.read",
        name: "CSV读取",
        description: "读取CSV文件",
        category: .data,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "CSV文件路径",
                required: true
            ),
            ToolParameter(
                name: "hasHeader",
                type: .boolean,
                description: "是否包含表头",
                required: false,
                defaultValue: "true"
            ),
            ToolParameter(
                name: "delimiter",
                type: .string,
                description: "分隔符",
                required: false,
                defaultValue: ","
            )
        ],
        returnType: .array,
        returnDescription: "CSV数据数组",
        tags: ["csv", "data"]
    )

    private static let csvReadExecutor: ToolExecutor = { input in
        guard let filePath = input.getString("filePath") else {
            return .failure(error: "文件路径不能为空")
        }

        let hasHeader = input.getBool("hasHeader") ?? true
        let delimiter = input.getString("delimiter") ?? ","

        guard FileManager.default.fileExists(atPath: filePath) else {
            return .failure(error: "文件不存在: \(filePath)")
        }

        do {
            let content = try String(contentsOfFile: filePath, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }

            guard !lines.isEmpty else {
                return .success(data: [])
            }

            var headers: [String] = []
            var dataStartIndex = 0

            if hasHeader {
                headers = parseCSVLine(lines[0], delimiter: delimiter)
                dataStartIndex = 1
            } else {
                // 生成默认列名
                let firstRow = parseCSVLine(lines[0], delimiter: delimiter)
                headers = (0..<firstRow.count).map { "column\($0 + 1)" }
            }

            var rows: [[String: Any]] = []

            for i in dataStartIndex..<lines.count {
                let values = parseCSVLine(lines[i], delimiter: delimiter)
                var row: [String: Any] = [:]

                for (index, header) in headers.enumerated() {
                    if index < values.count {
                        // 尝试转换为数字
                        if let intValue = Int(values[index]) {
                            row[header] = intValue
                        } else if let doubleValue = Double(values[index]) {
                            row[header] = doubleValue
                        } else {
                            row[header] = values[index]
                        }
                    }
                }

                rows.append(row)
            }

            return .success(data: [
                "headers": headers,
                "rows": rows,
                "rowCount": rows.count,
                "columnCount": headers.count
            ])

        } catch {
            return .failure(error: "读取CSV失败: \(error.localizedDescription)")
        }
    }

    /// 解析CSV行（处理引号）
    private static func parseCSVLine(_ line: String, delimiter: String) -> [String] {
        var result: [String] = []
        var current = ""
        var inQuotes = false

        for char in line {
            if char == "\"" {
                inQuotes.toggle()
            } else if String(char) == delimiter && !inQuotes {
                result.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(char)
            }
        }

        result.append(current.trimmingCharacters(in: .whitespaces))
        return result
    }

    // MARK: - Web工具 (Web Tools)

    /// HTTP请求工具
    private static let httpRequestTool = Tool(
        id: "tool.web.http.request",
        name: "HTTP请求",
        description: "发送HTTP请求",
        category: .web,
        parameters: [
            ToolParameter(
                name: "url",
                type: .url,
                description: "请求URL",
                required: true
            ),
            ToolParameter(
                name: "method",
                type: .string,
                description: "HTTP方法",
                required: false,
                defaultValue: "GET",
                enum: ["GET", "POST", "PUT", "DELETE", "PATCH"]
            ),
            ToolParameter(
                name: "headers",
                type: .object,
                description: "请求头",
                required: false
            ),
            ToolParameter(
                name: "body",
                type: .string,
                description: "请求体",
                required: false
            )
        ],
        returnType: .object,
        returnDescription: "HTTP响应",
        tags: ["http", "request"]
    )

    private static let httpRequestExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        let method = input.getString("method") ?? "GET"

        var request = URLRequest(url: url)
        request.httpMethod = method

        // 设置请求头
        if let headers = input.getObject("headers") {
            for (key, value) in headers {
                if let stringValue = value as? String {
                    request.setValue(stringValue, forHTTPHeaderField: key)
                }
            }
        }

        // 设置请求体
        if let body = input.getString("body") {
            request.httpBody = body.data(using: .utf8)
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                return .failure(error: "无效的HTTP响应")
            }

            let responseString = String(data: data, encoding: .utf8) ?? ""

            // 尝试解析JSON
            var responseBody: Any = responseString
            if let jsonData = try? JSONSerialization.jsonObject(with: data, options: []) {
                responseBody = jsonData
            }

            let result: [String: Any] = [
                "statusCode": httpResponse.statusCode,
                "headers": Dictionary(uniqueKeysWithValues: httpResponse.allHeaderFields.map { (String(describing: $0.key), $0.value) }),
                "body": responseBody,
                "contentLength": data.count
            ]

            return .success(data: result)

        } catch {
            return .failure(error: error.localizedDescription)
        }
    }

    // MARK: - 知识管理工具 (Knowledge Tools)

    /// 知识搜索工具
    private static let knowledgeSearchTool = Tool(
        id: "tool.knowledge.search",
        name: "知识搜索",
        description: "在知识库中搜索内容",
        category: .knowledge,
        parameters: [
            ToolParameter(
                name: "query",
                type: .string,
                description: "搜索关键词",
                required: true,
                minLength: 1
            ),
            ToolParameter(
                name: "limit",
                type: .number,
                description: "返回结果数量",
                required: false,
                defaultValue: "10",
                minValue: 1,
                maxValue: 100
            ),
            ToolParameter(
                name: "strategy",
                type: .string,
                description: "检索策略",
                required: false,
                defaultValue: "hybrid",
                enum: ["keyword", "semantic", "hybrid"]
            )
        ],
        returnType: .array,
        returnDescription: "搜索结果列表",
        tags: ["knowledge", "search", "rag"]
    )

    private static let knowledgeSearchExecutor: ToolExecutor = { input in
        guard let query = input.getString("query"), !query.isEmpty else {
            return .failure(error: "搜索关键词不能为空")
        }

        let limit = input.getInt("limit") ?? 10
        let strategy = input.getString("strategy") ?? "hybrid"

        do {
            // 使用KnowledgeEngine执行搜索
            let result = try await KnowledgeEngine.shared.execute(
                task: "search",
                parameters: [
                    "query": query,
                    "limit": limit,
                    "strategy": strategy
                ]
            )

            if let resultDict = result as? [String: Any],
               let results = resultDict["results"] {
                return .success(data: results)
            }

            return .success(data: [])

        } catch {
            return .failure(error: "搜索失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 代码工具 (Code Tools)

    /// Git状态工具
    private static let gitStatusTool = Tool(
        id: "tool.git.status",
        name: "Git状态",
        description: "获取Git仓库状态",
        category: .code,
        parameters: [
            ToolParameter(
                name: "repoPath",
                type: .string,
                description: "仓库路径",
                required: true
            )
        ],
        returnType: .object,
        returnDescription: "Git状态信息",
        tags: ["git", "version"]
    )

    private static let gitStatusExecutor: ToolExecutor = { input in
        guard let repoPath = input.getString("repoPath") else {
            return .failure(error: "仓库路径不能为空")
        }

        // 检查.git目录是否存在
        let gitPath = (repoPath as NSString).appendingPathComponent(".git")
        guard FileManager.default.fileExists(atPath: gitPath) else {
            return .failure(error: "不是有效的Git仓库")
        }

        // 读取HEAD获取当前分支
        let headPath = (gitPath as NSString).appendingPathComponent("HEAD")
        var currentBranch = "unknown"

        if let headContent = try? String(contentsOfFile: headPath, encoding: .utf8) {
            if headContent.hasPrefix("ref: refs/heads/") {
                currentBranch = headContent
                    .replacingOccurrences(of: "ref: refs/heads/", with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        // 简单统计未跟踪文件（实际实现需要解析git index）
        return .success(data: [
            "branch": currentBranch,
            "repoPath": repoPath,
            "isGitRepo": true,
            "note": "详细状态需要使用git命令行工具"
        ])
    }

    // MARK: - 文件系统工具 (File System Tools)

    /// 文件读取工具
    private static let fileReadTool = Tool(
        id: "tool.file.read",
        name: "文件读取",
        description: "读取文件内容",
        category: .system,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "文件路径",
                required: true
            ),
            ToolParameter(
                name: "encoding",
                type: .string,
                description: "文件编码",
                required: false,
                defaultValue: "utf8",
                enum: ["utf8", "ascii", "utf16"]
            )
        ],
        returnType: .string,
        returnDescription: "文件内容",
        tags: ["file", "read"]
    )

    private static let fileReadExecutor: ToolExecutor = { input in
        guard let filePath = input.getString("filePath") else {
            return .failure(error: "文件路径不能为空")
        }

        let encodingName = input.getString("encoding") ?? "utf8"
        let encoding: String.Encoding

        switch encodingName.lowercased() {
        case "ascii":
            encoding = .ascii
        case "utf16":
            encoding = .utf16
        default:
            encoding = .utf8
        }

        let fileURL = URL(fileURLWithPath: filePath)

        do {
            let content = try String(contentsOf: fileURL, encoding: encoding)
            return .success(data: [
                "content": content,
                "size": content.count,
                "encoding": encodingName
            ])
        } catch {
            return .failure(error: "读取文件失败: \(error.localizedDescription)")
        }
    }

    /// 文件写入工具
    private static let fileWriteTool = Tool(
        id: "tool.file.write",
        name: "文件写入",
        description: "写入内容到文件",
        category: .system,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "文件路径",
                required: true
            ),
            ToolParameter(
                name: "content",
                type: .string,
                description: "文件内容",
                required: true
            ),
            ToolParameter(
                name: "append",
                type: .boolean,
                description: "是否追加",
                required: false,
                defaultValue: "false"
            )
        ],
        returnType: .boolean,
        returnDescription: "是否写入成功",
        tags: ["file", "write"]
    )

    private static let fileWriteExecutor: ToolExecutor = { input in
        guard let filePath = input.getString("filePath"),
              let content = input.getString("content") else {
            return .failure(error: "文件路径和内容不能为空")
        }

        let fileURL = URL(fileURLWithPath: filePath)
        let append = input.getBool("append") ?? false

        do {
            if append && FileManager.default.fileExists(atPath: filePath) {
                let fileHandle = try FileHandle(forWritingTo: fileURL)
                defer { try? fileHandle.close() }
                try fileHandle.seekToEnd()
                if let data = content.data(using: .utf8) {
                    try fileHandle.write(contentsOf: data)
                }
            } else {
                try content.write(to: fileURL, atomically: true, encoding: .utf8)
            }
            return .success(data: ["success": true, "path": filePath])
        } catch {
            return .failure(error: "写入文件失败: \(error.localizedDescription)")
        }
    }

    /// 文件列表工具
    private static let fileListTool = Tool(
        id: "tool.file.list",
        name: "文件列表",
        description: "列出目录中的文件",
        category: .system,
        parameters: [
            ToolParameter(
                name: "directoryPath",
                type: .string,
                description: "目录路径",
                required: true
            ),
            ToolParameter(
                name: "recursive",
                type: .boolean,
                description: "是否递归",
                required: false,
                defaultValue: "false"
            ),
            ToolParameter(
                name: "pattern",
                type: .string,
                description: "文件名模式（如: *.swift）",
                required: false
            )
        ],
        returnType: .array,
        returnDescription: "文件列表",
        tags: ["file", "list"]
    )

    private static let fileListExecutor: ToolExecutor = { input in
        guard let directoryPath = input.getString("directoryPath") else {
            return .failure(error: "目录路径不能为空")
        }

        let recursive = input.getBool("recursive") ?? false
        let pattern = input.getString("pattern")

        let fileManager = FileManager.default

        guard fileManager.fileExists(atPath: directoryPath) else {
            return .failure(error: "目录不存在: \(directoryPath)")
        }

        var files: [[String: Any]] = []

        do {
            let items: [String]

            if recursive {
                if let enumerator = fileManager.enumerator(atPath: directoryPath) {
                    items = enumerator.allObjects.compactMap { $0 as? String }
                } else {
                    items = []
                }
            } else {
                items = try fileManager.contentsOfDirectory(atPath: directoryPath)
            }

            for item in items {
                let fullPath = (directoryPath as NSString).appendingPathComponent(item)

                // 应用模式过滤
                if let pattern = pattern {
                    let regex = pattern
                        .replacingOccurrences(of: ".", with: "\\.")
                        .replacingOccurrences(of: "*", with: ".*")

                    if let regex = try? NSRegularExpression(pattern: regex, options: [.caseInsensitive]) {
                        let range = NSRange(item.startIndex..., in: item)
                        if regex.firstMatch(in: item, options: [], range: range) == nil {
                            continue
                        }
                    }
                }

                var isDirectory: ObjCBool = false
                fileManager.fileExists(atPath: fullPath, isDirectory: &isDirectory)

                var fileInfo: [String: Any] = [
                    "name": item,
                    "path": fullPath,
                    "isDirectory": isDirectory.boolValue
                ]

                if !isDirectory.boolValue,
                   let attributes = try? fileManager.attributesOfItem(atPath: fullPath) {
                    fileInfo["size"] = attributes[.size] as? Int ?? 0
                    fileInfo["modifiedAt"] = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                }

                files.append(fileInfo)
            }

            return .success(data: [
                "files": files,
                "count": files.count,
                "directoryPath": directoryPath
            ])

        } catch {
            return .failure(error: "列出文件失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 所有工具集合

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 文档工具
            (pdfReadTool, pdfReadExecutor),
            (wordCreateTool, wordCreateExecutor),

            // 数据工具
            (dataStatisticsTool, dataStatisticsExecutor),
            (csvReadTool, csvReadExecutor),

            // Web工具
            (httpRequestTool, httpRequestExecutor),

            // 知识工具
            (knowledgeSearchTool, knowledgeSearchExecutor),

            // 代码工具
            (gitStatusTool, gitStatusExecutor),

            // 文件系统工具
            (fileReadTool, fileReadExecutor),
            (fileWriteTool, fileWriteExecutor),
            (fileListTool, fileListExecutor),
        ]
    }

    // MARK: - 工具注册

    /// 注册所有内置工具到ToolManager
    public static func registerAll() {
        let toolManager = ToolManager.shared

        for (tool, executor) in all {
            toolManager.register(tool: tool, executor: executor)
        }

        Logger.shared.info("[BuiltinTools] 已注册 \(all.count) 个内置工具")
    }

    // MARK: - 工具统计

    public static var totalCount: Int {
        return all.count
    }

    public static var categoryCounts: [SkillCategory: Int] {
        var counts: [SkillCategory: Int] = [:]
        for (tool, _) in all {
            counts[tool.category, default: 0] += 1
        }
        return counts
    }
}
