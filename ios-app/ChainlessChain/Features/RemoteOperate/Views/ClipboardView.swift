import SwiftUI
import UIKit
import CoreP2P

/// 剪贴板 skill 主 view — Phase 3.3。
///
/// **布局参考**：Android `feature-clipboard` (Compose) — 上 "桌面剪贴板"
/// 显示拉到的内容 + 复制到 iOS 按钮；下 "发送到桌面" 输入框 + 写桌面按钮。
/// 中间 status banner 显 lastError / 成功提示。
///
/// HIG 偏离：Compose `Card` → SwiftUI `RoundedRectangle.fill(.systemGray6)`。
struct ClipboardView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            clipboard: remoteDeps.clipboard,
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

private struct Inner: View {
    @StateObject private var vm: ClipboardViewModel
    @State private var draftToSend: String = ""

    init(pcPeerId: String, clipboard: ClipboardCommands, currentDIDProvider: @escaping () -> String?) {
        _vm = StateObject(wrappedValue: ClipboardViewModel(
            pcPeerId: pcPeerId,
            clipboard: clipboard,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Banner: error or success
                if let err = vm.lastError {
                    errorBanner(err)
                } else if let bytes = vm.lastSentBytes {
                    successBanner("已写入桌面剪贴板（\(bytes) 字节）")
                }

                // Section 1: 桌面剪贴板内容
                desktopClipboardSection

                // Section 2: 写桌面剪贴板
                pasteToDesktopSection

                Spacer(minLength: 32)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Sections

    private var desktopClipboardSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("桌面剪贴板", systemImage: "doc.on.clipboard")
                    .font(.headline)
                Spacer()
                Button {
                    Task { await vm.copyFromDesktop() }
                } label: {
                    if vm.busy {
                        ProgressView().scaleEffect(0.7)
                    } else {
                        Label("拉取", systemImage: "arrow.down.circle.fill")
                            .font(.subheadline)
                    }
                }
                .disabled(vm.busy)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }

            if let content = vm.lastFetchedContent {
                Text(content.content)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
                    .textSelection(.enabled)

                HStack(spacing: 12) {
                    Button {
                        UIPasteboard.general.string = content.content
                    } label: {
                        Label("复制到 iOS 剪贴板", systemImage: "square.on.square")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        vm.clearFetched()
                    } label: {
                        Label("清空", systemImage: "trash")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                }
            } else {
                Text("点击「拉取」从桌面读取剪贴板内容（v0.1 仅支持 text）")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
    }

    private var pasteToDesktopSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("发送到桌面", systemImage: "paperplane")
                    .font(.headline)
                Spacer()
                Button {
                    if let str = UIPasteboard.general.string, !str.isEmpty {
                        draftToSend = str
                    }
                } label: {
                    Label("从 iOS 剪贴板", systemImage: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }

            TextEditor(text: $draftToSend)
                .frame(minHeight: 100, maxHeight: 200)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
                .overlay(alignment: .topLeading) {
                    if draftToSend.isEmpty {
                        Text("输入要发送到桌面剪贴板的文字…")
                            .font(.body)
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .allowsHitTesting(false)
                    }
                }

            Button {
                let content = draftToSend
                Task {
                    await vm.pasteToDesktop(content: content)
                    if vm.lastError == nil {
                        draftToSend = ""
                    }
                }
            } label: {
                HStack {
                    if vm.busy {
                        ProgressView().scaleEffect(0.7).tint(.white)
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                    Text(vm.busy ? "发送中…" : "写入桌面剪贴板")
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(vm.busy || draftToSend.isEmpty)
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(message)
                .font(.caption)
                .lineLimit(3)
            Spacer()
            Button {
                vm.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.1)))
    }

    private func successBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
            Text(message)
                .font(.caption)
            Spacer()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.green.opacity(0.1)))
    }
}
