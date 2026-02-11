//
//  StartupOptimizer.swift
//  ChainlessChain
//
//  启动优化器
//  优化应用启动时间
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Startup Milestone

/// 启动里程碑
public struct StartupMilestone: Identifiable {
    public let id: String
    public let name: String
    public let timestamp: Date
    public let elapsed: TimeInterval // 从启动开始的时间
    public var isOptional: Bool

    public init(
        id: String = UUID().uuidString,
        name: String,
        timestamp: Date,
        elapsed: TimeInterval,
        isOptional: Bool = false
    ) {
        self.id = id
        self.name = name
        self.timestamp = timestamp
        self.elapsed = elapsed
        self.isOptional = isOptional
    }
}

// MARK: - Startup Report

/// 启动报告
public struct StartupReport {
    public let startTime: Date
    public let endTime: Date
    public let totalDuration: TimeInterval
    public let milestones: [StartupMilestone]
    public let deferredTasks: [DeferredTask]
    public let memoryAtStart: Int
    public let memoryAtEnd: Int
    public let isOptimized: Bool

    public var durationMs: Double {
        totalDuration * 1000
    }

    public var formattedDuration: String {
        String(format: "%.2f秒", totalDuration)
    }
}

// MARK: - Deferred Task

/// 延迟任务
public struct DeferredTask: Identifiable {
    public let id: String
    public let name: String
    public let priority: TaskPriority
    public var status: TaskStatus
    public var executedAt: Date?
    public var duration: TimeInterval?

    public enum TaskPriority: Int, Comparable {
        case high = 0
        case normal = 1
        case low = 2

        public static func < (lhs: TaskPriority, rhs: TaskPriority) -> Bool {
            lhs.rawValue < rhs.rawValue
        }
    }

    public enum TaskStatus {
        case pending
        case running
        case completed
        case failed(Error)
    }

    public init(
        id: String = UUID().uuidString,
        name: String,
        priority: TaskPriority = .normal,
        status: TaskStatus = .pending
    ) {
        self.id = id
        self.name = name
        self.priority = priority
        self.status = status
    }
}

// MARK: - Startup Optimizer

/// 启动优化器
@MainActor
public class StartupOptimizer: ObservableObject {
    public static let shared = StartupOptimizer()

    // MARK: - Published Properties

    @Published public private(set) var isStartupComplete: Bool = false
    @Published public private(set) var currentMilestone: String = ""
    @Published public private(set) var progress: Double = 0

    // MARK: - Properties

    private var startTime: Date?
    private var endTime: Date?
    private var milestones: [StartupMilestone] = []
    private var deferredTasks: [DeferredTask] = []
    private var deferredBlocks: [(String, DeferredTask.TaskPriority, () async -> Void)] = []

    private var memoryAtStart: Int = 0
    private var memoryAtEnd: Int = 0

    // 预期里程碑数量（用于进度计算）
    private var expectedMilestoneCount: Int = 10

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[StartupOptimizer] 初始化完成")
    }

    // MARK: - Public Methods

    /// 标记启动开始
    public func markStart() {
        startTime = Date()
        memoryAtStart = MemoryManager.currentMemoryUsage()
        milestones.removeAll()
        deferredTasks.removeAll()
        deferredBlocks.removeAll()
        isStartupComplete = false
        progress = 0

        Logger.shared.info("[StartupOptimizer] 启动开始")

        addMilestone("启动开始")
    }

    /// 添加里程碑
    public func addMilestone(_ name: String, isOptional: Bool = false) {
        guard let start = startTime else { return }

        let now = Date()
        let elapsed = now.timeIntervalSince(start)

        let milestone = StartupMilestone(
            name: name,
            timestamp: now,
            elapsed: elapsed,
            isOptional: isOptional
        )

        milestones.append(milestone)
        currentMilestone = name

        // 更新进度
        progress = min(Double(milestones.count) / Double(expectedMilestoneCount), 0.95)

        Logger.shared.debug("[StartupOptimizer] 里程碑: \(name) - \(String(format: "%.0f", elapsed * 1000))ms")
    }

    /// 标记启动结束
    public func markEnd() -> StartupReport {
        endTime = Date()
        memoryAtEnd = MemoryManager.currentMemoryUsage()
        isStartupComplete = true
        progress = 1.0

        addMilestone("启动完成")

        let report = generateReport()

        Logger.shared.info("[StartupOptimizer] 启动完成: \(report.formattedDuration)")

        // 执行延迟任务
        Task {
            await executeDeferredTasks()
        }

        return report
    }

    /// 延迟初始化
    public func deferInitialization(
        _ name: String,
        priority: DeferredTask.TaskPriority = .normal,
        block: @escaping () async -> Void
    ) {
        let task = DeferredTask(name: name, priority: priority)
        deferredTasks.append(task)
        deferredBlocks.append((name, priority, block))

        Logger.shared.debug("[StartupOptimizer] 延迟任务: \(name)")
    }

    /// 立即执行延迟任务（如果需要）
    public func executeImmediately(_ name: String) async {
        guard let index = deferredBlocks.firstIndex(where: { $0.0 == name }) else {
            return
        }

        let (_, _, block) = deferredBlocks[index]

        // 更新状态
        if let taskIndex = deferredTasks.firstIndex(where: { $0.name == name }) {
            deferredTasks[taskIndex].status = .running
        }

        let startTime = Date()

        await block()

        // 更新完成状态
        if let taskIndex = deferredTasks.firstIndex(where: { $0.name == name }) {
            deferredTasks[taskIndex].status = .completed
            deferredTasks[taskIndex].executedAt = Date()
            deferredTasks[taskIndex].duration = Date().timeIntervalSince(startTime)
        }

        // 移除已执行的任务
        deferredBlocks.remove(at: index)
    }

    /// 获取启动报告
    public func getReport() -> StartupReport? {
        guard startTime != nil, endTime != nil else {
            return nil
        }
        return generateReport()
    }

    /// 设置预期里程碑数量
    public func setExpectedMilestones(_ count: Int) {
        expectedMilestoneCount = max(1, count)
    }

    // MARK: - Private Methods

    private func generateReport() -> StartupReport {
        let start = startTime ?? Date()
        let end = endTime ?? Date()

        return StartupReport(
            startTime: start,
            endTime: end,
            totalDuration: end.timeIntervalSince(start),
            milestones: milestones,
            deferredTasks: deferredTasks,
            memoryAtStart: memoryAtStart,
            memoryAtEnd: memoryAtEnd,
            isOptimized: true
        )
    }

    private func executeDeferredTasks() async {
        // 按优先级排序
        let sortedBlocks = deferredBlocks.sorted { $0.1 < $1.1 }

        for (name, _, block) in sortedBlocks {
            // 更新状态
            if let index = deferredTasks.firstIndex(where: { $0.name == name }) {
                deferredTasks[index].status = .running
            }

            let startTime = Date()

            do {
                await block()

                // 更新完成状态
                if let index = deferredTasks.firstIndex(where: { $0.name == name }) {
                    deferredTasks[index].status = .completed
                    deferredTasks[index].executedAt = Date()
                    deferredTasks[index].duration = Date().timeIntervalSince(startTime)
                }

                Logger.shared.debug("[StartupOptimizer] 延迟任务完成: \(name)")

            } catch {
                if let index = deferredTasks.firstIndex(where: { $0.name == name }) {
                    deferredTasks[index].status = .failed(error)
                }

                Logger.shared.error("[StartupOptimizer] 延迟任务失败: \(name) - \(error)")
            }
        }

        deferredBlocks.removeAll()
    }
}

// MARK: - Startup Time Tracker

/// 启动时间追踪器（用于App启动）
public class StartupTimeTracker {
    public static let shared = StartupTimeTracker()

    private var processStartTime: Date?
    private var appDelegateStartTime: Date?
    private var firstFrameTime: Date?

    private init() {
        // 获取进程启动时间
        var kinfo = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]

        if sysctl(&mib, u_int(mib.count), &kinfo, &size, nil, 0) == 0 {
            let startTimeVal = kinfo.kp_proc.p_starttime
            processStartTime = Date(timeIntervalSince1970: Double(startTimeVal.tv_sec) + Double(startTimeVal.tv_usec) / 1_000_000)
        }
    }

    /// 标记AppDelegate开始
    public func markAppDelegateStart() {
        appDelegateStartTime = Date()
    }

    /// 标记首帧渲染
    public func markFirstFrame() {
        firstFrameTime = Date()
    }

    /// 获取预主阶段时间（进程启动到AppDelegate）
    public var preMainDuration: TimeInterval? {
        guard let process = processStartTime, let appDelegate = appDelegateStartTime else {
            return nil
        }
        return appDelegate.timeIntervalSince(process)
    }

    /// 获取主阶段时间（AppDelegate到首帧）
    public var mainDuration: TimeInterval? {
        guard let appDelegate = appDelegateStartTime, let firstFrame = firstFrameTime else {
            return nil
        }
        return firstFrame.timeIntervalSince(appDelegate)
    }

    /// 获取总启动时间
    public var totalDuration: TimeInterval? {
        guard let process = processStartTime, let firstFrame = firstFrameTime else {
            return nil
        }
        return firstFrame.timeIntervalSince(process)
    }

    /// 获取启动时间摘要
    public func getSummary() -> StartupTimeSummary? {
        guard let total = totalDuration else { return nil }

        return StartupTimeSummary(
            preMainMs: (preMainDuration ?? 0) * 1000,
            mainMs: (mainDuration ?? 0) * 1000,
            totalMs: total * 1000
        )
    }
}

/// 启动时间摘要
public struct StartupTimeSummary {
    public let preMainMs: Double
    public let mainMs: Double
    public let totalMs: Double

    public var formattedTotal: String {
        String(format: "%.0fms", totalMs)
    }
}

// MARK: - Lazy Initialization Helper

/// 懒加载帮助器
@propertyWrapper
public class LazyInit<T> {
    private var value: T?
    private let initializer: () -> T

    public init(wrappedValue: @autoclosure @escaping () -> T) {
        self.initializer = wrappedValue
    }

    public var wrappedValue: T {
        if let value = value {
            return value
        }
        let newValue = initializer()
        value = newValue
        return newValue
    }

    public var projectedValue: Bool {
        value != nil
    }
}

// MARK: - Preload Manager

/// 预加载管理器
public class PreloadManager {
    public static let shared = PreloadManager()

    private var preloadTasks: [String: () async -> Void] = [:]
    private var completedTasks: Set<String> = []

    private init() {}

    /// 注册预加载任务
    public func register(_ name: String, task: @escaping () async -> Void) {
        preloadTasks[name] = task
    }

    /// 执行预加载
    public func preload(_ name: String) async {
        guard let task = preloadTasks[name], !completedTasks.contains(name) else {
            return
        }

        await task()
        completedTasks.insert(name)

        Logger.shared.debug("[PreloadManager] 预加载完成: \(name)")
    }

    /// 批量预加载
    public func preloadAll() async {
        await withTaskGroup(of: Void.self) { group in
            for (name, task) in preloadTasks where !completedTasks.contains(name) {
                group.addTask {
                    await task()
                    self.completedTasks.insert(name)
                }
            }
        }

        Logger.shared.info("[PreloadManager] 所有预加载完成")
    }

    /// 检查是否已预加载
    public func isPreloaded(_ name: String) -> Bool {
        completedTasks.contains(name)
    }

    /// 重置
    public func reset() {
        completedTasks.removeAll()
    }
}
