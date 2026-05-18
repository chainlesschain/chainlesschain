import SwiftUI
import CoreP2P

/// Phase 6.4 — 远程 AI 扩展 UI（AIExtendedCommands 25 method 用得起来的入口）。
///
/// MVP scope：3 sub-tab — Templates (CRUD) / Code (explain/generate/refactor 文本)
/// / RAG (search + stats 摘要)。Multimodal (image/audio) + Agents 子界面 v0.2
/// 单独 view（multimodal 需 image picker / audio recorder, agents 需 metadata 设计）。
///
/// 入口：RemoteOperateView → 第 15 tab "AI+"。
struct AIExtendedView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    var body: some View {
        Inner(pcPeerId: pcPeerId, commands: remoteDeps.aiExtended)
    }
}

private struct Inner: View {
    @StateObject private var viewModel: RemoteAIExtendedViewModel
    @State private var showCreateTemplateSheet = false

    init(pcPeerId: String, commands: AIExtendedCommands) {
        let captured = pcPeerId
        _viewModel = StateObject(wrappedValue: RemoteAIExtendedViewModel(
            commands: commands,
            pcPeerIdProvider: { captured }
        ))
    }

    @State private var selectedSub: RemoteAIExtendedViewModel.SubTab = .templates

    var body: some View {
        VStack(spacing: 0) {
            subTabPicker
            Divider()

            Group {
                switch selectedSub {
                case .templates:
                    templatesView
                case .code:
                    codeView
                case .rag:
                    ragView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("AI 扩展")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: selectedSub) { newValue in
            Task {
                switch newValue {
                case .templates:
                    if viewModel.templates.isEmpty { await viewModel.loadTemplates() }
                case .rag:
                    if viewModel.ragStats == nil { await viewModel.loadRagStats() }
                case .code:
                    break
                }
            }
        }
        .task {
            await viewModel.loadTemplates()
        }
        .sheet(isPresented: $showCreateTemplateSheet) {
            CreateTemplateSheet { name, template, variables, category in
                Task {
                    await viewModel.saveTemplate(
                        name: name, template: template,
                        variables: variables, category: category
                    )
                    showCreateTemplateSheet = false
                }
            }
        }
        .alert("错误", isPresented: .constant(viewModel.errorMessage != nil),
               actions: {
                   Button("确定") { viewModel.errorMessage = nil }
               },
               message: {
                   Text(viewModel.errorMessage ?? "")
               })
    }

    private var subTabPicker: some View {
        Picker("视图", selection: $selectedSub) {
            ForEach(RemoteAIExtendedViewModel.SubTab.allCases) { tab in
                Label(tab.label, systemImage: tab.icon).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Templates sub

    private var templatesView: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Prompt 模板").font(.subheadline).foregroundColor(.secondary)
                Spacer()
                Button(action: { showCreateTemplateSheet = true }) {
                    Label("新建", systemImage: "plus")
                }
            }
            .padding(.horizontal).padding(.vertical, 6)

            if viewModel.templatesLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.templates.isEmpty {
                emptyView(icon: "doc.text", title: "无模板",
                          subtitle: "点右上 + 新建第一个 prompt 模板")
            } else {
                List {
                    ForEach(viewModel.templates, id: \.id) { tpl in
                        templateRow(tpl)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await viewModel.deleteTemplate(tpl) }
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                    }
                }
                .listStyle(.plain)
                .refreshable { await viewModel.loadTemplates() }
            }
        }
    }

    private func templateRow(_ tpl: PromptTemplate) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(tpl.name).font(.body).fontWeight(.medium)
                Spacer()
                if let cat = tpl.category {
                    Text(cat).font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.purple.opacity(0.15))
                        .cornerRadius(4)
                }
            }
            Text(tpl.template).font(.caption)
                .foregroundColor(.secondary).lineLimit(2)
            if !tpl.variables.isEmpty {
                HStack(spacing: 4) {
                    ForEach(tpl.variables, id: \.self) { v in
                        Text("{{\(v)}}").font(.caption2).foregroundColor(.blue)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Code sub

    private var codeView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("模式", selection: $viewModel.codeMode) {
                    ForEach(RemoteAIExtendedViewModel.CodeMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)

                Spacer()

                Picker("语言", selection: $viewModel.codeLanguage) {
                    Text("Swift").tag("Swift")
                    Text("Kotlin").tag("Kotlin")
                    Text("JS").tag("JavaScript")
                    Text("Python").tag("Python")
                    Text("Go").tag("Go")
                }
                .pickerStyle(.menu)
            }
            .padding(.horizontal).padding(.top, 8)

            Text(viewModel.codeMode == .generate ? "提示（自然语言）" : "代码")
                .font(.caption).foregroundColor(.secondary)
                .padding(.horizontal)

            TextEditor(text: $viewModel.codeInput)
                .font(.system(.body, design: .monospaced))
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)
                .padding(.horizontal)
                .frame(minHeight: 120, maxHeight: 200)

            Button(action: { Task { await viewModel.runCode() } }) {
                if viewModel.codeLoading {
                    ProgressView()
                } else {
                    Label("执行 \(viewModel.codeMode.label)", systemImage: "play.fill")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.codeLoading || viewModel.codeInput.isEmpty)
            .padding(.horizontal)

            Divider().padding(.vertical, 4)

            Text("结果").font(.caption).foregroundColor(.secondary).padding(.horizontal)

            ScrollView {
                Text(viewModel.codeResult.isEmpty ? "(等待执行)" : viewModel.codeResult)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(viewModel.codeResult.isEmpty ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .padding(.horizontal)
                    .textSelection(.enabled)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    // MARK: - RAG sub

    private var ragView: some View {
        VStack(spacing: 0) {
            if let stats = viewModel.ragStats {
                HStack {
                    Image(systemName: stats.available ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundColor(stats.available ? .green : .red)
                    if stats.available {
                        Text("\(stats.totalDocs) 文档 · \(stats.totalVectors) 向量")
                            .font(.caption)
                    } else {
                        Text("RAG 未就绪 (桌面 ragManager unavailable)").font(.caption)
                    }
                    Spacer()
                    Button {
                        Task { await viewModel.loadRagStats() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .padding(.horizontal).padding(.vertical, 8)
                .background(Color(.systemGray6))
            }

            HStack {
                TextField("语义搜索…", text: $viewModel.ragQuery)
                    .textFieldStyle(.plain)
                    .onSubmit { Task { await viewModel.searchRag() } }
                Button("搜索") { Task { await viewModel.searchRag() } }
                    .disabled(viewModel.ragQuery.isEmpty || viewModel.ragLoading)
            }
            .padding(8)
            .background(Color(.systemGray6))
            .cornerRadius(8)
            .padding(.horizontal).padding(.top, 8)

            if viewModel.ragLoading {
                ProgressView().padding()
            } else if viewModel.ragResults.isEmpty {
                emptyView(
                    icon: "magnifyingglass",
                    title: viewModel.ragQuery.isEmpty ? "请输入查询" : "无结果",
                    subtitle: "RAG 向量库语义搜索"
                )
            } else {
                List {
                    ForEach(Array(viewModel.ragResults.enumerated()), id: \.offset) { idx, r in
                        ragResultRow(r, rank: idx + 1)
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private func ragResultRow(_ r: RAGSearchResult, rank: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("#\(rank)").font(.caption).foregroundColor(.secondary)
                if let id = r.id {
                    Text(id).font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                if let score = r.score {
                    Text(String(format: "%.2f", score))
                        .font(.caption2).foregroundColor(.blue)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.blue.opacity(0.15))
                        .cornerRadius(4)
                }
            }
            if let text = r.text {
                Text(text).font(.body).lineLimit(3)
            }
            if !r.metadata.isEmpty {
                HStack(spacing: 4) {
                    ForEach(r.metadata.keys.sorted(), id: \.self) { k in
                        Text("\(k)=\(r.metadata[k] ?? "")")
                            .font(.caption2)
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(3)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - 共用

    private func emptyView(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.largeTitle).foregroundColor(.secondary)
            Text(title).font(.headline).foregroundColor(.secondary)
            Text(subtitle).font(.caption).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 新建 prompt template sheet。
private struct CreateTemplateSheet: View {
    var onSave: (String, String, [String], String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var template = ""
    @State private var variablesText = ""
    @State private var category = ""

    var body: some View {
        NavigationView {
            Form {
                Section("名称") {
                    TextField("如：总结文章", text: $name)
                }
                Section("模板内容 (用 {{var}} 占位)") {
                    TextEditor(text: $template)
                        .frame(minHeight: 150)
                        .font(.system(.body, design: .monospaced))
                }
                Section("变量名 (逗号分隔)") {
                    TextField("如：topic, length", text: $variablesText)
                        .autocapitalization(.none)
                }
                Section("分类 (可选)") {
                    TextField("如：writing / coding", text: $category)
                        .autocapitalization(.none)
                }
            }
            .navigationTitle("新建模板")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        let vars = variablesText
                            .split(separator: ",")
                            .map { $0.trimmingCharacters(in: .whitespaces) }
                            .filter { !$0.isEmpty }
                        onSave(name, template, vars, category.isEmpty ? nil : category)
                    }
                    .disabled(name.isEmpty || template.isEmpty)
                }
            }
        }
    }
}
