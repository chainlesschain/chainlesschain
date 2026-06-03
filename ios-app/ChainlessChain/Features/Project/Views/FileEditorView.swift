import SwiftUI
import CoreCommon

/// 文件编辑器视图
/// Reference: desktop-app-vue/src/renderer/components/editors/
struct FileEditorView: View {
    let file: ProjectFileEntity
    var onSave: (() -> Void)?
    var onClose: (() -> Void)?

    @StateObject private var viewModel = FileEditorViewModel()
    @State private var showMarkdownToolbar = false
    @State private var showFindReplace = false
    @State private var findText = ""
    @State private var replaceText = ""
    @FocusState private var isEditorFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Header
            editorHeader

            // Toolbar (for markdown)
            if showMarkdownToolbar && viewModel.fileType == .markdown {
                markdownToolbar
            }

            // Find/Replace bar
            if showFindReplace {
                findReplaceBar
            }

            Divider()

            // Content area
            contentArea

            // Footer
            editorFooter
        }
        .background(Color(.systemGroupedBackground))
        .onAppear {
            viewModel.loadFile(file)
        }
        .alert("错误", isPresented: .constant(viewModel.error != nil)) {
            Button("确定") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
        .onChange(of: file.id) { _ in
            viewModel.loadFile(file)
        }
    }

    // MARK: - Header

    private var editorHeader: some View {
        HStack {
            // File info
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(viewModel.fileName)
                        .font(.headline)
                        .lineLimit(1)

                    if viewModel.hasUnsavedChanges {
                        Circle()
                            .fill(Color.orange)
                            .frame(width: 8, height: 8)
                    }
                }

                Text(viewModel.filePath)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Actions
            HStack(spacing: 12) {
                // Preview toggle (for markdown)
                if viewModel.fileType.hasPreview {
                    Button {
                        viewModel.togglePreview()
                    } label: {
                        Image(systemName: viewModel.isPreviewMode ? "pencil" : "eye")
                            .foregroundColor(.blue)
                    }
                }

                // Save button
                if viewModel.hasUnsavedChanges {
                    Button {
                        Task {
                            await viewModel.save()
                            onSave?()
                        }
                    } label: {
                        if viewModel.isSaving {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "square.and.arrow.down")
                                .foregroundColor(.blue)
                        }
                    }
                    .disabled(viewModel.isSaving)
                }

                // More options
                Menu {
                    if viewModel.fileType == .markdown {
                        Button {
                            showMarkdownToolbar.toggle()
                        } label: {
                            Label(showMarkdownToolbar ? "隐藏格式工具栏" : "显示格式工具栏",
                                  systemImage: "textformat")
                        }
                    }

                    Button {
                        showFindReplace.toggle()
                    } label: {
                        Label("查找和替换", systemImage: "magnifyingglass")
                    }

                    Divider()

                    if viewModel.hasUnsavedChanges {
                        Button(role: .destructive) {
                            viewModel.revertChanges()
                        } label: {
                            Label("撤销更改", systemImage: "arrow.uturn.backward")
                        }
                    }

                    Button {
                        onClose?()
                    } label: {
                        Label("关闭", systemImage: "xmark")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
    }

    // MARK: - Markdown Toolbar

    private var markdownToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(markdownActions, id: \.title) { action in
                    Button {
                        viewModel.insertMarkdown(action.format)
                    } label: {
                        VStack(spacing: 2) {
                            Image(systemName: action.icon)
                                .font(.system(size: 16))
                            Text(action.title)
                                .font(.caption2)
                        }
                        .frame(width: 44, height: 44)
                    }
                    .foregroundColor(.primary)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.secondarySystemBackground))
    }

    private var markdownActions: [(title: String, icon: String, format: FileEditorViewModel.MarkdownFormat)] {
        [
            ("粗体", "bold", .bold),
            ("斜体", "italic", .italic),
            ("标题", "textformat.size.larger", .heading1),
            ("列表", "list.bullet", .bulletList),
            ("数字", "list.number", .numberedList),
            ("链接", "link", .link),
            ("图片", "photo", .image),
            ("代码", "chevron.left.forwardslash.chevron.right", .code),
            ("代码块", "curlybraces", .codeBlock),
            ("引用", "text.quote", .quote),
            ("表格", "tablecells", .table),
            ("待办", "checklist", .checkbox)
        ]
    }

    // MARK: - Find/Replace Bar

    private var findReplaceBar: some View {
        VStack(spacing: 8) {
            HStack {
                TextField("查找", text: $findText)
                    .textFieldStyle(.roundedBorder)

                Button("查找") {
                    // Highlight matches - simplified for now
                }
                .buttonStyle(.bordered)
            }

            HStack {
                TextField("替换为", text: $replaceText)
                    .textFieldStyle(.roundedBorder)

                Button("替换") {
                    _ = viewModel.findAndReplace(find: findText, replace: replaceText, all: false)
                }
                .buttonStyle(.bordered)

                Button("全部替换") {
                    let count = viewModel.findAndReplace(find: findText, replace: replaceText, all: true)
                    if count > 0 {
                        findText = ""
                        replaceText = ""
                    }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - Content Area

    @ViewBuilder
    private var contentArea: some View {
        if viewModel.isLoading {
            ProgressView("加载中...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !viewModel.fileType.isEditable {
            unsupportedFileView
        } else if viewModel.isPreviewMode && viewModel.fileType == .markdown {
            markdownPreview
        } else {
            editorTextView
        }
    }

    private var editorTextView: some View {
        TextEditor(text: $viewModel.content)
            .font(.system(.body, design: viewModel.fileType == .code ? .monospaced : .default))
            .focused($isEditorFocused)
            .scrollContentBackground(.hidden)
            .background(Color(.systemBackground))
            .padding(8)
    }

    private var markdownPreview: some View {
        ScrollView {
            MarkdownPreviewContent(content: viewModel.content)
                .padding()
        }
        .background(Color(.systemBackground))
    }

    private var unsupportedFileView: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.questionmark")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("无法编辑此文件类型")
                .font(.headline)

            Text("文件类型: \(file.type)")
                .font(.subheadline)
                .foregroundColor(.secondary)

            if viewModel.fileType == .image {
                // Show image preview
                if let content = file.content,
                   let data = Data(base64Encoded: content),
                   let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 300, maxHeight: 300)
                        .cornerRadius(8)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Footer

    private var editorFooter: some View {
        HStack {
            // File type badge
            Text(fileTypeBadge)
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(.systemGray5))
                .cornerRadius(4)

            Spacer()

            // Stats
            Text("\(viewModel.lineCount) 行")
                .font(.caption)
                .foregroundColor(.secondary)

            Text("•")
                .foregroundColor(.secondary)

            Text("\(viewModel.wordCount) 字")
                .font(.caption)
                .foregroundColor(.secondary)

            // Last saved
            if let lastSaved = viewModel.lastSavedAt {
                Text("•")
                    .foregroundColor(.secondary)
                Text("已保存 \(lastSaved.formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }

    private var fileTypeBadge: String {
        switch viewModel.fileType {
        case .markdown:
            return "Markdown"
        case .code:
            return (file.name as NSString).pathExtension.uppercased()
        case .json:
            return "JSON"
        case .text:
            return "TXT"
        case .image:
            return "图片"
        case .pdf:
            return "PDF"
        case .unsupported:
            return "未知"
        }
    }
}

// MARK: - Markdown Preview Content

struct MarkdownPreviewContent: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(parseMarkdown(), id: \.id) { block in
                renderBlock(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func parseMarkdown() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = content.components(separatedBy: .newlines)
        var codeBlockContent = ""
        var inCodeBlock = false

        for line in lines {
            // Code block
            if line.hasPrefix("```") {
                if inCodeBlock {
                    blocks.append(MarkdownBlock(type: .codeBlock, content: codeBlockContent))
                    codeBlockContent = ""
                }
                inCodeBlock.toggle()
                continue
            }

            if inCodeBlock {
                codeBlockContent += (codeBlockContent.isEmpty ? "" : "\n") + line
                continue
            }

            // Heading
            if line.hasPrefix("# ") {
                blocks.append(MarkdownBlock(type: .heading1, content: String(line.dropFirst(2))))
            } else if line.hasPrefix("## ") {
                blocks.append(MarkdownBlock(type: .heading2, content: String(line.dropFirst(3))))
            } else if line.hasPrefix("### ") {
                blocks.append(MarkdownBlock(type: .heading3, content: String(line.dropFirst(4))))
            }
            // Quote
            else if line.hasPrefix("> ") {
                blocks.append(MarkdownBlock(type: .quote, content: String(line.dropFirst(2))))
            }
            // List
            else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                blocks.append(MarkdownBlock(type: .bulletList, content: String(line.dropFirst(2))))
            }
            // Checkbox
            else if line.hasPrefix("- [ ] ") {
                blocks.append(MarkdownBlock(type: .checkbox, content: String(line.dropFirst(6)), checked: false))
            } else if line.hasPrefix("- [x] ") || line.hasPrefix("- [X] ") {
                blocks.append(MarkdownBlock(type: .checkbox, content: String(line.dropFirst(6)), checked: true))
            }
            // Horizontal rule
            else if line == "---" || line == "***" || line == "___" {
                blocks.append(MarkdownBlock(type: .horizontalRule, content: ""))
            }
            // Paragraph
            else if !line.isEmpty {
                blocks.append(MarkdownBlock(type: .paragraph, content: line))
            }
        }

        return blocks
    }

    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block.type {
        case .heading1:
            Text(block.content)
                .font(.largeTitle)
                .fontWeight(.bold)
        case .heading2:
            Text(block.content)
                .font(.title)
                .fontWeight(.semibold)
        case .heading3:
            Text(block.content)
                .font(.title2)
                .fontWeight(.medium)
        case .paragraph:
            Text(parseInlineMarkdown(block.content))
        case .quote:
            HStack {
                Rectangle()
                    .fill(Color.gray)
                    .frame(width: 4)
                Text(block.content)
                    .foregroundColor(.secondary)
                    .italic()
            }
            .padding(.leading, 8)
        case .bulletList:
            HStack(alignment: .top) {
                Text("•")
                Text(block.content)
            }
            .padding(.leading, 16)
        case .checkbox:
            HStack {
                Image(systemName: block.checked ? "checkmark.square.fill" : "square")
                    .foregroundColor(block.checked ? .green : .secondary)
                Text(block.content)
            }
            .padding(.leading, 16)
        case .codeBlock:
            Text(block.content)
                .font(.system(.body, design: .monospaced))
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGray6))
                .cornerRadius(8)
        case .horizontalRule:
            Divider()
        }
    }

    private func parseInlineMarkdown(_ text: String) -> AttributedString {
        var result = AttributedString(text)

        // Bold: **text**
        if let boldRegex = try? NSRegularExpression(pattern: "\\*\\*(.+?)\\*\\*"),
           let match = boldRegex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) {
            // Simplified - just return the text for now
            // Full implementation would need proper AttributedString manipulation
        }

        return result
    }

    struct MarkdownBlock: Identifiable {
        let id = UUID()
        let type: BlockType
        let content: String
        var checked: Bool = false

        enum BlockType {
            case heading1
            case heading2
            case heading3
            case paragraph
            case quote
            case bulletList
            case checkbox
            case codeBlock
            case horizontalRule
        }
    }
}

// MARK: - Preview

#Preview {
    FileEditorView(
        file: ProjectFileEntity(
            projectId: "test",
            name: "README.md",
            path: "/README.md",
            type: "md",
            size: 100,
            content: "# Hello World\n\nThis is a **markdown** file.",
            isDirectory: false
        )
    )
}
