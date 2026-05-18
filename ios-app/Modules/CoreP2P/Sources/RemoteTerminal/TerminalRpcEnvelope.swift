import Foundation

/// `TerminalRpcClient` 的 wire envelope 编/解辅助 — Phase 2.2。
///
/// 协议字段严格对齐桌面端 `handleTerminalCommand` 入口（design doc §3.2），
/// **禁止改字段名**——Android + iOS + 桌面三端必须 wire-compatible。
public enum TerminalRpcEnvelope {

    // MARK: - Outbound: command request

    /// 构造 `chainlesschain:command:request` envelope JSON 字符串。
    public static func buildCommandRequest(
        id: String,
        method: String,
        params: [String: Any],
        mobileDid: String?
    ) throws -> String {
        var payload: [String: Any] = [
            "id": id,
            "method": method,
            "params": params
        ]
        if let did = mobileDid, !did.isEmpty {
            payload["auth"] = ["mobileDid": did]
        }
        let envelope: [String: Any] = [
            "type": "chainlesschain:command:request",
            "payload": payload
        ]
        return try jsonEncode(envelope)
    }

    // MARK: - Inbound: parsing

    public enum InboundFrame: Sendable {
        case commandResponse(reqId: String, resultJson: String?, errorMessage: String?)
        case stdout(StdoutEvent)
        case exit(ExitEvent)
        case unknown
    }

    /// 解析任意入站 chainlesschain:* envelope。返 .unknown 让 caller 忽略。
    public static func parseInbound(_ raw: String) -> InboundFrame {
        guard let data = raw.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data),
              let dict = root as? [String: Any],
              let type = dict["type"] as? String,
              let payload = dict["payload"] as? [String: Any] else {
            return .unknown
        }
        switch type {
        case "chainlesschain:command:response":
            return parseCommandResponse(payload: payload)
        case "chainlesschain:event":
            return parseEvent(payload: payload)
        default:
            return .unknown
        }
    }

    // MARK: - Result decoders

    /// 解 terminal.create result。
    public static func decodeCreatedSession(_ resultJson: String) throws -> CreatedSession {
        let dict = try parseObject(resultJson)
        guard let sessionId = dict["sessionId"] as? String else {
            throw TerminalRpcError.malformedResult(reqId: "", detail: "missing sessionId")
        }
        let pid = (dict["pid"] as? Int) ?? Int(dict["pid"] as? Int64 ?? 0)
        let shell = (dict["shell"] as? String) ?? "?"
        let createdAt = (dict["createdAt"] as? Int64)
            ?? Int64(dict["createdAt"] as? Int ?? 0)
        return CreatedSession(sessionId: sessionId, pid: pid, shell: shell, createdAt: createdAt)
    }

    /// 解 terminal.list result.sessions。
    public static func decodeSessionList(_ resultJson: String) throws -> [SessionRow] {
        let dict = try parseObject(resultJson)
        guard let raw = dict["sessions"] as? [[String: Any]] else {
            // 允许 result 直接就是 array
            if let arr = (try? JSONSerialization.jsonObject(with: Data(resultJson.utf8))) as? [[String: Any]] {
                return arr.compactMap(decodeSessionRow)
            }
            throw TerminalRpcError.malformedResult(reqId: "", detail: "missing sessions array")
        }
        return raw.compactMap(decodeSessionRow)
    }

    private static func decodeSessionRow(_ obj: [String: Any]) -> SessionRow? {
        guard let id = obj["id"] as? String else { return nil }
        let shell = (obj["shell"] as? String) ?? "?"
        let cwd = obj["cwd"] as? String
        let alive = (obj["alive"] as? Bool) ?? true
        let lastSeq = (obj["lastSeq"] as? Int64) ?? Int64(obj["lastSeq"] as? Int ?? 0)
        return SessionRow(id: id, shell: shell, cwd: cwd, alive: alive, lastSeq: lastSeq)
    }

    /// 解 terminal.history result。
    public static func decodeHistoryResponse(_ resultJson: String) throws -> HistoryResponse {
        let dict = try parseObject(resultJson)
        let truncated = (dict["truncated"] as? Bool) ?? false
        guard let raw = dict["chunks"] as? [[String: Any]] else {
            return HistoryResponse(chunks: [], truncated: truncated)
        }
        let chunks = raw.compactMap { obj -> HistoryChunk? in
            let seq = (obj["seq"] as? Int64) ?? Int64(obj["seq"] as? Int ?? 0)
            guard let data = obj["data"] as? String else { return nil }
            return HistoryChunk(seq: seq, data: data)
        }
        return HistoryResponse(chunks: chunks, truncated: truncated)
    }

    /// 解 ok-style result（stdin/resize/close 用）— 检查 `ok==true`。
    public static func decodeOk(_ resultJson: String) throws -> Bool {
        let dict = try parseObject(resultJson)
        return (dict["ok"] as? Bool) ?? false
    }

    // MARK: - Internals

    private static func parseCommandResponse(payload: [String: Any]) -> InboundFrame {
        guard let reqId = payload["id"] as? String else {
            return .unknown
        }
        if let errorMsg = payload["error"] as? String {
            return .commandResponse(reqId: reqId, resultJson: nil, errorMessage: errorMsg)
        }
        if let result = payload["result"] {
            // result 可能是 dict / array / scalar — 一律 re-serialize 成 string 给 caller decode
            let resultJson = (try? JSONSerialization.data(withJSONObject: result, options: []))
                .flatMap { String(data: $0, encoding: .utf8) }
            return .commandResponse(reqId: reqId, resultJson: resultJson, errorMessage: nil)
        }
        // 既无 result 又无 error — 兜底当 success-empty
        return .commandResponse(reqId: reqId, resultJson: "{}", errorMessage: nil)
    }

    private static func parseEvent(payload: [String: Any]) -> InboundFrame {
        guard let event = payload["event"] as? String,
              let sessionId = payload["sessionId"] as? String else {
            return .unknown
        }
        switch event {
        case "terminal.stdout":
            guard let data = payload["data"] as? String else { return .unknown }
            let seq = (payload["seq"] as? Int64) ?? Int64(payload["seq"] as? Int ?? 0)
            return .stdout(StdoutEvent(sessionId: sessionId, data: data, seq: seq))
        case "terminal.exit":
            let exitCode = payload["exitCode"] as? Int
            let signal = payload["signal"] as? String
            return .exit(ExitEvent(sessionId: sessionId, exitCode: exitCode, signal: signal))
        default:
            return .unknown
        }
    }

    private static func parseObject(_ json: String) throws -> [String: Any] {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TerminalRpcError.malformedResult(reqId: "", detail: "invalid JSON")
        }
        return dict
    }

    private static func jsonEncode(_ obj: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
        guard let s = String(data: data, encoding: .utf8) else {
            throw TerminalRpcError.malformedResult(reqId: "", detail: "encode utf8 failed")
        }
        return s
    }
}
