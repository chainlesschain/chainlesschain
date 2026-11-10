import Foundation

struct ApprovalFixture: Decodable {
    let name: String
    let valid: Bool
    let value: JSONValue
}

guard CommandLine.arguments.count == 2 else {
    fatalError("usage: swift-approval-conformance <approval-decisions.json>")
}

let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
let fixtures = try JSONDecoder().decode(
    [ApprovalFixture].self,
    from: Data(contentsOf: fixtureURL)
)
let encoder = JSONEncoder()
let decoder = JSONDecoder()

for fixture in fixtures {
    do {
        let wireData = try encoder.encode(fixture.value)
        let decision = try decoder.decode(ApprovalDecision.self, from: wireData)
        guard fixture.valid else {
            fatalError("\(fixture.name): invalid fixture was accepted")
        }
        let roundTrip = try encoder.encode(decision)
        _ = try decoder.decode(ApprovalDecision.self, from: roundTrip)
    } catch {
        guard !fixture.valid else {
            fatalError("\(fixture.name): valid fixture was rejected: \(error)")
        }
    }
}

func requireEncodingFailure(_ name: String, _ decision: ApprovalDecision) {
    do {
        _ = try encoder.encode(decision)
        fatalError("\(name): invalid constructed decision was encoded")
    } catch {
        // Expected: output validation must also reject values that bypass decoding.
    }
}

requireEncodingFailure(
    "empty capability",
    .acceptForSession(permissions: [
        PermissionGrant(capability: "", scope: "*")
    ])
)
requireEncodingFailure(
    "invalid expiresAt",
    .acceptForTurn(permissions: [
        PermissionGrant(
            capability: "tool:run_shell",
            scope: "npm test",
            expiresAt: .bool(true)
        )
    ])
)
requireEncodingFailure("oversized reason", .cancel(reason: String(repeating: "x", count: 2049)))

print("Swift ApprovalDecision conformance: \(fixtures.count) fixtures passed")

// Preserve the constructor and Codable shape exported by agent-protocol 0.1.12.
let legacyMemoryDecision = MemoryDecisionRequest(
    memoryId: "memory-1", type: "reinforce", expectedRevision: 3,
    confidenceDelta: 0.1, importance: 0.8, tags: ["tag"], summary: "summary",
    reason: "reason", authority: "user-1", at: "2026-11-09T00:00:00Z"
)
let legacyMemoryData = try encoder.encode(legacyMemoryDecision)
let legacyMemoryWire = try JSONSerialization.jsonObject(with: legacyMemoryData) as! NSDictionary
let expectedLegacyMemoryWire: NSDictionary = [
    "memoryId": "memory-1", "type": "reinforce", "expectedRevision": 3,
    "confidenceDelta": 0.1, "importance": 0.8, "tags": ["tag"], "summary": "summary",
    "reason": "reason", "authority": "user-1", "at": "2026-11-09T00:00:00Z"
]
guard legacyMemoryWire == expectedLegacyMemoryWire else {
    fatalError("Legacy MemoryDecisionRequest encoding changed")
}
let decodedLegacyMemory = try decoder.decode(MemoryDecisionRequest.self, from: legacyMemoryData)
guard decodedLegacyMemory.memoryId == "memory-1", decodedLegacyMemory.confidenceDelta == 0.1 else {
    fatalError("Legacy MemoryDecisionRequest decoding changed")
}
let lifecycleMemory: MemoryLifecycleDecisionRequest = MemoryDecisionRequest(
    memoryId: "memory-1", type: "archive", expectedRevision: 4
)
let lifecycleMemoryWire = try JSONSerialization.jsonObject(with: encoder.encode(lifecycleMemory)) as! NSDictionary
guard lifecycleMemoryWire == ["memoryId": "memory-1", "type": "archive", "expectedRevision": 4] as NSDictionary else {
    fatalError("Lifecycle alias must not add a tagged-union wrapper")
}
let correctedMemory = MemoryCorrectionRequest(
    memoryId: "memory-1", type: "correct", expectedRevision: 3,
    content: "replacement", reason: "reason"
)
let correctedMemoryData = try encoder.encode(correctedMemory)
let correctedMemoryWire = try JSONSerialization.jsonObject(with: correctedMemoryData) as! NSDictionary
guard correctedMemoryWire == [
    "memoryId": "memory-1", "type": "correct", "expectedRevision": 3,
    "content": "replacement", "reason": "reason"
] as NSDictionary else {
    fatalError("Typed correction encoding changed")
}
let decodedCorrection = try decoder.decode(MemoryCorrectionRequest.self, from: correctedMemoryData)
guard decodedCorrection.content == "replacement" else {
    fatalError("Typed correction decoding changed")
}
print("Swift memory decision constructor/encoding: 3 cases passed")
