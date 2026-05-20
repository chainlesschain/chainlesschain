import SwiftUI
import CoreP2P

// MARK: - PersonalDataHubView (container)

/// Hub 主入口 — Phase 14.2.5. 3-tab segmented (提问 / Adapter / 审计) 包三个
/// SwiftUI 子 view，镜像 Android `PersonalDataHubScreen`.
///
/// **Inner View pattern**（per memory `ios_inner_view_stateobject_pattern.md`）：
/// Outer 读 EnvironmentObject + 传 deps；Inner 在 init() 用 deps 构造 StateObject
/// VM。避免 `@EnvironmentObject` 在 init() 不可用的 SwiftUI 限制。
struct PersonalDataHubView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            commands: remoteDeps.hub,
            dispatcher: remoteDeps.hubSyncDispatcher,
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

private struct Inner: View {
    let pcPeerId: String
    let commands: PersonalDataHubCommands
    let dispatcher: HubSyncEventDispatcher
    let currentDIDProvider: () -> String?

    enum HubTab: String, CaseIterable, Identifiable {
        case ask, adapters, audit
        var id: String { rawValue }
        var label: String {
            switch self {
            case .ask: return "提问"
            case .adapters: return "Adapter"
            case .audit: return "审计"
            }
        }
    }

    @State private var selected: HubTab = .ask

    var body: some View {
        VStack(spacing: 0) {
            Picker("Tab", selection: $selected) {
                ForEach(HubTab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            Divider()

            Group {
                switch selected {
                case .ask:
                    HubAskView(
                        pcPeerId: pcPeerId, commands: commands,
                        currentDIDProvider: currentDIDProvider
                    )
                case .adapters:
                    HubAdaptersView(
                        pcPeerId: pcPeerId, commands: commands,
                        dispatcher: dispatcher,
                        currentDIDProvider: currentDIDProvider
                    )
                case .audit:
                    HubAuditView(
                        pcPeerId: pcPeerId, commands: commands,
                        currentDIDProvider: currentDIDProvider
                    )
                }
            }
        }
    }
}

// MARK: - HubAskView

private struct HubAskView: View {
    @StateObject private var vm: HubAskViewModel

    init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        currentDIDProvider: @escaping () -> String?
    ) {
        _vm = StateObject(wrappedValue: HubAskViewModel(
            pcPeerId: pcPeerId, commands: commands,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Health card 顶部
                if let h = vm.health {
                    HubHealthCard(health: h)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                }

                // Error banner
                if let err = vm.errorMessage {
                    Text(err)
                        .font(.footnote)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                }

                // Question input + submit
                VStack(alignment: .leading, spacing: 8) {
                    TextField(
                        "请输入问题，例：上月在淘宝花了多少",
                        text: Binding(
                            get: { vm.question },
                            set: { vm.onQuestionChange($0) }
                        ),
                        axis: .vertical
                    )
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)

                    HStack {
                        Spacer()
                        Button {
                            Task { await vm.submit() }
                        } label: {
                            HStack(spacing: 6) {
                                if vm.isLoading {
                                    ProgressView().scaleEffect(0.7)
                                }
                                Text(vm.isLoading ? "提问中…" : "提问")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(vm.isLoading || vm.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(.horizontal, 16)

                // Answer
                if let answer = vm.answer {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("答案").font(.headline)
                            Spacer()
                            if let llm = vm.llmName {
                                Text(llm + (vm.isLocal ? " · 本地" : " · 非本地"))
                                    .font(.caption2)
                                    .foregroundColor(vm.isLocal ? .secondary : .orange)
                            }
                        }
                        Text(answer)
                            .font(.body)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        // Citation chips
                        if !vm.citations.isEmpty {
                            Text("引用 \(vm.citations.count) 条")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            FlowingChips(items: vm.citations) { cite in
                                Button {
                                    Task { await vm.openCitation(eventId: cite.eventId) }
                                } label: {
                                    Text(cite.source ?? cite.eventId.prefix(8).description)
                                        .font(.caption)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(Color.accentColor.opacity(0.12))
                                        .cornerRadius(8)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)
                    .padding(.horizontal, 16)
                }

                Spacer(minLength: 24)
            }
        }
        .sheet(isPresented: Binding(
            get: { vm.showAcceptNonLocalSheet },
            set: { if !$0 { vm.dismissAcceptNonLocalSheet() } }
        )) {
            AcceptNonLocalSheet(
                pendingQuestion: vm.pendingNonLocalQuestion ?? "",
                onAccept: { Task { await vm.acceptNonLocalAndRetry() } },
                onDismiss: { vm.dismissAcceptNonLocalSheet() }
            )
            .presentationDetents([.medium])
        }
        .sheet(item: Binding(
            get: { vm.activeCitationDetail.map { CitationDetailWrapper(detail: $0) } },
            set: { if $0 == nil { vm.closeCitation() } }
        )) { wrapper in
            CitationDetailSheet(detail: wrapper.detail)
                .presentationDetents([.medium, .large])
        }
    }
}

private struct CitationDetailWrapper: Identifiable {
    let detail: HubEventDetailResponse
    var id: String { detail.event.id }
}

// MARK: - HubAdaptersView

private struct HubAdaptersView: View {
    @StateObject private var vm: HubAdaptersViewModel

    init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        dispatcher: HubSyncEventDispatcher,
        currentDIDProvider: @escaping () -> String?
    ) {
        _vm = StateObject(wrappedValue: HubAdaptersViewModel(
            pcPeerId: pcPeerId, commands: commands, dispatcher: dispatcher,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        List {
            if let err = vm.errorMessage {
                Section {
                    Text(err)
                        .font(.footnote)
                        .foregroundColor(.red)
                }
            }
            Section("已注册 Adapter (\(vm.adapters.count))") {
                if vm.isLoading {
                    HStack {
                        ProgressView().scaleEffect(0.7)
                        Text("加载中…").font(.footnote).foregroundColor(.secondary)
                    }
                }
                ForEach(vm.adapters) { adapter in
                    AdapterRow(
                        adapter: adapter,
                        isSyncing: vm.syncingAdapter == adapter.name,
                        progressText: vm.syncingAdapter == adapter.name
                            ? progressTextFor(event: vm.progress[adapter.name])
                            : nil,
                        lastIngested: vm.completedReports[adapter.name]?.ingested,
                        onSync: { Task { await vm.syncStream(name: adapter.name) } }
                    )
                }
            }
        }
        .refreshable { await vm.reload() }
    }
}

private struct AdapterRow: View {
    let adapter: HubAdapterMeta
    let isSyncing: Bool
    let progressText: String?
    let lastIngested: Int?
    let onSync: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(adapter.name).font(.body).bold()
                    if !adapter.sensitivity.isEmpty {
                        Text("[\(adapter.sensitivity)]")
                            .font(.caption2)
                            .foregroundColor(sensitivityColor(adapter.sensitivity))
                    }
                }
                Text("v\(adapter.version)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                if !adapter.capabilities.isEmpty {
                    Text(adapter.capabilities.joinedDot())
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                if isSyncing, let pt = progressText {
                    Text(pt)
                        .font(.caption)
                        .foregroundColor(.accentColor)
                        .padding(.top, 2)
                } else if !isSyncing, let ingested = lastIngested {
                    Text("上次 +\(ingested) 事件")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .padding(.top, 2)
                }
            }
            Spacer()
            Button(action: onSync) {
                Text(isSyncing ? "同步中…" : "同步").font(.footnote)
            }
            .buttonStyle(.bordered)
            .disabled(isSyncing)
        }
        .padding(.vertical, 4)
    }

    private func sensitivityColor(_ s: String) -> Color {
        switch s {
        case "high", "critical": return .red
        case "medium": return .orange
        default: return .secondary
        }
    }
}

/// Localize a sync progress event into a 1-line UI string (mirror Android
/// `progressTextFor` in HubAdaptersScreen.kt).
internal func progressTextFor(event: HubSyncEvent?) -> String {
    guard let ev = event else { return "同步中…" }
    switch ev.kind {
    case "connecting":
        return "连接中…"
    case "fetching":
        let count = ev.detail?["uidsScanned"]
            ?? ev.detail?["rowsRead"]
            ?? ev.detail?.values.first
        let partText = ev.partition.map { " (\($0))" } ?? ""
        return "拉取中\(partText)" + (count.map { " · \($0) 条" } ?? "")
    case "normalizing":
        let built = ev.detail?["eventsBuilt"] ?? ev.detail?.values.first
        return "归一化中" + (built.map { " · \($0) 事件" } ?? "")
    default:
        return "同步中…(\(ev.kind))"
    }
}

// MARK: - HubAuditView

private struct HubAuditView: View {
    @StateObject private var vm: HubAuditViewModel

    init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        currentDIDProvider: @escaping () -> String?
    ) {
        _vm = StateObject(wrappedValue: HubAuditViewModel(
            pcPeerId: pcPeerId, commands: commands,
            currentDIDProvider: currentDIDProvider
        ))
    }

    private let actionOptions: [(label: String, value: String?)] = [
        ("全部", nil), ("提问", "ask"), ("注入", "ingest"), ("同步", "sync")
    ]

    var body: some View {
        List {
            Section {
                Picker("操作类型", selection: Binding(
                    get: { vm.actionFilter ?? "_all" },
                    set: { newValue in
                        let actual: String? = (newValue == "_all") ? nil : newValue
                        Task { await vm.setActionFilter(actual) }
                    }
                )) {
                    ForEach(actionOptions, id: \.label) { opt in
                        Text(opt.label).tag(opt.value ?? "_all")
                    }
                }
                .pickerStyle(.segmented)
            }
            if let err = vm.errorMessage {
                Section { Text(err).foregroundColor(.red).font(.footnote) }
            }
            Section("最近 \(vm.rows.count) 条") {
                if vm.isLoading {
                    HStack {
                        ProgressView().scaleEffect(0.7)
                        Text("加载中…").font(.footnote).foregroundColor(.secondary)
                    }
                }
                ForEach(vm.rows) { row in
                    AuditRowView(row: row)
                }
            }
        }
        .refreshable { await vm.reload() }
    }
}

private struct AuditRowView: View {
    let row: HubAuditRow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(row.action).font(.body).bold()
                Spacer()
                Text(formatAt(row.at))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            if let adapter = row.adapter, !adapter.isEmpty {
                Text("adapter: \(adapter)").font(.caption).foregroundColor(.secondary)
            }
            if let actor = row.actor, !actor.isEmpty {
                Text("actor: \(actor)").font(.caption).foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func formatAt(_ ts: Int64) -> String {
        let d = Date(timeIntervalSince1970: TimeInterval(ts) / 1000.0)
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f.string(from: d)
    }
}

// MARK: - HubHealthCard

private struct HubHealthCard: View {
    let health: HubHealth

    var body: some View {
        HStack(spacing: 8) {
            statusChip(
                title: "Vault",
                ok: health.vault.ok,
                subtitle: "schema v\(health.vault.schemaVersion)"
            )
            statusChip(
                title: "LLM",
                ok: health.llm.ok && health.llm.isLocal,
                subtitle: health.llm.name.isEmpty ? nil : health.llm.name
            )
            statusChip(title: "KG", ok: health.kgSink.ok, subtitle: nil)
            statusChip(title: "RAG", ok: health.ragSink.ok, subtitle: nil)
        }
    }

    private func statusChip(title: String, ok: Bool, subtitle: String?) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Circle()
                    .fill(ok ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(title).font(.caption2).bold()
            }
            if let sub = subtitle {
                Text(sub).font(.caption2).foregroundColor(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(6)
    }
}

// MARK: - AcceptNonLocalSheet

private struct AcceptNonLocalSheet: View {
    let pendingQuestion: String
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("当前 LLM 不是本地模型").font(.headline)
            Text("桌面端 LLM 不在本地白名单（如 Anthropic / 火山 / Gemini / DeepSeek 等）。继续提问会把你的事件摘要发到该提供方。\n\n如果你接受这个风险（例：仅本次需更强模型），点「我同意」；否则建议先在桌面端切回 Ollama。")
                .font(.footnote)
                .foregroundColor(.secondary)
            Divider()
            Text("待发送的问题").font(.caption).foregroundColor(.secondary)
            Text(pendingQuestion).font(.body)
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(6)
            Spacer()
            HStack {
                Button("取消", action: onDismiss)
                    .buttonStyle(.bordered)
                Spacer()
                Button("我同意，继续", action: onAccept)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
    }
}

// MARK: - CitationDetailSheet

private struct CitationDetailSheet: View {
    let detail: HubEventDetailResponse

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(detail.event.title).font(.headline)
                HStack {
                    Text("subtype:").font(.caption).foregroundColor(.secondary)
                    Text(detail.event.subtype).font(.caption)
                }
                HStack {
                    Text("source:").font(.caption).foregroundColor(.secondary)
                    Text(detail.event.adapter).font(.caption)
                }
                if let cls = detail.classification {
                    Divider()
                    Text("Classification").font(.caption).bold()
                    if let tpl = cls.template { Text("template: \(tpl)").font(.caption) }
                    if !cls.labels.isEmpty {
                        Text("labels: " + cls.labels.joined(separator: ", ")).font(.caption)
                    }
                }
                if let ex = detail.extraction {
                    Divider()
                    Text("Extraction").font(.caption).bold()
                    if let tpl = ex.template { Text("template: \(tpl)").font(.caption) }
                    if !ex.fields.isEmpty {
                        ForEach(ex.fields.sorted(by: { $0.key < $1.key }), id: \.key) { kv in
                            Text("\(kv.key) = \(kv.value)").font(.caption)
                        }
                    }
                }
                Spacer()
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Helpers

private struct FlowingChips<T: Identifiable, Content: View>: View {
    let items: [T]
    @ViewBuilder let content: (T) -> Content

    var body: some View {
        // Simple horizontal scroll for v0.1 — true flow layout is iOS 16+ Layout API.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items) { item in
                    content(item)
                }
            }
        }
    }
}

private extension Array where Element == String {
    func joinedDot() -> String { joined(separator: " · ") }
}
