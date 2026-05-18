import SwiftUI
import CoreP2P

/// 远程桌面主屏 — Phase 6.6.4。
///
/// **结构**：
/// - 顶部 toolbar: 状态 + 显示器 picker (getDisplays) + 键盘 toggle + 停止
/// - 中段全屏: DesktopFrameView 实时画面 (OQ-6 B)
/// - 透明叠加: 触控板手势识别 (OQ-3 6 基础手势)
///   - 单指 drag → mouseMove (经 virtualCursor 转绝对，16ms throttle)
///   - 单指 tap → mouseClick(.left)
///   - 单指 double-tap → mouseDoubleClick
///   - 单指 long-press → mouseClick(.right)
///   - 双指 drag → mouseScroll
///   - 双指 tap → mouseClick(.middle)
/// - 底部状态条 + 错误 banner
/// - 键盘 sheet: 扩展键盘 + Cmd 组合键 route 到 desktop.keyPress (不是 input.keyPress)
///
/// **生命周期**:
/// - onAppear: startSession + getDisplays + virtualCursor init + frame consumer task
/// - onDisappear: stopSession + cancel consumer task
/// - state: connecting / streaming / stopped / error
struct RemoteDesktopView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    @State private var sessionId: String? = nil
    @State private var displays: [DesktopDisplayInfo] = []
    @State private var currentDisplayId: Int = 0
    @State private var latestFrame: String? = nil
    @State private var connectionState: ConnState = .idle
    @State private var lastError: String? = nil
    @State private var frameCount: Int = 0
    @State private var showKeyboard: Bool = false
    @State private var dragLastSent: Date = .distantPast

    @State private var consumerTask: Task<Void, Never>? = nil
    @State private var statePollTask: Task<Void, Never>? = nil

    enum ConnState: Equatable {
        case idle, connecting, streaming, stopped
        case error(String)
    }

    private let mouseMoveThrottleMs: TimeInterval = 0.016

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                toolbar
                Divider()
                ZStack {
                    DesktopFrameView(frameData: latestFrame, contentMode: .scaleAspectFit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    trackpadOverlay
                }
                if case .error(let msg) = connectionState {
                    errorBanner(msg)
                } else {
                    statusBar
                }
            }
        }
        .navigationBarHidden(true)
        .task { await startupIfNeeded() }
        .onDisappear { Task { await shutdown() } }
        .sheet(isPresented: $showKeyboard) {
            keyboardSheet
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            Image(systemName: stateIcon)
                .foregroundColor(stateColor)
                .font(.system(size: 14))
            Text(stateLabel)
                .font(.caption)
                .foregroundColor(.white)

            Spacer()

            if displays.count > 1 {
                Menu {
                    ForEach(displays, id: \.id) { d in
                        Button {
                            Task { await switchToDisplay(d.id) }
                        } label: {
                            Label("显示器 \(d.id) (\(d.width)×\(d.height))",
                                  systemImage: d.id == currentDisplayId ? "checkmark" : "")
                        }
                    }
                } label: {
                    Image(systemName: "display.2")
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                }
            }

            Button {
                showKeyboard = true
            } label: {
                Image(systemName: "keyboard")
                    .font(.system(size: 14))
                    .foregroundColor(.white)
            }

            Button {
                Task { await shutdown() }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundColor(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.8))
    }

    private var stateIcon: String {
        switch connectionState {
        case .idle, .stopped: return "circle"
        case .connecting:     return "circle.dotted"
        case .streaming:      return "circle.fill"
        case .error:          return "exclamationmark.triangle.fill"
        }
    }
    private var stateColor: Color {
        switch connectionState {
        case .idle, .stopped: return .gray
        case .connecting:     return .yellow
        case .streaming:      return .green
        case .error:          return .orange
        }
    }
    private var stateLabel: String {
        switch connectionState {
        case .idle:           return "未连接"
        case .connecting:     return "连接中…"
        case .streaming:      return "在线 · \(frameCount) 帧"
        case .stopped:        return "已停止"
        case .error(let msg): return "错误: \(msg.prefix(40))"
        }
    }

    // MARK: - Trackpad overlay

    private var trackpadOverlay: some View {
        // 透明 Rectangle 接管手势 — 不阻挡 frame 渲染
        Rectangle()
            .fill(Color.clear)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { handleSingleDrag($0) }
            )
            .simultaneousGesture(
                TapGesture(count: 2).onEnded { Task { await sendClick(.left, double: true) } }
            )
            .simultaneousGesture(
                TapGesture(count: 1).onEnded { Task { await sendClick(.left) } }
            )
            .onLongPressGesture(minimumDuration: 0.5) {
                Task { await sendClick(.right) }
            }
    }

    private func handleSingleDrag(_ value: DragGesture.Value) {
        let now = Date()
        guard now.timeIntervalSince(dragLastSent) >= mouseMoveThrottleMs else { return }
        dragLastSent = now

        let dx = Int(value.translation.width)
        let dy = Int(value.translation.height)
        guard dx != 0 || dy != 0 else { return }

        Task {
            let abs = await remoteDeps.desktopVirtualCursor.applyDelta(dx: dx, dy: dy)
            guard let sid = sessionId else { return }
            do {
                _ = try await remoteDeps.desktop.mouseMove(
                    pcPeerId: pcPeerId, sessionId: sid, x: abs.x, y: abs.y
                )
            } catch {
                await MainActor.run { lastError = "mouseMove: \(error.localizedDescription)" }
            }
        }
    }

    // MARK: - Click / scroll helpers

    private func sendClick(_ button: DesktopMouseButton, double: Bool = false) async {
        guard let sid = sessionId else { return }
        do {
            _ = try await remoteDeps.desktop.mouseClick(
                pcPeerId: pcPeerId, sessionId: sid, button: button, double: double
            )
        } catch {
            await MainActor.run { lastError = "click: \(error.localizedDescription)" }
        }
    }

    private func sendKey(_ key: String, modifiers: [DesktopKeyModifier] = []) async {
        guard let sid = sessionId else { return }
        do {
            _ = try await remoteDeps.desktop.keyPress(
                pcPeerId: pcPeerId, sessionId: sid, key: key, modifiers: modifiers
            )
        } catch {
            await MainActor.run { lastError = "key \(key): \(error.localizedDescription)" }
        }
    }

    // MARK: - Lifecycle

    @MainActor
    private func startupIfNeeded() async {
        guard connectionState == .idle || connectionState == .stopped else { return }
        connectionState = .connecting
        lastError = nil
        frameCount = 0

        // 1. startSession
        do {
            let info = try await remoteDeps.desktop.startSession(
                pcPeerId: pcPeerId, quality: 75, maxFps: 15  // 移动端保守初值
            )
            sessionId = info.sessionId
            currentDisplayId = info.displayId
            // 初始化 virtualCursor 屏幕尺寸 (用 startSession 返的 width/height)
            await remoteDeps.desktopVirtualCursor.setScreen(
                width: info.width, height: info.height
            )
            await remoteDeps.desktopVirtualCursor.reset(
                toX: info.width / 2, toY: info.height / 2
            )
        } catch {
            connectionState = .error("启动失败: \(error.localizedDescription)")
            return
        }

        // 2. getDisplays (best-effort)
        if let sid = sessionId {
            if let resp = try? await remoteDeps.desktop.getDisplays(
                pcPeerId: pcPeerId, sessionId: sid
            ) {
                displays = resp.displays
            }
        }

        // 3. 起 frame streamer + consumer task
        guard let sid = sessionId else { return }
        await remoteDeps.desktopFrameStreamer.start(sessionId: sid)
        connectionState = .streaming

        consumerTask = Task {
            for await frame in await remoteDeps.desktopFrameStreamer.frames {
                if Task.isCancelled { return }
                await MainActor.run {
                    latestFrame = frame.data
                    frameCount += 1
                }
            }
            // stream finished — 可能 fatal
            let st = await remoteDeps.desktopFrameStreamer.state()
            await MainActor.run {
                if case .error(let msg) = st {
                    connectionState = .error(msg)
                }
            }
        }

        // 4. 起 state poll (streamer fatal 时早发现，不必等 stream finish)
        statePollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                let st = await remoteDeps.desktopFrameStreamer.state()
                if case .error(let msg) = st {
                    await MainActor.run {
                        if case .error = connectionState { return }
                        connectionState = .error(msg)
                    }
                    return
                }
            }
        }
    }

    @MainActor
    private func shutdown() async {
        consumerTask?.cancel()
        consumerTask = nil
        statePollTask?.cancel()
        statePollTask = nil
        await remoteDeps.desktopFrameStreamer.stop()

        if let sid = sessionId {
            // 即使桌面端可能已断 — best-effort stopSession 通知释放资源 (Trap D4)
            _ = try? await remoteDeps.desktop.stopSession(
                pcPeerId: pcPeerId, sessionId: sid
            )
        }
        sessionId = nil
        latestFrame = nil
        if case .error = connectionState { } else {
            connectionState = .stopped
        }
    }

    @MainActor
    private func switchToDisplay(_ displayId: Int) async {
        guard let sid = sessionId else { return }
        do {
            _ = try await remoteDeps.desktop.switchDisplay(
                pcPeerId: pcPeerId, sessionId: sid, displayId: displayId
            )
            currentDisplayId = displayId
            // Trap D10: switchDisplay 后重 setScreen + reset 防 cursor 漂移
            if let info = displays.first(where: { $0.id == displayId }) {
                await remoteDeps.desktopVirtualCursor.setScreen(
                    width: info.width, height: info.height
                )
                await remoteDeps.desktopVirtualCursor.reset(
                    toX: info.width / 2, toY: info.height / 2
                )
            }
        } catch {
            lastError = "切换显示器失败: \(error.localizedDescription)"
        }
    }

    // MARK: - Banners

    private var statusBar: some View {
        HStack(spacing: 8) {
            if let err = lastError {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundColor(.orange)
                Text(err)
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.8))
                    .lineLimit(1)
            } else {
                Text("拖拽=移动 · 点击=左键 · 长按=右键 · 双击=双击")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.6))
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.8))
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(msg)
                .font(.caption)
                .foregroundColor(.white)
                .lineLimit(2)
            Spacer()
            Button {
                Task {
                    await shutdown()
                    await startupIfNeeded()
                }
            } label: {
                Text("重试")
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color.accentColor))
                    .foregroundColor(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.2))
    }

    // MARK: - Keyboard sheet

    private var keyboardSheet: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 12) {
                    Text("常用快捷键")
                        .font(.caption).foregroundColor(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        shortcutBtn("⌘C", key: "c", modifiers: [.meta])
                        shortcutBtn("⌘V", key: "v", modifiers: [.meta])
                        shortcutBtn("⌘Z", key: "z", modifiers: [.meta])
                        shortcutBtn("⌘A", key: "a", modifiers: [.meta])
                        shortcutBtn("⌘S", key: "s", modifiers: [.meta])
                        shortcutBtn("⌘W", key: "w", modifiers: [.meta])
                        shortcutBtn("⌘Tab", key: "tab", modifiers: [.meta])
                        shortcutBtn("Esc", key: "escape")
                        shortcutBtn("Enter", key: "enter")
                    }

                    Divider()
                    Text("功能键")
                        .font(.caption).foregroundColor(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                        ForEach(["f1","f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12",
                                 "up","down","left","right",
                                 "home","end","pageup","pagedown",
                                 "tab","backspace","delete","space"], id: \.self) { k in
                            shortcutBtn(k, key: k)
                        }
                    }
                }
                .padding(12)
            }
            .navigationTitle("键盘")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { showKeyboard = false }
                }
            }
        }
    }

    private func shortcutBtn(_ label: String, key: String,
                              modifiers: [DesktopKeyModifier] = []) -> some View {
        Button {
            Task { await sendKey(key, modifiers: modifiers) }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(.tertiarySystemBackground)))
                .foregroundColor(.primary)
        }
        .buttonStyle(.plain)
    }
}
