//
//  DataAnalysisPlugin.swift
//  ChainlessChain
//
//  数据分析插件
//  提供数据统计分析和可视化功能
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Data Analysis Plugin

/// 数据分析插件处理器
public class DataAnalysisPlugin {
    public static let shared = DataAnalysisPlugin()

    private init() {
        Logger.shared.info("[DataAnalysisPlugin] 初始化完成")
    }

    // MARK: - Public Methods

    /// 分析CSV数据
    public func analyzeCsv(at path: String, options: AnalysisOptions = AnalysisOptions()) async throws -> AnalysisResult {
        Logger.shared.info("[DataAnalysisPlugin] 分析CSV: \(path)")

        // 读取CSV文件
        let url = URL(fileURLWithPath: path)
        let content = try String(contentsOf: url, encoding: .utf8)

        // 解析CSV
        let rows = parseCSV(content)

        guard !rows.isEmpty else {
            throw PluginError.executionFailed("CSV文件为空")
        }

        // 获取表头和数据
        let headers = rows[0]
        let data = Array(rows.dropFirst())

        // 执行分析
        var result = AnalysisResult()
        result.rowCount = data.count
        result.columnCount = headers.count
        result.headers = headers

        // 分析每列
        for (index, header) in headers.enumerated() {
            let columnData = data.compactMap { row -> String? in
                guard index < row.count else { return nil }
                return row[index]
            }

            let columnAnalysis = analyzeColumn(columnData, name: header)
            result.columnAnalysis[header] = columnAnalysis
        }

        // 计算相关性（如果需要）
        if options.calculateCorrelation {
            result.correlationMatrix = calculateCorrelationMatrix(data, headers: headers)
        }

        Logger.shared.info("[DataAnalysisPlugin] 分析完成: \(data.count) 行, \(headers.count) 列")

        return result
    }

    /// 生成报告
    public func generateReport(from result: AnalysisResult, format: ReportFormat = .markdown) async throws -> String {
        Logger.shared.info("[DataAnalysisPlugin] 生成报告")

        switch format {
        case .markdown:
            return generateMarkdownReport(result)
        case .html:
            return generateHTMLReport(result)
        case .json:
            return try generateJSONReport(result)
        }
    }

    /// 统计计算
    public func calculateStatistics(_ values: [Double]) -> Statistics {
        guard !values.isEmpty else {
            return Statistics()
        }

        let sorted = values.sorted()
        let count = Double(values.count)

        // 基本统计
        let sum = values.reduce(0, +)
        let mean = sum / count
        let min = sorted.first ?? 0
        let max = sorted.last ?? 0

        // 中位数
        let median: Double
        if sorted.count % 2 == 0 {
            median = (sorted[sorted.count / 2 - 1] + sorted[sorted.count / 2]) / 2
        } else {
            median = sorted[sorted.count / 2]
        }

        // 标准差
        let variance = values.map { pow($0 - mean, 2) }.reduce(0, +) / count
        let stdDev = sqrt(variance)

        // 四分位数
        let q1Index = Int(count * 0.25)
        let q3Index = Int(count * 0.75)
        let q1 = sorted[q1Index]
        let q3 = sorted[q3Index]

        return Statistics(
            count: values.count,
            sum: sum,
            mean: mean,
            median: median,
            min: min,
            max: max,
            stdDev: stdDev,
            variance: variance,
            q1: q1,
            q3: q3
        )
    }

    /// 数据聚合
    public func aggregate(data: [[String]], groupBy: Int, aggregateColumn: Int, operation: AggregateOperation) async throws -> [String: Double] {
        Logger.shared.info("[DataAnalysisPlugin] 数据聚合")

        var groups: [String: [Double]] = [:]

        for row in data {
            guard groupBy < row.count, aggregateColumn < row.count else { continue }

            let groupKey = row[groupBy]
            let value = Double(row[aggregateColumn]) ?? 0

            groups[groupKey, default: []].append(value)
        }

        var result: [String: Double] = [:]

        for (key, values) in groups {
            switch operation {
            case .sum:
                result[key] = values.reduce(0, +)
            case .avg:
                result[key] = values.reduce(0, +) / Double(values.count)
            case .count:
                result[key] = Double(values.count)
            case .min:
                result[key] = values.min() ?? 0
            case .max:
                result[key] = values.max() ?? 0
            }
        }

        return result
    }

    /// 数据过滤
    public func filter(data: [[String]], column: Int, condition: FilterCondition) async throws -> [[String]] {
        return data.filter { row in
            guard column < row.count else { return false }
            return evaluateCondition(row[column], condition: condition)
        }
    }

    /// 数据排序
    public func sort(data: [[String]], by column: Int, ascending: Bool = true) async throws -> [[String]] {
        return data.sorted { row1, row2 in
            guard column < row1.count, column < row2.count else {
                return false
            }

            // 尝试作为数字比较
            if let num1 = Double(row1[column]), let num2 = Double(row2[column]) {
                return ascending ? num1 < num2 : num1 > num2
            }

            // 作为字符串比较
            return ascending ? row1[column] < row2[column] : row1[column] > row2[column]
        }
    }

    // MARK: - Private Methods

    private func parseCSV(_ content: String) -> [[String]] {
        var rows: [[String]] = []
        var currentRow: [String] = []
        var currentField = ""
        var inQuotes = false

        for char in content {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                currentRow.append(currentField.trimmingCharacters(in: .whitespaces))
                currentField = ""
            } else if char == "\n" && !inQuotes {
                currentRow.append(currentField.trimmingCharacters(in: .whitespaces))
                if !currentRow.isEmpty && !currentRow.allSatisfy({ $0.isEmpty }) {
                    rows.append(currentRow)
                }
                currentRow = []
                currentField = ""
            } else if char != "\r" {
                currentField.append(char)
            }
        }

        // 处理最后一行
        if !currentField.isEmpty {
            currentRow.append(currentField.trimmingCharacters(in: .whitespaces))
        }
        if !currentRow.isEmpty && !currentRow.allSatisfy({ $0.isEmpty }) {
            rows.append(currentRow)
        }

        return rows
    }

    private func analyzeColumn(_ data: [String], name: String) -> ColumnAnalysis {
        var analysis = ColumnAnalysis(name: name)

        // 检测数据类型
        let numericValues = data.compactMap { Double($0) }
        let isNumeric = numericValues.count > data.count / 2

        if isNumeric {
            analysis.dataType = .numeric
            analysis.statistics = calculateStatistics(numericValues)
        } else {
            analysis.dataType = .categorical

            // 计算值频率
            var frequency: [String: Int] = [:]
            for value in data {
                frequency[value, default: 0] += 1
            }

            analysis.uniqueValues = frequency.count
            analysis.topValues = frequency.sorted { $0.value > $1.value }
                .prefix(10)
                .map { ($0.key, $0.value) }
        }

        // 计算缺失值
        analysis.missingCount = data.filter { $0.isEmpty }.count
        analysis.missingRate = Double(analysis.missingCount) / Double(data.count)

        return analysis
    }

    private func calculateCorrelationMatrix(data: [[String]], headers: [String]) -> [[Double]] {
        // 简化实现：只计算数值列的相关性
        var matrix: [[Double]] = Array(repeating: Array(repeating: 0.0, count: headers.count), count: headers.count)

        for i in 0..<headers.count {
            for j in 0..<headers.count {
                if i == j {
                    matrix[i][j] = 1.0
                } else if i < j {
                    let col1 = data.compactMap { $0.count > i ? Double($0[i]) : nil }
                    let col2 = data.compactMap { $0.count > j ? Double($0[j]) : nil }

                    if !col1.isEmpty && !col2.isEmpty {
                        let correlation = pearsonCorrelation(col1, col2)
                        matrix[i][j] = correlation
                        matrix[j][i] = correlation
                    }
                }
            }
        }

        return matrix
    }

    private func pearsonCorrelation(_ x: [Double], _ y: [Double]) -> Double {
        let n = min(x.count, y.count)
        guard n > 0 else { return 0 }

        let meanX = x.reduce(0, +) / Double(n)
        let meanY = y.reduce(0, +) / Double(n)

        var numerator: Double = 0
        var denomX: Double = 0
        var denomY: Double = 0

        for i in 0..<n {
            let dx = x[i] - meanX
            let dy = y[i] - meanY
            numerator += dx * dy
            denomX += dx * dx
            denomY += dy * dy
        }

        let denom = sqrt(denomX * denomY)
        return denom > 0 ? numerator / denom : 0
    }

    private func evaluateCondition(_ value: String, condition: FilterCondition) -> Bool {
        switch condition {
        case .equals(let target):
            return value == target
        case .notEquals(let target):
            return value != target
        case .contains(let substring):
            return value.contains(substring)
        case .greaterThan(let target):
            guard let numValue = Double(value), let numTarget = Double(target) else {
                return false
            }
            return numValue > numTarget
        case .lessThan(let target):
            guard let numValue = Double(value), let numTarget = Double(target) else {
                return false
            }
            return numValue < numTarget
        case .isEmpty:
            return value.isEmpty
        case .isNotEmpty:
            return !value.isEmpty
        }
    }

    private func generateMarkdownReport(_ result: AnalysisResult) -> String {
        var report = "# 数据分析报告\n\n"
        report += "## 概览\n\n"
        report += "- 行数: \(result.rowCount)\n"
        report += "- 列数: \(result.columnCount)\n\n"

        report += "## 列分析\n\n"

        for (header, analysis) in result.columnAnalysis {
            report += "### \(header)\n\n"
            report += "- 数据类型: \(analysis.dataType)\n"
            report += "- 缺失值: \(analysis.missingCount) (\(String(format: "%.1f%%", analysis.missingRate * 100)))\n"

            if let stats = analysis.statistics {
                report += "- 均值: \(String(format: "%.2f", stats.mean))\n"
                report += "- 中位数: \(String(format: "%.2f", stats.median))\n"
                report += "- 标准差: \(String(format: "%.2f", stats.stdDev))\n"
                report += "- 范围: \(String(format: "%.2f", stats.min)) - \(String(format: "%.2f", stats.max))\n"
            }

            report += "\n"
        }

        return report
    }

    private func generateHTMLReport(_ result: AnalysisResult) -> String {
        var html = "<html><head><title>数据分析报告</title></head><body>"
        html += "<h1>数据分析报告</h1>"
        html += "<p>行数: \(result.rowCount), 列数: \(result.columnCount)</p>"
        html += "</body></html>"
        return html
    }

    private func generateJSONReport(_ result: AnalysisResult) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted

        let summary = AnalysisSummary(
            rowCount: result.rowCount,
            columnCount: result.columnCount,
            headers: result.headers
        )

        let data = try encoder.encode(summary)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

// MARK: - Supporting Types

/// 分析结果
public struct AnalysisResult {
    public var rowCount: Int = 0
    public var columnCount: Int = 0
    public var headers: [String] = []
    public var columnAnalysis: [String: ColumnAnalysis] = [:]
    public var correlationMatrix: [[Double]]?
}

/// 列分析
public struct ColumnAnalysis {
    public var name: String
    public var dataType: DataType = .unknown
    public var statistics: Statistics?
    public var uniqueValues: Int = 0
    public var topValues: [(String, Int)] = []
    public var missingCount: Int = 0
    public var missingRate: Double = 0
}

/// 数据类型
public enum DataType: String, Codable {
    case numeric
    case categorical
    case datetime
    case unknown
}

/// 统计信息
public struct Statistics {
    public var count: Int = 0
    public var sum: Double = 0
    public var mean: Double = 0
    public var median: Double = 0
    public var min: Double = 0
    public var max: Double = 0
    public var stdDev: Double = 0
    public var variance: Double = 0
    public var q1: Double = 0
    public var q3: Double = 0
}

/// 分析选项
public struct AnalysisOptions {
    public var calculateCorrelation: Bool = false
    public var detectOutliers: Bool = false
    public var sampleSize: Int?

    public init(
        calculateCorrelation: Bool = false,
        detectOutliers: Bool = false,
        sampleSize: Int? = nil
    ) {
        self.calculateCorrelation = calculateCorrelation
        self.detectOutliers = detectOutliers
        self.sampleSize = sampleSize
    }
}

/// 报告格式
public enum ReportFormat {
    case markdown
    case html
    case json
}

/// 聚合操作
public enum AggregateOperation {
    case sum
    case avg
    case count
    case min
    case max
}

/// 过滤条件
public enum FilterCondition {
    case equals(String)
    case notEquals(String)
    case contains(String)
    case greaterThan(String)
    case lessThan(String)
    case isEmpty
    case isNotEmpty
}

/// 分析摘要（用于JSON序列化）
private struct AnalysisSummary: Codable {
    let rowCount: Int
    let columnCount: Int
    let headers: [String]
}
