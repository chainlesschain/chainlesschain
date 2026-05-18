import XCTest
@testable import CoreP2P

/// Phase 6.6.2 — `DesktopVirtualCursor` actor 测试。
final class DesktopVirtualCursorTests: XCTestCase {

    func testInitClampsOutOfBoundsCoordinates() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080,
            initialX: 5000, initialY: -100
        )
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 1919)
        XCTAssertEqual(pos.y, 0)
    }

    func testInitWithZeroDimensionsCoerceToOne() async {
        let cursor = DesktopVirtualCursor(initialWidth: 0, initialHeight: 0)
        let screen = await cursor.screen()
        // 0 dimension coerce to 1 — clamp 不会卡死
        XCTAssertEqual(screen.width, 1)
        XCTAssertEqual(screen.height, 1)
    }

    func testResetUpdatesPosition() async {
        let cursor = DesktopVirtualCursor(initialWidth: 1920, initialHeight: 1080)
        await cursor.reset(toX: 800, toY: 600)
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 800)
        XCTAssertEqual(pos.y, 600)
    }

    func testResetClampsOutOfBoundsValues() async {
        let cursor = DesktopVirtualCursor(initialWidth: 1920, initialHeight: 1080)
        await cursor.reset(toX: 10_000, toY: -500)
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 1919)   // clamp to width - 1
        XCTAssertEqual(pos.y, 0)      // clamp to 0
    }

    func testApplyDeltaAccumulates() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 100, initialY: 100
        )
        let r1 = await cursor.applyDelta(dx: 10, dy: 20)
        XCTAssertEqual(r1.x, 110)
        XCTAssertEqual(r1.y, 120)
        let r2 = await cursor.applyDelta(dx: 5, dy: -5)
        XCTAssertEqual(r2.x, 115)
        XCTAssertEqual(r2.y, 115)
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 115)
        XCTAssertEqual(pos.y, 115)
    }

    func testApplyDeltaClampsToLeftTopBoundary() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 5, initialY: 5
        )
        let r = await cursor.applyDelta(dx: -100, dy: -100)
        XCTAssertEqual(r.x, 0)
        XCTAssertEqual(r.y, 0)
    }

    func testApplyDeltaClampsToRightBottomBoundary() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 1910, initialY: 1070
        )
        let r = await cursor.applyDelta(dx: 100, dy: 100)
        XCTAssertEqual(r.x, 1919)
        XCTAssertEqual(r.y, 1079)
    }

    func testSetScreenShrinkClampsCurrentPosition() async {
        // 当前在 (1500, 900)；屏幕缩到 1280×720 → 光标应 clamp 到 (1279, 719)
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 1500, initialY: 900
        )
        await cursor.setScreen(width: 1280, height: 720)
        let screen = await cursor.screen()
        XCTAssertEqual(screen.width, 1280)
        XCTAssertEqual(screen.height, 720)
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 1279)
        XCTAssertEqual(pos.y, 719)
    }

    func testSetScreenEnlargeKeepsCurrentPosition() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1280, initialHeight: 720, initialX: 500, initialY: 400
        )
        await cursor.setScreen(width: 3840, height: 2160)
        let pos = await cursor.position()
        XCTAssertEqual(pos.x, 500)   // 原位置在新屏内 — 不动
        XCTAssertEqual(pos.y, 400)
    }

    func testSetScreenZeroDimensionIgnored() async {
        let cursor = DesktopVirtualCursor(initialWidth: 1920, initialHeight: 1080)
        await cursor.setScreen(width: 0, height: -100)
        let screen = await cursor.screen()
        // 非法尺寸忽略 — 状态不变
        XCTAssertEqual(screen.width, 1920)
        XCTAssertEqual(screen.height, 1080)
    }

    func testDeltaZeroReturnsCurrentPosition() async {
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 800, initialY: 600
        )
        let r = await cursor.applyDelta(dx: 0, dy: 0)
        XCTAssertEqual(r.x, 800)
        XCTAssertEqual(r.y, 600)
    }

    func testLargeDeltaSequencePreservesBounds() async {
        // 多次 delta 累加：100 次随机 → 始终在边界内
        let cursor = DesktopVirtualCursor(
            initialWidth: 1920, initialHeight: 1080, initialX: 960, initialY: 540
        )
        for _ in 0..<100 {
            let dx = Int.random(in: -200...200)
            let dy = Int.random(in: -200...200)
            let r = await cursor.applyDelta(dx: dx, dy: dy)
            XCTAssertGreaterThanOrEqual(r.x, 0)
            XCTAssertLessThan(r.x, 1920)
            XCTAssertGreaterThanOrEqual(r.y, 0)
            XCTAssertLessThan(r.y, 1080)
        }
    }
}
