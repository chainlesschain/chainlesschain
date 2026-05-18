import SwiftUI
import CoreP2P

/// 远程键鼠输入主屏 — Phase 6.1.7（B1 第 1 批 input skill UI 收口）。
///
/// **3 板块**：
/// 1. **触控板区**（占主屏中段）— DragGesture 累积 delta → InputCommands.mouseMove(relative:true)，
///    单击触发 mouseClick(.left)，双击触发 mouseDoubleClick。
/// 2. **虚拟键盘 quick buttons**（trackpad 下方）— 常用快捷键 (Cmd+C/V/Z/A/S, Enter, Esc, Tab)
///    一键触发；长按打开扩展键盘 sheet。
/// 3. **文本输入条**（底部）— TextField + send 按钮触发 InputCommands.typeText。
///
/// **节流策略**：trackpad mouseMove 用 16ms throttle (60 FPS UI → 60 FPS RPC) — 这与
/// Phase 6 Plan §6.6 提到的鼠标流 batching protocol 是同一问题。v0.1 不做协议层 batching，
/// UI 端 throttle 控制即可应付一般用法；高频拖拽 (drag-and-drop) 留 Phase 6.6 desktop skill。
struct RemoteInputView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    @State private var lastSentAt: Date = .distantPast
    @State private var lastDragLocation: CGPoint = .zero
    @State private var typeText: String = ""
    @State private var statusMessage: String = ""
    @State private var statusIsError: Bool = false
    @State private var showExtendedKeys: Bool = false

    /// 16ms throttle = 60 FPS RPC ceiling.
    private let throttleMs: TimeInterval = 0.016

    var body: some View {
        VStack(spacing: 0) {
            trackpadArea
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
                .padding(.horizontal, 12)
                .padding(.top, 12)

            quickKeyBar
                .padding(.vertical, 8)

            textInputBar
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

            if !statusMessage.isEmpty {
                statusFooter
            }
        }
        .sheet(isPresented: $showExtendedKeys) {
            extendedKeyboardSheet
        }
    }

    // MARK: - Trackpad

    private var trackpadArea: some View {
        ZStack {
            VStack(spacing: 4) {
                Image(systemName: "hand.tap")
                    .font(.system(size: 36))
                    .foregroundColor(.secondary.opacity(0.4))
                Text("触控板")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("拖拽 = 移动 / 单击 = 左键 / 双击 = 双击")
                    .font(.caption2)
                    .foregroundColor(.secondary.opacity(0.7))
            }
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1)
                .onChanged { value in
                    handleDrag(value)
                }
                .onEnded { _ in
                    lastDragLocation = .zero
                }
        )
        .simultaneousGesture(
            TapGesture(count: 2).onEnded {
                Task { await sendMouseDoubleClick() }
            }
        )
        .simultaneousGesture(
            TapGesture(count: 1).onEnded {
                Task { await sendMouseClick(.left) }
            }
        )
        .onLongPressGesture(minimumDuration: 0.5) {
            Task { await sendMouseClick(.right) }
        }
    }

    private func handleDrag(_ value: DragGesture.Value) {
        let now = Date()
        guard now.timeIntervalSince(lastSentAt) >= throttleMs else { return }

        let dx: Int
        let dy: Int
        if lastDragLocation == .zero {
            dx = 0; dy = 0
        } else {
            dx = Int(value.location.x - lastDragLocation.x)
            dy = Int(value.location.y - lastDragLocation.y)
        }
        lastDragLocation = value.location
        lastSentAt = now

        guard abs(dx) > 0 || abs(dy) > 0 else { return }

        Task {
            do {
                _ = try await remoteDeps.input.mouseMove(
                    pcPeerId: pcPeerId, x: dx, y: dy, relative: true
                )
            } catch {
                await MainActor.run { showStatus(error: error, op: "mouseMove") }
            }
        }
    }

    // MARK: - Quick key bar

    private var quickKeyBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                keyButton("⌘C", action: { try await remoteDeps.input.copy(pcPeerId: pcPeerId) })
                keyButton("⌘V", action: { try await remoteDeps.input.paste(pcPeerId: pcPeerId) })
                keyButton("⌘Z", action: { try await remoteDeps.input.undo(pcPeerId: pcPeerId) })
                keyButton("⌘A", action: { try await remoteDeps.input.selectAll(pcPeerId: pcPeerId) })
                keyButton("⌘S", action: { try await remoteDeps.input.save(pcPeerId: pcPeerId) })
                Divider().frame(height: 22)
                keyButton("Enter", action: { try await remoteDeps.input.sendKeyPress(pcPeerId: pcPeerId, key: "enter") })
                keyButton("Esc", action: { try await remoteDeps.input.sendKeyPress(pcPeerId: pcPeerId, key: "escape") })
                keyButton("Tab", action: { try await remoteDeps.input.sendKeyPress(pcPeerId: pcPeerId, key: "tab") })
                keyButton("⌫", action: { try await remoteDeps.input.sendKeyPress(pcPeerId: pcPeerId, key: "backspace") })
                Button {
                    showExtendedKeys = true
                } label: {
                    Image(systemName: "keyboard.fill")
                        .font(.system(size: 16))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
            }
            .padding(.horizontal, 12)
        }
    }

    @ViewBuilder
    private func keyButton<R: Sendable>(_ label: String, action: @escaping @Sendable () async throws -> R) -> some View {
        Button {
            Task {
                do {
                    _ = try await action()
                    await MainActor.run { showStatus("已发送: \(label)", error: false) }
                } catch {
                    await MainActor.run { showStatus(error: error, op: label) }
                }
            }
        } label: {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(.tertiarySystemBackground)))
                .foregroundColor(.primary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Text input bar

    private var textInputBar: some View {
        HStack(spacing: 6) {
            TextField("输入文本发送到桌面…", text: $typeText)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit { Task { await sendTypeText() } }

            Button {
                Task { await sendTypeText() }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .disabled(typeText.isEmpty)
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - Extended keyboard sheet

    private var extendedKeyboardSheet: some View {
        NavigationView {
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                    ForEach(extendedKeys, id: \.self) { key in
                        Button {
                            Task {
                                do {
                                    _ = try await remoteDeps.input.sendKeyPress(pcPeerId: pcPeerId, key: key)
                                    await MainActor.run {
                                        showStatus("已发送: \(key)", error: false)
                                        showExtendedKeys = false
                                    }
                                } catch {
                                    await MainActor.run { showStatus(error: error, op: key) }
                                }
                            }
                        } label: {
                            Text(key)
                                .font(.system(size: 14, weight: .medium))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(RoundedRectangle(cornerRadius: 6).fill(Color(.tertiarySystemBackground)))
                                .foregroundColor(.primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
            }
            .navigationTitle("扩展键盘")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { showExtendedKeys = false }
                }
            }
        }
    }

    private var extendedKeys: [String] {
        [
            "f1", "f2", "f3", "f4",
            "f5", "f6", "f7", "f8",
            "f9", "f10", "f11", "f12",
            "up", "down", "left", "right",
            "home", "end", "pageup", "pagedown",
            "insert", "delete", "space", "printscreen"
        ]
    }

    // MARK: - Status

    @ViewBuilder
    private var statusFooter: some View {
        HStack {
            Image(systemName: statusIsError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundColor(statusIsError ? .orange : .green)
            Text(statusMessage)
                .font(.caption)
                .foregroundColor(statusIsError ? .primary : .secondary)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(.systemBackground))
    }

    private func showStatus(_ message: String, error: Bool) {
        statusMessage = message
        statusIsError = error
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await MainActor.run {
                if statusMessage == message { statusMessage = "" }
            }
        }
    }

    private func showStatus(error: Error, op: String) {
        let msg = "\(op) 失败：\(error.localizedDescription)"
        showStatus(msg, error: true)
    }

    // MARK: - Actions

    private func sendMouseClick(_ button: MouseButton) async {
        do {
            _ = try await remoteDeps.input.mouseClick(pcPeerId: pcPeerId, button: button)
        } catch {
            await MainActor.run { showStatus(error: error, op: "click(\(button.rawValue))") }
        }
    }

    private func sendMouseDoubleClick() async {
        do {
            _ = try await remoteDeps.input.mouseDoubleClick(pcPeerId: pcPeerId)
        } catch {
            await MainActor.run { showStatus(error: error, op: "doubleClick") }
        }
    }

    private func sendTypeText() async {
        let text = typeText
        guard !text.isEmpty else { return }
        do {
            _ = try await remoteDeps.input.typeText(pcPeerId: pcPeerId, text: text)
            await MainActor.run {
                typeText = ""
                showStatus("已发送 \(text.count) 字符", error: false)
            }
        } catch {
            await MainActor.run { showStatus(error: error, op: "typeText") }
        }
    }
}
