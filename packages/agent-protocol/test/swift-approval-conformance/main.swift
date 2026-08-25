import Foundation

private struct ApprovalFixture: Decodable {
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
