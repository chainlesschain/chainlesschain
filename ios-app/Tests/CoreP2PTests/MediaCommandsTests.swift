import XCTest
@testable import CoreP2P

/// Phase 6.2 — `MediaCommands` typed wrapper 测试（10 method 桌面子集）。
final class MediaCommandsTests: XCTestCase {

    private final class InboundChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock(); var dcSent: [String] = []; var dcReady: Bool = true
    }

    private struct Setup { let cmds: MediaCommands; let inbound: InboundChannel; let transport: FakeTransport }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock(); transport.dcSent.append(text); transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "md-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: MediaCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqId(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func payload(_ json: String) throws -> [String: Any] {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return d["payload"] as! [String: Any]
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = ["type": "chainlesschain:command:response",
                                  "payload": ["id": reqId, "result": result]]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    func testGetVolumeDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getVolume(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "volume": 65, "muted": false, "platform": "darwin"
        ])
        let r = try await task.value
        XCTAssertEqual(r.volume, 65)
        XCTAssertFalse(r.muted)
    }

    func testSetVolumeEnvelopeAndValidation() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.setVolume(pcPeerId: "pc", volume: 50) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["volume"] as? Int, 50)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "volume": 50, "message": "Volume set to 50%"
        ])
        let r = try await task.value
        XCTAssertEqual(r.volume, 50)
    }

    func testSetVolumeOutOfRangeThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.setVolume(pcPeerId: "pc", volume: 150); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.setVolume(pcPeerId: "pc", volume: -1); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testMuteUnmuteToggleRouted() async throws {
        let s = await makeSetup()
        for (idx, action) in [
            ("media.mute", { try await s.cmds.mute(pcPeerId: "pc") }),
            ("media.unmute", { try await s.cmds.unmute(pcPeerId: "pc") }),
            ("media.toggleMute", { try await s.cmds.toggleMute(pcPeerId: "pc") })
        ].enumerated() {
            let (expectMethod, fn) = action
            let task = Task { try await fn() }
            try await Task.sleep(nanoseconds: 50_000_000)
            let p = try payload(s.transport.dcSent[idx])
            XCTAssertEqual(p["method"] as? String, expectMethod)
            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: [
                "success": true, "muted": expectMethod != "media.unmute",
                "message": "ok"
            ])
            _ = try await task.value
        }
    }

    func testGetDevicesDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDevices(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "devices": [
                ["id": "D1", "name": "MacBook Pro Speakers", "type": "output", "isDefault": true],
                ["id": "D2", "name": "AirPods Pro", "type": "output", "isDefault": false]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.devices.count, 2)
        XCTAssertTrue(r.devices[0].isDefault)
    }

    func testGetPlaybackStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPlaybackStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "playing": true,
            "track": "Bohemian Rhapsody", "artist": "Queen", "album": "A Night at the Opera",
            "position": 120.5, "duration": 354.0, "source": "spotify"
        ])
        let r = try await task.value
        XCTAssertTrue(r.playing)
        XCTAssertEqual(r.artist, "Queen")
        XCTAssertEqual(r.duration, 354.0)
    }

    func testMediaControlAllActions() async throws {
        let s = await makeSetup()
        for (idx, action): (Int, MediaControlAction) in [
            (0, .play), (1, .pause), (2, .next), (3, .previous), (4, .stop), (5, .playPause)
        ] {
            let task = Task { try await s.cmds.mediaControl(pcPeerId: "pc", action: action) }
            try await Task.sleep(nanoseconds: 50_000_000)
            let params = (try payload(s.transport.dcSent[idx]))["params"] as! [String: Any]
            XCTAssertEqual(params["action"] as? String, action.rawValue)

            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: [
                "success": true, "action": action.rawValue, "message": "ok"
            ])
            let r = try await task.value
            XCTAssertEqual(r.action, action.rawValue)
        }
    }

    func testPlaySoundWithVolumeParams() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.playSound(pcPeerId: "pc", soundId: "beep", volume: 75)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["soundId"] as? String, "beep")
        XCTAssertEqual(params["volume"] as? Int, 75)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "soundId": "beep", "message": "playing"
        ])
        let r = try await task.value
        XCTAssertEqual(r.soundId, "beep")
    }

    func testPlaySoundInvalidVolumeThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.playSound(pcPeerId: "pc", volume: 200); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testStopSoundEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.stopSound(pcPeerId: "pc", soundId: "beep") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "soundId": "beep", "message": "stopped"
        ])
        let r = try await task.value
        XCTAssertTrue(r.success)
    }
}
