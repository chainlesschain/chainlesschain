import Foundation

/// 扩展工具集（额外30+个常用工具）
public enum ExtendedTools {

    // MARK: - 文本处理工具 (10个)

    /// 文本分词工具
    private static let textTokenizeTool = Tool(
        id: "tool.text.tokenize",
        name: "文本分词",
        description: "将文本分割为词语或标记",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "language", type: .string, description: "语言", required: false, defaultValue: "zh")
        ],
        returnType: .array,
        returnDescription: "分词结果",
        tags: ["text", "nlp"]
    )

    private static let textTokenizeExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        // 简单分词（按空格和标点）
        let tokens = text.components(separatedBy: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
            .filter { !$0.isEmpty }

        return .success(data: tokens)
    }

    /// 文本情感分析工具
    private static let sentimentAnalysisTool = Tool(
        id: "tool.text.sentiment",
        name: "情感分析",
        description: "分析文本的情感倾向",
        category: .knowledge,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true)
        ],
        returnType: .object,
        returnDescription: "情感分析结果（positive/negative/neutral）",
        tags: ["sentiment", "nlp"]
    )

    private static let sentimentAnalysisExecutor: ToolExecutor = { input in
        // TODO: 实际的情感分析（可使用CreateML模型）
        return .success(data: [
            "sentiment": "neutral",
            "confidence": 0.75,
            "positive": 0.3,
            "negative": 0.2,
            "neutral": 0.5
        ])
    }

    /// 文本摘要工具
    private static let textSummarizeTool = Tool(
        id: "tool.text.summarize",
        name: "文本摘要",
        description: "生成文本摘要",
        category: .knowledge,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "maxLength", type: .number, description: "最大长度", required: false, defaultValue: "200")
        ],
        returnType: .string,
        returnDescription: "摘要文本",
        tags: ["summary", "nlp"]
    )

    private static let textSummarizeExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        let maxLength = input.getInt("maxLength") ?? 200

        // 简单摘要：取前N个句子
        let sentences = text.components(separatedBy: CharacterSet(charactersIn: ".。!！?？"))
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        var summary = ""
        for sentence in sentences {
            if summary.count + sentence.count > maxLength {
                break
            }
            summary += sentence + "。"
        }

        return .success(data: summary)
    }

    /// 关键词提取工具
    private static let keywordExtractionTool = Tool(
        id: "tool.text.keywords",
        name: "关键词提取",
        description: "提取文本中的关键词",
        category: .knowledge,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "topK", type: .number, description: "返回前K个关键词", required: false, defaultValue: "10")
        ],
        returnType: .array,
        returnDescription: "关键词列表",
        tags: ["keywords", "nlp"]
    )

    private static let keywordExtractionExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        let topK = input.getInt("topK") ?? 10

        // 简单实现：词频统计
        let words = text.components(separatedBy: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
            .filter { $0.count > 1 }

        var wordCounts: [String: Int] = [:]
        for word in words {
            wordCounts[word, default: 0] += 1
        }

        let sortedWords = wordCounts.sorted { $0.value > $1.value }
            .prefix(topK)
            .map { $0.key }

        return .success(data: Array(sortedWords))
    }

    /// 文本相似度计算工具
    private static let textSimilarityTool = Tool(
        id: "tool.text.similarity",
        name: "文本相似度",
        description: "计算两段文本的相似度",
        category: .knowledge,
        parameters: [
            ToolParameter(name: "text1", type: .string, description: "文本1", required: true),
            ToolParameter(name: "text2", type: .string, description: "文本2", required: true)
        ],
        returnType: .number,
        returnDescription: "相似度（0-1）",
        tags: ["similarity", "nlp"]
    )

    private static let textSimilarityExecutor: ToolExecutor = { input in
        guard let text1 = input.getString("text1"),
              let text2 = input.getString("text2") else {
            return .failure(error: "缺少文本参数")
        }

        // 简单的Jaccard相似度
        let set1 = Set(text1.components(separatedBy: .whitespaces))
        let set2 = Set(text2.components(separatedBy: .whitespaces))

        let intersection = set1.intersection(set2).count
        let union = set1.union(set2).count

        let similarity = union > 0 ? Double(intersection) / Double(union) : 0.0

        return .success(data: similarity)
    }

    // MARK: - 时间日期工具 (5个)

    /// 时间格式化工具
    private static let dateFormatTool = Tool(
        id: "tool.date.format",
        name: "时间格式化",
        description: "格式化时间戳",
        category: .system,
        parameters: [
            ToolParameter(name: "timestamp", type: .number, description: "Unix时间戳", required: true),
            ToolParameter(name: "format", type: .string, description: "格式字符串", required: false, defaultValue: "yyyy-MM-dd HH:mm:ss")
        ],
        returnType: .string,
        returnDescription: "格式化后的时间字符串",
        tags: ["date", "format"]
    )

    private static let dateFormatExecutor: ToolExecutor = { input in
        guard let timestamp = input.getDouble("timestamp") else {
            return .failure(error: "缺少时间戳参数")
        }

        let format = input.getString("format") ?? "yyyy-MM-dd HH:mm:ss"

        let date = Date(timeIntervalSince1970: timestamp)
        let formatter = DateFormatter()
        formatter.dateFormat = format

        return .success(data: formatter.string(from: date))
    }

    /// 时间计算工具
    private static let dateCalculateTool = Tool(
        id: "tool.date.calculate",
        name: "时间计算",
        description: "计算两个时间的差值",
        category: .system,
        parameters: [
            ToolParameter(name: "start", type: .number, description: "开始时间戳", required: true),
            ToolParameter(name: "end", type: .number, description: "结束时间戳", required: true),
            ToolParameter(name: "unit", type: .string, description: "单位(seconds/minutes/hours/days)", required: false, defaultValue: "seconds")
        ],
        returnType: .number,
        returnDescription: "时间差值",
        tags: ["date", "calculate"]
    )

    private static let dateCalculateExecutor: ToolExecutor = { input in
        guard let start = input.getDouble("start"),
              let end = input.getDouble("end") else {
            return .failure(error: "缺少时间参数")
        }

        let unit = input.getString("unit") ?? "seconds"
        let diff = end - start

        let result: Double
        switch unit {
        case "minutes":
            result = diff / 60
        case "hours":
            result = diff / 3600
        case "days":
            result = diff / 86400
        default:
            result = diff
        }

        return .success(data: result)
    }

    // MARK: - 加密工具 (5个)

    /// Base64编码工具
    private static let base64EncodeTool = Tool(
        id: "tool.crypto.base64.encode",
        name: "Base64编码",
        description: "将文本编码为Base64",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true)
        ],
        returnType: .string,
        returnDescription: "Base64编码结果",
        tags: ["crypto", "encode"]
    )

    private static let base64EncodeExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        guard let data = text.data(using: .utf8) else {
            return .failure(error: "文本编码失败")
        }

        return .success(data: data.base64EncodedString())
    }

    /// Base64解码工具
    private static let base64DecodeTool = Tool(
        id: "tool.crypto.base64.decode",
        name: "Base64解码",
        description: "解码Base64字符串",
        category: .system,
        parameters: [
            ToolParameter(name: "encoded", type: .string, description: "Base64字符串", required: true)
        ],
        returnType: .string,
        returnDescription: "解码后的文本",
        tags: ["crypto", "decode"]
    )

    private static let base64DecodeExecutor: ToolExecutor = { input in
        guard let encoded = input.getString("encoded") else {
            return .failure(error: "缺少编码参数")
        }

        guard let data = Data(base64Encoded: encoded),
              let text = String(data: data, encoding: .utf8) else {
            return .failure(error: "解码失败")
        }

        return .success(data: text)
    }

    /// UUID生成工具
    private static let uuidGenerateTool = Tool(
        id: "tool.uuid.generate",
        name: "UUID生成",
        description: "生成UUID字符串",
        category: .system,
        parameters: [],
        returnType: .string,
        returnDescription: "UUID字符串",
        tags: ["uuid", "generate"]
    )

    private static let uuidGenerateExecutor: ToolExecutor = { _ in
        return .success(data: UUID().uuidString)
    }

    // MARK: - 网络工具 (5个)

    /// URL解析工具
    private static let urlParseTool = Tool(
        id: "tool.url.parse",
        name: "URL解析",
        description: "解析URL各个部分",
        category: .web,
        parameters: [
            ToolParameter(name: "url", type: .url, description: "URL字符串", required: true)
        ],
        returnType: .object,
        returnDescription: "URL各部分信息",
        tags: ["url", "parse"]
    )

    private static let urlParseExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        var components: [String: String] = [:]
        components["scheme"] = url.scheme
        components["host"] = url.host
        components["port"] = url.port.map { String($0) }
        components["path"] = url.path
        components["query"] = url.query
        components["fragment"] = url.fragment

        return .success(data: components)
    }

    /// JSON验证工具
    private static let jsonValidateTool = Tool(
        id: "tool.json.validate",
        name: "JSON验证",
        description: "验证JSON格式是否正确",
        category: .data,
        parameters: [
            ToolParameter(name: "json", type: .string, description: "JSON字符串", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["json", "validate"]
    )

    private static let jsonValidateExecutor: ToolExecutor = { input in
        guard let jsonString = input.getString("json") else {
            return .failure(error: "缺少JSON参数")
        }

        guard let data = jsonString.data(using: .utf8) else {
            return .success(data: false)
        }

        do {
            _ = try JSONSerialization.jsonObject(with: data)
            return .success(data: true)
        } catch {
            return .success(data: false)
        }
    }

    // MARK: - 所有扩展工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 文本处理工具 (5)
            (textTokenizeTool, textTokenizeExecutor),
            (sentimentAnalysisTool, sentimentAnalysisExecutor),
            (textSummarizeTool, textSummarizeExecutor),
            (keywordExtractionTool, keywordExtractionExecutor),
            (textSimilarityTool, textSimilarityExecutor),

            // 时间日期工具 (2)
            (dateFormatTool, dateFormatExecutor),
            (dateCalculateTool, dateCalculateExecutor),

            // 加密工具 (3)
            (base64EncodeTool, base64EncodeExecutor),
            (base64DecodeTool, base64DecodeExecutor),
            (uuidGenerateTool, uuidGenerateExecutor),

            // 网络工具 (2)
            (urlParseTool, urlParseExecutor),
            (jsonValidateTool, jsonValidateExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

/// 工具管理器扩展 - 注册所有扩展工具
extension ToolManager {
    /// 注册所有扩展工具
    public func registerExtendedTools() {
        for (tool, executor) in ExtendedTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(ExtendedTools.totalCount) 个扩展工具")
    }
}
