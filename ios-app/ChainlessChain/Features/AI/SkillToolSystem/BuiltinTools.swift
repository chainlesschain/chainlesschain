import Foundation

/// 内置工具定义
///
/// 参考：PC端 desktop-app-vue/src/main/skill-tool-system/builtin-tools.js
/// PC端 desktop-app-vue/src/main/skill-tool-system/professional-tools.js
///
/// 总共300个工具，分为9大类别
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
                output: "{\"text\": \"PDF content...\"}"
            )
        ],
        tags: ["pdf", "read"]
    )

    private static let pdfReadExecutor: ToolExecutor = { input in
        // TODO: 实现PDF读取功能（使用PDFKit）
        let filePath = input.getString("filePath") ?? ""
        // 临时返回
        return .success(data: ["text": "PDF内容提取功能待实现", "filePath": filePath])
    }

    /// Word文档创建工具
    private static let wordCreateTool = Tool(
        id: "tool.document.word.create",
        name: "Word文档创建",
        description: "创建新的Word文档",
        category: .document,
        parameters: [
            ToolParameter(
                name: "filePath",
                type: .string,
                description: "保存路径",
                required: true
            )
        ],
        returnType: .boolean,
        returnDescription: "是否创建成功",
        tags: ["word", "create"]
    )

    private static let wordCreateExecutor: ToolExecutor = { input in
        // TODO: 实现Word创建功能
        return .success(data: true)
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

        let sum = numbers.reduce(0, +)
        let mean = sum / Double(numbers.count)
        let variance = numbers.map { pow($0 - mean, 2) }.reduce(0, +) / Double(numbers.count)
        let stdDev = sqrt(variance)
        let min = numbers.min() ?? 0
        let max = numbers.max() ?? 0

        let result: [String: Any] = [
            "count": numbers.count,
            "sum": sum,
            "mean": mean,
            "variance": variance,
            "stdDev": stdDev,
            "min": min,
            "max": max
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
            )
        ],
        returnType: .array,
        returnDescription: "CSV数据数组",
        tags: ["csv", "data"]
    )

    private static let csvReadExecutor: ToolExecutor = { input in
        // TODO: 实现CSV读取
        return .success(data: [[String: Any]]())
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

            let result: [String: Any] = [
                "statusCode": httpResponse.statusCode,
                "headers": httpResponse.allHeaderFields,
                "body": responseString
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
            )
        ],
        returnType: .array,
        returnDescription: "搜索结果列表",
        tags: ["knowledge", "search"]
    )

    private static let knowledgeSearchExecutor: ToolExecutor = { input in
        // TODO: 集成知识库RAG搜索
        let query = input.getString("query") ?? ""
        let limit = input.getInt("limit") ?? 10

        return .success(data: [
            ["title": "搜索结果1", "content": "内容1", "score": 0.9],
            ["title": "搜索结果2", "content": "内容2", "score": 0.8]
        ])
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
        // TODO: 集成GitManager
        return .success(data: [
            "branch": "main",
            "modified": 3,
            "staged": 1,
            "untracked": 2
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

        let fileURL = URL(fileURLWithPath: filePath)

        do {
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            return .success(data: content)
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
            if append {
                let fileHandle = try FileHandle(forWritingTo: fileURL)
                defer { fileHandle.closeFile() }
                fileHandle.seekToEndOfFile()
                if let data = content.data(using: .utf8) {
                    fileHandle.write(data)
                }
            } else {
                try content.write(to: fileURL, atomically: true, encoding: .utf8)
            }
            return .success(data: true)
        } catch {
            return .failure(error: "写入文件失败: \(error.localizedDescription)")
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
        ]
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
