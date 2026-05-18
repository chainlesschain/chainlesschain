import XCTest
@testable import CoreP2P

/// Phase 3.4 — `PathUtility` 跨平台 path separator 测试 (§7.5 trap)。
final class PathUtilityTests: XCTestCase {

    func testWin32Separator() {
        XCTAssertEqual(PathUtility.separator(forPlatform: "win32"), "\\")
    }

    func testUnixSeparator() {
        XCTAssertEqual(PathUtility.separator(forPlatform: "darwin"), "/")
        XCTAssertEqual(PathUtility.separator(forPlatform: "linux"), "/")
    }

    func testSplitUnixPath() {
        let segs = PathUtility.split(path: "/Users/me/Documents/file.txt", platform: "darwin")
        XCTAssertEqual(segs, ["Users", "me", "Documents", "file.txt"])
    }

    func testSplitWin32Path() {
        let segs = PathUtility.split(path: "C:\\Users\\me\\Docs", platform: "win32")
        XCTAssertEqual(segs, ["C:", "Users", "me", "Docs"])
    }

    func testSplitWin32MixedSeparators() {
        // Windows 容忍 forward slash
        let segs = PathUtility.split(path: "C:/Users\\me/Docs", platform: "win32")
        XCTAssertEqual(segs, ["C:", "Users", "me", "Docs"])
    }

    func testJoinUnix() {
        let path = PathUtility.join(segments: ["Users", "me", "doc.txt"], platform: "darwin")
        XCTAssertEqual(path, "/Users/me/doc.txt")
    }

    func testJoinWin32WithDrive() {
        let path = PathUtility.join(segments: ["C:", "Users", "me"], platform: "win32")
        XCTAssertEqual(path, "C:\\Users\\me")
    }

    func testParentUnix() {
        let parent = PathUtility.parent(of: "/Users/me/Docs", platform: "darwin")
        XCTAssertEqual(parent, "/Users/me")
    }

    func testParentWin32() {
        let parent = PathUtility.parent(of: "C:\\Users\\me", platform: "win32")
        XCTAssertEqual(parent, "C:\\Users")
    }

    func testParentRootReturnsRoot() {
        // Unix root parent → 仍 root
        XCTAssertEqual(PathUtility.parent(of: "/", platform: "darwin"), "/")
        // Win32 drive parent → ""
        XCTAssertEqual(PathUtility.parent(of: "C:", platform: "win32"), "")
    }

    func testChildUnix() {
        let child = PathUtility.child(of: "/Users/me", name: "Documents", platform: "darwin")
        XCTAssertEqual(child, "/Users/me/Documents")
    }

    func testChildWin32() {
        let child = PathUtility.child(of: "C:\\Users", name: "me", platform: "win32")
        XCTAssertEqual(child, "C:\\Users\\me")
    }
}
