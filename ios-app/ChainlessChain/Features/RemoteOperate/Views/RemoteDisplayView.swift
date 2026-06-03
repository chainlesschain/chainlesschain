import SwiftUI
import CoreP2P

/// 显示器信息主屏 — Phase 6.1.7（B1 第 1 批 display skill UI 收口）。
///
/// 4 块：
/// 1. **显示器列表**（顶部，DisplaysListResponse 渲染）— 含主屏标记 + 分辨率
/// 2. **亮度调节**（getBrightness + setBrightness）— 滑条 + 实时调节
/// 3. **截屏按钮**（display.screenshot）— 截屏后保存到相册 / 显示在 sheet
/// 4. **窗口列表**（getWindowList）— 桌面活动窗口
struct RemoteDisplayView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    @State private var displays: [DisplayInfo] = []
    @State private var brightness: Double = 50
    @State private var brightnessLoading: Bool = false
    @State private var screenshotImage: String? = nil   // base64
    @State private var windows: [WindowInfo] = []
    @State private var refreshing: Bool = false
    @State private var lastError: String? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                displaysSection
                brightnessSection
                actionsSection
                windowsSection
                if let err = lastError {
                    errorBanner(err)
                }
            }
            .padding(12)
        }
        .refreshable { await loadAll() }
        .task { await loadAll() }
        .sheet(item: Binding(
            get: { screenshotImage.map { ScreenshotItem(base64: $0) } },
            set: { screenshotImage = $0?.base64 }
        )) { item in
            screenshotSheet(item)
        }
    }

    // MARK: - Sections

    private var displaysSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("显示器", icon: "display")
            if displays.isEmpty {
                placeholderCard("拖动以刷新或等待加载…")
            } else {
                ForEach(displays, id: \.id) { d in
                    displayCard(d)
                }
            }
        }
    }

    private func displayCard(_ d: DisplayInfo) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(d.label.isEmpty ? "显示器 #\(d.id)" : d.label)
                    .font(.headline)
                Spacer()
                if let isInternal = d.isInternal, isInternal {
                    Tag("内置")
                }
            }
            if let b = d.bounds {
                Text("分辨率: \(b.width) × \(b.height)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            HStack(spacing: 12) {
                Text("缩放: \(String(format: "%.1f", d.scaleFactor))x")
                    .font(.caption)
                Text("旋转: \(d.rotation)°")
                    .font(.caption)
            }
            .foregroundColor(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
    }

    private var brightnessSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("亮度", icon: "sun.max")
            HStack(spacing: 12) {
                Image(systemName: "sun.min")
                    .foregroundColor(.secondary)
                Slider(value: $brightness, in: 0...100, step: 1) { editing in
                    if !editing { Task { await applyBrightness() } }
                }
                .disabled(brightnessLoading)
                Image(systemName: "sun.max.fill")
                    .foregroundColor(.secondary)
                Text("\(Int(brightness))")
                    .font(.system(.subheadline, design: .monospaced))
                    .frame(width: 28, alignment: .trailing)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    private var actionsSection: some View {
        HStack(spacing: 8) {
            actionButton(label: "截屏", icon: "camera") {
                await takeScreenshot()
            }
            actionButton(label: "刷新", icon: "arrow.clockwise") {
                await loadAll()
            }
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
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.15)))
            .foregroundColor(.accentColor)
        }
        .disabled(refreshing)
    }

    private var windowsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("窗口 (\(windows.count))", icon: "macwindow")
            if windows.isEmpty {
                placeholderCard("无活动窗口或未加载")
            } else {
                ForEach(windows.prefix(10), id: \.id) { w in
                    windowRow(w)
                }
                if windows.count > 10 {
                    Text("… 还有 \(windows.count - 10) 个窗口")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.leading, 12)
                }
            }
        }
    }

    private func windowRow(_ w: WindowInfo) -> some View {
        HStack {
            Image(systemName: w.focused == true ? "macwindow.badge.plus" : "macwindow")
                .foregroundColor(w.focused == true ? .accentColor : .secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(w.title ?? "(无标题)")
                    .font(.subheadline)
                    .lineLimit(1)
                if let proc = w.processName {
                    Text(proc)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(.secondarySystemBackground)))
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon)
            Text(title)
                .font(.headline)
        }
        .foregroundColor(.primary)
    }

    private func placeholderCard(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(msg)
                .font(.caption)
            Spacer()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.1)))
    }

    private func screenshotSheet(_ item: ScreenshotItem) -> some View {
        NavigationView {
            ScrollView([.horizontal, .vertical]) {
                if let img = decodedImage(item.base64) {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFit()
                } else {
                    Text("截屏数据无效")
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("截屏预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { screenshotImage = nil }
                }
            }
        }
    }

    private func decodedImage(_ base64: String) -> UIImage? {
        let trimmed = base64.hasPrefix("data:") ? String(base64.split(separator: ",", maxSplits: 1).last ?? "") : base64
        guard let data = Data(base64Encoded: trimmed) else { return nil }
        return UIImage(data: data)
    }

    // MARK: - Actions

    private func loadAll() async {
        refreshing = true
        defer { refreshing = false }
        lastError = nil
        do {
            async let displaysResp = remoteDeps.display.getDisplays(pcPeerId: pcPeerId)
            async let brightnessResp = remoteDeps.display.getBrightness(pcPeerId: pcPeerId)
            async let windowsResp = remoteDeps.display.getWindowList(pcPeerId: pcPeerId)

            let d = try await displaysResp
            await MainActor.run { self.displays = d.displays }

            if let b = try? await brightnessResp, let lvl = b.brightness ?? b.level {
                await MainActor.run { self.brightness = Double(lvl) }
            }

            let w = try await windowsResp
            await MainActor.run { self.windows = w.windows }
        } catch {
            await MainActor.run { lastError = "加载失败：\(error.localizedDescription)" }
        }
    }

    private func applyBrightness() async {
        brightnessLoading = true
        defer { brightnessLoading = false }
        do {
            _ = try await remoteDeps.display.setBrightness(pcPeerId: pcPeerId, brightness: Int(brightness))
        } catch {
            await MainActor.run { lastError = "亮度设置失败：\(error.localizedDescription)" }
        }
    }

    private func takeScreenshot() async {
        do {
            let r = try await remoteDeps.display.screenshot(pcPeerId: pcPeerId, format: "png", quality: 90)
            await MainActor.run {
                if let data = r.data, !data.isEmpty {
                    self.screenshotImage = data
                } else {
                    self.lastError = "截屏返空数据 (size=\(r.size))"
                }
            }
        } catch {
            await MainActor.run { lastError = "截屏失败：\(error.localizedDescription)" }
        }
    }
}

private struct ScreenshotItem: Identifiable {
    let id = UUID()
    let base64: String
}

private struct Tag: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.accentColor.opacity(0.15)))
            .foregroundColor(.accentColor)
    }
}
