import XCTest
@testable import CoreP2P

/// Phase 3.1 — `SeedRegistry` 23 entries 数据完整性测试。
///
/// 与 Android `SeedRegistry.kt` (393 LOC) 1:1 翻译；本测试**写死预期值**作 contract，
/// Android 端改字段时强制 iOS 端同步（commit msg 标 mirrors @<commit> 时一并 update test）。
final class SeedRegistryTests: XCTestCase {

    func testEntryCountIs23() {
        XCTAssertEqual(SeedRegistry.SKILLS.count, 23)
        XCTAssertEqual(SeedRegistry.EXPECTED_FILE_COUNT, 23)
    }

    func testTotalMethodCountIs795() {
        let total = SeedRegistry.SKILLS.reduce(0) { $0 + $1.methodCount }
        XCTAssertEqual(total, 795, "与 Android M1 inventory 表合计一致")
        XCTAssertEqual(SeedRegistry.EXPECTED_METHOD_COUNT, 795)
    }

    func testVerifyCounts() {
        XCTAssertTrue(SeedRegistry.verifyCounts())
    }

    func testNamespacesAreUnique() {
        let namespaces = SeedRegistry.SKILLS.map { $0.namespace }
        let unique = Set(namespaces)
        XCTAssertEqual(namespaces.count, unique.count, "namespace 必须唯一")
    }

    func testAllExpectedNamespacesPresent() {
        // 写死预期 23 个 namespace（contract test —— Android 改字段时需同步）
        let expected: Set<String> = [
            "extension", "desktop", "media", "knowledge", "network",
            "ai", "system", "file", "system.info", "storage",
            "browser", "power", "process", "input", "workflow",
            "userBrowser", "device", "notification", "display",
            "clipboard", "app", "security", "history",
        ]
        let actual = Set(SeedRegistry.SKILLS.map { $0.namespace })
        XCTAssertEqual(actual, expected)
    }

    func testRiskDistribution() {
        let byRisk = Dictionary(grouping: SeedRegistry.SKILLS, by: { $0.risk })
        // 写死预期数量分布
        XCTAssertEqual(byRisk[.Privileged]?.count, 11, "11 个 Privileged: extension/desktop/network/ai/system/file/power/process/workflow/device/security")
        XCTAssertEqual(byRisk[.Mutating]?.count, 10, "10 个 Mutating")
        XCTAssertEqual(byRisk[.Safe]?.count, 2, "2 个 Safe: system.info / history")
    }

    func testExtensionUsesExtensionWsTransport() {
        let ext = SeedRegistry.SKILLS.first(where: { $0.namespace == "extension" })
        XCTAssertEqual(ext?.transport, "extension-ws", "ExtensionCommands 走 Chrome 扩展独立 WS")
    }

    func testAllOtherSkillsUseHandlerRpcTransport() {
        let nonExt = SeedRegistry.SKILLS.filter { $0.namespace != "extension" }
        for skill in nonExt {
            XCTAssertEqual(skill.transport, "handler-rpc", "\(skill.namespace) 应用 handler-rpc")
        }
    }

    func testKnowledgeAndAiHaveMethodLevelData() {
        let knowledge = SeedRegistry.SKILLS.first(where: { $0.namespace == "knowledge" })
        let ai = SeedRegistry.SKILLS.first(where: { $0.namespace == "ai" })
        XCTAssertNotNil(knowledge?.methods)
        XCTAssertEqual(knowledge?.methods?.count, 10)
        XCTAssertNotNil(ai?.methods)
        XCTAssertEqual(ai?.methods?.count, 10)
    }

    func testKnowledgeDeleteNoteIsRiskOverridePrivileged() {
        let knowledge = SeedRegistry.SKILLS.first(where: { $0.namespace == "knowledge" })
        let deleteNote = knowledge?.methods?.first(where: { $0.name == "deleteNote" })
        XCTAssertEqual(deleteNote?.riskOverride, .Privileged, "delete 不可逆 → 强 Privileged")
    }

    func testAiDeleteConversationHasRequiresApprovalOverride() {
        let ai = SeedRegistry.SKILLS.first(where: { $0.namespace == "ai" })
        let deleteConv = ai?.methods?.first(where: { $0.name == "deleteConversation" })
        XCTAssertEqual(deleteConv?.requiresApprovalOverride, true)
    }

    func testRequiresApprovalDerivedFromRiskByDefault() {
        // Privileged → requiresApproval=true 默认
        let privileged = SeedRegistry.SKILLS.filter { $0.risk == .Privileged }
        for skill in privileged {
            XCTAssertTrue(skill.requiresApproval, "\(skill.namespace) Privileged 应默认 requiresApproval=true")
        }
        // Safe → requiresApproval=false 默认
        let safe = SeedRegistry.SKILLS.filter { $0.risk == .Safe }
        for skill in safe {
            XCTAssertFalse(skill.requiresApproval, "\(skill.namespace) Safe 应默认 requiresApproval=false")
        }
    }
}
