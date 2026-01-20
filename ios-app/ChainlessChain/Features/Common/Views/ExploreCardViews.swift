import SwiftUI
import CoreCommon

// MARK: - Base Card Container

/// 基础卡片容器
struct BaseExploreCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .padding(16)
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - Card View Router

/// 根据卡片类型渲染对应的视图
struct ExploreCardView: View {
    let card: ExploreCardModel

    var body: some View {
        switch card.type {
        case .knowledge(let item):
            KnowledgeExploreCard(item: item)
        case .aiConversation(let conversation):
            AIConversationExploreCard(conversation: conversation)
        case .project(let project):
            ProjectExploreCard(project: project)
        }
    }
}

// MARK: - Knowledge Card

/// 知识库卡片
struct KnowledgeExploreCard: View {
    let item: KnowledgeItem

    var body: some View {
        BaseExploreCard {
            VStack(alignment: .leading, spacing: 12) {
                // Header with icon and category
                HStack {
                    Image(systemName: contentTypeIcon)
                        .font(.system(size: 16))
                        .foregroundColor(.blue)

                    if let category = item.category {
                        Text(category)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    if item.isFavorite {
                        Image(systemName: "star.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.yellow)
                    }
                }

                // Title
                Text(item.title)
                    .font(.headline)
                    .foregroundColor(.primary)
                    .lineLimit(2)

                // Content preview
                if !item.content.isEmpty {
                    Text(item.content)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                }

                // Tags
                if !item.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(item.tags.prefix(3), id: \.self) { tag in
                                Text("#\(tag)")
                                    .font(.caption)
                                    .foregroundColor(.blue)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.blue.opacity(0.1))
                                    .cornerRadius(8)
                            }
                        }
                    }
                }

                // Footer with stats
                HStack {
                    Label("\(item.viewCount)", systemImage: "eye")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    Text(timeAgoString(from: item.updatedAt))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private var contentTypeIcon: String {
        switch item.contentType {
        case .text: return "doc.text"
        case .markdown: return "doc.richtext"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .image: return "photo"
        case .pdf: return "doc.fill"
        case .link: return "link"
        }
    }
}

// MARK: - AI Conversation Card

/// AI对话卡片
struct AIConversationExploreCard: View {
    let conversation: AIConversationEntity

    var body: some View {
        BaseExploreCard {
            VStack(alignment: .leading, spacing: 12) {
                // Header with AI icon
                HStack {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 16))
                        .foregroundColor(.purple)

                    Text("AI 对话")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()
                }

                // Title
                Text(conversation.title ?? "新对话")
                    .font(.headline)
                    .foregroundColor(.primary)
                    .lineLimit(2)

                // Model info
                HStack(spacing: 8) {
                    Image(systemName: modelIcon)
                        .font(.system(size: 12))
                        .foregroundColor(.purple)

                    Text(conversation.model)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                // Stats
                HStack(spacing: 16) {
                    Label("\(conversation.messageCount)", systemImage: "message")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Label("\(conversation.totalTokens)", systemImage: "chart.bar")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // Footer with timestamp
                HStack {
                    Spacer()
                    Text(timeAgoString(from: conversation.updatedAt))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private var modelIcon: String {
        if conversation.model.lowercased().contains("gpt") {
            return "cpu"
        } else if conversation.model.lowercased().contains("claude") {
            return "cloud"
        } else {
            return "sparkles"
        }
    }
}

// MARK: - Project Card

/// 项目卡片
struct ProjectExploreCard: View {
    let project: ProjectEntity

    var body: some View {
        BaseExploreCard {
            VStack(alignment: .leading, spacing: 12) {
                // Header with type icon
                HStack {
                    Image(systemName: projectTypeIcon)
                        .font(.system(size: 16))
                        .foregroundColor(.green)

                    Text(project.type.displayName)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    // Status badge
                    statusBadge
                }

                // Title
                Text(project.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                    .lineLimit(2)

                // Description
                if let description = project.description, !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                }

                // Stats
                HStack(spacing: 16) {
                    Label("\(project.fileCount)", systemImage: "doc")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Label(formatFileSize(project.totalSize), systemImage: "internaldrive")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if project.syncStatus != .local {
                        syncStatusIcon
                    }
                }

                // Footer with timestamp
                HStack {
                    Spacer()
                    Text(timeAgoString(from: project.updatedAt))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private var projectTypeIcon: String {
        switch project.type {
        case .document: return "doc.fill"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .design: return "paintbrush.fill"
        case .data: return "chart.bar.fill"
        default: return "folder.fill"
        }
    }

    private var statusBadge: some View {
        Text(project.status.displayName)
            .font(.caption)
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor)
            .cornerRadius(8)
    }

    private var statusColor: Color {
        switch project.status {
        case .draft: return .gray
        case .active: return .blue
        case .completed: return .green
        case .archived: return .orange
        default: return .gray
        }
    }

    private var syncStatusIcon: some View {
        Image(systemName: syncIconName)
            .font(.caption)
            .foregroundColor(syncColor)
    }

    private var syncIconName: String {
        switch project.syncStatus {
        case .local: return "externaldrive"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .synced: return "checkmark.icloud"
        case .conflict: return "exclamationmark.icloud"
        case .error: return "xmark.icloud"
        }
    }

    private var syncColor: Color {
        switch project.syncStatus {
        case .local: return .gray
        case .syncing: return .blue
        case .synced: return .green
        case .conflict: return .orange
        case .error: return .red
        }
    }
}

// MARK: - Empty State

/// 空状态视图
struct ExploreEmptyView: View {
    let filter: ContentFilter

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: emptyIcon)
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            Text(emptyTitle)
                .font(.headline)
                .foregroundColor(.primary)

            Text(emptyMessage)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .padding(.vertical, 60)
    }

    private var emptyIcon: String {
        switch filter {
        case .all: return "tray"
        case .knowledge: return "book"
        case .aiConversation: return "message"
        case .project: return "folder"
        }
    }

    private var emptyTitle: String {
        switch filter {
        case .all: return "暂无内容"
        case .knowledge: return "暂无知识库"
        case .aiConversation: return "暂无AI对话"
        case .project: return "暂无项目"
        }
    }

    private var emptyMessage: String {
        switch filter {
        case .all: return "开始创建您的第一个知识库、AI对话或项目"
        case .knowledge: return "点击知识库标签页开始创建"
        case .aiConversation: return "点击AI对话标签页开始创建"
        case .project: return "点击项目标签页开始创建"
        }
    }
}

// MARK: - Statistics Overview

/// 统计概览卡片
struct ExploreStatsOverview: View {
    let statistics: ExploreStatistics

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                StatItem(
                    icon: "book.fill",
                    count: statistics.totalKnowledge,
                    label: "知识库",
                    color: .blue
                )

                Divider()
                    .frame(height: 40)

                StatItem(
                    icon: "message.fill",
                    count: statistics.totalConversations,
                    label: "对话",
                    color: .purple
                )

                Divider()
                    .frame(height: 40)

                StatItem(
                    icon: "folder.fill",
                    count: statistics.totalProjects,
                    label: "项目",
                    color: .green
                )
            }
            .padding(.vertical, 16)
        }
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

private struct StatItem: View {
    let icon: String
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(color)

            Text("\(count)")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.primary)

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Helper Functions

private func timeAgoString(from date: Date) -> String {
    let interval = Date().timeIntervalSince(date)
    let seconds = Int(interval)

    if seconds < 60 {
        return "刚刚"
    } else if seconds < 3600 {
        let minutes = seconds / 60
        return "\(minutes) 分钟前"
    } else if seconds < 86400 {
        let hours = seconds / 3600
        return "\(hours) 小时前"
    } else if seconds < 2592000 {
        let days = seconds / 86400
        return "\(days) 天前"
    } else if seconds < 31536000 {
        let months = seconds / 2592000
        return "\(months) 个月前"
    } else {
        let years = seconds / 31536000
        return "\(years) 年前"
    }
}

private func formatFileSize(_ bytes: Int64) -> String {
    let formatter = ByteCountFormatter()
    formatter.countStyle = .file
    formatter.allowedUnits = [.useKB, .useMB, .useGB]
    return formatter.string(fromByteCount: bytes)
}
