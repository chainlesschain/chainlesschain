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
    public let adapter: String?
    public let status: String?
    public let rawCount: Int
    public let archivedRawCount: Int
    public let archiveFailureCount: Int
    public let entityCounts: [String: Int]
    public let invalidCount: Int
    public let kgTripleCount: Int
    public let ragDocCount: Int
    public let error: String?
    public let errors: [String]
    public let watermark: String?
    public let watermarkDeferred: Bool
    public let checkpointCommitted: Bool?
    public let pageBudget: Int?
    public let nextPageBudget: Int?
    public let scanDeferredCount: Int
    public let watermarkLookbackMs: Int
    public let collectionSinceWatermark: String?
    public let attemptCount: Int
    public let retryCount: Int
    public let totalRetryDelayMs: Int
    public let retryExhausted: Bool
    public let retryAfterMs: Int?
    public let rateLimitReason: String?
    public let rateLimitRemainingMinute: Int?
    public let rateLimitRemainingDay: Int?
    public let sourceRequestCount: Int
    public let sourceRequestThrottleMs: Int
    public let sourceRequestRateLimitRemainingMinute: Int?
    public let sourceRequestRateLimitRemainingDay: Int?
    public let skipReason: String?
    public let skipMessage: String?

    // Compatibility projections used by existing views and older peers.
    public let ingested: Int
    public let kgTriples: Int
    public let ragDocs: Int
    public let durationMs: Int

    public init(
        ingested: Int = 0,
        kgTriples: Int = 0,
        ragDocs: Int = 0,
        durationMs: Int = 0,
        adapter: String? = nil,
        status: String? = nil,
        rawCount: Int = 0,
        archivedRawCount: Int = 0,
        archiveFailureCount: Int = 0,
        entityCounts: [String: Int] = [:],
        invalidCount: Int = 0,
        kgTripleCount: Int? = nil,
        ragDocCount: Int? = nil,
        error: String? = nil,
        errors: [String] = [],
        watermark: String? = nil,
        watermarkDeferred: Bool = false,
        checkpointCommitted: Bool? = nil,
        pageBudget: Int? = nil,
        nextPageBudget: Int? = nil,
        scanDeferredCount: Int = 0,
        watermarkLookbackMs: Int = 0,
        collectionSinceWatermark: String? = nil,
        attemptCount: Int = 0,
        retryCount: Int = 0,
        totalRetryDelayMs: Int = 0,
        retryExhausted: Bool = false,
        retryAfterMs: Int? = nil,
        rateLimitReason: String? = nil,
        rateLimitRemainingMinute: Int? = nil,
        rateLimitRemainingDay: Int? = nil,
        sourceRequestCount: Int = 0,
        sourceRequestThrottleMs: Int = 0,
        sourceRequestRateLimitRemainingMinute: Int? = nil,
        sourceRequestRateLimitRemainingDay: Int? = nil,
        skipReason: String? = nil,
        skipMessage: String? = nil
    ) {
        let canonicalTotal = Self.entityTotal(entityCounts)
        let effectiveKgTriples = kgTripleCount ?? kgTriples
        let effectiveRagDocs = ragDocCount ?? ragDocs
        self.adapter = adapter
        self.status = status
        self.rawCount = rawCount
        self.archivedRawCount = archivedRawCount
        self.archiveFailureCount = archiveFailureCount
        self.entityCounts = entityCounts
        self.invalidCount = invalidCount
        self.kgTripleCount = effectiveKgTriples
        self.ragDocCount = effectiveRagDocs
        self.error = error
        self.errors = errors
        self.watermark = watermark
        self.watermarkDeferred = watermarkDeferred
        self.checkpointCommitted = checkpointCommitted
        self.pageBudget = pageBudget
        self.nextPageBudget = nextPageBudget
        self.scanDeferredCount = scanDeferredCount
        self.watermarkLookbackMs = watermarkLookbackMs
        self.collectionSinceWatermark = collectionSinceWatermark
        self.attemptCount = attemptCount
        self.retryCount = retryCount
        self.totalRetryDelayMs = totalRetryDelayMs
        self.retryExhausted = retryExhausted
        self.retryAfterMs = retryAfterMs
        self.rateLimitReason = rateLimitReason
        self.rateLimitRemainingMinute = rateLimitRemainingMinute
        self.rateLimitRemainingDay = rateLimitRemainingDay
        self.sourceRequestCount = sourceRequestCount
        self.sourceRequestThrottleMs = sourceRequestThrottleMs
        self.sourceRequestRateLimitRemainingMinute = sourceRequestRateLimitRemainingMinute
        self.sourceRequestRateLimitRemainingDay = sourceRequestRateLimitRemainingDay
        self.skipReason = skipReason
        self.skipMessage = skipMessage
        self.ingested = entityCounts.isEmpty ? ingested : canonicalTotal
        self.kgTriples = effectiveKgTriples
        self.ragDocs = effectiveRagDocs
        self.durationMs = durationMs
    }

    public var isSkipped: Bool { status == "skipped" }

    public var isPartial: Bool {
        watermarkDeferred ||
            archiveFailureCount > 0 ||
            checkpointCommitted == false ||
            invalidCount > 0 ||
            (rawCount > 0 && ingested == 0)
    }

    public var isSuccessful: Bool {
        guard let status else { return error == nil && errors.isEmpty }
        return status == "ok"
    }

    public var failureMessage: String {
        error ?? skipMessage ?? errors.first ?? status ?? "unknown sync failure"
    }

    public static func decode(_ json: String) throws -> HubSyncReport {
        from(try parseHubDict(json))
    }

    internal static func from(_ d: [String: Any]) -> HubSyncReport {
        let countsRaw = d["entityCounts"] as? [String: Any] ?? [:]
        let counts = countsRaw.reduce(into: [String: Int]()) { result, entry in
            if let value = pickHubInt64(entry.value) {
                result[entry.key] = Int(value)
            }
        }
        return HubSyncReport(
            ingested: Int(pickHubInt64(d["ingested"]) ?? 0),
            kgTriples: Int(pickHubInt64(d["kgTriples"]) ?? 0),
            ragDocs: Int(pickHubInt64(d["ragDocs"]) ?? 0),
            durationMs: Int(pickHubInt64(d["durationMs"]) ?? 0),
            adapter: d["adapter"] as? String,
            status: d["status"] as? String,
            rawCount: Int(pickHubInt64(d["rawCount"]) ?? 0),
            archivedRawCount: Int(pickHubInt64(d["archivedRawCount"]) ?? 0),
            archiveFailureCount: Int(pickHubInt64(d["archiveFailureCount"]) ?? 0),
            entityCounts: counts,
            invalidCount: Int(pickHubInt64(d["invalidCount"]) ?? 0),
            kgTripleCount: pickHubInt64(d["kgTripleCount"]).map { Int($0) },
            ragDocCount: pickHubInt64(d["ragDocCount"]).map { Int($0) },
            error: d["error"] as? String,
            errors: d["errors"] as? [String] ?? [],
            watermark: d["watermark"] as? String,
            watermarkDeferred: d["watermarkDeferred"] as? Bool ?? false,
            checkpointCommitted: d["checkpointCommitted"] as? Bool,
            pageBudget: pickHubInt64(d["pageBudget"]).map { Int($0) },
            nextPageBudget: pickHubInt64(d["nextPageBudget"]).map { Int($0) },
            scanDeferredCount: Int(pickHubInt64(d["scanDeferredCount"]) ?? 0),
            watermarkLookbackMs: Int(pickHubInt64(d["watermarkLookbackMs"]) ?? 0),
            collectionSinceWatermark: d["collectionSinceWatermark"] as? String,
            attemptCount: Int(pickHubInt64(d["attemptCount"]) ?? 0),
            retryCount: Int(pickHubInt64(d["retryCount"]) ?? 0),
            totalRetryDelayMs: Int(pickHubInt64(d["totalRetryDelayMs"]) ?? 0),
            retryExhausted: d["retryExhausted"] as? Bool ?? false,
            retryAfterMs: pickHubInt64(d["retryAfterMs"]).map { Int($0) },
            rateLimitReason: d["rateLimitReason"] as? String,
            rateLimitRemainingMinute: pickHubInt64(d["rateLimitRemainingMinute"]).map { Int($0) },
            rateLimitRemainingDay: pickHubInt64(d["rateLimitRemainingDay"]).map { Int($0) },
            sourceRequestCount: Int(pickHubInt64(d["sourceRequestCount"]) ?? 0),
            sourceRequestThrottleMs: Int(pickHubInt64(d["sourceRequestThrottleMs"]) ?? 0),
            sourceRequestRateLimitRemainingMinute: pickHubInt64(d["sourceRequestRateLimitRemainingMinute"]).map { Int($0) },
            sourceRequestRateLimitRemainingDay: pickHubInt64(d["sourceRequestRateLimitRemainingDay"]).map { Int($0) },
            skipReason: d["skipReason"] as? String,
            skipMessage: d["skipMessage"] as? String
        )
    }

    private static func entityTotal(_ counts: [String: Int]) -> Int {
        ["events", "persons", "places", "items", "topics"]
            .reduce(0) { $0 + (counts[$1] ?? 0) }
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
            return HubSyncReportList(reports: arr.map(HubSyncReport.from))
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let arr = obj["reports"] as? [[String: Any]] {
            return HubSyncReportList(reports: arr.map(HubSyncReport.from))
        }
        throw RemoteSkillError.malformedResult("hub.sync-all: unexpected shape")
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
    public let active: Bool

    public var id: String { email }

    public init(email: String, provider: String, folders: [String] = [],
                registeredAt: Int64 = 0, pdfPasswordHints: [String] = [],
                active: Bool = false) {
        self.email = email; self.provider = provider; self.folders = folders
        self.registeredAt = registeredAt; self.pdfPasswordHints = pdfPasswordHints
        self.active = active
    }

    internal static func from(_ d: [String: Any]) -> HubEmailAccountInfo {
        HubEmailAccountInfo(
            email: (d["email"] as? String) ?? "",
            provider: (d["provider"] as? String) ?? "",
            folders: (d["folders"] as? [String]) ?? [],
            registeredAt: pickHubInt64(d["registeredAt"]) ?? 0,
            pdfPasswordHints: (d["pdfPasswordHints"] as? [String]) ?? [],
            active: (d["active"] as? Bool) ?? false
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
    public let active: Bool

    public var id: String { email }

    public init(email: String, hasZipPassword: Bool = false,
                registeredAt: Int64 = 0, active: Bool = false) {
        self.email = email; self.hasZipPassword = hasZipPassword
        self.registeredAt = registeredAt
        self.active = active
    }

    internal static func from(_ d: [String: Any]) -> HubAlipayAccountInfo {
        HubAlipayAccountInfo(
            email: (d["email"] as? String) ?? "",
            hasZipPassword: (d["hasZipPassword"] as? Bool) ?? false,
            registeredAt: pickHubInt64(d["registeredAt"]) ?? 0,
            active: (d["active"] as? Bool) ?? false
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

// MARK: - 16. HubSyncEvent (Phase 14.3.2 streaming events)

/// Sync progress event from desktop's `hub.registry.onSyncEvent` forwarder.
/// 5 kinds (`connecting` / `fetching` / `normalizing` / `done` / `error`) per
/// Android `HubSyncEvent`. desktop `route-mobile.runSyncStream` (commit
/// `badc1e108`) emits this as JSON-RPC notification wrapped in
/// `chainlesschain:event:notification` envelope.
public struct HubSyncEvent: Sendable, Equatable {
    public let kind: String
    public let adapter: String
    public let partition: String?
    public let detail: [String: Int64]?
    public let report: HubSyncReport?
    public let reports: [HubSyncReport]?
    public let message: String?
    public let error: String?
    public let attemptCount: Int?
    public let nextAttempt: Int?
    public let retryCount: Int?
    public let delayMs: Int?
    public let retryAfterMs: Int?
    public let reason: String?
    public let sourceRequestCount: Int?
    public let operation: String?
    public let page: Int?

    public init(
        kind: String,
        adapter: String,
        partition: String? = nil,
        detail: [String: Int64]? = nil,
        report: HubSyncReport? = nil,
        reports: [HubSyncReport]? = nil,
        message: String? = nil,
        error: String? = nil,
        attemptCount: Int? = nil,
        nextAttempt: Int? = nil,
        retryCount: Int? = nil,
        delayMs: Int? = nil,
        retryAfterMs: Int? = nil,
        reason: String? = nil,
        sourceRequestCount: Int? = nil,
        operation: String? = nil,
        page: Int? = nil
    ) {
        self.kind = kind; self.adapter = adapter
        self.partition = partition; self.detail = detail
        self.report = report; self.reports = reports; self.message = message
        self.error = error; self.attemptCount = attemptCount
        self.nextAttempt = nextAttempt; self.retryCount = retryCount
        self.delayMs = delayMs; self.retryAfterMs = retryAfterMs
        self.reason = reason
        self.sourceRequestCount = sourceRequestCount
        self.operation = operation
        self.page = page
    }

    /// Parse from the raw envelope wire format. Desktop sends:
    /// ```
    /// {
    ///   "type": "chainlesschain:event:notification",
    ///   "payload": {
    ///     "jsonrpc": "2.0",
    ///     "method": "personal-data-hub.sync.progress",
    ///     "params": { kind, adapter, partition?, detail?, report?, message? }
    ///   }
    /// }
    /// ```
    /// Returns nil for non-PDH-sync events / malformed payloads — dispatcher
    /// silent drops nil. Empty `kind` or `adapter` also returns nil.
    public static func parseFromEnvelope(_ raw: String) -> HubSyncEvent? {
        guard let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard (dict["type"] as? String) == "chainlesschain:event:notification" else {
            return nil
        }
        guard let payload = dict["payload"] as? [String: Any] else { return nil }
        guard (payload["method"] as? String) == "personal-data-hub.sync.progress" else {
            return nil
        }
        guard let params = payload["params"] as? [String: Any] else { return nil }
        guard let kind = params["kind"] as? String, !kind.isEmpty,
              let adapter = params["adapter"] as? String, !adapter.isEmpty else {
            return nil
        }
        let partition = params["partition"] as? String
        let detailRaw = params["detail"] as? [String: Any]
        let detail = detailRaw?.compactMapValues(pickHubInt64)
        let report: HubSyncReport? = {
            guard let r = params["report"] as? [String: Any] else { return nil }
            return HubSyncReport.from(r)
        }()
        let reports = (params["reports"] as? [[String: Any]])?.map(HubSyncReport.from)
        let message = params["message"] as? String
        return HubSyncEvent(
            kind: kind,
            adapter: adapter,
            partition: partition,
            detail: detail?.isEmpty == false ? detail : nil,
            report: report,
            reports: reports,
            message: message,
            error: params["error"] as? String,
            attemptCount: pickHubInt64(params["attemptCount"]).map { Int($0) },
            nextAttempt: pickHubInt64(params["nextAttempt"]).map { Int($0) },
            retryCount: pickHubInt64(params["retryCount"]).map { Int($0) },
            delayMs: pickHubInt64(params["delayMs"]).map { Int($0) },
            retryAfterMs: pickHubInt64(params["retryAfterMs"]).map { Int($0) },
            reason: params["reason"] as? String,
            sourceRequestCount: pickHubInt64(params["sourceRequestCount"]).map { Int($0) },
            operation: params["operation"] as? String,
            page: pickHubInt64(params["page"]).map { Int($0) }
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
