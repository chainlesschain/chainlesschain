import Foundation
import CoreGraphics

/// 数据引擎
///
/// 负责处理数据分析、统计、可视化等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/data-engine.js
public class DataEngine: BaseAIEngine {

    public static let shared = DataEngine()

    // 支持的数据格式
    public enum DataFormat: String {
        case csv = "csv"
        case json = "json"
        case xml = "xml"
        case excel = "xlsx"
        case text = "txt"
    }

    // 图表类型
    public enum ChartType: String {
        case line = "line"
        case bar = "bar"
        case pie = "pie"
        case scatter = "scatter"
        case histogram = "histogram"
        case heatmap = "heatmap"
    }

    private init() {
        super.init(
            type: .data,
            name: "数据引擎",
            description: "处理数据分析、统计、可视化等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "statistics",
                name: "统计分析",
                description: "计算均值、方差、标准差等统计指标"
            ),
            AIEngineCapability(
                id: "visualization",
                name: "数据可视化",
                description: "生成各种类型的数据图表"
            ),
            AIEngineCapability(
                id: "csv_processing",
                name: "CSV处理",
                description: "读取、解析、处理CSV文件"
            ),
            AIEngineCapability(
                id: "json_processing",
                name: "JSON处理",
                description: "解析、查询、转换JSON数据"
            ),
            AIEngineCapability(
                id: "data_cleaning",
                name: "数据清洗",
                description: "处理缺失值、异常值、重复数据"
            ),
            AIEngineCapability(
                id: "data_aggregation",
                name: "数据聚合",
                description: "分组、聚合、透视数据"
            ),
            AIEngineCapability(
                id: "correlation_analysis",
                name: "相关性分析",
                description: "计算变量间的相关系数"
            ),
            AIEngineCapability(
                id: "trend_analysis",
                name: "趋势分析",
                description: "分析时间序列数据的趋势"
            ),
            AIEngineCapability(
                id: "ai_insights",
                name: "AI洞察",
                description: "使用LLM生成数据洞察和建议"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 注册数据处理相关的技能和工具
        Logger.shared.info("数据引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("数据引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "statistics":
            return try await calculateStatistics(parameters: parameters)

        case "csv_read":
            return try await readCSV(parameters: parameters)

        case "json_parse":
            return try await parseJSON(parameters: parameters)

        case "data_clean":
            return try await cleanData(parameters: parameters)

        case "aggregate":
            return try await aggregateData(parameters: parameters)

        case "correlation":
            return try await analyzeCorrelation(parameters: parameters)

        case "trend":
            return try await analyzeTrend(parameters: parameters)

        case "visualize":
            return try await visualizeData(parameters: parameters)

        case "ai_insights":
            return try await generateAIInsights(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 统计分析

    /// 计算统计指标
    private func calculateStatistics(parameters: [String: Any]) async throws -> [String: Any] {
        guard let numbers = parameters["numbers"] as? [Double] else {
            throw AIEngineError.invalidParameters("缺少numbers参数")
        }

        guard !numbers.isEmpty else {
            throw AIEngineError.executionFailed("数据不能为空")
        }

        // 基础统计
        let count = numbers.count
        let sum = numbers.reduce(0, +)
        let mean = sum / Double(count)

        // 方差和标准差
        let variance = numbers.map { pow($0 - mean, 2) }.reduce(0, +) / Double(count)
        let stdDev = sqrt(variance)

        // 最值
        let min = numbers.min() ?? 0
        let max = numbers.max() ?? 0

        // 中位数
        let sorted = numbers.sorted()
        let median: Double
        if count % 2 == 0 {
            median = (sorted[count/2 - 1] + sorted[count/2]) / 2
        } else {
            median = sorted[count/2]
        }

        // 四分位数
        let q1Index = count / 4
        let q3Index = (count * 3) / 4
        let q1 = sorted[q1Index]
        let q3 = sorted[q3Index]
        let iqr = q3 - q1

        return [
            "count": count,
            "sum": sum,
            "mean": mean,
            "median": median,
            "variance": variance,
            "stdDev": stdDev,
            "min": min,
            "max": max,
            "range": max - min,
            "q1": q1,
            "q3": q3,
            "iqr": iqr
        ]
    }

    // MARK: - CSV处理

    /// 读取CSV文件
    private func readCSV(parameters: [String: Any]) async throws -> [String: Any] {
        guard let filePath = parameters["filePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少filePath参数")
        }

        let hasHeader = parameters["hasHeader"] as? Bool ?? true
        let delimiter = parameters["delimiter"] as? String ?? ","

        let fileURL = URL(fileURLWithPath: filePath)

        guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else {
            throw AIEngineError.executionFailed("无法读取CSV文件")
        }

        let lines = content.components(separatedBy: .newlines)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        guard !lines.isEmpty else {
            throw AIEngineError.executionFailed("CSV文件为空")
        }

        var headers: [String] = []
        var dataStartIndex = 0

        if hasHeader {
            headers = parseCSVLine(lines[0], delimiter: delimiter)
            dataStartIndex = 1
        } else {
            // 自动生成列名
            let firstLine = parseCSVLine(lines[0], delimiter: delimiter)
            headers = (0..<firstLine.count).map { "column_\($0)" }
            dataStartIndex = 0
        }

        var rows: [[String: String]] = []
        for i in dataStartIndex..<lines.count {
            let values = parseCSVLine(lines[i], delimiter: delimiter)
            var row: [String: String] = [:]
            for (index, header) in headers.enumerated() {
                if index < values.count {
                    row[header] = values[index]
                }
            }
            rows.append(row)
        }

        return [
            "headers": headers,
            "rows": rows,
            "rowCount": rows.count,
            "columnCount": headers.count
        ]
    }

    /// 解析CSV行（处理引号和逗号）
    private func parseCSVLine(_ line: String, delimiter: String) -> [String] {
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

    // MARK: - JSON处理

    /// 解析JSON数据
    private func parseJSON(parameters: [String: Any]) async throws -> [String: Any] {
        var jsonData: Data?

        if let filePath = parameters["filePath"] as? String {
            let fileURL = URL(fileURLWithPath: filePath)
            jsonData = try? Data(contentsOf: fileURL)
        } else if let jsonString = parameters["json"] as? String {
            jsonData = jsonString.data(using: .utf8)
        }

        guard let data = jsonData else {
            throw AIEngineError.invalidParameters("缺少filePath或json参数")
        }

        guard let jsonObject = try? JSONSerialization.jsonObject(with: data, options: []) else {
            throw AIEngineError.executionFailed("JSON解析失败")
        }

        // 提取JSON路径（如果提供）
        if let path = parameters["path"] as? String {
            let value = extractJSONValue(from: jsonObject, path: path)
            return ["value": value ?? NSNull()]
        }

        return ["data": jsonObject]
    }

    /// 提取JSON路径的值
    private func extractJSONValue(from json: Any, path: String) -> Any? {
        let components = path.split(separator: ".").map(String.init)
        var current: Any = json

        for component in components {
            if let dict = current as? [String: Any] {
                guard let next = dict[component] else { return nil }
                current = next
            } else if let array = current as? [Any], let index = Int(component) {
                guard index < array.count else { return nil }
                current = array[index]
            } else {
                return nil
            }
        }

        return current
    }

    // MARK: - 数据清洗

    /// 清洗数据
    private func cleanData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? [[String: Any]] else {
            throw AIEngineError.invalidParameters("缺少data参数")
        }

        let removeDuplicates = parameters["removeDuplicates"] as? Bool ?? true
        let fillMissing = parameters["fillMissing"] as? String ?? "none" // none, mean, median, zero

        var cleanedData = data

        // 移除重复
        if removeDuplicates {
            cleanedData = Array(NSOrderedSet(array: cleanedData)) as? [[String: Any]] ?? cleanedData
        }

        // 处理缺失值
        if fillMissing != "none" {
            cleanedData = fillMissingValues(data: cleanedData, strategy: fillMissing)
        }

        return [
            "cleanedData": cleanedData,
            "originalCount": data.count,
            "cleanedCount": cleanedData.count,
            "removedCount": data.count - cleanedData.count
        ]
    }

    /// 填充缺失值
    private func fillMissingValues(data: [[String: Any]], strategy: String) -> [[String: Any]] {
        // 简化实现：这里只处理数值类型
        // 实际应用中需要更复杂的逻辑
        return data
    }

    // MARK: - 数据聚合

    /// 聚合数据
    private func aggregateData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? [[String: Any]],
              let groupBy = parameters["groupBy"] as? String else {
            throw AIEngineError.invalidParameters("缺少data或groupBy参数")
        }

        let aggregateFunc = parameters["function"] as? String ?? "count" // count, sum, avg, min, max
        let targetColumn = parameters["column"] as? String

        var groups: [String: [[String: Any]]] = [:]

        // 分组
        for row in data {
            if let groupValue = row[groupBy] as? String {
                groups[groupValue, default: []].append(row)
            }
        }

        // 聚合
        var results: [[String: Any]] = []
        for (groupKey, groupData) in groups {
            var result: [String: Any] = [groupBy: groupKey]

            switch aggregateFunc {
            case "count":
                result["count"] = groupData.count

            case "sum", "avg", "min", "max":
                if let column = targetColumn {
                    let numbers = groupData.compactMap { $0[column] as? Double }
                    if !numbers.isEmpty {
                        switch aggregateFunc {
                        case "sum":
                            result[column] = numbers.reduce(0, +)
                        case "avg":
                            result[column] = numbers.reduce(0, +) / Double(numbers.count)
                        case "min":
                            result[column] = numbers.min()
                        case "max":
                            result[column] = numbers.max()
                        default:
                            break
                        }
                    }
                }

            default:
                break
            }

            results.append(result)
        }

        return [
            "aggregatedData": results,
            "groupCount": groups.count
        ]
    }

    // MARK: - 相关性分析

    /// 计算相关系数
    private func analyzeCorrelation(parameters: [String: Any]) async throws -> [String: Any] {
        guard let xValues = parameters["x"] as? [Double],
              let yValues = parameters["y"] as? [Double] else {
            throw AIEngineError.invalidParameters("缺少x或y参数")
        }

        guard xValues.count == yValues.count, !xValues.isEmpty else {
            throw AIEngineError.executionFailed("数据长度不匹配或为空")
        }

        // 计算Pearson相关系数
        let n = Double(xValues.count)
        let sumX = xValues.reduce(0, +)
        let sumY = yValues.reduce(0, +)
        let sumXY = zip(xValues, yValues).map(*).reduce(0, +)
        let sumX2 = xValues.map { $0 * $0 }.reduce(0, +)
        let sumY2 = yValues.map { $0 * $0 }.reduce(0, +)

        let numerator = n * sumXY - sumX * sumY
        let denominator = sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

        let correlation = denominator != 0 ? numerator / denominator : 0

        // 相关性强度
        let strength: String
        let absCorr = abs(correlation)
        if absCorr >= 0.7 {
            strength = "strong"
        } else if absCorr >= 0.4 {
            strength = "moderate"
        } else {
            strength = "weak"
        }

        return [
            "correlation": correlation,
            "strength": strength,
            "direction": correlation > 0 ? "positive" : "negative",
            "sampleSize": xValues.count
        ]
    }

    // MARK: - 趋势分析

    /// 分析时间序列趋势
    private func analyzeTrend(parameters: [String: Any]) async throws -> [String: Any] {
        guard let values = parameters["values"] as? [Double] else {
            throw AIEngineError.invalidParameters("缺少values参数")
        }

        guard values.count >= 2 else {
            throw AIEngineError.executionFailed("数据点不足")
        }

        // 简单线性回归
        let n = Double(values.count)
        let xValues = Array(0..<values.count).map { Double($0) }
        let yValues = values

        let sumX = xValues.reduce(0, +)
        let sumY = yValues.reduce(0, +)
        let sumXY = zip(xValues, yValues).map(*).reduce(0, +)
        let sumX2 = xValues.map { $0 * $0 }.reduce(0, +)

        let slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
        let intercept = (sumY - slope * sumX) / n

        // 趋势方向
        let trend: String
        if abs(slope) < 0.01 {
            trend = "flat"
        } else if slope > 0 {
            trend = "increasing"
        } else {
            trend = "decreasing"
        }

        // 计算R²（拟合优度）
        let meanY = sumY / n
        let ssTotal = yValues.map { pow($0 - meanY, 2) }.reduce(0, +)
        let ssResidual = zip(xValues, yValues).map { x, y in
            let predicted = slope * x + intercept
            return pow(y - predicted, 2)
        }.reduce(0, +)
        let rSquared = 1 - (ssResidual / ssTotal)

        return [
            "trend": trend,
            "slope": slope,
            "intercept": intercept,
            "rSquared": rSquared,
            "prediction": slope * n + intercept // 下一个点的预测值
        ]
    }

    // MARK: - 数据可视化

    /// 生成数据可视化
    private func visualizeData(parameters: [String: Any]) async throws -> [String: Any] {
        guard let chartType = parameters["chartType"] as? String,
              let data = parameters["data"] as? [Double] else {
            throw AIEngineError.invalidParameters("缺少chartType或data参数")
        }

        let width = parameters["width"] as? Int ?? 800
        let height = parameters["height"] as? Int ?? 600

        // 这里返回图表配置，实际渲染由前端完成
        let chartConfig: [String: Any] = [
            "type": chartType,
            "data": data,
            "width": width,
            "height": height,
            "options": parameters["options"] ?? [:]
        ]

        return [
            "chartConfig": chartConfig,
            "dataPoints": data.count
        ]
    }

    // MARK: - AI增强功能

    /// 使用LLM生成数据洞察
    private func generateAIInsights(parameters: [String: Any]) async throws -> [String: Any] {
        guard let data = parameters["data"] as? [[String: Any]] else {
            throw AIEngineError.invalidParameters("缺少data参数")
        }

        // 将数据转换为文本描述
        let dataDescription = describeData(data)

        // 计算基础统计
        let stats = try await calculateBasicStats(data: data)

        // 构建提示词
        let prompt = """
        请分析以下数据并提供洞察：

        数据概览：
        \(dataDescription)

        统计信息：
        \(stats)

        请提供：
        1. 主要发现和趋势
        2. 异常值或特殊模式
        3. 数据质量评估
        4. 可操作的建议
        """

        let insights = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个专业的数据分析师，擅长发现数据中的模式和洞察。"
        )

        return [
            "insights": insights,
            "dataDescription": dataDescription,
            "statistics": stats
        ]
    }

    // MARK: - 辅助方法

    /// 描述数据结构
    private func describeData(_ data: [[String: Any]]) -> String {
        guard !data.isEmpty else { return "空数据集" }

        let rowCount = data.count
        let columns = Array(data[0].keys)
        let columnCount = columns.count

        return """
        - 行数: \(rowCount)
        - 列数: \(columnCount)
        - 列名: \(columns.joined(separator: ", "))
        """
    }

    /// 计算基础统计信息
    private func calculateBasicStats(data: [[String: Any]]) async throws -> [String: Any] {
        var stats: [String: Any] = [:]

        guard let firstRow = data.first else { return stats }

        for (key, _) in firstRow {
            let numbers = data.compactMap { $0[key] as? Double }
            if !numbers.isEmpty {
                let mean = numbers.reduce(0, +) / Double(numbers.count)
                let min = numbers.min() ?? 0
                let max = numbers.max() ?? 0
                stats[key] = [
                    "mean": mean,
                    "min": min,
                    "max": max,
                    "count": numbers.count
                ]
            }
        }

        return stats
    }
}
