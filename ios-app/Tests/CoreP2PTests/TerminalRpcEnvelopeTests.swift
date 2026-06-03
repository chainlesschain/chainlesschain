import XCTest
@testable import CoreP2P

/// Phase 2.2 — `TerminalRpcEnvelope` build/parse round-trip + 字段对齐 wire 协议。
final class TerminalRpcEnvelopeTests: XCTestCase {

    // MARK: build outbound

    func testBuildCommandRequestShape() throws {
        let json = try TerminalRpcEnvelope.buildCommandRequest(
            id: "req-123",
            method: "terminal.create",
            params: ["shell": "/bin/zsh"],
            mobileDid: "did:cc:abc"
        )
        let dict = try parseJsonObject(json)
        XCTAssertEqual(dict["type"] as? String, "chainlesschain:command:request")
        let payload = dict["payload"] as? [String: Any]
        XCTAssertEqual(payload?["id"] as? String, "req-123")
        XCTAssertEqual(payload?["method"] as? String, "terminal.create")
        let params = payload?["params"] as? [String: Any]
        XCTAssertEqual(params?["shell"] as? String, "/bin/zsh")
        let auth = payload?["auth"] as? [String: Any]
        XCTAssertEqual(auth?["mobileDid"] as? String, "did:cc:abc")
    }

    func testBuildCommandRequestOmitsAuthWhenNoMobileDid() throws {
        let json = try TerminalRpcEnvelope.buildCommandRequest(
            id: "r", method: "terminal.list", params: [:], mobileDid: nil
        )
        let dict = try parseJsonObject(json)
        let payload = dict["payload"] as? [String: Any]
        XCTAssertNil(payload?["auth"])
    }

    // MARK: parse inbound

    func testParseCommandResponseSuccess() {
        let raw = #"{"type":"chainlesschain:command:response","payload":{"id":"r1","result":{"sessionId":"s1","pid":1234,"shell":"/bin/zsh","createdAt":1700000000000}}}"#
        if case .commandResponse(let reqId, let resultJson, let err) = TerminalRpcEnvelope.parseInbound(raw) {
            XCTAssertEqual(reqId, "r1")
            XCTAssertNotNil(resultJson)
            XCTAssertNil(err)
            XCTAssertTrue(resultJson!.contains("\"sessionId\""))
        } else {
            XCTFail("expected commandResponse")
        }
    }

    func testParseCommandResponseError() {
        let raw = #"{"type":"chainlesschain:command:response","payload":{"id":"r2","error":"shell not found"}}"#
        if case .commandResponse(let reqId, let resultJson, let err) = TerminalRpcEnvelope.parseInbound(raw) {
            XCTAssertEqual(reqId, "r2")
            XCTAssertNil(resultJson)
            XCTAssertEqual(err, "shell not found")
        } else {
            XCTFail("expected commandResponse with error")
        }
    }

    func testParseStdoutEvent() {
        let raw = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"hello\n","seq":42}}"#
        if case .stdout(let event) = TerminalRpcEnvelope.parseInbound(raw) {
            XCTAssertEqual(event.sessionId, "s1")
            XCTAssertEqual(event.data, "hello\n")
            XCTAssertEqual(event.seq, 42)
        } else {
            XCTFail("expected stdout event")
        }
    }

    func testParseExitEvent() {
        let raw = #"{"type":"chainlesschain:event","payload":{"event":"terminal.exit","sessionId":"s2","exitCode":0,"signal":null}}"#
        if case .exit(let event) = TerminalRpcEnvelope.parseInbound(raw) {
            XCTAssertEqual(event.sessionId, "s2")
            XCTAssertEqual(event.exitCode, 0)
            XCTAssertNil(event.signal)
        } else {
            XCTFail("expected exit event")
        }
    }

    func testParseUnknownTypeReturnsUnknown() {
        let raw = #"{"type":"some-other-type","payload":{}}"#
        if case .unknown = TerminalRpcEnvelope.parseInbound(raw) {
            // ok
        } else {
            XCTFail("expected unknown")
        }
    }

    func testParseMalformedJsonReturnsUnknown() {
        if case .unknown = TerminalRpcEnvelope.parseInbound("not-json") {
            // ok
        } else {
            XCTFail("expected unknown")
        }
    }

    // MARK: result decoders

    func testDecodeCreatedSession() throws {
        let json = #"{"sessionId":"s-1","pid":4321,"shell":"/bin/bash","createdAt":1700000001234}"#
        let cs = try TerminalRpcEnvelope.decodeCreatedSession(json)
        XCTAssertEqual(cs.sessionId, "s-1")
        XCTAssertEqual(cs.pid, 4321)
        XCTAssertEqual(cs.shell, "/bin/bash")
        XCTAssertEqual(cs.createdAt, 1700000001234)
    }

    func testDecodeSessionList() throws {
        let json = #"{"sessions":[{"id":"a","shell":"/bin/zsh","cwd":"/home","alive":true,"lastSeq":10},{"id":"b","shell":"/bin/bash","cwd":null,"alive":false,"lastSeq":0}]}"#
        let list = try TerminalRpcEnvelope.decodeSessionList(json)
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].id, "a")
        XCTAssertEqual(list[0].cwd, "/home")
        XCTAssertEqual(list[1].alive, false)
        XCTAssertNil(list[1].cwd)
    }

    func testDecodeOk() throws {
        XCTAssertTrue(try TerminalRpcEnvelope.decodeOk(#"{"ok":true}"#))
        XCTAssertFalse(try TerminalRpcEnvelope.decodeOk(#"{"ok":false}"#))
        XCTAssertFalse(try TerminalRpcEnvelope.decodeOk(#"{}"#))
    }

    func testDecodeHistoryResponse() throws {
        let json = #"{"chunks":[{"seq":1,"data":"line1"},{"seq":2,"data":"line2"}],"truncated":true}"#
        let resp = try TerminalRpcEnvelope.decodeHistoryResponse(json)
        XCTAssertEqual(resp.chunks.count, 2)
        XCTAssertEqual(resp.chunks[0].seq, 1)
        XCTAssertEqual(resp.chunks[0].data, "line1")
        XCTAssertTrue(resp.truncated)
    }

    // MARK: helpers

    private func parseJsonObject(_ s: String) throws -> [String: Any] {
        guard let data = s.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "test", code: 0)
        }
        return dict
    }
}
