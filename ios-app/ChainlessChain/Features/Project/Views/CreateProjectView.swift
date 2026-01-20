import SwiftUI
import CoreCommon

/// 创建项目视图
struct CreateProjectView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var projectManager = ProjectManager.shared

    @State private var name = ""
    @State private var description = ""
    @State private var selectedType: ProjectType = .document
    @State private var tags: [String] = []
    @State private var newTag = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    private let logger = Logger.shared

    var body: some View {
        NavigationStack {
            Form {
                // Basic info
                Section("基本信息") {
                    TextField("项目名称", text: $name)
                        .textInputAutocapitalization(.never)

                    TextField("项目描述（可选）", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                // Project type
                Section("项目类型") {
                    Picker("类型", selection: $selectedType) {
                        ForEach(ProjectType.allCases, id: \.self) { type in
                            Label(type.displayName, systemImage: type.icon)
                                .tag(type)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                // Tags
                Section("标签") {
                    if !tags.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(tags, id: \.self) { tag in
                                TagChip(tag: tag) {
                                    tags.removeAll { $0 == tag }
                                }
                            }
                        }
                    }

                    HStack {
                        TextField("添加标签", text: $newTag)
                            .textInputAutocapitalization(.never)
                            .onSubmit {
                                addTag()
                            }

                        Button {
                            addTag()
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .foregroundColor(.blue)
                        }
                        .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                // Quick templates
                Section("快速模板") {
                    Button {
                        applyTemplate(.web)
                    } label: {
                        Label("网页项目", systemImage: "globe")
                    }

                    Button {
                        applyTemplate(.document)
                    } label: {
                        Label("文档项目", systemImage: "doc.text.fill")
                    }

                    Button {
                        applyTemplate(.data)
                    } label: {
                        Label("数据分析项目", systemImage: "chart.bar.fill")
                    }
                }

                // Error message
                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("新建项目")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("创建") {
                        createProject()
                    }
                    .fontWeight(.semibold)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
            .interactiveDismissDisabled(isCreating)
        }
    }

    // MARK: - Actions

    private func addTag() {
        let trimmedTag = newTag.trimmingCharacters(in: .whitespaces)
        guard !trimmedTag.isEmpty, !tags.contains(trimmedTag) else { return }

        tags.append(trimmedTag)
        newTag = ""
    }

    private func applyTemplate(_ type: ProjectType) {
        selectedType = type

        switch type {
        case .web:
            if name.isEmpty { name = "新网页项目" }
            tags = ["web", "html", "css"]
        case .document:
            if name.isEmpty { name = "新文档" }
            tags = ["文档", "笔记"]
        case .data:
            if name.isEmpty { name = "数据分析项目" }
            tags = ["数据", "分析", "报表"]
        case .application:
            if name.isEmpty { name = "新应用" }
            tags = ["应用", "开发"]
        case .presentation:
            if name.isEmpty { name = "新演示文稿" }
            tags = ["演示", "PPT"]
        case .spreadsheet:
            if name.isEmpty { name = "新表格" }
            tags = ["表格", "数据"]
        }
    }

    private func createProject() {
        errorMessage = nil
        isCreating = true

        do {
            let _ = try projectManager.createProject(
                name: name,
                description: description.isEmpty ? nil : description,
                type: selectedType,
                tags: tags
            )

            logger.info("Created project: \(name)", category: "Project")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            logger.error("Failed to create project", error: error, category: "Project")
        }

        isCreating = false
    }
}

// MARK: - Tag Chip

struct TagChip: View {
    let tag: String
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(tag)
                .font(.caption)

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.blue.opacity(0.1))
        .foregroundColor(.blue)
        .cornerRadius(12)
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(
            in: proposal.replacingUnspecifiedDimensions().width,
            subviews: subviews,
            spacing: spacing
        )
        return result.bounds
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(
            in: bounds.width,
            subviews: subviews,
            spacing: spacing
        )
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.offsets[index].x,
                                       y: bounds.minY + result.offsets[index].y),
                          proposal: .unspecified)
        }
    }

    struct FlowResult {
        var bounds: CGSize = .zero
        var offsets: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var currentX: CGFloat = 0
            var currentY: CGFloat = 0
            var lineHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if currentX + size.width > maxWidth, currentX > 0 {
                    currentX = 0
                    currentY += lineHeight + spacing
                    lineHeight = 0
                }

                offsets.append(CGPoint(x: currentX, y: currentY))
                lineHeight = max(lineHeight, size.height)
                currentX += size.width + spacing

                bounds.width = max(bounds.width, currentX)
                bounds.height = max(bounds.height, currentY + lineHeight)
            }
        }
    }
}

#Preview {
    CreateProjectView()
}
