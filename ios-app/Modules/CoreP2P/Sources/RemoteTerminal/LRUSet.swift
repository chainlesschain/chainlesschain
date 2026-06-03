import Foundation

/// 简易 LRU set — Phase 2.2。
///
/// 用于 `TerminalRpcClient` 反向去重：stdout 按 `"<sessionId>|<seq>"` 索引；
/// exit 按 `"<sessionId>|exit"`。capacity ≤ 256 时 O(N) eviction 也只 ~1µs，
/// 不需要 LinkedHashMap 复杂度。
///
/// **线程安全**：本结构**非线程安全**——必须在 actor isolation 内使用
/// （与 Phase 1 actor + plain Dictionary 同模式；Android 用
/// `Collections.synchronizedMap` 是因为 Hilt @Singleton 跨线程）。
public struct LRUSet<Element: Hashable & Sendable>: Sendable {
    public let capacity: Int
    private var elements: [Element: UInt64] = [:]
    private var counter: UInt64 = 0

    public init(capacity: Int) {
        self.capacity = max(1, capacity)
    }

    /// 插入元素。如果已存在返 false（caller 用此判 "重复"）；新插入返 true。
    /// 满时按插入顺序 evict 最老的。
    @discardableResult
    public mutating func insert(_ element: Element) -> Bool {
        if elements[element] != nil {
            return false
        }
        counter &+= 1
        elements[element] = counter
        if elements.count > capacity {
            // O(N) 找最老 — 256 元素下可忽略
            if let oldest = elements.min(by: { $0.value < $1.value }) {
                elements.removeValue(forKey: oldest.key)
            }
        }
        return true
    }

    public func contains(_ element: Element) -> Bool {
        elements[element] != nil
    }

    public mutating func remove(_ element: Element) {
        elements.removeValue(forKey: element)
    }

    public mutating func removeAll() {
        elements.removeAll()
        counter = 0
    }

    public var count: Int { elements.count }
}
