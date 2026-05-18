import SwiftUI
import CoreP2P

/// 浏览器自动化主屏 — Phase 6.2 (主屏 batch 1 — browser skill UI 收口)。
///
/// 区别于 SystemTools 内的 userBrowser tab:
/// - userBrowser (CDP) → 控用户已装 Chrome
/// - browser (本 view) → 控桌面端 Playwright/Puppeteer 启动的**内置 chromium**
///
/// 4 板块：
/// 1. **引擎状态卡** + start/stop 按钮
/// 2. **打开 URL** (browser.openUrl 含 profileName)
/// 3. **标签页列表** (listTabs + 点击 focusTab/closeTab/navigate)
/// 4. **当前 tab 操作** (screenshot + takeSnapshot + act 自然语言指令)
struct RemoteBrowserView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    @State private var engineRunning: Bool = false
    @State private var engineType: String = ""
    @State private var tabCount: Int = 0
    @State private var uptime: Int = 0
    @State private var urlInput: String = "https://example.com"
    @State private var profileInput: String = ""
    @State private var tabs: [BrowserTab] = []
    @State private var selectedTab: BrowserTab? = nil
    @State private var actInstruction: String = ""
    @State private var screenshotBase64: String? = nil
    @State private var lastResult: String? = nil
    @State private var lastError: String? = nil
    @State private var loading: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                engineSection
                openUrlSection
                tabsSection
                if selectedTab != nil {
                    tabActionsSection
                }
                if let r = lastResult { successBanner(r) }
                if let e = lastError { errorBanner(e) }
            }
            .padding(12)
        }
        .refreshable { await loadAll() }
        .task { await loadAll() }
        .sheet(item: Binding(
            get: { screenshotBase64.map { ScreenshotSheetItem(base64: $0) } },
            set: { screenshotBase64 = $0?.base64 }
        )) { item in
            screenshotSheet(item)
        }
    }

    // MARK: - 引擎

    private var engineSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("引擎", icon: "rectangle.connected.to.line.below")
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: engineRunning ? "circle.fill" : "circle")
                        .foregroundColor(engineRunning ? .green : .gray)
                    Text(engineRunning ? "Running" : "Stopped")
                        .font(.subheadline).fontWeight(.medium)
                    if !engineType.isEmpty {
                        Text("(\(engineType))").foregroundColor(.secondary).font(.caption)
                    }
                    Spacer()
                    if uptime > 0 {
                        Text("\(uptime)s").font(.caption).foregroundColor(.secondary)
                    }
                }
                HStack {
                    Text("Tabs: \(tabCount)").font(.caption).foregroundColor(.secondary)
                    Spacer()
                }
                HStack(spacing: 8) {
                    Button {
                        Task { await startEngine() }
                    } label: {
                        Label("启动", systemImage: "play.fill")
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(engineRunning || loading)

                    Button {
                        Task { await stopEngine() }
                    } label: {
                        Label("停止", systemImage: "stop.fill")
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                    .disabled(!engineRunning || loading)
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    // MARK: - 打开 URL

    private var openUrlSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("打开 URL", icon: "globe")
            VStack(spacing: 8) {
                TextField("URL", text: $urlInput)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .keyboardType(.URL)
                TextField("Profile (可选)", text: $profileInput)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                Button {
                    Task { await openUrl() }
                } label: {
                    Label("打开新标签页", systemImage: "plus.square")
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                .disabled(urlInput.isEmpty || loading)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    // MARK: - 标签页

    private var tabsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionHeader("标签页 (\(tabs.count))", icon: "rectangle.on.rectangle")
                Spacer()
                Button {
                    Task { await loadTabs() }
                } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 12))
                }
                .buttonStyle(.borderless)
            }
            if tabs.isEmpty {
                placeholderCard("无标签页 — 先启引擎 + 打开 URL")
            } else {
                ForEach(tabs, id: \.targetId) { tab in
                    tabRow(tab)
                }
            }
        }
    }

    private func tabRow(_ tab: BrowserTab) -> some View {
        Button {
            selectedTab = tab
            Task { await focusTab(tab.targetId) }
        } label: {
            HStack {
                Image(systemName: selectedTab?.targetId == tab.targetId ? "circle.inset.filled" : "circle")
                    .foregroundColor(selectedTab?.targetId == tab.targetId ? .accentColor : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tab.title ?? "(无标题)").font(.subheadline).lineLimit(1)
                    Text(tab.url).font(.caption).foregroundColor(.secondary).lineLimit(1)
                }
                Spacer()
                if tab.active {
                    Image(systemName: "star.fill").foregroundColor(.orange).font(.system(size: 10))
                }
                Button {
                    Task { await closeTab(tab.targetId) }
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(.red.opacity(0.7))
                }
                .buttonStyle(.borderless)
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color(.secondarySystemBackground)))
        }
        .buttonStyle(.plain)
    }

    // MARK: - 当前 tab 操作

    private var tabActionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("当前 tab 操作", icon: "hand.point.up.left.fill")
            VStack(alignment: .leading, spacing: 8) {
                if let t = selectedTab {
                    Text(t.url).font(.caption2).foregroundColor(.secondary).lineLimit(1)
                }
                HStack(spacing: 8) {
                    actionButton(label: "截图", icon: "camera") { await screenshot() }
                    actionButton(label: "Snapshot", icon: "doc.text.viewfinder") { await snapshot() }
                }
                Divider()
                Text("自然语言指令 (browser.act)")
                    .font(.caption).foregroundColor(.secondary)
                HStack(spacing: 8) {
                    TextField("e.g., click login button", text: $actInstruction)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit { Task { await runAct() } }
                    Button {
                        Task { await runAct() }
                    } label: {
                        Image(systemName: "play.fill").padding(8)
                    }
                    .disabled(actInstruction.isEmpty || loading)
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    @ViewBuilder
    private func actionButton(label: String, icon: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack {
                Image(systemName: icon)
                Text(label)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.15)))
            .foregroundColor(.accentColor)
        }
        .disabled(loading)
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon)
            Text(title).font(.headline)
        }
        .foregroundColor(.primary)
    }

    private func placeholderCard(_ text: String) -> some View {
        Text(text)
            .font(.caption).foregroundColor(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
    }

    private func successBanner(_ msg: String) -> some View {
        HStack {
            Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
            Text(msg).font(.caption)
            Spacer()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.green.opacity(0.1)))
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
            Text(msg).font(.caption)
            Spacer()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.1)))
    }

    private func screenshotSheet(_ item: ScreenshotSheetItem) -> some View {
        NavigationView {
            ScrollView([.horizontal, .vertical]) {
                if let data = Data(base64Encoded: item.base64),
                   let img = UIImage(data: data) {
                    Image(uiImage: img).resizable().scaledToFit()
                } else {
                    Text("无法解码截图").foregroundColor(.secondary)
                }
            }
            .navigationTitle("浏览器截图")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { screenshotBase64 = nil }
                }
            }
        }
    }

    // MARK: - Actions

    private func loadAll() async {
        await loadStatus()
        if engineRunning { await loadTabs() }
    }

    private func loadStatus() async {
        do {
            let r = try await remoteDeps.browser.getStatus(pcPeerId: pcPeerId)
            await MainActor.run {
                engineRunning = r.status.running
                engineType = r.status.browserType ?? ""
                tabCount = r.status.tabCount ?? 0
                uptime = r.status.uptimeSeconds ?? 0
            }
        } catch {
            await MainActor.run { lastError = "状态加载失败：\(error.localizedDescription)" }
        }
    }

    private func loadTabs() async {
        do {
            let r = try await remoteDeps.browser.listTabs(pcPeerId: pcPeerId)
            await MainActor.run {
                self.tabs = r.tabs
                if selectedTab == nil { selectedTab = r.tabs.first(where: { $0.active }) ?? r.tabs.first }
            }
        } catch {
            await MainActor.run { lastError = "标签页加载失败：\(error.localizedDescription)" }
        }
    }

    private func startEngine() async {
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.start(pcPeerId: pcPeerId)
            await MainActor.run {
                lastResult = r.message
                engineRunning = r.status?.running ?? true
            }
            await loadStatus()
        } catch {
            await MainActor.run { lastError = "启动失败：\(error.localizedDescription)" }
        }
    }

    private func stopEngine() async {
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.stop(pcPeerId: pcPeerId)
            await MainActor.run {
                lastResult = r.message
                engineRunning = false
                tabs = []
                selectedTab = nil
            }
        } catch {
            await MainActor.run { lastError = "停止失败：\(error.localizedDescription)" }
        }
    }

    private func openUrl() async {
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.openUrl(
                pcPeerId: pcPeerId, url: urlInput,
                profileName: profileInput.isEmpty ? nil : profileInput
            )
            await MainActor.run {
                lastResult = "已打开: \(r.title ?? r.url)"
            }
            await loadTabs()
        } catch {
            await MainActor.run { lastError = "打开失败：\(error.localizedDescription)" }
        }
    }

    private func focusTab(_ targetId: String) async {
        clearMessages()
        do {
            _ = try await remoteDeps.browser.focusTab(pcPeerId: pcPeerId, targetId: targetId)
        } catch {
            await MainActor.run { lastError = "聚焦失败：\(error.localizedDescription)" }
        }
    }

    private func closeTab(_ targetId: String) async {
        clearMessages()
        do {
            _ = try await remoteDeps.browser.closeTab(pcPeerId: pcPeerId, targetId: targetId)
            await loadTabs()
            await MainActor.run {
                if selectedTab?.targetId == targetId { selectedTab = nil }
            }
        } catch {
            await MainActor.run { lastError = "关闭失败：\(error.localizedDescription)" }
        }
    }

    private func screenshot() async {
        guard let tab = selectedTab else { return }
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.screenshot(
                pcPeerId: pcPeerId, targetId: tab.targetId, format: "png", fullPage: false
            )
            await MainActor.run {
                if !r.data.isEmpty {
                    screenshotBase64 = r.data
                } else {
                    lastError = "截图返空"
                }
            }
        } catch {
            await MainActor.run { lastError = "截图失败：\(error.localizedDescription)" }
        }
    }

    private func snapshot() async {
        guard let tab = selectedTab else { return }
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.takeSnapshot(pcPeerId: pcPeerId, targetId: tab.targetId)
            await MainActor.run {
                lastResult = "snapshotId=\(r.snapshotId ?? "-") | size=\(r.size ?? 0) bytes | format=\(r.format ?? "-")"
            }
        } catch {
            await MainActor.run { lastError = "快照失败：\(error.localizedDescription)" }
        }
    }

    private func runAct() async {
        guard let tab = selectedTab, !actInstruction.isEmpty else { return }
        loading = true; defer { loading = false }
        clearMessages()
        do {
            let r = try await remoteDeps.browser.act(
                pcPeerId: pcPeerId, targetId: tab.targetId, instruction: actInstruction
            )
            await MainActor.run {
                let act = r.action ?? "-"
                let res = r.result ?? r.error ?? "-"
                lastResult = "action=\(act) | result=\(res)"
                actInstruction = ""
            }
        } catch {
            await MainActor.run { lastError = "act 失败：\(error.localizedDescription)" }
        }
    }

    private func clearMessages() {
        lastResult = nil
        lastError = nil
    }
}

private struct ScreenshotSheetItem: Identifiable {
    let id = UUID()
    let base64: String
}
