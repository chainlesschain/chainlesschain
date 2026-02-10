import Foundation
import UIKit
import Combine
import CoreCommon

// MARK: - Memory Statistics

/// 内存统计信息
public struct MemoryStatistics {
    /// 当前使用内存（字节）
    public var usedMemory: Int64 = 0

    /// 可用内存（字节）
    public var availableMemory: Int64 = 0

    /// 总物理内存（字节）
    public var totalMemory: Int64 = 0

    /// 内存压力级别
    public var pressureLevel: MemoryPressureLevel = .normal

    /// 使用率
    public var usagePercent: Double {
        guard totalMemory > 0 else { return 0 }
        return Double(usedMemory) / Double(totalMemory) * 100
    }

    /// 格式化已用内存
    public var usedMemoryMB: Double {
        Double(usedMemory) / (1024 * 1024)
    }

    /// 格式化可用内存
    public var availableMemoryMB: Double {
        Double(availableMemory) / (1024 * 1024)
    }
}

/// 内存压力级别
public enum MemoryPressureLevel: String, CaseIterable {
    case normal = "正常"
    case warning = "警告"
    case critical = "危险"

    public var color: UIColor {
        switch self {
        case .normal: return .systemGreen
        case .warning: return .systemOrange
        case .critical: return .systemRed
        }
    }
}

// MARK: - Object Pool

/// 对象池
public class ObjectPool<T: AnyObject> {

    private var pool: [T] = []
    private let factory: () -> T
    private let reset: ((T) -> Void)?
    private let maxSize: Int
    private let lock = NSLock()

    public init(
        maxSize: Int = 20,
        factory: @escaping () -> T,
        reset: ((T) -> Void)? = nil
    ) {
        self.maxSize = maxSize
        self.factory = factory
        self.reset = reset
    }

    /// 获取对象
    public func acquire() -> T {
        lock.lock()
        defer { lock.unlock() }

        if let object = pool.popLast() {
            return object
        }

        return factory()
    }

    /// 归还对象
    public func release(_ object: T) {
        lock.lock()
        defer { lock.unlock() }

        if pool.count < maxSize {
            reset?(object)
            pool.append(object)
        }
    }

    /// 清空池
    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        pool.removeAll()
    }

    /// 当前池大小
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return pool.count
    }
}

// MARK: - Weak Cache

/// 弱引用缓存
public class WeakCache<Key: Hashable, Value: AnyObject> {

    private class WeakBox {
        weak var value: Value?

        init(_ value: Value) {
            self.value = value
        }
    }

    private var cache: [Key: WeakBox] = [:]
    private let lock = NSLock()

    public init() {}

    /// 获取值
    public func get(_ key: Key) -> Value? {
        lock.lock()
        defer { lock.unlock() }

        guard let box = cache[key] else { return nil }

        if let value = box.value {
            return value
        } else {
            // 值已被释放，移除条目
            cache.removeValue(forKey: key)
            return nil
        }
    }

    /// 设置值
    public func set(_ key: Key, value: Value) {
        lock.lock()
        defer { lock.unlock() }

        cache[key] = WeakBox(value)
    }

    /// 移除值
    public func remove(_ key: Key) {
        lock.lock()
        defer { lock.unlock() }

        cache.removeValue(forKey: key)
    }

    /// 清理已释放的条目
    public func cleanup() {
        lock.lock()
        defer { lock.unlock() }

        cache = cache.filter { $0.value.value != nil }
    }

    /// 清空缓存
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        cache.removeAll()
    }

    /// 当前有效条目数
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }

        return cache.values.filter { $0.value != nil }.count
    }
}

// MARK: - Image Memory Cache

/// 图片内存缓存
public class ImageMemoryCache {

    private let cache = NSCache<NSString, UIImage>()
    private var keys = Set<String>()
    private let lock = NSLock()

    public init(countLimit: Int = 100, totalCostLimit: Int = 50 * 1024 * 1024) {
        cache.countLimit = countLimit
        cache.totalCostLimit = totalCostLimit // 50MB默认
    }

    /// 获取图片
    public func get(_ key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    /// 设置图片
    public func set(_ key: String, image: UIImage) {
        lock.lock()
        defer { lock.unlock() }

        let cost = Int(image.size.width * image.size.height * 4) // 估算内存占用
        cache.setObject(image, forKey: key as NSString, cost: cost)
        keys.insert(key)
    }

    /// 移除图片
    public func remove(_ key: String) {
        lock.lock()
        defer { lock.unlock() }

        cache.removeObject(forKey: key as NSString)
        keys.remove(key)
    }

    /// 清空缓存
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        cache.removeAllObjects()
        keys.removeAll()
    }

    /// 设置限制
    public func setLimits(countLimit: Int, totalCostLimit: Int) {
        cache.countLimit = countLimit
        cache.totalCostLimit = totalCostLimit
    }
}

// MARK: - Memory Manager

/// 内存管理器
@MainActor
public class MemoryManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = MemoryManager()

    // MARK: - Properties

    @Published public private(set) var statistics = MemoryStatistics()
    @Published public private(set) var isUnderPressure = false

    /// 图片缓存
    public let imageCache = ImageMemoryCache()

    /// 弱引用缓存池
    private var weakCaches: [String: Any] = [:]

    /// 对象池
    private var objectPools: [String: Any] = [:]

    /// 内存警告处理器
    private var memoryWarningHandlers: [(MemoryPressureLevel) -> Void] = []

    /// 监控定时器
    private var monitorTimer: Timer?

    /// 更新间隔
    private let updateInterval: TimeInterval = 5.0

    // MARK: - Initialization

    private init() {
        setupMemoryWarningObserver()
        startMonitoring()
        Logger.shared.info("[MemoryManager] 已初始化")
    }

    // MARK: - Monitoring

    /// 开始监控
    public func startMonitoring() {
        stopMonitoring()

        monitorTimer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateStatistics()
            }
        }

        updateStatistics()
    }

    /// 停止监控
    public func stopMonitoring() {
        monitorTimer?.invalidate()
        monitorTimer = nil
    }

    /// 更新统计信息
    public func updateStatistics() {
        var stats = MemoryStatistics()

        // 获取内存使用情况
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4

        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        if result == KERN_SUCCESS {
            stats.usedMemory = Int64(info.resident_size)
        }

        // 获取总内存
        stats.totalMemory = Int64(ProcessInfo.processInfo.physicalMemory)

        // 计算可用内存
        stats.availableMemory = stats.totalMemory - stats.usedMemory

        // 确定压力级别
        let usagePercent = stats.usagePercent
        if usagePercent > 80 {
            stats.pressureLevel = .critical
        } else if usagePercent > 60 {
            stats.pressureLevel = .warning
        } else {
            stats.pressureLevel = .normal
        }

        statistics = stats
        isUnderPressure = stats.pressureLevel != .normal
    }

    // MARK: - Memory Warning

    /// 设置内存警告观察者
    private func setupMemoryWarningObserver() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleMemoryWarning()
        }
    }

    /// 处理内存警告
    public func handleMemoryWarning() {
        Logger.shared.warning("[MemoryManager] 收到内存警告")

        updateStatistics()

        let level = statistics.pressureLevel

        // 通知所有处理器
        for handler in memoryWarningHandlers {
            handler(level)
        }

        // 执行清理
        performCleanup(level: level)
    }

    /// 注册内存警告处理器
    public func registerWarningHandler(_ handler: @escaping (MemoryPressureLevel) -> Void) {
        memoryWarningHandlers.append(handler)
    }

    /// 执行清理
    public func performCleanup(level: MemoryPressureLevel) {
        Logger.shared.info("[MemoryManager] 执行清理: \(level.rawValue)")

        switch level {
        case .normal:
            // 仅清理弱引用缓存
            cleanupWeakCaches()

        case .warning:
            // 清理弱引用缓存 + 部分图片缓存
            cleanupWeakCaches()
            imageCache.setLimits(countLimit: 50, totalCostLimit: 25 * 1024 * 1024)

        case .critical:
            // 全面清理
            cleanupWeakCaches()
            imageCache.clear()
            clearObjectPools()

            // 通知缓存管理器
            CacheManager.shared.handleMemoryWarning()
        }

        // 触发垃圾回收
        autoreleasepool { }

        Logger.shared.info("[MemoryManager] 清理完成，当前内存: \(String(format: "%.1f", statistics.usedMemoryMB))MB")
    }

    // MARK: - Object Pools

    /// 注册对象池
    public func registerPool<T: AnyObject>(
        name: String,
        maxSize: Int = 20,
        factory: @escaping () -> T,
        reset: ((T) -> Void)? = nil
    ) {
        objectPools[name] = ObjectPool(maxSize: maxSize, factory: factory, reset: reset)
    }

    /// 获取对象池
    public func getPool<T: AnyObject>(name: String) -> ObjectPool<T>? {
        return objectPools[name] as? ObjectPool<T>
    }

    /// 从池中获取对象
    public func acquire<T: AnyObject>(from poolName: String) -> T? {
        guard let pool = objectPools[poolName] as? ObjectPool<T> else {
            return nil
        }
        return pool.acquire()
    }

    /// 归还对象到池
    public func release<T: AnyObject>(_ object: T, to poolName: String) {
        guard let pool = objectPools[poolName] as? ObjectPool<T> else {
            return
        }
        pool.release(object)
    }

    /// 清空所有对象池
    public func clearObjectPools() {
        for (_, pool) in objectPools {
            if let clearable = pool as? Clearable {
                clearable.clear()
            }
        }
    }

    // MARK: - Weak Caches

    /// 注册弱引用缓存
    public func registerWeakCache<Key: Hashable, Value: AnyObject>(name: String) -> WeakCache<Key, Value> {
        let cache = WeakCache<Key, Value>()
        weakCaches[name] = cache
        return cache
    }

    /// 获取弱引用缓存
    public func getWeakCache<Key: Hashable, Value: AnyObject>(name: String) -> WeakCache<Key, Value>? {
        return weakCaches[name] as? WeakCache<Key, Value>
    }

    /// 清理所有弱引用缓存
    public func cleanupWeakCaches() {
        for (_, cache) in weakCaches {
            if let cleanable = cache as? Cleanable {
                cleanable.cleanup()
            }
        }
    }

    // MARK: - Utility

    /// 格式化内存大小
    public static func formatMemorySize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .memory
        return formatter.string(fromByteCount: bytes)
    }

    /// 获取当前内存使用
    public static func currentMemoryUsage() -> Int64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4

        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        if result == KERN_SUCCESS {
            return Int64(info.resident_size)
        }

        return 0
    }

    deinit {
        stopMonitoring()
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Protocols

private protocol Clearable {
    func clear()
}

private protocol Cleanable {
    func cleanup()
}

extension ObjectPool: Clearable {}
extension WeakCache: Cleanable {}

// MARK: - Auto Release Pool Helper

/// 自动释放池辅助
public func withAutoReleasePool<T>(_ block: () throws -> T) rethrows -> T {
    try autoreleasepool {
        try block()
    }
}

// MARK: - Memory Pressure Monitor

/// 内存压力监控器（用于后台任务）
public class MemoryPressureMonitor {

    private var source: DispatchSourceMemoryPressure?
    private var handler: ((DispatchSource.MemoryPressureEvent) -> Void)?

    public init() {}

    /// 开始监控
    public func start(handler: @escaping (DispatchSource.MemoryPressureEvent) -> Void) {
        self.handler = handler

        source = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .main)

        source?.setEventHandler { [weak self] in
            guard let self = self, let source = self.source else { return }
            let event = source.data
            self.handler?(event)
        }

        source?.resume()
    }

    /// 停止监控
    public func stop() {
        source?.cancel()
        source = nil
    }

    deinit {
        stop()
    }
}
