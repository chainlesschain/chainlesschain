import XCTest
@testable import CoreP2P

/// **iOS 集成测试** — Phase 1+2+3 多组件协同。
///
/// 与现有 `*Tests.swift` 单元测试**互补**：单元测试专注单类，本套覆盖
/// 跨类边界 / 数据流 / 真实 envelope codec wire round-trip。
///
/// **保险范围**：
/// - WebRTC handshake → CommandClient → typed command wrapper → response decode 全链
/// - TerminalRpcClient.events 流 demux（command response vs stdout event 路由）
/// - OfflineQueueDrainer 在 dataChannelReady false→true edge 真触发 drain
/// - 多 concurrent invoke 共享同一池
/// - Continuation 泄漏防御（regression for P0 fix 2026-05-15）
///
/// **scope**：仅 fake transport 边界。真 Google WebRTC SDK / 真 PC / 真
/// xterm.js 留 Phase 1.7/2.7/3.7 真机 E2E。
@MainActor
final class Phase3IntegrationTests: XCTestCase {

    // MARK: - Shared harness

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

    private final class ReadyChannel {
        let stream: AsyncStream<Bool>
        let continuation: AsyncStream<Bool>.Continuation
        init() {
            var local: AsyncStream<Bool>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(8)) { c in local = c }
            self.continuation = local
        }
        func send(_ b: Bool) { continuation.yield(b) }
    }

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var sigSent: [(String, String)] = []
        var dcReady: Bool = true
    }

    private func makeCommandClient(
        transport: FakeTransport,
        inbound: InboundChannel,
        responseTimeoutSeconds: UInt64 = 2
    ) -> RemoteCommandClient {
        RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { pid, json in
                transport.lock.lock()
                transport.sigSent.append((pid, json))
                transport.lock.unlock()
            },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "p3-int-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
    }

    private func reqId(from json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Test 1: ClipboardCommands.get end-to-end

    func testClipboardGetEndToEndViaDC() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeCommandClient(transport: transport, inbound: inbound)
        await client.start()

        let cmd = ClipboardCommands(client: client)
        let task = Task { try await cmd.get(pcPeerId: "pc-1", type: .text) }
        try await Task.sleep(nanoseconds: 50_000_000)

        // verify outbound envelope shape
        XCTAssertEqual(transport.dcSent.count, 1)
        let envJson = transport.dcSent[0]
        XCTAssertTrue(envJson.contains("clipboard.get"), "envelope 必须含 method 名")
        let id = try reqId(from: envJson)

        // simulate desktop response
        inbound.send(try responseRaw(reqId: id, result: [
            "content": "hello world",
            "type": "text"
        ]))

        let result = try await task.value
        XCTAssertEqual(result.content, "hello world")
        XCTAssertEqual(result.type, .text)
    }

    // MARK: - Test 2: TerminalRpcClient.events demux

    func testTerminalRpcDemuxesStdoutFromCommandClientEvents() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let cmdClient = makeCommandClient(transport: transport, inbound: inbound)
        await cmdClient.start()

        // TerminalRpcClient 订阅 cmdClient.events，把 stdout/exit 帧 demux 到自己的 stdoutEvents/exitEvents
        let terminalRpc = TerminalRpcClient(commandClient: cmdClient, eventStream: cmdClient.events)
        await terminalRpc.start()

        // 起 stdout subscriber
        let stdoutTask = Task<StdoutEvent?, Never> {
            for await ev in await terminalRpc.stdoutEvents {
                return ev
            }
            return nil
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        // 注入一条 stdout event
        let stdoutEnv = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"sess-A","data":"hello\n","seq":42}}"#
        inbound.send(stdoutEnv)

        try await Task.sleep(nanoseconds: 200_000_000)
        stdoutTask.cancel()
        let evt = await stdoutTask.value
        XCTAssertNotNil(evt, "TerminalRpcClient 应收到 demux 出的 stdout event")
        XCTAssertEqual(evt?.sessionId, "sess-A")
        XCTAssertEqual(evt?.data, "hello\n")
    }

    // MARK: - Test 3: OfflineQueueDrainer false→true edge

    func testDrainerFiresOnReadinessFalseToTrueEdge() async throws {
        let suite = UserDefaults(suiteName: "drain-edge-\(UUID())")!
        let queue = OfflineCommandQueue(userDefaults: suite, key: "k", capacity: 100, maxRetries: 3)
        let transport = FakeTransport()
        transport.dcReady = false
        let inbound = InboundChannel()
        let ready = ReadyChannel()
        let cmdClient = makeCommandClient(transport: transport, inbound: inbound)
        await cmdClient.start()

        let drainer = OfflineQueueDrainer(
            queue: queue,
            commandClient: cmdClient,
            pcPeerIdProvider: { "pc-x" },
            dataChannelReadyStream: ready.stream
        )
        drainer.start()

        // enqueue 1 命令（DC 未通）
        await queue.enqueue(method: "clipboard.get", paramsJson: #"{"type":"text"}"#, mobileDid: nil)
        XCTAssertEqual(await queue.totalCount(), 1)

        // 模拟 readiness false→false（重复 false 不应 fire drain）
        ready.send(false)
        ready.send(false)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(transport.dcSent.count, 0, "重复 false 不触发 drain")

        // false→true edge：触发 drain
        transport.dcReady = true
        ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertGreaterThanOrEqual(transport.dcSent.count, 1, "false→true edge 必须触发 drain")

        // 喂回 success 响应让 invoke 完成
        if let firstSent = transport.dcSent.first {
            let id = try reqId(from: firstSent)
            inbound.send(try responseRaw(reqId: id, result: ["content": "x", "type": "text"]))
        }
        try await Task.sleep(nanoseconds: 200_000_000)

        // true→true 不再 fire（Drainer 边缘检测）
        let countAfterFirst = transport.dcSent.count
        ready.send(true)
        ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(transport.dcSent.count, countAfterFirst, "true→true 不重复 drain")
    }

    // MARK: - Test 4: Offline enqueue → recover → drain success

    func testOfflineEnqueueThenRecoverDrainsSuccessfully() async throws {
        let suite = UserDefaults(suiteName: "off-recover-\(UUID())")!
        let queue = OfflineCommandQueue(userDefaults: suite, key: "k", capacity: 100, maxRetries: 3)
        let transport = FakeTransport()
        transport.dcReady = false
        let inbound = InboundChannel()
        let cmdClient = makeCommandClient(transport: transport, inbound: inbound)
        await cmdClient.start()

        // 用户操作生成的 enqueue（DC 未通）
        await queue.enqueue(method: "system.info", paramsJson: "{}", mobileDid: "did:cc:me")
        await queue.enqueue(method: "clipboard.get", paramsJson: #"{"type":"text"}"#, mobileDid: "did:cc:me")
        XCTAssertEqual(await queue.totalCount(), 2)

        // 网络恢复，手动调 drain（边缘检测在另一个测试覆盖）
        transport.dcReady = true
        let drainTask = Task { await queue.drain(client: cmdClient, pcPeerId: "pc-1") }
        try await Task.sleep(nanoseconds: 100_000_000)

        // 喂 2 笔响应
        XCTAssertEqual(transport.dcSent.count, 2)
        let id1 = try reqId(from: transport.dcSent[0])
        let id2 = try reqId(from: transport.dcSent[1])
        inbound.send(try responseRaw(reqId: id1, result: [:]))
        inbound.send(try responseRaw(reqId: id2, result: ["content": "x", "type": "text"]))

        let (succeeded, failed) = await drainTask.value
        XCTAssertEqual(succeeded, 2)
        XCTAssertEqual(failed, 0)
        XCTAssertEqual(await queue.totalCount(), 0, "drain 成功后队列应清空")
    }

    // MARK: - Test 5: 3 concurrent invokes share same client pool

    func testConcurrentInvokesShareClientPoolWithDistinctReqIds() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeCommandClient(transport: transport, inbound: inbound)
        await client.start()

        async let r1 = client.invoke(pcPeerId: "pc", method: "system.info", params: [:])
        async let r2 = client.invoke(pcPeerId: "pc", method: "clipboard.get", params: ["type": "text"])
        async let r3 = client.invoke(pcPeerId: "pc", method: "file.list", params: ["path": "/"])
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(transport.dcSent.count, 3)
        // 三个 reqId 必须 distinct
        let ids = try transport.dcSent.map { try reqId(from: $0) }
        XCTAssertEqual(Set(ids).count, 3, "concurrent invoke 必须 reqId distinct")

        // 喂回响应 — 顺序乱序也应 demux 正确
        inbound.send(try responseRaw(reqId: ids[2], result: ["entries": []]))
        inbound.send(try responseRaw(reqId: ids[0], result: ["cpu": ["usage": 1.0]]))
        inbound.send(try responseRaw(reqId: ids[1], result: ["content": "ok", "type": "text"]))

        let (a, b, c) = try await (r1, r2, r3)
        // 全部 success
        if case .success = a {} else { XCTFail("r1 should succeed") }
        if case .success = b {} else { XCTFail("r2 should succeed") }
        if case .success = c {} else { XCTFail("r3 should succeed") }

        // pool 必须清干净
        let pending = await client.pendingCount()
        XCTAssertEqual(pending, 0)
    }

    // MARK: - Test 6: Continuation 泄漏 regression — timeout 后立即新 invoke

    /// **Regression** — 修 P0 continuation 泄漏 (2026-05-15)：
    /// timeout 后 pendingResponses 必须清，否则下一次 invoke 与残留 continuation 冲突。
    func testTimeoutFollowedByImmediateInvokeSucceeds() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeCommandClient(transport: transport, inbound: inbound, responseTimeoutSeconds: 1)
        await client.start()

        // 第一次 invoke timeout
        do {
            _ = try await client.invoke(pcPeerId: "pc", method: "slow", params: [:])
            XCTFail("expected timeout")
        } catch TerminalRpcError.timeout {
            // ok
        }
        XCTAssertEqual(await client.pendingCount(), 0, "timeout 后 pendingResponses 必须清")

        // 第二次 invoke 必须能正常完成（池已清，无残留干扰）
        let task = Task { try await client.invoke(pcPeerId: "pc", method: "fast", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(from: transport.dcSent.last!)
        inbound.send(try responseRaw(reqId: id, result: ["x": 1]))
        let resp = try await task.value
        if case .success = resp {} else { XCTFail("second invoke should succeed") }
    }
}
