import SwiftUI
import UIKit
import CoreP2P

/// 文件浏览 skill view — Phase 3.4 v0.1（read-only browse + text preview）。
///
/// **布局**：
/// - 顶部 breadcrumb horizontal scroll（home / drive / dir / dir...）
/// - List of FileEntry rows (folder icon / file icon by extension)
/// - tap folder navigate / tap text file 弹 sheet 看内容
/// - 右上 refresh + up button
struct FileBrowserView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            file: remoteDeps.file,
            pairingStore: pairingDeps.pairedDesktopsStore,
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

private struct Inner: View {
    @StateObject private var vm: FileBrowserViewModel

    init(
        pcPeerId: String,
        file: FileCommands,
        pairingStore: PairedDesktopsStore,
        currentDIDProvider: @escaping () -> String?
    ) {
        // platform lookup happens in onAppear via store query; default "linux" for VM init
        // 实际 platform 由 task 内 store.devices() 拿到（v0.1 简化路径）
        _vm = StateObject(wrappedValue: FileBrowserViewModel(
            pcPeerId: pcPeerId,
            platform: "linux",  // safe default; refresh 会用桌面真返路径
            file: file,
            currentDIDProvider: currentDIDProvider
        ))
        // pairingStore 实际未在 init 用 — Phase 4+ 改成 platform-aware lookup 时接通
        _ = pairingStore
    }

    var body: some View {
        VStack(spacing: 0) {
            if let err = vm.lastError {
                errorBanner(err)
            }
            breadcrumb
            Divider()
            entriesList
        }
        .background(Color(.systemGroupedBackground))
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await vm.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(vm.busy)
            }
        }
        .task { await vm.onAppear() }
        .sheet(item: openedFileBinding) { _ in
            if let resp = vm.openedTextContent, let path = vm.openedFilePath {
                FileTextSheet(path: path, response: resp, onDismiss: { vm.closeOpenedFile() })
            }
        }
    }

    // MARK: - Subviews

    private var breadcrumb: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Button {
                    Task { await vm.navigateToSegment(-1) }
                } label: {
                    Image(systemName: "house.fill")
                        .font(.subheadline)
                }
                .buttonStyle(.borderless)

                let segments = vm.breadcrumbSegments()
                ForEach(Array(segments.enumerated()), id: \.offset) { idx, seg in
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Button {
                        Task { await vm.navigateToSegment(idx) }
                    } label: {
                        Text(seg)
                            .font(.subheadline)
                            .lineLimit(1)
                    }
                    .buttonStyle(.borderless)
                    .disabled(idx == segments.count - 1 && !vm.busy)
                }

                if vm.busy {
                    ProgressView().scaleEffect(0.6).padding(.leading, 8)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
    }

    @ViewBuilder
    private var entriesList: some View {
        if vm.entries.isEmpty && !vm.busy && vm.lastError == nil {
            VStack(spacing: 12) {
                Image(systemName: "folder")
                    .font(.system(size: 50))
                    .foregroundColor(.secondary)
                Text("空目录")
                    .font(.headline)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(vm.entries) { entry in
                Button {
                    Task {
                        if entry.isDirectory {
                            await vm.navigate(to: entry)
                        } else {
                            await vm.openFile(entry)
                        }
                    }
                } label: {
                    fileRow(entry)
                }
                .buttonStyle(.plain)
                .disabled(vm.busy)
            }
            .listStyle(.plain)
            .refreshable { await vm.refresh() }
        }
    }

    private func fileRow(_ entry: FileEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: iconForEntry(entry))
                .foregroundColor(entry.isDirectory ? .blue : .secondary)
                .frame(width: 28)
                .font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                    .font(.body)
                    .foregroundColor(.primary)
                    .lineLimit(1)
                if !entry.isDirectory, let size = entry.size {
                    Text(formatSize(size))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
            if entry.isDirectory {
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(message)
                .font(.caption)
                .lineLimit(3)
            Spacer()
            Button { vm.clearError() } label: {
                Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
            }
        }
        .padding(8)
        .background(Color.red.opacity(0.1))
    }

    // MARK: - Helpers

    private func iconForEntry(_ entry: FileEntry) -> String {
        if entry.isDirectory { return "folder.fill" }
        guard let ext = entry.fileExtension else { return "doc" }
        switch ext {
        case "txt", "md", "log", "csv": return "doc.text"
        case "json", "xml", "yml", "yaml", "toml": return "doc.badge.gearshape"
        case "png", "jpg", "jpeg", "gif", "webp", "heic": return "photo"
        case "mp4", "mov", "avi", "mkv": return "film"
        case "mp3", "wav", "m4a", "flac": return "music.note"
        case "zip", "tar", "gz", "rar", "7z": return "doc.zipper"
        case "swift", "kt", "java", "py", "js", "ts", "rb", "rs", "go": return "chevron.left.forwardslash.chevron.right"
        default: return "doc"
        }
    }

    private func formatSize(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        if bytes < 1024 * 1024 * 1024 { return String(format: "%.1f MB", Double(bytes) / (1024 * 1024)) }
        return String(format: "%.2f GB", Double(bytes) / (1024 * 1024 * 1024))
    }

    private var openedFileBinding: Binding<OpenedFileMarker?> {
        Binding(
            get: { vm.openedFilePath != nil ? OpenedFileMarker(id: vm.openedFilePath!) : nil },
            set: { if $0 == nil { vm.closeOpenedFile() } }
        )
    }
}

private struct OpenedFileMarker: Identifiable {
    let id: String
}

private struct FileTextSheet: View {
    let path: String
    let response: FileReadResponse
    let onDismiss: () -> Void

    var body: some View {
        NavigationView {
            ScrollView {
                Text(response.content)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding()
            }
            .navigationTitle((path as NSString).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") { onDismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        UIPasteboard.general.string = response.content
                    } label: {
                        Label("复制", systemImage: "doc.on.doc")
                    }
                }
            }
        }
    }
}
