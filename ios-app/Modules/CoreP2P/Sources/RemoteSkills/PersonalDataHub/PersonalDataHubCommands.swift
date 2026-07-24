import Foundation

/// 个人数据中台 typed RPC wrapper — Phase 14.2 完整 22 method（2026-05-20）。
///
/// 镜像 Android `PersonalDataHubCommands.kt`（Phase 14.1 已落，22 method 1:1 对齐）。
/// 全部 method 名走 **kebab-case**（`personal-data-hub.list-adapters` 等）— 与
/// 桌面 `personal-data-hub-protocol.js` 注册的 dot-style topic 完全对齐。
/// Android Phase 14.1 真踩过 camelCase / kebab-case mismatch 17/22 method 在
/// 首调时 404；本端自始即用 kebab-case，docs/internal/hidden-risk-traps.md #17。
///
/// 复用 `invokeAndDecode` 模板 — KnowledgeCommands / ExtensionCommands 同模式
/// (method ≥ 10 时统一 helper，per memory `ios_remote_extension_phase6_7`)。
///
/// **隐私 Gate 提示**：`ask` 在桌面端被拒（非本地 LLM 且无 acceptNonLocal）时，
/// 桌面侧直接 return `{error: "Non-local LLM blocked — pass options.acceptNonLocal=true to override"}`。
/// iOS ViewModel 需识别该 errorMessage substring 触发 AcceptNonLocalDialog
/// （镜像 Android Phase 14.1 HubAskViewModel 隐私 gate 三态路径）。
public actor PersonalDataHubCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - 1. Q&A

    /// 自然语言提问。隐私 gate 在桌面端执行。
    public func ask(
        pcPeerId: String,
        question: String,
        acceptNonLocal: Bool? = nil,
        useRag: Bool? = nil,
        topK: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> HubAskResult {
        guard !question.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.ask: question empty")
        }
        var options: [String: Any] = [:]
        if let v = acceptNonLocal { options["acceptNonLocal"] = v }
        if let v = useRag { options["useRag"] = v }
        if let v = topK { options["topK"] = v }
        var params: [String: Any] = ["question": question]
        if !options.isEmpty { params["options"] = options }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.ask",
            params: params, mobileDid: mobileDid,
            decoder: HubAskResult.decode
        )
    }

    // MARK: - 2. Health / Stats

    public func health(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> HubHealth {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.health",
            params: [:], mobileDid: mobileDid, decoder: HubHealth.decode
        )
    }

    public func stats(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> HubStats {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.stats",
            params: [:], mobileDid: mobileDid, decoder: HubStats.decode
        )
    }

    // MARK: - 3. Adapters

    public func listAdapters(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> HubAdaptersResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.list-adapters",
            params: [:], mobileDid: mobileDid, decoder: HubAdaptersResponse.decode
        )
    }

    /// 触发指定 adapter 增量同步。**Mutating** — 桌面侧走 ApprovalGate (privileged
    /// 走 Approval UI per Phase 14 design §5)；iOS UI 调前应弹二次确认。
    public func syncAdapter(
        pcPeerId: String, name: String,
        options: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubSyncReport {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.syncAdapter: name empty")
        }
        var params: [String: Any] = ["name": name]
        if let opts = options, !opts.isEmpty { params["options"] = opts }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.sync-adapter",
            params: params, mobileDid: mobileDid,
            decoder: HubSyncReport.decode
        )
    }

    /// 全部已注册 Adapter 并发同步。**Mutating**。
    public func syncAll(
        pcPeerId: String,
        options: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubSyncReportList {
        var params: [String: Any] = [:]
        if let opts = options, !opts.isEmpty { params["options"] = opts }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.sync-all",
            params: params, mobileDid: mobileDid,
            decoder: HubSyncReportList.decode
        )
    }

    /// 带进度推送的单 Adapter 同步（Phase 14.3）。返回 streamId 后通过事件流订阅
    /// `personal-data-hub.sync.progress`（dispatcher 接事件用，Phase 14.3 实现）。
    public func syncAdapterStream(
        pcPeerId: String, name: String,
        options: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubStreamStartResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.syncAdapterStream: name empty")
        }
        var params: [String: Any] = ["name": name]
        if let opts = options, !opts.isEmpty { params["options"] = opts }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.sync-adapter-stream",
            params: params, mobileDid: mobileDid,
            decoder: HubStreamStartResponse.decode
        )
    }

    /// 全 Adapter 同步带进度推送。
    public func syncAllStream(
        pcPeerId: String,
        options: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubStreamStartResponse {
        var params: [String: Any] = [:]
        if let opts = options, !opts.isEmpty { params["options"] = opts }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.sync-all-stream",
            params: params, mobileDid: mobileDid,
            decoder: HubStreamStartResponse.decode
        )
    }

    // MARK: - 4. Events / Audit

    /// 按 subtype + 时间窗 + actor + adapter 过滤事件。**只读**。
    public func queryEvents(
        pcPeerId: String,
        subtype: String? = nil,
        since: Int64? = nil,
        until: Int64? = nil,
        actor: String? = nil,
        adapter: String? = nil,
        limit: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> HubEventsResponse {
        var params: [String: Any] = [:]
        if let v = subtype { params["subtype"] = v }
        if let v = since { params["since"] = v }
        if let v = until { params["until"] = v }
        if let v = actor { params["actor"] = v }
        if let v = adapter { params["adapter"] = v }
        if let v = limit { params["limit"] = v }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.query-events",
            params: params, mobileDid: mobileDid,
            decoder: HubEventsResponse.decode
        )
    }

    /// 反查最近审计日志。action filter 可 ingest / ask / sync / register / unregister。
    public func recentAudit(
        pcPeerId: String,
        since: Int64? = nil,
        action: String? = nil,
        limit: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> HubAuditResponse {
        var params: [String: Any] = [:]
        if let v = since { params["since"] = v }
        if let v = action { params["action"] = v }
        if let v = limit { params["limit"] = v }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.recent-audit",
            params: params, mobileDid: mobileDid,
            decoder: HubAuditResponse.decode
        )
    }

    /// 按 eventId 取单事件详情（含 classification / extraction）。**只读**。
    public func eventDetail(
        pcPeerId: String, eventId: String,
        mobileDid: String? = nil
    ) async throws -> HubEventDetailResponse {
        guard !eventId.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.eventDetail: eventId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.event-detail",
            params: ["eventId": eventId], mobileDid: mobileDid,
            decoder: HubEventDetailResponse.decode
        )
    }

    // MARK: - 5. Email Adapter 管理 (6 methods, Privileged)

    /// 注册 IMAP 邮箱（持久化授权码）。**Privileged** — 桌面端二次 ApprovalUI。
    public func registerEmail(
        pcPeerId: String,
        account: HubEmailAccount,
        opts: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubAdapterRegisterResponse {
        guard !account.email.isEmpty, !account.authCode.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.registerEmail: email/authCode empty")
        }
        var params: [String: Any] = ["account": account.toDict()]
        if let o = opts, !o.isEmpty { params["opts"] = o }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.register-email",
            params: params, mobileDid: mobileDid,
            decoder: HubAdapterRegisterResponse.decode
        )
    }

    /// Activate a persisted email account without resubmitting its auth code.
    public func activateEmail(
        pcPeerId: String, email: String,
        mobileDid: String? = nil
    ) async throws -> HubAdapterRegisterResponse {
        guard !email.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.activateEmail: email empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.activate-email",
            params: ["email": email], mobileDid: mobileDid,
            decoder: HubAdapterRegisterResponse.decode
        )
    }

    /// 注销邮箱配置（vault 数据保留）。**Privileged**。
    public func unregisterEmail(
        pcPeerId: String, email: String,
        mobileDid: String? = nil
    ) async throws -> HubUnregisterResponse {
        guard !email.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.unregisterEmail: email empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.unregister-email",
            params: ["email": email], mobileDid: mobileDid,
            decoder: HubUnregisterResponse.decode
        )
    }

    /// 测试 IMAP 授权码（不持久化）。
    public func testEmailAuth(
        pcPeerId: String,
        account: HubEmailAccount,
        mobileDid: String? = nil
    ) async throws -> HubTestAuthResponse {
        guard !account.email.isEmpty, !account.authCode.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.testEmailAuth: email/authCode empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.test-email-auth",
            params: ["account": account.toDict()], mobileDid: mobileDid,
            decoder: HubTestAuthResponse.decode
        )
    }

    /// 枚举已注册邮箱。**只读**。
    public func listEmailAccounts(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> HubEmailAccountsResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.list-email-accounts",
            params: [:], mobileDid: mobileDid,
            decoder: HubEmailAccountsResponse.decode
        )
    }

    // MARK: - 6. Alipay Adapter 管理 (5 methods)

    /// 注册支付宝账单导入账号（含 ZIP 密码）。**Privileged**。
    public func registerAlipay(
        pcPeerId: String,
        email: String,
        zipPassword: String? = nil,
        opts: [String: Any]? = nil,
        mobileDid: String? = nil
    ) async throws -> HubAdapterRegisterResponse {
        guard !email.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.registerAlipay: email empty")
        }
        var account: [String: Any] = ["email": email]
        if let z = zipPassword { account["zipPassword"] = z }
        var params: [String: Any] = ["account": account]
        if let o = opts, !o.isEmpty { params["opts"] = o }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.register-alipay",
            params: params, mobileDid: mobileDid,
            decoder: HubAdapterRegisterResponse.decode
        )
    }

    /// Activate a persisted Alipay account without rewriting its credentials.
    public func activateAlipay(
        pcPeerId: String, email: String,
        mobileDid: String? = nil
    ) async throws -> HubAdapterRegisterResponse {
        guard !email.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.activateAlipay: email empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.activate-alipay",
            params: ["email": email], mobileDid: mobileDid,
            decoder: HubAdapterRegisterResponse.decode
        )
    }

    /// 注销支付宝配置。**Privileged**。
    public func unregisterAlipay(
        pcPeerId: String, email: String,
        mobileDid: String? = nil
    ) async throws -> HubUnregisterResponse {
        guard !email.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.unregisterAlipay: email empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.unregister-alipay",
            params: ["email": email], mobileDid: mobileDid,
            decoder: HubUnregisterResponse.decode
        )
    }

    /// 导入支付宝 ZIP 或 CSV 账单。**Mutating**。
    public func importAlipayBill(
        pcPeerId: String,
        zipPath: String? = nil,
        csvPath: String? = nil,
        zipPassword: String? = nil,
        mobileDid: String? = nil
    ) async throws -> HubSyncReport {
        guard zipPath != nil || csvPath != nil else {
            throw RemoteSkillError.invalidArgument("hub.importAlipayBill: needs zipPath or csvPath")
        }
        var params: [String: Any] = [:]
        if let v = zipPath { params["zipPath"] = v }
        if let v = csvPath { params["csvPath"] = v }
        if let v = zipPassword { params["zipPassword"] = v }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.import-alipay-bill",
            params: params, mobileDid: mobileDid,
            decoder: HubSyncReport.decode
        )
    }

    /// 枚举已注册支付宝账号。**只读**。
    public func listAlipayAccounts(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> HubAlipayAccountsResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.list-alipay-accounts",
            params: [:], mobileDid: mobileDid,
            decoder: HubAlipayAccountsResponse.decode
        )
    }

    // MARK: - 7. Dev / 通用 (2 method)

    /// 注册 MockAdapter 用于开发/smoke（仅 dev）。
    public func registerMock(
        pcPeerId: String,
        name: String? = nil,
        count: Int? = nil,
        seed: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> HubAdapterRegisterResponse {
        var params: [String: Any] = [:]
        if let v = name { params["name"] = v }
        if let v = count { params["count"] = v }
        if let v = seed { params["seed"] = v }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.register-mock",
            params: params, mobileDid: mobileDid,
            decoder: HubAdapterRegisterResponse.decode
        )
    }

    /// 通用 Adapter 注销。**Privileged**。
    public func unregister(
        pcPeerId: String, name: String,
        mobileDid: String? = nil
    ) async throws -> HubUnregisterResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.unregister: name empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.unregister",
            params: ["name": name], mobileDid: mobileDid,
            decoder: HubUnregisterResponse.decode
        )
    }

    // MARK: - 8. Analysis Skills (Phase 11)

    /// 跑内置分析 skill — `analysis.spending / relations / footprint / interests / timeline`。
    /// 设计：`docs/design/Personal_Data_Hub_Analysis_Skills.md`。
    /// Phase 14.2 v0.1 透传 raw JSON；v0.2 加 typed sub-decoders。
    public func runSkill(
        pcPeerId: String, name: String,
        options: [String: Any] = [:],
        mobileDid: String? = nil
    ) async throws -> HubSkillResult {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("hub.runSkill: name empty")
        }
        let params: [String: Any] = ["name": name, "options": options]
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "personal-data-hub.run-skill",
            params: params, mobileDid: mobileDid,
            decoder: HubSkillResult.decode
        )
    }

    // MARK: - 共用 invokeAndDecode helper

    private func invokeAndDecode<T>(
        pcPeerId: String, method: String,
        params: [String: Any], mobileDid: String?,
        decoder: (String) throws -> T
    ) async throws -> T {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId, method: method,
            params: params, mobileDid: mobileDid
        )
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
