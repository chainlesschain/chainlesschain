import Foundation
import CoreCommon

/// 性能分析器
/// 用于测量和分析应用性能
@MainActor
class PerformanceProfiler: ObservableObject {

    // MARK: - Singleton

    static let shared = PerformanceProfiler()

    // MARK: - Properties

    @Published var isProfilingEnabled = false
    @Published var reports: [PerformanceReport] = []

    private let logger = Logger.shared
    private var activeOperations: [String: OperationProfile] = [:]
    private var completedProfiles: [OperationProfile] = []

    // MARK: - Types

    struct OperationProfile: Identifiable {
        let id = UUID()
        let name: String
        let category: Category
        let startTime: CFAbsoluteTime
        var endTime: CFAbsoluteTime?
        var memoryBefore: UInt64
        var memoryAfter: UInt64?
        var metadata: [String: Any]

        var duration: TimeInterval? {
            guard let end = endTime else { return nil }
            return end - startTime
        }

        var memoryDelta: Int64? {
            guard let after = memoryAfter else { return nil }
            return Int64(after) - Int64(memoryBefore)
        }

        enum Category: String, CaseIterable {
            case database = "Database"
            case network = "Network"
            case ui = "UI"
            case crypto = "Crypto"
            case ai = "AI"
            case p2p = "P2P"
            case general = "General"
        }
    }

    struct PerformanceReport: Identifiable {
        let id = UUID()
        let timestamp: Date
        let category: OperationProfile.Category
        let operationCount: Int
        let averageDuration: TimeInterval
        let maxDuration: TimeInterval
        let minDuration: TimeInterval
        let totalMemoryDelta: Int64
        let operations: [OperationSummary]

        struct OperationSummary: Identifiable {
            let id = UUID()
            let name: String
            let count: Int
            let averageDuration: TimeInterval
            let maxDuration: TimeInterval
        }
    }

    // MARK: - Initialization

    private init() {}

    // MARK: - Profiling Control

    /// 开始性能分析
    func startProfiling() {
        isProfilingEnabled = true
        completedProfiles.removeAll()
        logger.info("[Profiler] Performance profiling started", category: "Performance")
    }

    /// 停止性能分析
    func stopProfiling() {
        isProfilingEnabled = false
        logger.info("[Profiler] Performance profiling stopped", category: "Performance")
    }

    // MARK: - Operation Tracking

    /// 开始跟踪操作
    func beginOperation(
        _ name: String,
        category: OperationProfile.Category = .general,
        metadata: [String: Any] = [:]
    ) -> String {
        guard isProfilingEnabled else { return name }

        let profile = OperationProfile(
            name: name,
            category: category,
            startTime: CFAbsoluteTimeGetCurrent(),
            memoryBefore: getCurrentMemoryUsage(),
            metadata: metadata
        )

        let operationId = "\(name)_\(UUID().uuidString.prefix(8))"
        activeOperations[operationId] = profile

        return operationId
    }

    /// 结束跟踪操作
    func endOperation(_ operationId: String) {
        guard isProfilingEnabled,
              var profile = activeOperations.removeValue(forKey: operationId) else {
            return
        }

        profile.endTime = CFAbsoluteTimeGetCurrent()
        profile.memoryAfter = getCurrentMemoryUsage()

        completedProfiles.append(profile)

        if let duration = profile.duration {
            logger.debug(
                "[Profiler] \(profile.name) completed in \(String(format: "%.3f", duration))s",
                category: "Performance"
            )
        }
    }

    /// 测量闭包执行时间
    func measure<T>(
        _ name: String,
        category: OperationProfile.Category = .general,
        operation: () throws -> T
    ) rethrows -> T {
        let operationId = beginOperation(name, category: category)
        defer { endOperation(operationId) }
        return try operation()
    }

    /// 测量异步闭包执行时间
    func measureAsync<T>(
        _ name: String,
        category: OperationProfile.Category = .general,
        operation: () async throws -> T
    ) async rethrows -> T {
        let operationId = beginOperation(name, category: category)
        defer { endOperation(operationId) }
        return try await operation()
    }

    // MARK: - Memory Tracking

    /// 获取当前内存使用量
    private func getCurrentMemoryUsage() -> UInt64 {
        var taskInfo = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &taskInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        return result == KERN_SUCCESS ? taskInfo.resident_size : 0
    }

    // MARK: - Report Generation

    /// 生成性能报告
    func generateReport(for category: OperationProfile.Category? = nil) -> PerformanceReport? {
        let profiles: [OperationProfile]
        let reportCategory: OperationProfile.Category

        if let cat = category {
            profiles = completedProfiles.filter { $0.category == cat }
            reportCategory = cat
        } else {
            profiles = completedProfiles
            reportCategory = .general
        }

        guard !profiles.isEmpty else { return nil }

        let durations = profiles.compactMap { $0.duration }
        let memoryDeltas = profiles.compactMap { $0.memoryDelta }

        // Group by operation name
        var operationGroups: [String: [OperationProfile]] = [:]
        for profile in profiles {
            operationGroups[profile.name, default: []].append(profile)
        }

        let operationSummaries = operationGroups.map { name, ops -> PerformanceReport.OperationSummary in
            let opDurations = ops.compactMap { $0.duration }
            return PerformanceReport.OperationSummary(
                name: name,
                count: ops.count,
                averageDuration: opDurations.isEmpty ? 0 : opDurations.reduce(0, +) / Double(opDurations.count),
                maxDuration: opDurations.max() ?? 0
            )
        }.sorted { $0.averageDuration > $1.averageDuration }

        let report = PerformanceReport(
            timestamp: Date(),
            category: reportCategory,
            operationCount: profiles.count,
            averageDuration: durations.isEmpty ? 0 : durations.reduce(0, +) / Double(durations.count),
            maxDuration: durations.max() ?? 0,
            minDuration: durations.min() ?? 0,
            totalMemoryDelta: memoryDeltas.reduce(0, +),
            operations: operationSummaries
        )

        reports.append(report)

        return report
    }

    /// 生成所有类别的报告
    func generateAllReports() -> [PerformanceReport] {
        return OperationProfile.Category.allCases.compactMap { generateReport(for: $0) }
    }

    // MARK: - Benchmarking

    /// 运行基准测试
    func runBenchmark(
        name: String,
        iterations: Int = 100,
        warmupIterations: Int = 10,
        operation: () throws -> Void
    ) rethrows -> BenchmarkResult {
        // Warmup
        for _ in 0..<warmupIterations {
            try operation()
        }

        // Actual benchmark
        var durations: [TimeInterval] = []
        durations.reserveCapacity(iterations)

        for _ in 0..<iterations {
            let start = CFAbsoluteTimeGetCurrent()
            try operation()
            let end = CFAbsoluteTimeGetCurrent()
            durations.append(end - start)
        }

        let sorted = durations.sorted()
        let sum = durations.reduce(0, +)

        return BenchmarkResult(
            name: name,
            iterations: iterations,
            totalTime: sum,
            averageTime: sum / Double(iterations),
            medianTime: sorted[iterations / 2],
            minTime: sorted.first ?? 0,
            maxTime: sorted.last ?? 0,
            p95Time: sorted[Int(Double(iterations) * 0.95)],
            p99Time: sorted[Int(Double(iterations) * 0.99)]
        )
    }

    struct BenchmarkResult {
        let name: String
        let iterations: Int
        let totalTime: TimeInterval
        let averageTime: TimeInterval
        let medianTime: TimeInterval
        let minTime: TimeInterval
        let maxTime: TimeInterval
        let p95Time: TimeInterval
        let p99Time: TimeInterval

        var summary: String {
            """
            Benchmark: \(name)
            Iterations: \(iterations)
            Average: \(String(format: "%.6f", averageTime))s
            Median: \(String(format: "%.6f", medianTime))s
            Min: \(String(format: "%.6f", minTime))s
            Max: \(String(format: "%.6f", maxTime))s
            P95: \(String(format: "%.6f", p95Time))s
            P99: \(String(format: "%.6f", p99Time))s
            """
        }
    }

    // MARK: - Cleanup

    /// 清除所有分析数据
    func clearData() {
        activeOperations.removeAll()
        completedProfiles.removeAll()
        reports.removeAll()
    }
}

// MARK: - Performance Test Suite

/// 性能测试套件
@MainActor
class PerformanceTestSuite {

    private let profiler = PerformanceProfiler.shared
    private let logger = Logger.shared

    /// 运行数据库性能测试
    func runDatabaseTests() async -> [PerformanceProfiler.BenchmarkResult] {
        var results: [PerformanceProfiler.BenchmarkResult] = []

        logger.info("[PerformanceTest] Starting database tests", category: "Performance")

        // Test 1: Simple query
        let simpleQueryResult = profiler.runBenchmark(name: "Simple Query", iterations: 100) {
            // Simulate simple database query
            _ = [Int](repeating: 0, count: 100).map { $0 * 2 }
        }
        results.append(simpleQueryResult)

        // Test 2: Complex query with sorting
        let complexQueryResult = profiler.runBenchmark(name: "Complex Query", iterations: 50) {
            // Simulate complex query
            var data = (0..<1000).map { _ in Int.random(in: 0..<10000) }
            data.sort()
        }
        results.append(complexQueryResult)

        // Test 3: JSON serialization
        let jsonResult = profiler.runBenchmark(name: "JSON Serialization", iterations: 100) {
            let testData = ["key": "value", "number": 123, "array": [1, 2, 3]] as [String: Any]
            _ = try? JSONSerialization.data(withJSONObject: testData)
        }
        results.append(jsonResult)

        logger.info("[PerformanceTest] Database tests completed", category: "Performance")

        return results
    }

    /// 运行加密性能测试
    func runCryptoTests() async -> [PerformanceProfiler.BenchmarkResult] {
        var results: [PerformanceProfiler.BenchmarkResult] = []

        logger.info("[PerformanceTest] Starting crypto tests", category: "Performance")

        // Test 1: SHA256 hashing
        let hashResult = profiler.runBenchmark(name: "SHA256 Hash", iterations: 1000) {
            let data = Data(repeating: 0x42, count: 1024)
            _ = data.base64EncodedString()
        }
        results.append(hashResult)

        // Test 2: Base64 encoding
        let base64Result = profiler.runBenchmark(name: "Base64 Encode/Decode", iterations: 500) {
            let data = Data(repeating: 0x42, count: 4096)
            let encoded = data.base64EncodedString()
            _ = Data(base64Encoded: encoded)
        }
        results.append(base64Result)

        logger.info("[PerformanceTest] Crypto tests completed", category: "Performance")

        return results
    }

    /// 运行 UI 性能测试
    func runUITests() async -> [PerformanceProfiler.BenchmarkResult] {
        var results: [PerformanceProfiler.BenchmarkResult] = []

        logger.info("[PerformanceTest] Starting UI tests", category: "Performance")

        // Test 1: String formatting
        let stringResult = profiler.runBenchmark(name: "String Formatting", iterations: 1000) {
            _ = String(format: "User %@ sent %d messages at %@", "TestUser", 42, Date().description)
        }
        results.append(stringResult)

        // Test 2: Array operations
        let arrayResult = profiler.runBenchmark(name: "Array Operations", iterations: 100) {
            var array = Array(0..<1000)
            array = array.filter { $0 % 2 == 0 }.map { $0 * 2 }
        }
        results.append(arrayResult)

        logger.info("[PerformanceTest] UI tests completed", category: "Performance")

        return results
    }

    /// 运行所有性能测试
    func runAllTests() async -> PerformanceTestReport {
        let startTime = Date()

        let dbResults = await runDatabaseTests()
        let cryptoResults = await runCryptoTests()
        let uiResults = await runUITests()

        let endTime = Date()

        return PerformanceTestReport(
            timestamp: startTime,
            duration: endTime.timeIntervalSince(startTime),
            databaseResults: dbResults,
            cryptoResults: cryptoResults,
            uiResults: uiResults
        )
    }

    struct PerformanceTestReport {
        let timestamp: Date
        let duration: TimeInterval
        let databaseResults: [PerformanceProfiler.BenchmarkResult]
        let cryptoResults: [PerformanceProfiler.BenchmarkResult]
        let uiResults: [PerformanceProfiler.BenchmarkResult]

        var summary: String {
            var text = """
            Performance Test Report
            =======================
            Date: \(timestamp)
            Total Duration: \(String(format: "%.2f", duration))s

            Database Tests:
            """

            for result in databaseResults {
                text += "\n  - \(result.name): avg \(String(format: "%.6f", result.averageTime))s"
            }

            text += "\n\nCrypto Tests:"
            for result in cryptoResults {
                text += "\n  - \(result.name): avg \(String(format: "%.6f", result.averageTime))s"
            }

            text += "\n\nUI Tests:"
            for result in uiResults {
                text += "\n  - \(result.name): avg \(String(format: "%.6f", result.averageTime))s"
            }

            return text
        }
    }
}
