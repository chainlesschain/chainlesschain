/**
 * VersionHistoryView.swift
 *
 * Displays version history for a collaborative document.
 * Allows viewing, comparing, and restoring previous versions.
 */

import SwiftUI

public struct VersionHistoryView: View {

    // MARK: - Properties

    let documentId: String

    @StateObject private var versionControl = VersionControlService()
    @State private var versions: [VersionHistoryEntry] = []
    @State private var selectedVersion: VersionHistoryEntry?
    @State private var showComparison = false
    @State private var comparisonVersion: VersionHistoryEntry?
    @State private var isLoading = false
    @State private var errorMessage: String?

    @Environment(\.dismiss) private var dismiss

    // MARK: - Body

    public var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("加载版本历史...")
                } else if let error = errorMessage {
                    errorView(error)
                } else if versions.isEmpty {
                    emptyView
                } else {
                    versionList
                }
            }
            .navigationTitle("版本历史")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showComparison) {
                if let selected = selectedVersion, let comparison = comparisonVersion {
                    VersionComparisonView(
                        oldVersion: comparison,
                        newVersion: selected,
                        documentId: documentId
                    )
                }
            }
            .task {
                await loadVersionHistory()
            }
        }
    }

    // MARK: - Version List

    private var versionList: some View {
        List {
            ForEach(versions) { version in
                VersionRow(
                    version: version,
                    onRestore: { await restoreVersion(version) },
                    onCompare: { selectForComparison(version) }
                )
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无版本历史")
                .font(.headline)

            Text("开始编辑文档后会自动创建版本快照")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    // MARK: - Error View

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 60))
                .foregroundColor(.red)

            Text("加载失败")
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("重试") {
                Task { await loadVersionHistory() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }

    // MARK: - Actions

    private func loadVersionHistory() async {
        isLoading = true
        errorMessage = nil

        do {
            versions = try await versionControl.getVersionHistory(
                documentId: documentId,
                limit: 50
            )
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func restoreVersion(_ version: VersionHistoryEntry) async {
        isLoading = true
        errorMessage = nil

        do {
            let snapshot = try await versionControl.restoreSnapshot(snapshotId: version.snapshotId)
            // NOTE: 需要将恢复的内容传递给编辑器。可通过 @Binding 或 Notification 实现
            // 集成方式: onRestoreContent?(snapshot.content)
            print("Restored version \(version.version): \(snapshot.content)")

            // Reload history
            await loadVersionHistory()

            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func selectForComparison(_ version: VersionHistoryEntry) {
        if selectedVersion == nil {
            selectedVersion = version
        } else {
            comparisonVersion = version
            showComparison = true
            selectedVersion = nil
        }
    }

    // MARK: - Initializer

    public init(documentId: String) {
        self.documentId = documentId
    }
}

// MARK: - Version Row

struct VersionRow: View {
    let version: VersionHistoryEntry
    let onRestore: () async -> Void
    let onCompare: () -> Void

    @State private var showActions = false

    var body: some View {
        HStack(spacing: 12) {
            // Version indicator
            VStack(spacing: 4) {
                Circle()
                    .fill(version.isCurrent ? Color.green : Color.blue)
                    .frame(width: 12, height: 12)

                if !version.isCurrent {
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 2)
                }
            }
            .frame(width: 12)

            // Version info
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(version.versionLabel)
                        .font(.headline)

                    if version.isAutoSnapshot {
                        Text("自动")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.gray.opacity(0.2))
                            .cornerRadius(4)
                    }
                }

                Text(version.timeAgo)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text("作者: \(version.author)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if let comment = version.comment {
                    Text(comment)
                        .font(.caption)
                        .foregroundColor(.primary)
                        .italic()
                }

                if version.changeCount > 0 {
                    Text("\(version.changeCount) 处修改")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Actions
            if !version.isCurrent {
                Button(action: { showActions = true }) {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundColor(.blue)
                }
                .confirmationDialog("版本操作", isPresented: $showActions) {
                    Button("恢复此版本") {
                        Task { await onRestore() }
                    }
                    Button("对比版本") {
                        onCompare()
                    }
                    Button("取消", role: .cancel) {}
                }
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Version Comparison View

struct VersionComparisonView: View {
    let oldVersion: VersionHistoryEntry
    let newVersion: VersionHistoryEntry
    let documentId: String

    @StateObject private var versionControl = VersionControlService()
    @State private var comparison: VersionComparison?
    @State private var isLoading = false

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("对比版本中...")
                } else if let comparison = comparison {
                    comparisonView(comparison)
                }
            }
            .navigationTitle("版本对比")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .task {
                await loadComparison()
            }
        }
    }

    private func comparisonView(_ comparison: VersionComparison) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Version headers
                HStack(spacing: 20) {
                    versionHeader("旧版本", oldVersion)
                    Divider()
                    versionHeader("新版本", newVersion)
                }
                .padding()

                Divider()

                // Changes
                VStack(alignment: .leading, spacing: 12) {
                    Text("变更内容")
                        .font(.headline)
                        .padding(.horizontal)

                    if comparison.changes.isEmpty {
                        Text("无变更")
                            .foregroundColor(.secondary)
                            .padding()
                    } else {
                        ForEach(comparison.changes) { change in
                            ChangeRow(change: change)
                        }
                    }
                }
            }
        }
    }

    private func versionHeader(_ title: String, _ version: VersionHistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)

            Text(version.versionLabel)
                .font(.headline)

            Text(version.timeAgo)
                .font(.caption)
                .foregroundColor(.secondary)

            Text(version.author)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loadComparison() async {
        isLoading = true

        do {
            comparison = try await versionControl.compareVersions(
                oldSnapshotId: oldVersion.snapshotId,
                newSnapshotId: newVersion.snapshotId
            )
        } catch {
            print("Error loading comparison: \(error)")
        }

        isLoading = false
    }
}

// MARK: - Change Row

struct ChangeRow: View {
    let change: VersionComparison.Change

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                changeTypeLabel
                Spacer()
                Text("位置: \(change.position)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if !change.oldContent.isEmpty {
                Text("- \(change.oldContent)")
                    .font(.body)
                    .foregroundColor(.red)
                    .padding(8)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(4)
            }

            if !change.newContent.isEmpty {
                Text("+ \(change.newContent)")
                    .font(.body)
                    .foregroundColor(.green)
                    .padding(8)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(4)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .padding(.horizontal)
    }

    private var changeTypeLabel: some View {
        Group {
            switch change.type {
            case .addition:
                Label("新增", systemImage: "plus.circle.fill")
                    .foregroundColor(.green)
            case .deletion:
                Label("删除", systemImage: "minus.circle.fill")
                    .foregroundColor(.red)
            case .modification:
                Label("修改", systemImage: "pencil.circle.fill")
                    .foregroundColor(.orange)
            }
        }
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color(.systemGray5))
        .cornerRadius(8)
    }
}

// MARK: - Preview

#Preview {
    VersionHistoryView(documentId: "doc_001")
}
