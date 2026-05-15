import XCTest
@testable import CoreP2P

/// Phase 2.2 — `LRUSet` 容量 + eviction 测试。
final class LRUSetTests: XCTestCase {

    func testInsertNewReturnsTrue() {
        var lru = LRUSet<String>(capacity: 4)
        XCTAssertTrue(lru.insert("a"))
        XCTAssertTrue(lru.insert("b"))
        XCTAssertEqual(lru.count, 2)
    }

    func testInsertDuplicateReturnsFalse() {
        var lru = LRUSet<String>(capacity: 4)
        XCTAssertTrue(lru.insert("x"))
        XCTAssertFalse(lru.insert("x"))
        XCTAssertEqual(lru.count, 1)
    }

    func testCapacityEvictsOldest() {
        var lru = LRUSet<String>(capacity: 3)
        lru.insert("a")
        lru.insert("b")
        lru.insert("c")
        XCTAssertEqual(lru.count, 3)
        lru.insert("d")  // 应 evict "a"（最早插入）
        XCTAssertEqual(lru.count, 3)
        XCTAssertFalse(lru.contains("a"))
        XCTAssertTrue(lru.contains("b"))
        XCTAssertTrue(lru.contains("c"))
        XCTAssertTrue(lru.contains("d"))
    }

    func testRemove() {
        var lru = LRUSet<Int>(capacity: 4)
        lru.insert(1); lru.insert(2); lru.insert(3)
        lru.remove(2)
        XCTAssertFalse(lru.contains(2))
        XCTAssertEqual(lru.count, 2)
    }

    func testRemoveAll() {
        var lru = LRUSet<String>(capacity: 4)
        lru.insert("x"); lru.insert("y")
        lru.removeAll()
        XCTAssertEqual(lru.count, 0)
        XCTAssertFalse(lru.contains("x"))
    }

    func testCapacityOneAlwaysHoldsLatest() {
        var lru = LRUSet<String>(capacity: 1)
        lru.insert("first")
        lru.insert("second")
        XCTAssertFalse(lru.contains("first"))
        XCTAssertTrue(lru.contains("second"))
    }
}
