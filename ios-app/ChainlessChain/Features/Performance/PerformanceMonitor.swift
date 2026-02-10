import Foundation
import UIKit
import Combine
import QuartzCore
import CoreCommon

// MARK: - Performance Metrics

/// 性能指标
public struct PerformanceMetrics {
    /// CPU使用率 (0-100)
    public var cpuUsage: Double = 0

    /// 内存使用（MB）
    public var memoryUsageMB: Double = 0

    /// 磁盘使用（MB）
    public var diskUsageMB: Double = 0

    /// 磁盘可用空间（MB）
    public var diskFreeMB: Double = 0

    /// 帧率
    public var fps: Double = 0

    /// 网络发送字节
    public var networkBytesSent: Int64 = 0

    /// 网络接收字节
    public var networkBytesReceived: Int64 = 0

    /// 电池电量 (0-100)
    public var batteryLevel: Double = 0

    /// 是否在充电
    public var isCharging: Bool = false

    /// 热状态
    public var thermalState: ProcessInfo.ThermalState = .nominal

    /// 采集时间
    public var timestamp: Date = Date()
}

// MARK: - Operation Trace

/// 操作追踪
public struct OperationTrace: Identifiable {
    public let id: String
    public let name: String
    public let category: String
    public let startTime: Date
    public var endTime: Date?
    public var metadata: [String: Any]

    public var duration: TimeInterval? {
        guard let endTime = endTime else { return nil }
        return endTime.timeIntervalSince(startTime)
    }

    public var durationMs: Double? {
        duration.map { $0 * 1000 }
    }

    public var isRunning: Bool {
        endTime == nil
    }

    public init(
        id: String = UUID().uuidString,
        name: String,
        category: String,
        startTime: Date = Date(),
        metadata: [String: Any] = [:]
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.startTime = startTime
        self.metadata = metadata
    }
}

// MARK: - Performance Report

/// 性能报告
public struct PerformanceReport {
    public let generatedAt: Date
    public let duration: TimeInterval
    public let metrics: [PerformanceMetrics]
    public let slowOperations: [OperationTrace]
    public let summary: PerformanceSummary

    public struct PerformanceSummary {
        public var avgCpuUsage: Double
        public var maxCpuUsage: Double
        public var avgMemoryMB: Double
        public var maxMemoryMB: Double
        public var avgFps: Double
        public var minFps: Double
        public var slowOperationCount: Int
        public var totalOperationCount: Int
    }
}

// MARK: - FPS Counter

/// 帧率计数器
public class FPSCounter {

    private var displayLink: CADisplayLink?
    private var lastTimestamp: CFTimeInterval = 0
    private var frameCount: Int = 0
    private var fps: Double = 0

    public var currentFPS: Double { fps }

    private var onUpdate: ((Double) -> Void)?

    public init() {}

    /// 开始计数
    public func start(onUpdate: ((Double) -> Void)? = nil) {
        self.onUpdate = onUpdate

        displayLink = CADisplayLink(target: self, selector: #selector(tick))
        displayLink?.add(to: .main, forMode: .common)
    }

    /// 停止计数
    public func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tick(link: CADisplayLink) {
        if lastTimestamp == 0 {
            lastTimestamp = link.timestamp
            return
        }

        frameCount += 1

        let elapsed = link.timestamp - lastTimestamp
        if elapsed >= 1.0 {
            fps = Double(frameCount) / elapsed
            frameCount = 0
            lastTimestamp = link.timestamp

            onUpdate?(fps)
        }
    }

    deinit {
        stop()
    }
}

// MARK: - Performance Monitor

/// 性能监控器
@MainActor
public class PerformanceMonitor: ObservableObject {

    // MARK: - Singleton

    public static let shared = PerformanceMonitor()

    // MARK: - Properties

    @Published public private(set) var currentMetrics = PerformanceMetrics()
    @Published public private(set) var isMonitoring = false

    /// 历史指标
    private var metricsHistory: [PerformanceMetrics] = []
    private let maxHistoryCount = 1000

    /// 操作追踪
    private var activeTraces: [String: OperationTrace] = [:]
    private var completedTraces: [OperationTrace] = []
    private let maxTracesCount = 500

    /// 慢操作阈值（毫秒）
    public var slowOperationThresholdMs: Double = 100

    /// FPS计数器
    private let fpsCounter = FPSCounter()

    /// 监控定时器
    private var monitorTimer: Timer?

    /// 更新间隔
    public var updateInterval: TimeInterval = 1.0

    /// 事件发布
    public let metricsUpdated = PassthroughSubject<PerformanceMetrics, Never>()
    public let slowOperationDetected = PassthroughSubject<OperationTrace, Never>()

    // MARK: - Initialization

    private init() {
        setupBatteryMonitoring()
        Logger.shared.info("[PerformanceMonitor] 已初始化")
    }

    // MARK: - Monitoring Control

    /// 开始监控
    public func startMonitoring() {
        guard !isMonitoring else { return }

        isMonitoring = true

        // 启动FPS计数
        fpsCounter.start { [weak self] fps in
            Task { @MainActor in
                self?.currentMetrics.fps = fps
            }
        }

        // 启动定时采集
        monitorTimer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.collectMetrics()
            }
        }

        Logger.shared.info("[PerformanceMonitor] 开始监控")
    }

    /// 停止监控
    public func stopMonitoring() {
        isMonitoring = false

        fpsCounter.stop()
        monitorTimer?.invalidate()
        monitorTimer = nil

        Logger.shared.info("[PerformanceMonitor] 停止监控")
    }

    // MARK: - Metrics Collection

    /// 收集指标
    private func collectMetrics() {
        var metrics = PerformanceMetrics()
        metrics.timestamp = Date()

        // CPU使用率
        metrics.cpuUsage = getCPUUsage()

        // 内存使用
        metrics.memoryUsageMB = Double(MemoryManager.currentMemoryUsage()) / (1024 * 1024)

        // 磁盘使用
        let diskInfo = getDiskInfo()
        metrics.diskUsageMB = diskInfo.used
        metrics.diskFreeMB = diskInfo.free

        // FPS
        metrics.fps = fpsCounter.currentFPS

        // 电池
        metrics.batteryLevel = Double(UIDevice.current.batteryLevel) * 100
        metrics.isCharging = UIDevice.current.batteryState == .charging

        // 热状态
        metrics.thermalState = ProcessInfo.processInfo.thermalState

        currentMetrics = metrics
        metricsUpdated.send(metrics)

        // 保存历史
        metricsHistory.append(metrics)
        if metricsHistory.count > maxHistoryCount {
            metricsHistory.removeFirst(metricsHistory.count - maxHistoryCount)
        }
    }

    /// 获取CPU使用率
    private func getCPUUsage() -> Double {
        var totalUsageOfCPU: Double = 0.0
        var threadsList: thread_act_array_t?
        var threadsCount = mach_msg_type_number_t(0)

        let threadsResult = withUnsafeMutablePointer(to: &threadsList) {
            $0.withMemoryRebound(to: thread_act_array_t?.self, capacity: 1) {
                task_threads(mach_task_self_, $0, &threadsCount)
            }
        }

        if threadsResult == KERN_SUCCESS, let threads = threadsList {
            for index in 0..<threadsCount {
                var threadInfo = thread_basic_info()
                var count = mach_msg_type_number_t(THREAD_INFO_MAX)

                let infoResult = withUnsafeMutablePointer(to: &threadInfo) {
                    $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                        thread_info(threads[Int(index)], thread_flavor_t(THREAD_BASIC_INFO), $0, &count)
                    }
                }

                if infoResult == KERN_SUCCESS {
                    if threadInfo.flags & TH_FLAGS_IDLE == 0 {
                        totalUsageOfCPU += Double(threadInfo.cpu_usage) / Double(TH_USAGE_SCALE) * 100.0
                    }
                }
            }

            vm_deallocate(mach_task_self_, vm_address_t(bitPattern: threads), vm_size_t(Int(threadsCount) * MemoryLayout<thread_t>.stride))
        }

        return min(totalUsageOfCPU, 100.0)
    }

    /// 获取磁盘信息
    private func getDiskInfo() -> (used: Double, free: Double) {
        do {
            let attrs = try FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory())
            let totalSize = (attrs[.systemSize] as? Int64) ?? 0
            let freeSize = (attrs[.systemFreeSize] as? Int64) ?? 0
            let usedSize = totalSize - freeSize

            return (
                Double(usedSize) / (1024 * 1024),
                Double(freeSize) / (1024 * 1024)
            )
        } catch {
            return (0, 0)
        }
    }

    /// 设置电池监控
    private func setupBatteryMonitoring() {
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    // MARK: - Operation Tracing

    /// 开始追踪操作
    @discardableResult
    public func startTrace(
        name: String,
        category: String = "general",
        metadata: [String: Any] = [:]
    ) -> String {
        let trace = OperationTrace(
            name: name,
            category: category,
            metadata: metadata
        )

        activeTraces[trace.id] = trace

        Logger.shared.debug("[PerformanceMonitor] 开始追踪: \(name)")

        return trace.id
    }

    /// 结束追踪操作
    public func endTrace(_ traceId: String, metadata: [String: Any]? = nil) {
        guard var trace = activeTraces.removeValue(forKey: traceId) else {
            return
        }

        trace.endTime = Date()

        if let metadata = metadata {
            trace.metadata.merge(metadata) { _, new in new }
        }

        // 保存完成的追踪
        completedTraces.append(trace)
        if completedTraces.count > maxTracesCount {
            completedTraces.removeFirst(completedTraces.count - maxTracesCount)
        }

        // 检查是否为慢操作
        if let durationMs = trace.durationMs, durationMs > slowOperationThresholdMs {
            Logger.shared.warning("[PerformanceMonitor] 慢操作: \(trace.name) - \(String(format: "%.1f", durationMs))ms")
            slowOperationDetected.send(trace)
        }

        Logger.shared.debug("[PerformanceMonitor] 结束追踪: \(trace.name) - \(trace.durationMs ?? 0)ms")
    }

    /// 追踪闭包执行
    public func trace<T>(
        name: String,
        category: String = "general",
        _ block: () throws -> T
    ) rethrows -> T {
        let traceId = startTrace(name: name, category: category)
        defer { endTrace(traceId) }
        return try block()
    }

    /// 异步追踪
    public func trace<T>(
        name: String,
        category: String = "general",
        _ block: () async throws -> T
    ) async rethrows -> T {
        let traceId = startTrace(name: name, category: category)
        defer { endTrace(traceId) }
        return try await block()
    }

    // MARK: - Reports

    /// 生成性能报告
    public func generateReport(duration: TimeInterval = 3600) -> PerformanceReport {
        let cutoffTime = Date().addingTimeInterval(-duration)

        // 筛选时间范围内的指标
        let metrics = metricsHistory.filter { $0.timestamp >= cutoffTime }

        // 筛选慢操作
        let slowOperations = completedTraces.filter {
            guard let durationMs = $0.durationMs else { return false }
            return durationMs > slowOperationThresholdMs && $0.startTime >= cutoffTime
        }.sorted { ($0.durationMs ?? 0) > ($1.durationMs ?? 0) }

        // 计算汇总
        let summary = calculateSummary(metrics: metrics, slowOperations: slowOperations)

        return PerformanceReport(
            generatedAt: Date(),
            duration: duration,
            metrics: metrics,
            slowOperations: slowOperations,
            summary: summary
        )
    }

    private func calculateSummary(
        metrics: [PerformanceMetrics],
        slowOperations: [OperationTrace]
    ) -> PerformanceReport.PerformanceSummary {
        guard !metrics.isEmpty else {
            return PerformanceReport.PerformanceSummary(
                avgCpuUsage: 0, maxCpuUsage: 0,
                avgMemoryMB: 0, maxMemoryMB: 0,
                avgFps: 0, minFps: 0,
                slowOperationCount: 0, totalOperationCount: 0
            )
        }

        let cpuValues = metrics.map { $0.cpuUsage }
        let memoryValues = metrics.map { $0.memoryUsageMB }
        let fpsValues = metrics.map { $0.fps }.filter { $0 > 0 }

        return PerformanceReport.PerformanceSummary(
            avgCpuUsage: cpuValues.reduce(0, +) / Double(cpuValues.count),
            maxCpuUsage: cpuValues.max() ?? 0,
            avgMemoryMB: memoryValues.reduce(0, +) / Double(memoryValues.count),
            maxMemoryMB: memoryValues.max() ?? 0,
            avgFps: fpsValues.isEmpty ? 0 : fpsValues.reduce(0, +) / Double(fpsValues.count),
            minFps: fpsValues.min() ?? 0,
            slowOperationCount: slowOperations.count,
            totalOperationCount: completedTraces.count
        )
    }

    /// 获取慢操作列表
    public func getSlowOperations(limit: Int = 20) -> [OperationTrace] {
        return completedTraces
            .filter { ($0.durationMs ?? 0) > slowOperationThresholdMs }
            .sorted { ($0.durationMs ?? 0) > ($1.durationMs ?? 0) }
            .prefix(limit)
            .map { $0 }
    }

    /// 获取历史指标
    public func getMetricsHistory(limit: Int = 100) -> [PerformanceMetrics] {
        return Array(metricsHistory.suffix(limit))
    }

    /// 清除历史数据
    public func clearHistory() {
        metricsHistory.removeAll()
        completedTraces.removeAll()
    }

    deinit {
        stopMonitoring()
    }
}

// MARK: - Performance Marker

/// 性能标记（用于代码块计时）
public struct PerformanceMarker {

    private let name: String
    private let startTime: CFAbsoluteTime

    public init(_ name: String) {
        self.name = name
        self.startTime = CFAbsoluteTimeGetCurrent()
    }

    /// 结束并打印耗时
    public func end() {
        let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
        Logger.shared.debug("[Performance] \(name): \(String(format: "%.2f", elapsed))ms")
    }

    /// 结束并返回耗时（毫秒）
    public func endAndReturn() -> Double {
        let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
        Logger.shared.debug("[Performance] \(name): \(String(format: "%.2f", elapsed))ms")
        return elapsed
    }
}

// MARK: - Convenience Functions

/// 性能计时宏
public func measureTime<T>(_ name: String, _ block: () throws -> T) rethrows -> T {
    let marker = PerformanceMarker(name)
    defer { marker.end() }
    return try block()
}

public func measureTimeAsync<T>(_ name: String, _ block: () async throws -> T) async rethrows -> T {
    let marker = PerformanceMarker(name)
    defer { marker.end() }
    return try await block()
}

// MARK: - Thermal State Extension

extension ProcessInfo.ThermalState {
    public var description: String {
        switch self {
        case .nominal: return "正常"
        case .fair: return "轻微发热"
        case .serious: return "严重发热"
        case .critical: return "过热"
        @unknown default: return "未知"
        }
    }

    public var color: UIColor {
        switch self {
        case .nominal: return .systemGreen
        case .fair: return .systemYellow
        case .serious: return .systemOrange
        case .critical: return .systemRed
        @unknown default: return .systemGray
        }
    }
}
