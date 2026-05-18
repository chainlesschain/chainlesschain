import XCTest
@testable import CoreP2P

/// Phase 3.1 — `RemoteSkillRegistry` actor 测试。
final class RemoteSkillRegistryTests: XCTestCase {

    private func makeRegistry() -> (RemoteSkillRegistry, RegistryStore, UserDefaults) {
        let suite = UserDefaults(suiteName: "test-reg-\(UUID().uuidString)")!
        let store = RegistryStore(userDefaults: suite, key: "test-key")
        let registry = RemoteSkillRegistry(store: store)
        return (registry, store, suite)
    }

    // MARK: initialize

    func testInitializeFromSeedWhenDiskEmpty() async {
        let (registry, _, _) = makeRegistry()
        let source = await registry.initialize()
        XCTAssertEqual(source, .seed)
        let skills = await registry.allSkills()
        XCTAssertEqual(skills.count, 23)
    }

    func testInitializeFromDiskWhenAvailable() async {
        let (registry, store, _) = makeRegistry()
        // pre-seed disk with smaller subset
        let custom = [
            SkillMetadata(namespace: "test", displayName: "Test", description: "x",
                          category: "data", risk: .Safe, nativeSourceFile: "x.swift", methodCount: 1)
        ]
        store.save(custom)

        let source = await registry.initialize()
        XCTAssertEqual(source, .disk)
        let skills = await registry.allSkills()
        XCTAssertEqual(skills.count, 1)
        XCTAssertEqual(skills[0].namespace, "test")
    }

    func testInitializeIsIdempotent() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        _ = await registry.initialize()
        _ = await registry.initialize()
        let skills = await registry.allSkills()
        XCTAssertEqual(skills.count, 23, "重复 init 应 no-op")
    }

    // MARK: lookup

    func testSkillForNamespaceFound() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        let clipboard = await registry.skill(for: "clipboard")
        XCTAssertNotNil(clipboard)
        XCTAssertEqual(clipboard?.displayName, "剪贴板")
    }

    func testSkillForUnknownNamespaceReturnsNil() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        XCTAssertNil(await registry.skill(for: "nonexistent"))
    }

    // MARK: groupings

    func testListByCategory() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        let byCat = await registry.listByCategory()
        // 7 categories: ai/browser/system/data/ui/control/infra
        XCTAssertGreaterThanOrEqual(byCat.count, 7)
        XCTAssertEqual(byCat["ai"]?.count, 1, "AI 分类只有 ai namespace")
        XCTAssertGreaterThanOrEqual(byCat["system"]?.count ?? 0, 5, "system 类别多")
    }

    func testListByRisk() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        let safe = await registry.listByRisk(.Safe)
        XCTAssertEqual(safe.count, 2, "system.info / history")
    }

    // MARK: requiresApproval

    func testRequiresApprovalForPrivilegedSkill() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        XCTAssertTrue(await registry.requiresApproval(namespace: "system"))
        XCTAssertTrue(await registry.requiresApproval(namespace: "file"))
    }

    func testRequiresApprovalForSafeSkill() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        XCTAssertFalse(await registry.requiresApproval(namespace: "system.info"))
        XCTAssertFalse(await registry.requiresApproval(namespace: "history"))
    }

    func testRequiresApprovalForUnknownNamespaceConservative() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        XCTAssertTrue(await registry.requiresApproval(namespace: "unknown.skill"),
                      "未知 namespace 保守要求 approval")
    }

    func testRequiresApprovalMethodLevelOverride() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        // ai.deleteConversation 有 requiresApprovalOverride=true（已经 Privileged 但显式声明）
        XCTAssertTrue(await registry.requiresApproval(namespace: "ai", method: "deleteConversation"))
        // ai.getModels: file-level Privileged 但 method-level riskOverride=.Safe
        XCTAssertFalse(await registry.requiresApproval(namespace: "ai", method: "getModels"))
        // knowledge.deleteNote: file-level Mutating 但 method-level Privileged
        XCTAssertTrue(await registry.requiresApproval(namespace: "knowledge", method: "deleteNote"))
    }

    // MARK: updateFromRemote

    func testUpdateFromRemoteWithNoOpVerifierAccepts() async throws {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        let custom = [
            SkillMetadata(namespace: "newOne", displayName: "New One", description: "test",
                          category: "data", risk: .Safe, nativeSourceFile: "x.swift", methodCount: 5)
        ]
        try await registry.updateFromRemote(custom)
        let skills = await registry.allSkills()
        XCTAssertEqual(skills.count, 1)
        XCTAssertEqual(skills[0].namespace, "newOne")
    }

    func testUpdateFromRemoteRejectsWhenVerifierFails() async {
        let (registry, _, _) = makeRegistry()
        _ = await registry.initialize()
        await registry.setManifestVerifier(AlwaysRejectVerifier())
        do {
            try await registry.updateFromRemote([])
            XCTFail("expected RegistryError.signatureInvalid")
        } catch RegistryError.signatureInvalid {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    func testUpdateFromRemotePersistsToDisk() async throws {
        let (registry, store, _) = makeRegistry()
        _ = await registry.initialize()
        let custom = [
            SkillMetadata(namespace: "persistTest", displayName: "x", description: "y",
                          category: "data", risk: .Safe, nativeSourceFile: "z.swift", methodCount: 1)
        ]
        try await registry.updateFromRemote(custom)
        let loaded = store.load()
        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].namespace, "persistTest")
    }
}

// MARK: - Test helpers

private final class AlwaysRejectVerifier: ManifestSignatureVerifier {
    func verify(manifestJson: String, signature: String?, publicKey: String?) async -> Bool {
        false
    }
}
