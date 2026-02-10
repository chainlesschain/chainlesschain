import Foundation
import CoreCommon
import Accelerate

// MARK: - DataScienceTools
/// Data science tools for analysis, preprocessing, and visualization
/// Provides native Swift implementations for data manipulation
///
/// Features:
/// - Data preprocessing (normalization, outlier detection)
/// - Statistical analysis (descriptive, correlation)
/// - Simple ML models (linear regression, k-means)
/// - Chart data preparation
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Data Structures

/// Data frame representation
struct DataFrame {
    var columns: [String]
    var data: [[Double?]]  // Each inner array is a row

    var rowCount: Int { data.count }
    var columnCount: Int { columns.count }

    /// Get column values
    func column(_ name: String) -> [Double?]? {
        guard let index = columns.firstIndex(of: name) else { return nil }
        return data.map { $0[index] }
    }

    /// Get numeric columns
    func numericColumns() -> [String] {
        return columns.filter { colName in
            guard let col = column(colName) else { return false }
            return col.compactMap { $0 }.count > col.count / 2
        }
    }
}

/// Preprocessing operation
enum PreprocessingOperation: String, Codable {
    case removeDuplicates = "remove_duplicates"
    case handleMissing = "handle_missing"
    case detectOutliers = "detect_outliers"
    case normalize = "normalize"
    case standardize = "standardize"
    case encodeLabels = "encode_labels"
}

/// Missing value strategy
enum MissingValueStrategy: String, Codable {
    case drop = "drop"
    case mean = "mean"
    case median = "median"
    case mode = "mode"
    case forwardFill = "forward_fill"
    case backwardFill = "backward_fill"
    case zero = "zero"
}

/// Scaling method
enum ScalingMethod: String, Codable {
    case standard = "standard"    // Z-score normalization
    case minmax = "minmax"        // Min-max scaling to [0, 1]
    case robust = "robust"        // Robust scaling using median/IQR
}

/// Preprocessing result
struct PreprocessingResult: Codable {
    let success: Bool
    let rowsProcessed: Int
    let columnsProcessed: Int
    let summary: PreprocessingSummary
    let outputPath: String?

    struct PreprocessingSummary: Codable {
        var duplicatesRemoved: Int = 0
        var missingValuesHandled: Int = 0
        var outliersDetected: Int = 0
    }
}

/// Statistical result
struct StatisticalResult: Codable {
    let columnName: String
    let count: Int
    let mean: Double?
    let std: Double?
    let min: Double?
    let max: Double?
    let median: Double?
    let q1: Double?
    let q3: Double?
}

/// Correlation result
struct CorrelationResult {
    let column1: String
    let column2: String
    let correlation: Double
}

// MARK: - Data Science Tools Handler

/// Data science tools handler
@MainActor
class DataScienceToolsHandler: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared

    // MARK: - Singleton

    static let shared = DataScienceToolsHandler()

    // MARK: - Data Loading

    /// Load CSV data into DataFrame
    /// - Parameter filePath: CSV file path
    /// - Returns: DataFrame
    func loadCSV(filePath: String) async throws -> DataFrame {
        logger.info("[DataScience] Loading CSV: \(filePath)")

        let url = URL(fileURLWithPath: filePath)
        let content = try String(contentsOf: url, encoding: .utf8)
        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }

        guard !lines.isEmpty else {
            throw DataScienceError.emptyData
        }

        let headers = parseCSVLine(lines[0])
        var data: [[Double?]] = []

        for line in lines.dropFirst() {
            let values = parseCSVLine(line)
            let row = values.map { Double($0) }
            data.append(row)
        }

        return DataFrame(columns: headers, data: data)
    }

    /// Save DataFrame to CSV
    /// - Parameters:
    ///   - dataFrame: DataFrame to save
    ///   - filePath: Output file path
    func saveCSV(_ dataFrame: DataFrame, to filePath: String) async throws {
        var content = dataFrame.columns.joined(separator: ",") + "\n"

        for row in dataFrame.data {
            let rowStr = row.map { $0.map { String($0) } ?? "" }.joined(separator: ",")
            content += rowStr + "\n"
        }

        let url = URL(fileURLWithPath: filePath)
        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    // MARK: - Preprocessing

    /// Preprocess data
    /// - Parameters:
    ///   - dataFrame: Input DataFrame
    ///   - operations: Preprocessing operations
    ///   - options: Preprocessing options
    /// - Returns: Preprocessed DataFrame and summary
    func preprocess(
        dataFrame: DataFrame,
        operations: [PreprocessingOperation],
        options: PreprocessingOptions = PreprocessingOptions()
    ) async throws -> (DataFrame, PreprocessingResult) {
        logger.info("[DataScience] Preprocessing data with \(operations.count) operations")

        var df = dataFrame
        var summary = PreprocessingResult.PreprocessingSummary()

        for operation in operations {
            switch operation {
            case .removeDuplicates:
                let beforeCount = df.rowCount
                df = removeDuplicates(df)
                summary.duplicatesRemoved = beforeCount - df.rowCount

            case .handleMissing:
                let missingCount = countMissingValues(df)
                df = handleMissingValues(df, strategy: options.missingStrategy)
                summary.missingValuesHandled = missingCount

            case .detectOutliers:
                summary.outliersDetected = detectOutliers(df, method: options.outlierMethod)

            case .normalize, .standardize:
                df = scaleData(df, method: options.scalingMethod)

            case .encodeLabels:
                df = encodeLabels(df)
            }
        }

        let result = PreprocessingResult(
            success: true,
            rowsProcessed: df.rowCount,
            columnsProcessed: df.columnCount,
            summary: summary,
            outputPath: nil
        )

        return (df, result)
    }

    /// Remove duplicate rows
    private func removeDuplicates(_ df: DataFrame) -> DataFrame {
        var seen = Set<String>()
        var uniqueData: [[Double?]] = []

        for row in df.data {
            let key = row.map { $0.map { String($0) } ?? "nil" }.joined(separator: "|")
            if !seen.contains(key) {
                seen.insert(key)
                uniqueData.append(row)
            }
        }

        return DataFrame(columns: df.columns, data: uniqueData)
    }

    /// Count missing values
    private func countMissingValues(_ df: DataFrame) -> Int {
        return df.data.flatMap { $0 }.filter { $0 == nil }.count
    }

    /// Handle missing values
    private func handleMissingValues(_ df: DataFrame, strategy: MissingValueStrategy) -> DataFrame {
        var newData = df.data

        switch strategy {
        case .drop:
            newData = df.data.filter { row in !row.contains(where: { $0 == nil }) }

        case .mean:
            for colIdx in 0..<df.columnCount {
                let values = df.data.compactMap { $0[colIdx] }
                let mean = values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
                for rowIdx in 0..<newData.count {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = mean
                    }
                }
            }

        case .median:
            for colIdx in 0..<df.columnCount {
                let values = df.data.compactMap { $0[colIdx] }.sorted()
                let median = values.isEmpty ? 0 : values[values.count / 2]
                for rowIdx in 0..<newData.count {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = median
                    }
                }
            }

        case .mode:
            for colIdx in 0..<df.columnCount {
                let values = df.data.compactMap { $0[colIdx] }
                let mode = findMode(values)
                for rowIdx in 0..<newData.count {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = mode
                    }
                }
            }

        case .forwardFill:
            for rowIdx in 1..<newData.count {
                for colIdx in 0..<df.columnCount {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = newData[rowIdx - 1][colIdx]
                    }
                }
            }

        case .backwardFill:
            for rowIdx in stride(from: newData.count - 2, through: 0, by: -1) {
                for colIdx in 0..<df.columnCount {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = newData[rowIdx + 1][colIdx]
                    }
                }
            }

        case .zero:
            for rowIdx in 0..<newData.count {
                for colIdx in 0..<df.columnCount {
                    if newData[rowIdx][colIdx] == nil {
                        newData[rowIdx][colIdx] = 0
                    }
                }
            }
        }

        return DataFrame(columns: df.columns, data: newData)
    }

    /// Detect outliers using IQR method
    private func detectOutliers(_ df: DataFrame, method: OutlierMethod) -> Int {
        var outlierCount = 0

        for colIdx in 0..<df.columnCount {
            let values = df.data.compactMap { $0[colIdx] }.sorted()
            guard values.count >= 4 else { continue }

            let q1 = values[values.count / 4]
            let q3 = values[3 * values.count / 4]
            let iqr = q3 - q1
            let lowerBound = q1 - 1.5 * iqr
            let upperBound = q3 + 1.5 * iqr

            outlierCount += values.filter { $0 < lowerBound || $0 > upperBound }.count
        }

        return outlierCount
    }

    /// Scale data
    private func scaleData(_ df: DataFrame, method: ScalingMethod) -> DataFrame {
        var newData = df.data

        for colIdx in 0..<df.columnCount {
            let values = df.data.compactMap { $0[colIdx] }
            guard !values.isEmpty else { continue }

            let (scaledValues, _) = scaleColumn(values, method: method)

            var scaledIdx = 0
            for rowIdx in 0..<newData.count {
                if newData[rowIdx][colIdx] != nil {
                    newData[rowIdx][colIdx] = scaledValues[scaledIdx]
                    scaledIdx += 1
                }
            }
        }

        return DataFrame(columns: df.columns, data: newData)
    }

    /// Scale a single column
    private func scaleColumn(_ values: [Double], method: ScalingMethod) -> ([Double], ScaleParams) {
        switch method {
        case .standard:
            let mean = values.reduce(0, +) / Double(values.count)
            let variance = values.map { pow($0 - mean, 2) }.reduce(0, +) / Double(values.count)
            let std = sqrt(variance)
            let scaled = std == 0 ? values : values.map { ($0 - mean) / std }
            return (scaled, ScaleParams(method: method, param1: mean, param2: std))

        case .minmax:
            let minVal = values.min() ?? 0
            let maxVal = values.max() ?? 1
            let range = maxVal - minVal
            let scaled = range == 0 ? values : values.map { ($0 - minVal) / range }
            return (scaled, ScaleParams(method: method, param1: minVal, param2: maxVal))

        case .robust:
            let sorted = values.sorted()
            let median = sorted[sorted.count / 2]
            let q1 = sorted[sorted.count / 4]
            let q3 = sorted[3 * sorted.count / 4]
            let iqr = q3 - q1
            let scaled = iqr == 0 ? values : values.map { ($0 - median) / iqr }
            return (scaled, ScaleParams(method: method, param1: median, param2: iqr))
        }
    }

    /// Encode categorical labels as integers
    private func encodeLabels(_ df: DataFrame) -> DataFrame {
        // This is a simplified version - in practice would detect categorical columns
        return df
    }

    // MARK: - Statistical Analysis

    /// Calculate descriptive statistics
    /// - Parameter dataFrame: Input DataFrame
    /// - Returns: Statistics for each column
    func descriptiveStatistics(_ dataFrame: DataFrame) -> [StatisticalResult] {
        var results: [StatisticalResult] = []

        for colName in dataFrame.columns {
            guard let values = dataFrame.column(colName)?.compactMap({ $0 }) else { continue }

            let sorted = values.sorted()
            let count = values.count
            let mean = values.reduce(0, +) / Double(count)
            let variance = values.map { pow($0 - mean, 2) }.reduce(0, +) / Double(count)
            let std = sqrt(variance)

            results.append(StatisticalResult(
                columnName: colName,
                count: count,
                mean: mean,
                std: std,
                min: sorted.first,
                max: sorted.last,
                median: sorted[count / 2],
                q1: sorted[count / 4],
                q3: sorted[3 * count / 4]
            ))
        }

        return results
    }

    /// Calculate correlation matrix
    /// - Parameter dataFrame: Input DataFrame
    /// - Returns: Correlation results
    func correlationMatrix(_ dataFrame: DataFrame) -> [CorrelationResult] {
        var results: [CorrelationResult] = []
        let numericCols = dataFrame.numericColumns()

        for i in 0..<numericCols.count {
            for j in (i+1)..<numericCols.count {
                guard let col1 = dataFrame.column(numericCols[i])?.compactMap({ $0 }),
                      let col2 = dataFrame.column(numericCols[j])?.compactMap({ $0 }) else { continue }

                let correlation = pearsonCorrelation(col1, col2)
                results.append(CorrelationResult(
                    column1: numericCols[i],
                    column2: numericCols[j],
                    correlation: correlation
                ))
            }
        }

        return results
    }

    /// Calculate Pearson correlation
    private func pearsonCorrelation(_ x: [Double], _ y: [Double]) -> Double {
        guard x.count == y.count, !x.isEmpty else { return 0 }

        let n = Double(x.count)
        let meanX = x.reduce(0, +) / n
        let meanY = y.reduce(0, +) / n

        var numerator: Double = 0
        var denomX: Double = 0
        var denomY: Double = 0

        for i in 0..<x.count {
            let dx = x[i] - meanX
            let dy = y[i] - meanY
            numerator += dx * dy
            denomX += dx * dx
            denomY += dy * dy
        }

        let denom = sqrt(denomX) * sqrt(denomY)
        return denom == 0 ? 0 : numerator / denom
    }

    // MARK: - Simple ML Models

    /// Linear regression
    /// - Parameters:
    ///   - x: Independent variable
    ///   - y: Dependent variable
    /// - Returns: Slope and intercept
    func linearRegression(_ x: [Double], _ y: [Double]) -> (slope: Double, intercept: Double, r2: Double) {
        guard x.count == y.count, !x.isEmpty else { return (0, 0, 0) }

        let n = Double(x.count)
        let sumX = x.reduce(0, +)
        let sumY = y.reduce(0, +)
        let sumXY = zip(x, y).map { $0 * $1 }.reduce(0, +)
        let sumX2 = x.map { $0 * $0 }.reduce(0, +)

        let slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
        let intercept = (sumY - slope * sumX) / n

        // Calculate R-squared
        let meanY = sumY / n
        let ssTotal = y.map { pow($0 - meanY, 2) }.reduce(0, +)
        let ssResidual = zip(x, y).map { pow($1 - (slope * $0 + intercept), 2) }.reduce(0, +)
        let r2 = 1 - (ssResidual / ssTotal)

        return (slope, intercept, r2)
    }

    /// K-Means clustering (simplified)
    /// - Parameters:
    ///   - data: 2D data points
    ///   - k: Number of clusters
    ///   - maxIterations: Maximum iterations
    /// - Returns: Cluster assignments and centroids
    func kMeans(_ data: [[Double]], k: Int, maxIterations: Int = 100) -> (labels: [Int], centroids: [[Double]]) {
        guard !data.isEmpty, k > 0 else { return ([], []) }

        let n = data.count
        let dims = data[0].count

        // Initialize centroids randomly
        var centroids = Array(data.shuffled().prefix(k))
        var labels = [Int](repeating: 0, count: n)

        for _ in 0..<maxIterations {
            // Assign points to nearest centroid
            var newLabels = [Int](repeating: 0, count: n)
            for i in 0..<n {
                var minDist = Double.infinity
                for j in 0..<k {
                    let dist = euclideanDistance(data[i], centroids[j])
                    if dist < minDist {
                        minDist = dist
                        newLabels[i] = j
                    }
                }
            }

            // Check for convergence
            if newLabels == labels { break }
            labels = newLabels

            // Update centroids
            for j in 0..<k {
                let clusterPoints = data.enumerated().filter { labels[$0.offset] == j }.map { $0.element }
                if !clusterPoints.isEmpty {
                    centroids[j] = (0..<dims).map { d in
                        clusterPoints.map { $0[d] }.reduce(0, +) / Double(clusterPoints.count)
                    }
                }
            }
        }

        return (labels, centroids)
    }

    // MARK: - Chart Data Preparation

    /// Prepare histogram data
    /// - Parameters:
    ///   - values: Input values
    ///   - bins: Number of bins
    /// - Returns: Bin edges and counts
    func prepareHistogram(_ values: [Double], bins: Int = 10) -> (edges: [Double], counts: [Int]) {
        guard !values.isEmpty else { return ([], []) }

        let minVal = values.min()!
        let maxVal = values.max()!
        let binWidth = (maxVal - minVal) / Double(bins)

        var edges: [Double] = (0...bins).map { minVal + Double($0) * binWidth }
        var counts = [Int](repeating: 0, count: bins)

        for value in values {
            let binIndex = min(Int((value - minVal) / binWidth), bins - 1)
            counts[binIndex] += 1
        }

        return (edges, counts)
    }

    /// Prepare line chart data
    /// - Parameters:
    ///   - x: X values
    ///   - y: Y values
    /// - Returns: Chart data dictionary
    func prepareLineChart(x: [Double], y: [Double]) -> [String: [Double]] {
        return ["x": x, "y": y]
    }

    /// Prepare bar chart data
    /// - Parameters:
    ///   - categories: Category labels
    ///   - values: Values
    /// - Returns: Chart data
    func prepareBarChart(categories: [String], values: [Double]) -> [String: Any] {
        return ["categories": categories, "values": values]
    }

    // MARK: - Helper Methods

    private func parseCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        var currentField = ""
        var inQuotes = false

        for char in line {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                fields.append(currentField.trimmingCharacters(in: .whitespaces))
                currentField = ""
            } else {
                currentField.append(char)
            }
        }
        fields.append(currentField.trimmingCharacters(in: .whitespaces))

        return fields
    }

    private func findMode(_ values: [Double]) -> Double {
        var frequency: [Int: Int] = [:]
        for value in values {
            let key = Int(value * 1000)  // Round to 3 decimal places
            frequency[key, default: 0] += 1
        }
        let maxFreq = frequency.max { $0.value < $1.value }
        return Double(maxFreq?.key ?? 0) / 1000.0
    }

    private func euclideanDistance(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count == b.count else { return Double.infinity }
        return sqrt(zip(a, b).map { pow($0 - $1, 2) }.reduce(0, +))
    }
}

// MARK: - Supporting Types

/// Preprocessing options
struct PreprocessingOptions {
    var missingStrategy: MissingValueStrategy = .median
    var outlierMethod: OutlierMethod = .iqr
    var scalingMethod: ScalingMethod = .standard
}

/// Outlier detection method
enum OutlierMethod: String, Codable {
    case iqr = "iqr"
    case zscore = "zscore"
}

/// Scale parameters for inverse transform
struct ScaleParams {
    let method: ScalingMethod
    let param1: Double  // mean/min/median
    let param2: Double  // std/max/iqr
}

/// Data science errors
enum DataScienceError: LocalizedError {
    case emptyData
    case invalidColumn(String)
    case dimensionMismatch
    case computationFailed(String)

    var errorDescription: String? {
        switch self {
        case .emptyData:
            return "Data is empty"
        case .invalidColumn(let name):
            return "Invalid column: \(name)"
        case .dimensionMismatch:
            return "Dimension mismatch"
        case .computationFailed(let msg):
            return "Computation failed: \(msg)"
        }
    }
}

// MARK: - Tool Registration

extension DataScienceToolsHandler {
    /// Get all data science tools for registration
    func getTools() -> [Tool] {
        return [
            Tool(
                name: "data_preprocessor",
                description: "Preprocess data: remove duplicates, handle missing values, normalize",
                parameters: [
                    ToolParameter(name: "dataPath", type: .string, description: "CSV file path", required: true),
                    ToolParameter(name: "operations", type: .array, description: "Preprocessing operations", required: true),
                    ToolParameter(name: "outputPath", type: .string, description: "Output file path", required: false)
                ]
            ),
            Tool(
                name: "statistical_analyzer",
                description: "Calculate descriptive statistics and correlations",
                parameters: [
                    ToolParameter(name: "dataPath", type: .string, description: "CSV file path", required: true),
                    ToolParameter(name: "analyses", type: .array, description: "Analysis types: descriptive, correlation", required: true)
                ]
            ),
            Tool(
                name: "linear_regression",
                description: "Fit linear regression model",
                parameters: [
                    ToolParameter(name: "dataPath", type: .string, description: "CSV file path", required: true),
                    ToolParameter(name: "xColumn", type: .string, description: "Independent variable column", required: true),
                    ToolParameter(name: "yColumn", type: .string, description: "Dependent variable column", required: true)
                ]
            ),
            Tool(
                name: "kmeans_clustering",
                description: "K-Means clustering",
                parameters: [
                    ToolParameter(name: "dataPath", type: .string, description: "CSV file path", required: true),
                    ToolParameter(name: "k", type: .number, description: "Number of clusters", required: true),
                    ToolParameter(name: "columns", type: .array, description: "Columns to use", required: false)
                ]
            ),
            Tool(
                name: "histogram_data",
                description: "Prepare histogram data",
                parameters: [
                    ToolParameter(name: "dataPath", type: .string, description: "CSV file path", required: true),
                    ToolParameter(name: "column", type: .string, description: "Column name", required: true),
                    ToolParameter(name: "bins", type: .number, description: "Number of bins", required: false)
                ]
            )
        ]
    }
}
