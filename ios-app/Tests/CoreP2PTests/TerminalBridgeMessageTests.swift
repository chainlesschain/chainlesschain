import XCTest
@testable import CoreP2P

/// Phase 2.3 — `TerminalBridgeMessage.parse` JS body 解码测试。
final class TerminalBridgeMessageTests: XCTestCase {

    func testOnReadyParsesIntFields() {
        let body: [String: Any] = ["type": "onReady", "cols": 80, "rows": 24]
        XCTAssertEqual(TerminalBridgeMessage.parse(body), .onReady(cols: 80, rows: 24))
    }

    func testOnReadyParsesDoubleFields() {
        // WKScriptMessage 转 JS Number 来时通常 NSNumber → Swift 端可能是 Double
        let body: [String: Any] = ["type": "onReady", "cols": 80.0, "rows": 24.0]
        XCTAssertEqual(TerminalBridgeMessage.parse(body), .onReady(cols: 80, rows: 24))
    }

    func testOnResize() {
        let body: [String: Any] = ["type": "onResize", "cols": 132, "rows": 50]
        XCTAssertEqual(TerminalBridgeMessage.parse(body), .onResize(cols: 132, rows: 50))
    }

    func testOnUserInput() {
        let body: [String: Any] = ["type": "onUserInput", "data": "ls\n"]
        XCTAssertEqual(TerminalBridgeMessage.parse(body), .onUserInput(data: "ls\n"))
    }

    func testOnUserInputWithSpecialChars() {
        // 多字节 UTF-8 + ANSI escape
        let body: [String: Any] = ["type": "onUserInput", "data": "中文\u{001b}[A"]
        XCTAssertEqual(TerminalBridgeMessage.parse(body), .onUserInput(data: "中文\u{001b}[A"))
    }

    func testRejectsMissingType() {
        XCTAssertNil(TerminalBridgeMessage.parse(["cols": 80, "rows": 24]))
    }

    func testRejectsUnknownType() {
        XCTAssertNil(TerminalBridgeMessage.parse(["type": "onWeird", "x": 1]))
    }

    func testRejectsMissingColsOrRows() {
        XCTAssertNil(TerminalBridgeMessage.parse(["type": "onReady", "cols": 80]))
        XCTAssertNil(TerminalBridgeMessage.parse(["type": "onResize", "rows": 24]))
    }

    func testRejectsMissingData() {
        XCTAssertNil(TerminalBridgeMessage.parse(["type": "onUserInput"]))
    }
}
