import SwiftUI
import CoreCommon

/// 导出菜单视图
/// Reference: desktop-app-vue/src/renderer/components/projects/FileExportMenu.vue
struct ExportMenuView: View {
    let projectId: String
    let file: ProjectFileEntity?
    var onExportComplete: ((URL?) -> Void)?

    @StateObject private var viewModel: ExportViewModel
    @Environment(\.dismiss) private var dismiss

    init(projectId: String, file: ProjectFileEntity? = nil, onExportComplete: ((URL?) -> Void)? = nil) {
        self.projectId = projectId
        self.file = file
        self.onExportComplete = onExportComplete
        _viewModel = StateObject(wrappedValue: ExportViewModel(projectId: projectId))
    }

    var body: some View {
        NavigationView {
            Form {
                // Export scope
                Section(header: Text("导出范围")) {
                    Picker("导出", selection: $viewModel.exportScope) {
                        Text("当前文件").tag(ExportViewModel.ExportScope.currentFile)
                        Text("整个项目").tag(ExportViewModel.ExportScope.project)
                    }
                    .disabled(file == nil)
                }

                // Export format
                Section(header: Text("导出格式")) {
                    ForEach(ExportViewModel.ExportFormat.allCases, id: \.self) { format in
                        formatRow(format: format)
                    }
                }

                // Export options
                Section(header: Text("导出选项")) {
                    Toggle("包含目录", isOn: $viewModel.includeTOC)
                        .disabled(viewModel.selectedFormat != .pdf && viewModel.selectedFormat != .html)

                    Toggle("包含页眉页脚", isOn: $viewModel.includeHeaderFooter)
                        .disabled(viewModel.selectedFormat != .pdf)

                    if viewModel.selectedFormat == .html {
                        Toggle("包含样式", isOn: $viewModel.includeStyles)
                    }
                }

                // Theme (for PDF/HTML)
                if viewModel.selectedFormat == .pdf || viewModel.selectedFormat == .html {
                    Section(header: Text("主题")) {
                        Picker("主题", selection: $viewModel.theme) {
                            Text("默认").tag("default")
                            Text("学术").tag("academic")
                            Text("商务").tag("business")
                            Text("简约").tag("minimal")
                        }
                    }
                }
            }
            .navigationTitle("导出文档")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            await exportDocument()
                        }
                    } label: {
                        if viewModel.isExporting {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Text("导出")
                        }
                    }
                    .disabled(viewModel.isExporting)
                }
            }
            .alert("错误", isPresented: .constant(viewModel.error != nil)) {
                Button("确定") { viewModel.error = nil }
            } message: {
                Text(viewModel.error ?? "")
            }
        }
    }

    private func formatRow(format: ExportViewModel.ExportFormat) -> some View {
        Button {
            viewModel.selectedFormat = format
        } label: {
            HStack {
                Image(systemName: format.icon)
                    .font(.title3)
                    .foregroundColor(format.color)
                    .frame(width: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(format.displayName)
                        .font(.body)
                        .foregroundColor(.primary)

                    Text(format.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                if viewModel.selectedFormat == format {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.blue)
                }
            }
        }
    }

    private func exportDocument() async {
        let result = await viewModel.export(file: file)
        if let url = result {
            onExportComplete?(url)
            dismiss()
        }
    }
}

// MARK: - Export View Model

@MainActor
class ExportViewModel: ObservableObject {
    // MARK: - Types

    enum ExportScope {
        case currentFile
        case project
    }

    enum ExportFormat: String, CaseIterable {
        case pdf
        case html
        case markdown
        case txt

        var displayName: String {
            switch self {
            case .pdf: return "PDF"
            case .html: return "HTML"
            case .markdown: return "Markdown"
            case .txt: return "纯文本"
            }
        }

        var description: String {
            switch self {
            case .pdf: return "适合打印和正式文档"
            case .html: return "适合网页浏览和分享"
            case .markdown: return "适合技术文档和编辑"
            case .txt: return "最简单的纯文本格式"
            }
        }

        var icon: String {
            switch self {
            case .pdf: return "doc.richtext"
            case .html: return "globe"
            case .markdown: return "doc.text"
            case .txt: return "doc.plaintext"
            }
        }

        var color: Color {
            switch self {
            case .pdf: return .red
            case .html: return .orange
            case .markdown: return .blue
            case .txt: return .gray
            }
        }

        var fileExtension: String {
            rawValue
        }
    }

    // MARK: - Published Properties

    @Published var exportScope: ExportScope = .currentFile
    @Published var selectedFormat: ExportFormat = .pdf
    @Published var includeTOC: Bool = true
    @Published var includeHeaderFooter: Bool = true
    @Published var includeStyles: Bool = true
    @Published var theme: String = "default"
    @Published var isExporting: Bool = false
    @Published var error: String?

    // MARK: - Dependencies

    private let exportManager = DocumentExportManager.shared
    private let projectManager = ProjectManager.shared
    private let logger = Logger.shared

    // MARK: - Project Context

    let projectId: String

    // MARK: - Initialization

    init(projectId: String) {
        self.projectId = projectId
    }

    // MARK: - Export

    func export(file: ProjectFileEntity?) async -> URL? {
        isExporting = true
        error = nil

        do {
            let options = DocumentExportManager.ExportOptions(
                format: selectedFormat.rawValue,
                theme: theme,
                includeTOC: includeTOC,
                includeStyles: includeStyles,
                includeHeaderFooter: includeHeaderFooter
            )

            let result: DocumentExportManager.ExportResult

            if exportScope == .currentFile, let file = file {
                result = try await exportManager.exportDocument(
                    content: file.content ?? "",
                    title: file.name,
                    options: options
                )
            } else {
                result = try await exportManager.exportProjectDocuments(
                    projectId: projectId,
                    options: options
                )
            }

            logger.info("Export completed: \(result.fileName)", category: "Export")
            isExporting = false
            return result.fileURL

        } catch {
            self.error = "导出失败: \(error.localizedDescription)"
            logger.error("Export failed", error: error, category: "Export")
            isExporting = false
            return nil
        }
    }
}

// MARK: - Quick Export Button

struct QuickExportButton: View {
    let projectId: String
    let file: ProjectFileEntity?
    @State private var showExportMenu = false
    @State private var exportedURL: URL?
    @State private var showShareSheet = false

    var body: some View {
        Button {
            showExportMenu = true
        } label: {
            Label("导出", systemImage: "square.and.arrow.up")
        }
        .sheet(isPresented: $showExportMenu) {
            ExportMenuView(projectId: projectId, file: file) { url in
                if let url = url {
                    exportedURL = url
                    showShareSheet = true
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if let url = exportedURL {
                ShareSheet(activityItems: [url])
            }
        }
    }
}

// MARK: - Share Sheet

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    var applicationActivities: [UIActivity]? = nil

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: applicationActivities
        )
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Inline Export Menu

struct InlineExportMenu: View {
    let projectId: String
    let file: ProjectFileEntity?
    @State private var showExportSheet = false

    var body: some View {
        Menu {
            Button {
                showExportSheet = true
            } label: {
                Label("导出设置...", systemImage: "gear")
            }

            Divider()

            Button {
                Task { await quickExport(format: .pdf) }
            } label: {
                Label("导出为PDF", systemImage: "doc.richtext")
            }

            Button {
                Task { await quickExport(format: .html) }
            } label: {
                Label("导出为HTML", systemImage: "globe")
            }

            Button {
                Task { await quickExport(format: .markdown) }
            } label: {
                Label("导出为Markdown", systemImage: "doc.text")
            }

            Button {
                Task { await quickExport(format: .txt) }
            } label: {
                Label("导出为纯文本", systemImage: "doc.plaintext")
            }
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .sheet(isPresented: $showExportSheet) {
            ExportMenuView(projectId: projectId, file: file)
        }
    }

    @MainActor
    private func quickExport(format: ExportViewModel.ExportFormat) async {
        let viewModel = ExportViewModel(projectId: projectId)
        viewModel.selectedFormat = format
        if let url = await viewModel.export(file: file) {
            // Share the exported file
            let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let window = windowScene.windows.first,
               let rootVC = window.rootViewController {
                rootVC.present(activityVC, animated: true)
            }
        }
    }
}

// MARK: - Preview

#Preview {
    ExportMenuView(projectId: "test-project", file: nil)
}
