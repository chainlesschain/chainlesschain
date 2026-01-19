import SwiftUI

struct KnowledgeDetailView: View {
    let item: KnowledgeItem
    let onUpdate: (KnowledgeItem) -> Void
    let onDelete: () -> Void

    @State private var showingEditSheet = false
    @State private var showingDeleteAlert = false
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 标题
                    Text(item.title)
                        .font(.title)
                        .fontWeight(.bold)

                    // 元数据
                    HStack {
                        if let category = item.category {
                            Label(category, systemImage: "folder")
                                .font(.subheadline)
                                .foregroundColor(.blue)
                        }

                        Label("\(item.viewCount)", systemImage: "eye")
                            .font(.subheadline)
                            .foregroundColor(.gray)

                        Spacer()

                        Text(item.updatedAt, style: .date)
                            .font(.caption)
                            .foregroundColor(.gray)
                    }

                    // 标签
                    if !item.tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(item.tags, id: \.self) { tag in
                                    Text("#\(tag)")
                                        .font(.subheadline)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(Color.green.opacity(0.1))
                                        .foregroundColor(.green)
                                        .cornerRadius(16)
                                }
                            }
                        }
                    }

                    Divider()

                    // 内容
                    Text(item.content)
                        .font(.body)
                        .textSelection(.enabled)

                    // 来源链接
                    if let sourceURL = item.sourceURL, let url = URL(string: sourceURL) {
                        Divider()

                        Link(destination: url) {
                            HStack {
                                Image(systemName: "link")
                                Text("来源链接")
                                Spacer()
                                Image(systemName: "arrow.up.right")
                            }
                            .foregroundColor(.blue)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationTitle("详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            showingEditSheet = true
                        } label: {
                            Label("编辑", systemImage: "pencil")
                        }

                        Button(role: .destructive) {
                            showingDeleteAlert = true
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingEditSheet) {
                KnowledgeEditView(mode: .edit(item)) { updatedItem in
                    onUpdate(updatedItem)
                    dismiss()
                }
            }
            .alert("确认删除", isPresented: $showingDeleteAlert) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    onDelete()
                    dismiss()
                }
            } message: {
                Text("确定要删除这条知识库条目吗?此操作无法撤销。")
            }
        }
    }
}

// MARK: - Knowledge Edit View

struct KnowledgeEditView: View {
    enum Mode {
        case create
        case edit(KnowledgeItem)
    }

    let mode: Mode
    let onSave: (KnowledgeItem) -> Void

    @State private var title = ""
    @State private var content = ""
    @State private var contentType: KnowledgeItem.ContentType = .text
    @State private var category = ""
    @State private var tags: [String] = []
    @State private var tagInput = ""
    @State private var sourceURL = ""

    @Environment(\.dismiss) var dismiss
    @FocusState private var focusedField: Field?

    enum Field {
        case title, content, category, tag, sourceURL
    }

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    TextField("标题", text: $title)
                        .focused($focusedField, equals: .title)

                    Picker("内容类型", selection: $contentType) {
                        Text("文本").tag(KnowledgeItem.ContentType.text)
                        Text("Markdown").tag(KnowledgeItem.ContentType.markdown)
                        Text("代码").tag(KnowledgeItem.ContentType.code)
                        Text("链接").tag(KnowledgeItem.ContentType.link)
                    }
                }

                Section("内容") {
                    TextEditor(text: $content)
                        .frame(minHeight: 200)
                        .focused($focusedField, equals: .content)
                }

                Section("分类") {
                    TextField("分类 (可选)", text: $category)
                        .focused($focusedField, equals: .category)
                }

                Section("标签") {
                    // 已添加的标签
                    if !tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(tags, id: \.self) { tag in
                                    HStack {
                                        Text("#\(tag)")
                                        Button {
                                            tags.removeAll { $0 == tag }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundColor(.gray)
                                        }
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Color.green.opacity(0.1))
                                    .foregroundColor(.green)
                                    .cornerRadius(16)
                                }
                            }
                        }
                    }

                    // 添加标签
                    HStack {
                        TextField("添加标签", text: $tagInput)
                            .focused($focusedField, equals: .tag)
                            .onSubmit {
                                addTag()
                            }

                        Button("添加") {
                            addTag()
                        }
                        .disabled(tagInput.isEmpty)
                    }
                }

                Section("来源") {
                    TextField("来源链接 (可选)", text: $sourceURL)
                        .focused($focusedField, equals: .sourceURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }
            }
            .navigationTitle(mode.isEdit ? "编辑" : "新建")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        save()
                    }
                    .disabled(title.isEmpty || content.isEmpty)
                }
            }
            .onAppear {
                loadData()
                focusedField = .title
            }
        }
    }

    // MARK: - Helper Methods

    private func loadData() {
        if case .edit(let item) = mode {
            title = item.title
            content = item.content
            contentType = item.contentType
            category = item.category ?? ""
            tags = item.tags
            sourceURL = item.sourceURL ?? ""
        }
    }

    private func addTag() {
        let trimmed = tagInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !tags.contains(trimmed) else { return }

        tags.append(trimmed)
        tagInput = ""
    }

    private func save() {
        let item: KnowledgeItem

        if case .edit(let existingItem) = mode {
            item = KnowledgeItem(
                id: existingItem.id,
                title: title,
                content: content,
                contentType: contentType,
                tags: tags,
                category: category.isEmpty ? nil : category,
                sourceURL: sourceURL.isEmpty ? nil : sourceURL,
                isFavorite: existingItem.isFavorite,
                viewCount: existingItem.viewCount,
                createdAt: existingItem.createdAt,
                updatedAt: Date()
            )
        } else {
            item = KnowledgeItem(
                title: title,
                content: content,
                contentType: contentType,
                tags: tags,
                category: category.isEmpty ? nil : category,
                sourceURL: sourceURL.isEmpty ? nil : sourceURL
            )
        }

        onSave(item)
        dismiss()
    }
}

extension KnowledgeEditView.Mode {
    var isEdit: Bool {
        if case .edit = self {
            return true
        }
        return false
    }
}

#Preview("Detail") {
    KnowledgeDetailView(
        item: KnowledgeItem(
            title: "SwiftUI 学习笔记",
            content: "SwiftUI 是苹果推出的声明式 UI 框架...",
            tags: ["iOS", "SwiftUI", "编程"],
            category: "技术"
        ),
        onUpdate: { _ in },
        onDelete: {}
    )
}

#Preview("Create") {
    KnowledgeEditView(mode: .create) { _ in }
}
