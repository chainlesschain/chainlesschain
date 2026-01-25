/**
 * CollaborativeEditorView.swift
 *
 * Real-time collaborative text editor with cursor tracking and presence awareness.
 */

import SwiftUI

public struct CollaborativeEditorView: View {

    // MARK: - Properties

    let documentId: String
    let knowledgeId: String
    let initialContent: String
    var organizationId: String? = nil

    @StateObject private var manager = CollaborationManager.shared
    @State private var content: String = ""
    @State private var cursorPosition: CursorPosition?
    @State private var selection: TextSelection?

    @State private var session: CollaborationSession?
    @State private var showVersionHistory = false
    @State private var showActiveUsers = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    // Current user info (from DID)
    @State private var userId = "user_001" // TODO: Get from IdentityManager
    @State private var userName = "Current User"

    // MARK: - Body

    public var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            toolbar

            // Editor
            editor

            // Status bar
            statusBar
        }
        .navigationTitle("协作编辑")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showVersionHistory) {
            VersionHistoryView(documentId: documentId)
        }
        .sheet(isPresented: $showActiveUsers) {
            ActiveUsersSheet(
                users: manager.activeUsers[documentId] ?? []
            )
        }
        .task {
            await joinSession()
        }
        .onDisappear {
            Task {
                await leaveSession()
            }
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            // Active users indicator
            Button(action: { showActiveUsers = true }) {
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                    Text("\(manager.activeUsers[documentId]?.count ?? 0)")
                }
                .font(.subheadline)
                .foregroundColor(.blue)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.blue.opacity(0.1))
                .cornerRadius(8)
            }

            Spacer()

            // Sync status
            syncStatusIndicator

            // Version history
            Button(action: { showVersionHistory = true }) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.title3)
            }

            // Save snapshot
            Button(action: { Task { await createSnapshot() } }) {
                Image(systemName: "arrow.down.doc")
                    .font(.title3)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .overlay(
            Divider(),
            alignment: .bottom
        )
    }

    private var syncStatusIndicator: some View {
        Group {
            if let status = manager.syncStatus[documentId] {
                HStack(spacing: 4) {
                    Circle()
                        .fill(statusColor(status))
                        .frame(width: 8, height: 8)
                    Text(status.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private func statusColor(_ status: SyncStatus) -> Color {
        switch status {
        case .connected: return .green
        case .syncing: return .orange
        case .connecting: return .yellow
        case .disconnected: return .gray
        case .error: return .red
        }
    }

    // MARK: - Editor

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            // Main text editor
            TextEditor(text: $content)
                .font(.body)
                .padding()
                .onChange(of: content) { oldValue, newValue in
                    handleContentChange(old: oldValue, new: newValue)
                }

            // Remote cursors overlay
            remoteCursorsOverlay
        }
    }

    private var remoteCursorsOverlay: some View {
        ForEach(manager.activeUsers[documentId] ?? []) { user in
            if user.userId != userId, let cursor = user.cursor {
                CursorIndicator(
                    userName: user.userName,
                    color: Color(hex: user.userColor) ?? .blue,
                    position: cursor
                )
            }
        }
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack {
            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            } else if let session = session {
                Text("已加入协作 • \(formatTimestamp(session.joinedAt))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Character count
            Text("\(content.count) 字符")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemGray6))
        .overlay(
            Divider(),
            alignment: .top
        )
    }

    // MARK: - Actions

    private func joinSession() async {
        isLoading = true
        errorMessage = nil

        do {
            // Join collaboration session
            let newSession = try await manager.joinSession(
                documentId: documentId,
                knowledgeId: knowledgeId,
                userId: userId,
                userName: userName,
                organizationId: organizationId
            )

            session = newSession

            // Load initial content
            manager.setDocumentContent(documentId: documentId, content: initialContent)
            content = initialContent

            // Load persisted updates
            try await manager.loadDocumentUpdates(documentId: documentId)

            // Get latest content
            content = manager.getDocumentContent(documentId: documentId)

        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func leaveSession() async {
        do {
            try await manager.leaveSession(documentId: documentId)
        } catch {
            print("Error leaving session: \(error)")
        }
    }

    private func handleContentChange(old: String, new: String) {
        guard let session = session else { return }

        // Calculate changes and apply CRDT operations
        if new.count > old.count {
            // Insertion
            let insertedText = String(new.dropFirst(old.count))
            let position = old.count

            do {
                try manager.insertText(
                    documentId: documentId,
                    position: position,
                    text: insertedText,
                    userId: userId
                )
            } catch {
                errorMessage = error.localizedDescription
            }

        } else if new.count < old.count {
            // Deletion
            let position = new.count
            let length = old.count - new.count

            do {
                try manager.deleteText(
                    documentId: documentId,
                    position: position,
                    length: length,
                    userId: userId
                )
            } catch {
                errorMessage = error.localizedDescription
            }
        }

        // Update cursor position
        updateCursorPosition()
    }

    private func updateCursorPosition() {
        // TODO: Calculate actual cursor position from TextEditor
        // For now, use content length as position
        let position = CursorPosition(
            line: 0,
            column: content.count,
            offset: content.count
        )

        manager.updateCursor(
            documentId: documentId,
            cursor: position,
            selection: selection
        )
    }

    private func createSnapshot() async {
        // TODO: Integrate with VersionControlService
        print("Create snapshot for document: \(documentId)")
    }

    // MARK: - Helpers

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.string(from: date)
    }

    // MARK: - Initializer

    public init(
        documentId: String,
        knowledgeId: String,
        initialContent: String,
        organizationId: String? = nil
    ) {
        self.documentId = documentId
        self.knowledgeId = knowledgeId
        self.initialContent = initialContent
        self.organizationId = organizationId
    }
}

// MARK: - Cursor Indicator

struct CursorIndicator: View {
    let userName: String
    let color: Color
    let position: CursorPosition

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // User name label
            Text(userName)
                .font(.caption2)
                .foregroundColor(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(color)
                .cornerRadius(4)

            // Cursor line
            Rectangle()
                .fill(color)
                .frame(width: 2, height: 20)
        }
        // TODO: Position based on actual cursor location
        .position(x: 50, y: 50)
    }
}

// MARK: - Active Users Sheet

struct ActiveUsersSheet: View {
    let users: [ActiveUser]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List(users) { user in
                HStack(spacing: 12) {
                    // User color indicator
                    Circle()
                        .fill(Color(hex: user.userColor) ?? .blue)
                        .frame(width: 12, height: 12)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.userName)
                            .font(.body)
                        if let lastUpdate = user.lastUpdate {
                            Text(timeAgo(lastUpdate))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    Spacer()

                    // Status indicator
                    if isActive(user.lastUpdate) {
                        Text("活跃")
                            .font(.caption)
                            .foregroundColor(.green)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.green.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("协作用户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func isActive(_ lastUpdate: Date?) -> Bool {
        guard let lastUpdate = lastUpdate else { return false }
        return Date().timeIntervalSince(lastUpdate) < 60 // Active within last minute
    }

    private func timeAgo(_ date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 60 {
            return "刚刚"
        } else if interval < 3600 {
            return "\(Int(interval / 60))分钟前"
        } else {
            return "\(Int(interval / 3600))小时前"
        }
    }
}

// MARK: - Color Extension

extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            return nil
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        CollaborativeEditorView(
            documentId: "doc_001",
            knowledgeId: "knowledge_001",
            initialContent: "# 协作文档\n\n这是一个实时协作编辑的示例文档。"
        )
    }
}
