import SwiftUI
import Combine

/// 工具和技能浏览视图
public struct ToolsSkillsView: View {
    @StateObject private var viewModel = ToolsSkillsViewModel()
    @State private var selectedTab = 0
    @State private var searchText = ""

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Tab选择器
                Picker("类型", selection: $selectedTab) {
                    Text("工具 (\(viewModel.totalTools))").tag(0)
                    Text("技能 (\(viewModel.totalSkills))").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()

                // 搜索栏
                SearchField(text: $searchText, placeholder: selectedTab == 0 ? "搜索工具..." : "搜索技能...")
                    .padding(.horizontal)

                // 内容区域
                if selectedTab == 0 {
                    ToolsListView(
                        tools: filteredTools,
                        onToolSelect: { tool in
                            viewModel.selectedTool = tool
                        }
                    )
                } else {
                    SkillsListView(
                        skills: filteredSkills,
                        onSkillSelect: { skill in
                            viewModel.selectedSkill = skill
                        }
                    )
                }
            }
            .navigationTitle("工具与技能")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(item: $viewModel.selectedTool) { tool in
                ToolDetailSheet(tool: tool)
            }
            .sheet(item: $viewModel.selectedSkill) { skill in
                SkillDetailSheet(skill: skill)
            }
            .onAppear {
                viewModel.loadData()
            }
        }
    }

    private var filteredTools: [ToolDisplayInfo] {
        if searchText.isEmpty {
            return viewModel.tools
        }
        return viewModel.tools.filter { tool in
            tool.name.localizedCaseInsensitiveContains(searchText) ||
            tool.description.localizedCaseInsensitiveContains(searchText) ||
            tool.tags.contains { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    private var filteredSkills: [SkillDisplayInfo] {
        if searchText.isEmpty {
            return viewModel.skills
        }
        return viewModel.skills.filter { skill in
            skill.name.localizedCaseInsensitiveContains(searchText) ||
            skill.description.localizedCaseInsensitiveContains(searchText)
        }
    }
}

// MARK: - 搜索框

struct SearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)

            if !text.isEmpty {
                Button(action: { text = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
}

// MARK: - 工具列表视图

struct ToolsListView: View {
    let tools: [ToolDisplayInfo]
    let onToolSelect: (ToolDisplayInfo) -> Void

    var body: some View {
        List {
            ForEach(categoryGroups, id: \.key) { category, categoryTools in
                Section(header: HStack {
                    Text(category)
                    Spacer()
                    Text("\(categoryTools.count) 个工具")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }) {
                    ForEach(categoryTools) { tool in
                        Button(action: { onToolSelect(tool) }) {
                            ToolRow(tool: tool)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var categoryGroups: [(key: String, value: [ToolDisplayInfo])] {
        let grouped = Dictionary(grouping: tools) { $0.category }
        return grouped.sorted { $0.key < $1.key }
    }
}

struct ToolRow: View {
    let tool: ToolDisplayInfo

    var body: some View {
        HStack(spacing: 12) {
            // 工具图标
            Image(systemName: tool.icon)
                .font(.title2)
                .foregroundColor(categoryColor(tool.category))
                .frame(width: 40, height: 40)
                .background(categoryColor(tool.category).opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(tool.name)
                    .font(.headline)

                Text(tool.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                // 标签
                if !tool.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(tool.tags.prefix(3), id: \.self) { tag in
                                TagView(text: tag, color: .blue)
                            }
                        }
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func categoryColor(_ category: String) -> Color {
        switch category {
        case "system": return .blue
        case "data": return .green
        case "web": return .orange
        case "knowledge": return .purple
        default: return .gray
        }
    }
}

struct TagView: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundColor(color)
            .cornerRadius(4)
    }
}

// MARK: - 技能列表视图

struct SkillsListView: View {
    let skills: [SkillDisplayInfo]
    let onSkillSelect: (SkillDisplayInfo) -> Void

    var body: some View {
        List {
            ForEach(categoryGroups, id: \.key) { category, categorySkills in
                Section(header: HStack {
                    Text(category)
                    Spacer()
                    Text("\(categorySkills.count) 项技能")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }) {
                    ForEach(categorySkills) { skill in
                        Button(action: { onSkillSelect(skill) }) {
                            SkillRow(skill: skill)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var categoryGroups: [(key: String, value: [SkillDisplayInfo])] {
        let grouped = Dictionary(grouping: skills) { $0.category }
        return grouped.sorted { $0.key < $1.key }
    }
}

struct SkillRow: View {
    let skill: SkillDisplayInfo

    var body: some View {
        HStack(spacing: 12) {
            // 技能图标
            Image(systemName: skill.icon)
                .font(.title2)
                .foregroundColor(categoryColor(skill.category))
                .frame(width: 40, height: 40)
                .background(categoryColor(skill.category).opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(skill.name)
                    .font(.headline)

                Text(skill.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                // 子技能数量
                if skill.subSkillsCount > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.caption2)
                        Text("\(skill.subSkillsCount) 项子技能")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func categoryColor(_ category: String) -> Color {
        switch category {
        case "文档处理": return .blue
        case "数据分析": return .green
        case "代码开发": return .orange
        case "多媒体": return .purple
        case "知识管理": return .pink
        default: return .gray
        }
    }
}

// MARK: - 工具详情弹窗

struct ToolDetailSheet: View {
    let tool: ToolDisplayInfo
    @Environment(\.dismiss) var dismiss
    @State private var testInput: [String: String] = [:]
    @State private var testResult: String = ""
    @State private var isTesting = false

    var body: some View {
        NavigationView {
            List {
                // 基本信息
                Section(header: Text("基本信息")) {
                    InfoRow(label: "名称", value: tool.name)
                    InfoRow(label: "类别", value: tool.category)
                    InfoRow(label: "ID", value: tool.id)
                }

                // 描述
                Section(header: Text("功能描述")) {
                    Text(tool.description)
                        .font(.body)
                }

                // 参数
                Section(header: Text("参数列表")) {
                    ForEach(tool.parameters) { param in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(param.name)
                                    .fontWeight(.medium)
                                if param.required {
                                    Text("*")
                                        .foregroundColor(.red)
                                }
                                Spacer()
                                Text(param.type)
                                    .font(.caption)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.blue.opacity(0.1))
                                    .cornerRadius(4)
                            }

                            Text(param.description)
                                .font(.caption)
                                .foregroundColor(.secondary)

                            if let defaultValue = param.defaultValue {
                                Text("默认: \(defaultValue)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                // 返回值
                Section(header: Text("返回值")) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("类型")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(tool.returnType)
                                .fontWeight(.medium)
                        }
                        Text(tool.returnDescription)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // 标签
                if !tool.tags.isEmpty {
                    Section(header: Text("标签")) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(tool.tags, id: \.self) { tag in
                                    TagView(text: tag, color: .blue)
                                }
                            }
                        }
                    }
                }

                // 测试工具
                Section(header: Text("测试工具")) {
                    ForEach(tool.parameters.filter { $0.required }) { param in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(param.name)
                                .font(.caption)
                                .foregroundColor(.secondary)
                            TextField("输入\(param.name)", text: Binding(
                                get: { testInput[param.name] ?? "" },
                                set: { testInput[param.name] = $0 }
                            ))
                            .textFieldStyle(.roundedBorder)
                        }
                    }

                    Button(action: executeTool) {
                        HStack {
                            if isTesting {
                                ProgressView()
                                    .progressViewStyle(.circular)
                            } else {
                                Image(systemName: "play.fill")
                            }
                            Text("执行")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(isTesting || !allRequiredParamsFilled)

                    if !testResult.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("结果")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(testResult)
                                .font(.caption)
                                .fontFamily(.monospaced)
                                .padding(8)
                                .background(Color(.systemGray6))
                                .cornerRadius(8)
                        }
                    }
                }
            }
            .navigationTitle(tool.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var allRequiredParamsFilled: Bool {
        tool.parameters.filter { $0.required }.allSatisfy { param in
            !(testInput[param.name] ?? "").isEmpty
        }
    }

    private func executeTool() {
        isTesting = true
        testResult = ""

        Task {
            do {
                let result = try await ToolManager.shared.execute(toolId: tool.id, input: testInput)
                await MainActor.run {
                    testResult = "成功: \(result)"
                    isTesting = false
                }
            } catch {
                await MainActor.run {
                    testResult = "错误: \(error.localizedDescription)"
                    isTesting = false
                }
            }
        }
    }
}

// MARK: - 技能详情弹窗

struct SkillDetailSheet: View {
    let skill: SkillDisplayInfo
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            List {
                // 基本信息
                Section(header: Text("基本信息")) {
                    InfoRow(label: "名称", value: skill.name)
                    InfoRow(label: "类别", value: skill.category)
                    InfoRow(label: "ID", value: skill.id)
                }

                // 描述
                Section(header: Text("技能描述")) {
                    Text(skill.description)
                        .font(.body)
                }

                // 提示词
                if let prompt = skill.prompt {
                    Section(header: Text("系统提示词")) {
                        Text(prompt)
                            .font(.caption)
                            .fontFamily(.monospaced)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                    }
                }

                // 依赖工具
                if !skill.requiredTools.isEmpty {
                    Section(header: Text("依赖工具")) {
                        ForEach(skill.requiredTools, id: \.self) { toolId in
                            HStack {
                                Image(systemName: "wrench.fill")
                                    .foregroundColor(.blue)
                                    .font(.caption)
                                Text(toolId)
                                    .font(.subheadline)
                            }
                        }
                    }
                }

                // 子技能
                if !skill.subSkills.isEmpty {
                    Section(header: Text("子技能")) {
                        ForEach(skill.subSkills, id: \.self) { subSkillId in
                            HStack {
                                Image(systemName: "arrow.right.circle.fill")
                                    .foregroundColor(.green)
                                    .font(.caption)
                                Text(subSkillId)
                                    .font(.subheadline)
                            }
                        }
                    }
                }

                // 示例
                if !skill.examples.isEmpty {
                    Section(header: Text("使用示例")) {
                        ForEach(Array(skill.examples.enumerated()), id: \.offset) { index, example in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("示例 \(index + 1)")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                                Text(example)
                                    .font(.caption)
                                    .padding(8)
                                    .background(Color(.systemGray6))
                                    .cornerRadius(8)
                            }
                        }
                    }
                }
            }
            .navigationTitle(skill.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - ViewModel

class ToolsSkillsViewModel: ObservableObject {
    @Published var tools: [ToolDisplayInfo] = []
    @Published var skills: [SkillDisplayInfo] = []
    @Published var selectedTool: ToolDisplayInfo?
    @Published var selectedSkill: SkillDisplayInfo?

    var totalTools: Int { tools.count }
    var totalSkills: Int { skills.count }

    func loadData() {
        loadTools()
        loadSkills()
    }

    func refresh() {
        loadData()
    }

    private func loadTools() {
        let toolManager = ToolManager.shared
        let allTools = toolManager.getAllTools()

        tools = allTools.map { tool in
            ToolDisplayInfo(
                id: tool.id,
                name: tool.name,
                description: tool.description,
                category: categoryString(tool.category),
                parameters: tool.parameters.map { param in
                    ToolParameterInfo(
                        name: param.name,
                        type: typeString(param.type),
                        description: param.description,
                        required: param.required,
                        defaultValue: param.defaultValue
                    )
                },
                returnType: typeString(tool.returnType),
                returnDescription: tool.returnDescription,
                tags: tool.tags,
                icon: iconForCategory(tool.category)
            )
        }
    }

    private func loadSkills() {
        let skillManager = SkillManager.shared
        let allSkills = skillManager.getAllSkills()

        skills = allSkills.map { skill in
            SkillDisplayInfo(
                id: skill.id,
                name: skill.name,
                description: skill.description,
                category: skill.category,
                prompt: skill.systemPrompt,
                requiredTools: skill.requiredTools,
                subSkills: skill.subSkills ?? [],
                examples: skill.examples ?? [],
                icon: iconForSkillCategory(skill.category)
            )
        }
    }

    private func categoryString(_ category: ToolCategory) -> String {
        switch category {
        case .system: return "system"
        case .data: return "data"
        case .web: return "web"
        case .knowledge: return "knowledge"
        }
    }

    private func typeString(_ type: ToolParameterType) -> String {
        switch type {
        case .string: return "String"
        case .number: return "Number"
        case .boolean: return "Boolean"
        case .array: return "Array"
        case .object: return "Object"
        case .url: return "URL"
        }
    }

    private func iconForCategory(_ category: ToolCategory) -> String {
        switch category {
        case .system: return "gearshape.fill"
        case .data: return "chart.bar.fill"
        case .web: return "network"
        case .knowledge: return "brain"
        }
    }

    private func iconForSkillCategory(_ category: String) -> String {
        switch category {
        case "文档处理": return "doc.text.fill"
        case "数据分析": return "chart.line.uptrend.xyaxis"
        case "代码开发": return "chevron.left.forwardslash.chevron.right"
        case "多媒体": return "photo.on.rectangle.angled"
        case "知识管理": return "book.fill"
        default: return "star.fill"
        }
    }
}

// MARK: - Models

struct ToolDisplayInfo: Identifiable {
    let id: String
    let name: String
    let description: String
    let category: String
    let parameters: [ToolParameterInfo]
    let returnType: String
    let returnDescription: String
    let tags: [String]
    let icon: String
}

struct ToolParameterInfo: Identifiable {
    let id = UUID()
    let name: String
    let type: String
    let description: String
    let required: Bool
    let defaultValue: String?
}

struct SkillDisplayInfo: Identifiable {
    let id: String
    let name: String
    let description: String
    let category: String
    let prompt: String?
    let requiredTools: [String]
    let subSkills: [String]
    let examples: [String]
    let icon: String

    var subSkillsCount: Int { subSkills.count }
}

// MARK: - Preview

struct ToolsSkillsView_Previews: PreviewProvider {
    static var previews: some View {
        ToolsSkillsView()
    }
}
