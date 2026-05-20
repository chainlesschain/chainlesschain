import Foundation

/// 个人数据中台 typed RPC 响应模型 — Phase 14.2 v1.0 完整 22 method 模型集。
///
/// 镜像桌面 `desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js` +
/// `packages/cli/src/gateways/ws/personal-data-hub-protocol.js` 通道契约。
///
/// 全部 wire method 名走 **kebab-case**（与 Android Phase 14.1 修齐后一致）。
///
/// 设计文档：`docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`
/// + `docs/design/Personal_Data_Hub_Analysis_Skills.md`（runSkill 契约）。

// MARK: - 1. Ask

/// 自然语言提问结果 (`personal-data-hub.ask`).
public struct HubAskResult: Sendable, Equatable {
    public let answer: String
    public let citations: [HubCitation]
    public let llmName: String
    public let isLocal: Bool

    public init(answer: String, citations: [HubCitation] = [],
                llmName: String = "", isLocal: Bool = true) {
        self.answer = answer
        self.citations = citations
        self.llmName = llmName
        self.isLocal = isLocal
    }

    public static func decode(_ json: String) throws -> HubAskResult {
        let d = try parseHubDict(json)
        return HubAskResult(
            answer: (d["answer"] as? String) ?? "",
            citations: parseCitations(d["citations"]),
            llmName: (d["llmName"] as? String) ?? "",
            isLocal: (d["isLocal"] as? Bool) ?? true
        )
    }
}

public struct HubCitation: Sendable, Equatable, Identifiable {
    public let eventId: String
    public let source: String?
    public let occurredAt: Int64?

    public var id: String { eventId }

    public init(eventId: String, source: String? = nil, occurredAt: Int64? = nil) {
        self.eventId = eventId
        self.source = source
        self.occurredAt = occurredAt
    }
}

private func parseCitations(_ raw: Any?) -> [HubCitation] {
    guard let arr = raw as? [[String: Any]] else { return [] }
    return arr.compactMap { d in
        let eid = d["eventId"] as? String ?? d["id"] as? String
        guard let id = eid else { return nil }
        return HubCitation(
            eventId: id,
            source: d["source"] as? String,
            occurredAt: pickHubInt64(d["occurredAt"])
        )
    }
}

// MARK: - 2. Health

public struct HubHealth: Sendable, Equatable {
    public let vault: HubHealthVault
    public let llm: HubHealthLlm
    public let kgSink: HubHealthOk
    public let ragSink: HubHealthOk

    public init(vault: HubHealthVault, llm: HubHealthLlm,
                kgSink: HubHealthOk, ragSink: HubHealthOk) {
        self.vault = vault; self.llm = llm
        self.kgSink = kgSink; self.ragSink = ragSink
    }

    public static func decode(_ json: String) throws -> HubHealth {
        let d = try parseHubDict(json)
        return HubHealth(
            vault: HubHealthVault.from(d["vault"]),
            llm: HubHealthLlm.from(d["llm"]),
            kgSink: HubHealthOk.from(d["kgSink"]),
            ragSink: HubHealthOk.from(d["ragSink"])
        )
    }
}

public struct HubHealthVault: Sendable, Equatable {
    public let ok: Bool
    public let schemaVersion: Int

    public init(ok: Bool, schemaVersion: Int) {
        self.ok = ok; self.schemaVersion = schemaVersion
    }

    internal static func from(_ raw: Any?) -> HubHealthVault {
        let d = raw as? [String: Any] ?? [:]
        return HubHealthVault(
            ok: (d["ok"] as? Bool) ?? false,
            schemaVersion: (d["schemaVersion"] as? Int) ?? 0
        )
    }
}

public struct HubHealthLlm: Sendable, Equatable {
    public let ok: Bool
    public let isLocal: Bool
    public let name: String

    public init(ok: Bool, isLocal: Bool, name: String) {
        self.ok = ok; self.isLocal = isLocal; self.name = name
    }

    internal static func from(_ raw: Any?) -> HubHealthLlm {
        let d = raw as? [String: Any] ?? [:]
        return HubHealthLlm(
            ok: (d["ok"] as? Bool) ?? false,
            isLocal: (d["isLocal"] as? Bool) ?? true,
            name: (d["name"] as? String) ?? ""
        )
    }
}

public struct HubHealthOk: Sendable, Equatable {
    public let ok: Bool
    public init(ok: Bool) { self.ok = ok }
    internal static func from(_ raw: Any?) -> HubHealthOk {
        let d = raw as? [String: Any] ?? [:]
        return HubHealthOk(ok: (d["ok"] as? Bool) ?? false)
    }
}

// MARK: - 3. Stats

public struct HubStats: Sendable, Equatable {
    public let events: Int
    public let persons: Int
    public let places: Int
    public let items: Int
    public let topics: Int
    public let adapters: [HubAdapterMeta]
    public let hubDir: String

    public init(events: Int, persons: Int, places: Int, items: Int, topics: Int,
                adapters: [HubAdapterMeta], hubDir: String) {
        self.events = events; self.persons = persons; self.places = places
        self.items = items; self.topics = topics; self.adapters = adapters; self.hubDir = hubDir
    }

    public static func decode(_ json: String) throws -> HubStats {
        let d = try parseHubDict(json)
        let v = d["vault"] as? [String: Any] ?? [:]
        let adapters = (d["adapters"] as? [[String: Any]] ?? []).map(HubAdapterMeta.from)
        return HubStats(
            events: (v["events"] as? Int) ?? 0,
            persons: (v["persons"] as? Int) ?? 0,
            places: (v["places"] as? Int) ?? 0,
            items: (v["items"] as? Int) ?? 0,
            topics: (v["topics"] as? Int) ?? 0,
            adapters: adapters,
            hubDir: (d["hubDir"] as? String) ?? ""
        )
    }
}

// MARK: - 4. AdapterMeta + AdaptersResponse

public struct HubAdapterMeta: Sendable, Equatable, Identifiable {
    public let name: String
    public let version: String
    public let capabilities: [String]
    public let sensitivity: String

    public var id: String { name }

    public init(name: String, version: String = "",
                capabilities: [String] = [], sensitivity: String = "low") {
        self.name = name; self.version = version
        self.capabilities = capabilities; self.sensitivity = sensitivity
    }

    internal static func from(_ d: [String: Any]) -> HubAdapterMeta {
        HubAdapterMeta(
            name: (d["name"] as? String) ?? "",
            version: (d["version"] as? String) ?? "",
            capabilities: (d["capabilities"] as? [String]) ?? [],
            sensitivity: (d["sensitivity"] as? String) ?? "low"
        )
    }
}

public struct HubAdaptersResponse: Sendable, Equatable {
    public let adapters: [HubAdapterMeta]
    public init(adapters: [HubAdapterMeta]) { self.adapters = adapters }

    public static func decode(_ json: String) throws -> HubAdaptersResponse {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.list-adapters: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubAdaptersResponse(adapters: arr.map(HubAdapterMeta.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["adapters"] as? [[String: Any]] {
            return HubAdaptersResponse(adapters: arr.map(HubAdapterMeta.from))
        }
        throw RemoteSkillError.malformedResult("hub.list-adapters: unexpected shape")
    }
}

// MARK: - 5. SyncReport / SyncReportList

public struct HubSyncReport: Sendable, Equatable {
    public let ingested: Int
    public let kgTriples: Int
    public let ragDocs: Int
    public let durationMs: Int

    public init(ingested: Int, kgTriples: Int = 0, ragDocs: Int = 0, durationMs: Int = 0) {
        self.ingested = ingested; self.kgTriples = kgTriples
        self.ragDocs = ragDocs; self.durationMs = durationMs
    }

    public static func decode(_ json: String) throws -> HubSyncReport {
        let d = try parseHubDict(json)
        return HubSyncReport(
            ingested: (d["ingested"] as? Int) ?? 0,
            kgTriples: (d["kgTriples"] as? Int) ?? 0,
            ragDocs: (d["ragDocs"] as? Int) ?? 0,
            durationMs: (d["durationMs"] as? Int) ?? 0
        )
    }
}

public struct HubSyncReportList: Sendable, Equatable {
    public let reports: [HubSyncReport]
    public init(reports: [HubSyncReport]) { self.reports = reports }

    public static func decode(_ json: String) throws -> HubSyncReportList {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.sync-all: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubSyncReportList(reports: arr.map(HubSyncReportList.reportFrom))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["reports"] as? [[String: Any]] {
            return HubSyncReportList(reports: arr.map(HubSyncReportList.reportFrom))
        }
        throw RemoteSkillError.malformedResult("hub.sync-all: unexpected shape")
    }

    private static func reportFrom(_ d: [String: Any]) -> HubSyncReport {
        HubSyncReport(
            ingested: (d["ingested"] as? Int) ?? 0,
            kgTriples: (d["kgTriples"] as? Int) ?? 0,
            ragDocs: (d["ragDocs"] as? Int) ?? 0,
            durationMs: (d["durationMs"] as? Int) ?? 0
        )
    }
}

// MARK: - 6. StreamStartResponse (Phase 14.3 streaming sync)

public struct HubStreamStartResponse: Sendable, Equatable {
    public let streamId: String
    public let name: String?

    public init(streamId: String, name: String? = nil) {
        self.streamId = streamId; self.name = name
    }

    public static func decode(_ json: String) throws -> HubStreamStartResponse {
        let d = try parseHubDict(json)
        guard let sid = d["streamId"] as? String, !sid.isEmpty else {
            throw RemoteSkillError.malformedResult("hub.sync-*-stream: streamId missing")
        }
        return HubStreamStartResponse(
            streamId: sid,
            name: d["name"] as? String
        )
    }
}

// MARK: - 7. Events

public struct HubEvent: Sendable, Equatable, Identifiable {
    public let id: String
    public let subtype: String
    public let title: String
    public let occurredAt: Int64
    public let adapter: String

    public init(id: String, subtype: String, title: String,
                occurredAt: Int64, adapter: String) {
        self.id = id; self.subtype = subtype; self.title = title
        self.occurredAt = occurredAt; self.adapter = adapter
    }

    internal static func from(_ d: [String: Any]) -> HubEvent {
        let source = d["source"] as? [String: Any] ?? [:]
        let content = d["content"] as? [String: Any] ?? [:]
        return HubEvent(
            id: (d["id"] as? String) ?? "",
            subtype: (d["subtype"] as? String) ?? "",
            title: (content["title"] as? String) ?? "",
            occurredAt: pickHubInt64(d["occurredAt"]) ?? 0,
            adapter: (source["adapter"] as? String) ?? "unknown"
        )
    }
}

public struct HubEventsResponse: Sendable, Equatable {
    public let events: [HubEvent]
    public init(events: [HubEvent]) { self.events = events }

    public static func decode(_ json: String) throws -> HubEventsResponse {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.query-events: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubEventsResponse(events: arr.map(HubEvent.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["events"] as? [[String: Any]] {
            return HubEventsResponse(events: arr.map(HubEvent.from))
        }
        throw RemoteSkillError.malformedResult("hub.query-events: unexpected shape")
    }
}

// MARK: - 8. Audit

public struct HubAuditRow: Sendable, Equatable, Identifiable {
    public let at: Int64
    public let action: String
    public let adapter: String?
    public let eventId: String?
    public let actor: String?
    public let context: String?

    public var id: String { "\(at)-\(eventId ?? action)" }

    public init(at: Int64, action: String, adapter: String? = nil,
                eventId: String? = nil, actor: String? = nil, context: String? = nil) {
        self.at = at; self.action = action
        self.adapter = adapter; self.eventId = eventId
        self.actor = actor; self.context = context
    }

    internal static func from(_ d: [String: Any]) -> HubAuditRow {
        HubAuditRow(
            at: pickHubInt64(d["at"]) ?? 0,
            action: (d["action"] as? String) ?? "",
            adapter: d["adapter"] as? String,
            eventId: d["eventId"] as? String,
            actor: d["actor"] as? String,
            context: d["context"] as? String
        )
    }
}

public struct HubAuditResponse: Sendable, Equatable {
    public let rows: [HubAuditRow]
    public init(rows: [HubAuditRow]) { self.rows = rows }

    public static func decode(_ json: String) throws -> HubAuditResponse {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.recent-audit: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubAuditResponse(rows: arr.map(HubAuditRow.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["rows"] as? [[String: Any]] {
            return HubAuditResponse(rows: arr.map(HubAuditRow.from))
        }
        throw RemoteSkillError.malformedResult("hub.recent-audit: unexpected shape")
    }
}

// MARK: - 9. EventDetailResponse

public struct HubEventDetailResponse: Sendable, Equatable {
    public let event: HubEvent
    public let classification: HubClassification?
    public let extraction: HubExtraction?

    public init(event: HubEvent, classification: HubClassification? = nil,
                extraction: HubExtraction? = nil) {
        self.event = event; self.classification = classification; self.extraction = extraction
    }

    public static func decode(_ json: String) throws -> HubEventDetailResponse {
        let d = try parseHubDict(json)
        let eventDict = d["event"] as? [String: Any] ?? d
        return HubEventDetailResponse(
            event: HubEvent.from(eventDict),
            classification: (d["classification"] as? [String: Any]).map(HubClassification.from),
            extraction: (d["extraction"] as? [String: Any]).map(HubExtraction.from)
        )
    }
}

public struct HubClassification: Sendable, Equatable {
    public let template: String?
    public let confidence: Double?
    public let labels: [String]

    public init(template: String? = nil, confidence: Double? = nil, labels: [String] = []) {
        self.template = template; self.confidence = confidence; self.labels = labels
    }

    internal static func from(_ d: [String: Any]) -> HubClassification {
        HubClassification(
            template: d["template"] as? String,
            confidence: d["confidence"] as? Double,
            labels: (d["labels"] as? [String]) ?? []
        )
    }
}

public struct HubExtraction: Sendable, Equatable {
    public let template: String?
    public let confidence: Double?
    public let fields: [String: String]
    public let warnings: [String]

    public init(template: String? = nil, confidence: Double? = nil,
                fields: [String: String] = [:], warnings: [String] = []) {
        self.template = template; self.confidence = confidence
        self.fields = fields; self.warnings = warnings
    }

    internal static func from(_ d: [String: Any]) -> HubExtraction {
        HubExtraction(
            template: d["template"] as? String,
            confidence: d["confidence"] as? Double,
            fields: (d["fields"] as? [String: String]) ?? [:],
            warnings: (d["warnings"] as? [String]) ?? []
        )
    }
}

// MARK: - 10. AdapterRegisterResponse (register-email / register-alipay / register-mock)

public struct HubAdapterRegisterResponse: Sendable, Equatable {
    public let name: String
    public let version: String?
    public let capabilities: [String]
    public let sensitivity: String?

    public init(name: String, version: String? = nil,
                capabilities: [String] = [], sensitivity: String? = nil) {
        self.name = name; self.version = version
        self.capabilities = capabilities; self.sensitivity = sensitivity
    }

    public static func decode(_ json: String) throws -> HubAdapterRegisterResponse {
        let d = try parseHubDict(json)
        return HubAdapterRegisterResponse(
            name: (d["name"] as? String) ?? "",
            version: d["version"] as? String,
            capabilities: (d["capabilities"] as? [String]) ?? [],
            sensitivity: d["sensitivity"] as? String
        )
    }
}

// MARK: - 11. UnregisterResponse

public struct HubUnregisterResponse: Sendable, Equatable {
    public let ok: Bool
    public let removed: String?

    public init(ok: Bool, removed: String? = nil) {
        self.ok = ok; self.removed = removed
    }

    public static func decode(_ json: String) throws -> HubUnregisterResponse {
        let d = try parseHubDict(json)
        return HubUnregisterResponse(
            ok: (d["ok"] as? Bool) ?? false,
            removed: d["removed"] as? String
        )
    }
}

// MARK: - 12. TestAuthResponse

public struct HubTestAuthResponse: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?
    public let error: String?

    public init(ok: Bool, reason: String? = nil, error: String? = nil) {
        self.ok = ok; self.reason = reason; self.error = error
    }

    public static func decode(_ json: String) throws -> HubTestAuthResponse {
        let d = try parseHubDict(json)
        return HubTestAuthResponse(
            ok: (d["ok"] as? Bool) ?? false,
            reason: d["reason"] as? String,
            error: d["error"] as? String
        )
    }
}

// MARK: - 13. EmailAccount + EmailAccountInfo + EmailAccountsResponse

/// 入参 — `registerEmail` / `testEmailAuth`。
public struct HubEmailAccount: Sendable, Equatable {
    public let provider: String        // "qq" / "gmail" / "163" / "custom"
    public let email: String
    public let authCode: String
    public let folders: [String]?
    public let imapHost: String?
    public let imapPort: Int?

    public init(provider: String, email: String, authCode: String,
                folders: [String]? = nil, imapHost: String? = nil, imapPort: Int? = nil) {
        self.provider = provider; self.email = email; self.authCode = authCode
        self.folders = folders; self.imapHost = imapHost; self.imapPort = imapPort
    }

    internal func toDict() -> [String: Any] {
        var d: [String: Any] = [
            "provider": provider, "email": email, "authCode": authCode
        ]
        if let v = folders { d["folders"] = v }
        if let v = imapHost { d["imapHost"] = v }
        if let v = imapPort { d["imapPort"] = v }
        return d
    }
}

public struct HubEmailAccountInfo: Sendable, Equatable, Identifiable {
    public let email: String
    public let provider: String
    public let folders: [String]
    public let registeredAt: Int64
    public let pdfPasswordHints: [String]

    public var id: String { email }

    public init(email: String, provider: String, folders: [String] = [],
                registeredAt: Int64 = 0, pdfPasswordHints: [String] = []) {
        self.email = email; self.provider = provider; self.folders = folders
        self.registeredAt = registeredAt; self.pdfPasswordHints = pdfPasswordHints
    }

    internal static func from(_ d: [String: Any]) -> HubEmailAccountInfo {
        HubEmailAccountInfo(
            email: (d["email"] as? String) ?? "",
            provider: (d["provider"] as? String) ?? "",
            folders: (d["folders"] as? [String]) ?? [],
            registeredAt: pickHubInt64(d["registeredAt"]) ?? 0,
            pdfPasswordHints: (d["pdfPasswordHints"] as? [String]) ?? []
        )
    }
}

public struct HubEmailAccountsResponse: Sendable, Equatable {
    public let accounts: [HubEmailAccountInfo]
    public init(accounts: [HubEmailAccountInfo]) { self.accounts = accounts }

    public static func decode(_ json: String) throws -> HubEmailAccountsResponse {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.list-email-accounts: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubEmailAccountsResponse(accounts: arr.map(HubEmailAccountInfo.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["accounts"] as? [[String: Any]] {
            return HubEmailAccountsResponse(accounts: arr.map(HubEmailAccountInfo.from))
        }
        throw RemoteSkillError.malformedResult("hub.list-email-accounts: unexpected shape")
    }
}

// MARK: - 14. AlipayAccountInfo + AlipayAccountsResponse

public struct HubAlipayAccountInfo: Sendable, Equatable, Identifiable {
    public let email: String
    public let hasZipPassword: Bool
    public let registeredAt: Int64

    public var id: String { email }

    public init(email: String, hasZipPassword: Bool = false, registeredAt: Int64 = 0) {
        self.email = email; self.hasZipPassword = hasZipPassword
        self.registeredAt = registeredAt
    }

    internal static func from(_ d: [String: Any]) -> HubAlipayAccountInfo {
        HubAlipayAccountInfo(
            email: (d["email"] as? String) ?? "",
            hasZipPassword: (d["hasZipPassword"] as? Bool) ?? false,
            registeredAt: pickHubInt64(d["registeredAt"]) ?? 0
        )
    }
}

public struct HubAlipayAccountsResponse: Sendable, Equatable {
    public let accounts: [HubAlipayAccountInfo]
    public init(accounts: [HubAlipayAccountInfo]) { self.accounts = accounts }

    public static func decode(_ json: String) throws -> HubAlipayAccountsResponse {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("hub.list-alipay-accounts: invalid utf8")
        }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return HubAlipayAccountsResponse(accounts: arr.map(HubAlipayAccountInfo.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["accounts"] as? [[String: Any]] {
            return HubAlipayAccountsResponse(accounts: arr.map(HubAlipayAccountInfo.from))
        }
        throw RemoteSkillError.malformedResult("hub.list-alipay-accounts: unexpected shape")
    }
}

// MARK: - 15. RunSkill (Phase 11 analysis)

/// `personal-data-hub.run-skill` 是动态结构 — 不同 skill 输出不同。
/// Phase 14.2 v0.1 透传 raw JSON；UI 按 skill name 分支自行解析；
/// v0.2 再加 typed sub-decoders (SpendingResult / RelationsResult 等)。
public struct HubSkillResult: Sendable, Equatable {
    public let skillName: String
    public let rawJson: String

    public init(skillName: String, rawJson: String) {
        self.skillName = skillName; self.rawJson = rawJson
    }

    public static func decode(_ json: String) throws -> HubSkillResult {
        let d = try parseHubDict(json)
        return HubSkillResult(
            skillName: (d["skill"] as? String) ?? "",
            rawJson: json
        )
    }
}

// MARK: - 共用 helpers (PDH 专用 — 与其它 module 同名 helper 隔离)

internal func parseHubDict(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8),
          let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw RemoteSkillError.malformedResult("hub response: invalid json or not object")
    }
    return dict
}

internal func pickHubInt64(_ v: Any?) -> Int64? {
    if let n = v as? Int64 { return n }
    if let n = v as? Int { return Int64(n) }
    if let n = v as? Double { return Int64(n) }
    if let s = v as? String, let n = Int64(s) { return n }
    return nil
}
