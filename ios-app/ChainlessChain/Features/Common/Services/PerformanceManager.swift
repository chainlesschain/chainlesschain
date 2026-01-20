import Foundation
import UIKit
import CoreCommon

/// 性能管理器
/// 负责内存监控、性能优化和资源管理
@MainActor
class PerformanceManager: ObservableObject {
    // MARK: - Singleton

    static let shared = PerformanceManager()

    // MARK: - Published Properties

    @Published var memoryUsage: MemoryUsage = MemoryUsage()
    @Published var performanceMetrics: PerformanceMetrics = PerformanceMetrics()
    @Published var isLowMemory = false

    // MARK: - Configuration

    private let memoryWarningThreshold: Float = AppConfig.Performance.memoryWarningThreshold
    private let criticalMemoryThreshold: Float = AppConfig.Performance.criticalMemoryThreshold
    private var monitoringTimer: Timer?
    private var isMonitoring = false
    private let logger = Logger.shared
    private var memoryWarningObserver: NSObjectProtocol?

    // MARK: - Types

    struct MemoryUsage {
        var used: UInt64 = 0
        var total: UInt64 = 0
        var percentage: Float = 0
        var appMemory: UInt64 = 0

        var formattedUsed: String {
            return ByteCountFormatter.string(fromByteCount: Int64(used), countStyle: .memory)
        }

        var formattedTotal: String {
            return ByteCountFormatter.string(fromByteCount: Int64(total), countStyle: .memory)
        }

        var formattedApp: String {
            return ByteCountFormatter.string(fromByteCount: Int64(appMemory), countStyle: .memory)
        }
    }

    struct PerformanceMetrics {
        var cpuUsage: Double = 0
        var frameRate: Double = 60
        var droppedFrames: Int = 0
        var networkLatency: TimeInterval = 0
        var databaseQueryTime: TimeInterval = 0
    }

    // MARK: - Initialization

    private init() {
        setupMemoryWarningObserver()
    }

    // MARK: - Memory Monitoring

    /// 开始性能监控
    func startMonitoring(interval: TimeInterval = 5.0) {
        guard !isMonitoring else { return }

        isMonitoring = true
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateMemoryUsage()
                self?.checkMemoryPressure()
            }
        }

        // Initial update
        updateMemoryUsage()

        logger.debug("[PerformanceManager] Started monitoring")
    }

    /// 停止性能监控
    func stopMonitoring() {
        monitoringTimer?.invalidate()
        monitoringTimer = nil
        isMonitoring = false

        logger.debug("[PerformanceManager] Stopped monitoring")
    }

    /// 更新内存使用情况
    private func updateMemoryUsage() {
        var taskInfo = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &taskInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        if result == KERN_SUCCESS {
            let appMemory = taskInfo.resident_size
            let totalMemory = ProcessInfo.processInfo.physicalMemory

            memoryUsage = MemoryUsage(
                used: appMemory,
                total: totalMemory,
                percentage: Float(appMemory) / Float(totalMemory),
                appMemory: appMemory
            )
        }
    }

    /// 检查内存压力
    private func checkMemoryPressure() {
        let percentage = memoryUsage.percentage

        if percentage >= criticalMemoryThreshold {
            handleCriticalMemory()
        } else if percentage >= memoryWarningThreshold {
            handleMemoryWarning()
        } else {
            isLowMemory = false
        }
    }

    // MARK: - Memory Warning Handling

    private func setupMemoryWarningObserver() {
        // Remove existing observer if any
        if let observer = memoryWarningObserver {
            NotificationCenter.default.removeObserver(observer)
        }

        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleSystemMemoryWarning()
            }
        }
    }

    /// Remove memory warning observer
    func removeObservers() {
        if let observer = memoryWarningObserver {
            NotificationCenter.default.removeObserver(observer)
            memoryWarningObserver = nil
        }
    }

    private func handleSystemMemoryWarning() {
        logger.debug("[PerformanceManager] System memory warning received")
        isLowMemory = true

        // Clear caches
        clearCaches()

        // Notify observers
        NotificationCenter.default.post(name: .memoryWarningReceived, object: nil)
    }

    private func handleMemoryWarning() {
        logger.debug("[PerformanceManager] Memory warning: \(String(format: "%.1f", memoryUsage.percentage * 100))%")
        isLowMemory = true

        // Clear non-essential caches
        clearNonEssentialCaches()
    }

    private func handleCriticalMemory() {
        logger.debug("[PerformanceManager] Critical memory: \(String(format: "%.1f", memoryUsage.percentage * 100))%")
        isLowMemory = true

        // Clear all caches
        clearCaches()

        // Notify for aggressive cleanup
        NotificationCenter.default.post(name: .criticalMemoryWarning, object: nil)
    }

    // MARK: - Cache Management

    /// 清除所有缓存
    func clearCaches() {
        // Clear image caches
        URLCache.shared.removeAllCachedResponses()

        // Clear memory cache
        NSCache<AnyObject, AnyObject>().removeAllObjects()

        // Notify image cache manager
        NotificationCenter.default.post(name: .clearImageCache, object: nil)

        logger.debug("[PerformanceManager] Cleared all caches")
    }

    /// 清除非必要缓存
    func clearNonEssentialCaches() {
        // Clear only URL cache
        URLCache.shared.removeAllCachedResponses()

        logger.debug("[PerformanceManager] Cleared non-essential caches")
    }

    // MARK: - Performance Tracking

    /// 测量操作耗时
    func measureTime<T>(operation: String, block: () async throws -> T) async rethrows -> T {
        let startTime = CFAbsoluteTimeGetCurrent()
        let result = try await block()
        let timeElapsed = CFAbsoluteTimeGetCurrent() - startTime

        logger.debug("[PerformanceManager] \(operation) took \(String(format: "%.3f", timeElapsed))s")

        return result
    }

    /// 测量同步操作耗时
    func measureTimeSync<T>(operation: String, block: () throws -> T) rethrows -> T {
        let startTime = CFAbsoluteTimeGetCurrent()
        let result = try block()
        let timeElapsed = CFAbsoluteTimeGetCurrent() - startTime

        logger.debug("[PerformanceManager] \(operation) took \(String(format: "%.3f", timeElapsed))s")

        return result
    }

    // MARK: - List Performance Optimization

    /// 获取推荐的列表页面大小
    func recommendedPageSize(for itemHeight: CGFloat, screenHeight: CGFloat? = nil) -> Int {
        let height = screenHeight ?? UIScreen.main.bounds.height
        let visibleItems = Int(height / itemHeight)
        // Load 2x visible items for smooth scrolling
        return visibleItems * 2
    }

    /// 检查是否应该使用懒加载
    func shouldUseLazyLoading(itemCount: Int, threshold: Int = 50) -> Bool {
        return itemCount > threshold
    }

    // MARK: - Debounce and Throttle

    private var debounceTimers: [String: Timer] = [:]
    private var throttleLastFired: [String: Date] = [:]

    /// 防抖函数
    func debounce(key: String, delay: TimeInterval, action: @escaping () -> Void) {
        debounceTimers[key]?.invalidate()

        let timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            action()
        }
        debounceTimers[key] = timer
    }

    /// 节流函数
    func throttle(key: String, interval: TimeInterval, action: @escaping () -> Void) {
        let now = Date()

        if let lastFired = throttleLastFired[key] {
            guard now.timeIntervalSince(lastFired) >= interval else { return }
        }

        throttleLastFired[key] = now
        action()
    }

    // MARK: - Background Task Management

    private var backgroundTasks: [String: UIBackgroundTaskIdentifier] = [:]

    /// 开始后台任务
    func beginBackgroundTask(key: String, expirationHandler: (() -> Void)? = nil) {
        let task = UIApplication.shared.beginBackgroundTask(withName: key) { [weak self] in
            expirationHandler?()
            self?.endBackgroundTask(key: key)
        }
        backgroundTasks[key] = task

        logger.debug("[PerformanceManager] Started background task: \(key)")
    }

    /// 结束后台任务
    func endBackgroundTask(key: String) {
        guard let task = backgroundTasks[key] else { return }

        UIApplication.shared.endBackgroundTask(task)
        backgroundTasks.removeValue(forKey: key)

        logger.debug("[PerformanceManager] Ended background task: \(key)")
    }

    // MARK: - Statistics

    func getMemoryStats() -> [String: Any] {
        return [
            "usedMemory": memoryUsage.formattedUsed,
            "totalMemory": memoryUsage.formattedTotal,
            "appMemory": memoryUsage.formattedApp,
            "percentage": String(format: "%.1f%%", memoryUsage.percentage * 100),
            "isLowMemory": isLowMemory
        ]
    }

    // MARK: - Cleanup

    func cleanup() {
        stopMonitoring()
        clearCaches()

        // End all background tasks
        for key in backgroundTasks.keys {
            endBackgroundTask(key: key)
        }

        // Cancel all debounce timers
        for timer in debounceTimers.values {
            timer.invalidate()
        }
        debounceTimers.removeAll()
        throttleLastFired.removeAll()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let memoryWarningReceived = Notification.Name("memoryWarningReceived")
    static let criticalMemoryWarning = Notification.Name("criticalMemoryWarning")
    static let clearImageCache = Notification.Name("clearImageCache")
}

// MARK: - Lazy Paginated List

/// 分页懒加载列表管理器
@MainActor
class PaginatedListManager<T: Identifiable>: ObservableObject {
    @Published var items: [T] = []
    @Published var isLoading = false
    @Published var hasMorePages = true
    @Published var error: Error?

    private var currentPage = 0
    private let pageSize: Int
    private var loadTask: Task<Void, Never>?

    init(pageSize: Int = 20) {
        self.pageSize = pageSize
    }

    /// 加载下一页
    func loadNextPage(loader: @escaping (Int, Int) async throws -> [T]) {
        guard !isLoading && hasMorePages else { return }

        loadTask?.cancel()
        loadTask = Task {
            await MainActor.run { isLoading = true }

            do {
                let newItems = try await loader(currentPage, pageSize)

                await MainActor.run {
                    if newItems.isEmpty {
                        hasMorePages = false
                    } else {
                        items.append(contentsOf: newItems)
                        currentPage += 1
                    }
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.error = error
                    isLoading = false
                }
            }
        }
    }

    /// 刷新列表
    func refresh(loader: @escaping (Int, Int) async throws -> [T]) async {
        loadTask?.cancel()
        currentPage = 0
        hasMorePages = true
        items.removeAll()

        loadNextPage(loader: loader)
    }

    /// 重置
    func reset() {
        loadTask?.cancel()
        currentPage = 0
        hasMorePages = true
        items.removeAll()
        error = nil
    }
}

// MARK: - Image Prefetcher

/// 图片预加载器
@MainActor
class ImagePrefetcher: ObservableObject {
    @Published var prefetchedURLs: Set<URL> = []

    private let maxPrefetchCount = 10
    private var prefetchTasks: [URL: Task<Void, Never>] = [:]

    /// 预加载图片
    func prefetch(urls: [URL]) {
        let urlsToPrefetch = urls.prefix(maxPrefetchCount).filter { !prefetchedURLs.contains($0) }

        for url in urlsToPrefetch {
            guard prefetchTasks[url] == nil else { continue }

            let task = Task {
                do {
                    let (data, _) = try await URLSession.shared.data(from: url)
                    // Cache the data
                    let response = URLResponse(url: url, mimeType: "image/jpeg", expectedContentLength: data.count, textEncodingName: nil)
                    let cachedResponse = CachedURLResponse(response: response, data: data)
                    URLCache.shared.storeCachedResponse(cachedResponse, for: URLRequest(url: url))

                    await MainActor.run {
                        prefetchedURLs.insert(url)
                    }
                } catch {
                    // Silently fail
                }

                await MainActor.run {
                    prefetchTasks.removeValue(forKey: url)
                }
            }

            prefetchTasks[url] = task
        }
    }

    /// 取消预加载
    func cancelPrefetch(urls: [URL]) {
        for url in urls {
            prefetchTasks[url]?.cancel()
            prefetchTasks.removeValue(forKey: url)
        }
    }

    /// 清除所有
    func clear() {
        for task in prefetchTasks.values {
            task.cancel()
        }
        prefetchTasks.removeAll()
        prefetchedURLs.removeAll()
    }
}
