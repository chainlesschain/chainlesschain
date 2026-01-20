import SwiftUI
import CoreCommon

/// Git操作视图
/// Reference: desktop-app-vue/src/renderer/components/projects/GitStatusDialog.vue
struct GitOperationsView: View {
    let projectId: String

    @StateObject private var viewModel: GitViewModel
    @State private var selectedTab: GitTab = .status
    @State private var showCreateBranchSheet = false
    @State private var showInitSheet = false
    @State private var newBranchName = ""
    @State private var remoteUrl = ""

    enum GitTab: String, CaseIterable {
        case status = "状态"
        case commits = "历史"
        case branches = "分支"
    }

    init(projectId: String) {
        self.projectId = projectId
        _viewModel = StateObject(wrappedValue: GitViewModel(projectId: projectId))
    }

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isInitialized {
                // Tab selector
                Picker("", selection: $selectedTab) {
                    ForEach(GitTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                // Tab content
                switch selectedTab {
                case .status:
                    statusView
                case .commits:
                    commitsView
                case .branches:
                    branchesView
                }
            } else {
                notInitializedView
            }
        }
        .background(Color(.systemGroupedBackground))
        .sheet(isPresented: $showCreateBranchSheet) {
            createBranchSheet
        }
        .sheet(isPresented: $showInitSheet) {
            initRepositorySheet
        }
        .alert("错误", isPresented: .constant(viewModel.error != nil)) {
            Button("确定") { viewModel.clearMessages() }
        } message: {
            Text(viewModel.error ?? "")
        }
        .alert("成功", isPresented: .constant(viewModel.successMessage != nil)) {
            Button("确定") { viewModel.clearMessages() }
        } message: {
            Text(viewModel.successMessage ?? "")
        }
    }

    // MARK: - Not Initialized View

    private var notInitializedView: some View {
        VStack(spacing: 20) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 64))
                .foregroundColor(.secondary)

            Text("Git未初始化")
                .font(.title2)
                .fontWeight(.medium)

            Text("初始化Git仓库以开始版本控制")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button {
                showInitSheet = true
            } label: {
                Label("初始化仓库", systemImage: "plus.circle")
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Init Repository Sheet

    private var initRepositorySheet: some View {
        NavigationView {
            Form {
                Section(header: Text("远程仓库（可选）")) {
                    TextField("https://github.com/user/repo.git", text: $remoteUrl)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }

                Section(footer: Text("如果不设置远程仓库，可以稍后添加")) {
                    // Info about local git
                }
            }
            .navigationTitle("初始化Git仓库")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        showInitSheet = false
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("初始化") {
                        Task {
                            await viewModel.initRepository(remoteUrl: remoteUrl.isEmpty ? nil : remoteUrl)
                            showInitSheet = false
                        }
                    }
                    .disabled(viewModel.isLoading)
                }
            }
        }
    }

    // MARK: - Status View

    private var statusView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Current branch info
                branchInfoCard

                // Changes section
                if let status = viewModel.status {
                    changesSection(status: status)
                }

                // Commit section
                commitSection
            }
            .padding()
        }
    }

    private var branchInfoCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("当前分支")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack {
                    Image(systemName: "arrow.triangle.branch")
                        .foregroundColor(.blue)
                    Text(viewModel.currentBranch)
                        .font(.headline)
                }
            }

            Spacer()

            // Pull/Push buttons
            HStack(spacing: 12) {
                Button {
                    Task { await viewModel.pull() }
                } label: {
                    Image(systemName: "arrow.down.circle")
                        .font(.title2)
                }
                .disabled(viewModel.isLoading)

                Button {
                    Task { await viewModel.push() }
                } label: {
                    Image(systemName: "arrow.up.circle")
                        .font(.title2)
                }
                .disabled(viewModel.isLoading)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    private func changesSection(status: GitStatus) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("更改")
                    .font(.headline)

                Spacer()

                if !status.isClean {
                    Button("全部暂存") {
                        viewModel.stageAll()
                    }
                    .font(.caption)
                }
            }

            if status.isClean {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("工作区干净")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding()
            } else {
                // Staged files
                if !status.staged.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("已暂存")
                            .font(.subheadline)
                            .foregroundColor(.green)

                        ForEach(status.staged, id: \.path) { file in
                            fileStatusRow(file: file, isStaged: true)
                        }
                    }
                }

                // Unstaged files
                if !status.unstaged.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("未暂存")
                            .font(.subheadline)
                            .foregroundColor(.orange)

                        ForEach(status.unstaged, id: \.path) { file in
                            fileStatusRow(file: file, isStaged: false)
                        }
                    }
                }

                // Untracked files
                if !status.untracked.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("未跟踪")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        ForEach(status.untracked, id: \.self) { path in
                            HStack {
                                Text("?")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.gray)
                                    .frame(width: 20)

                                Text(path)
                                    .font(.subheadline)
                                    .lineLimit(1)

                                Spacer()

                                Button {
                                    viewModel.stageFile(path: path)
                                } label: {
                                    Image(systemName: "plus.circle")
                                        .foregroundColor(.blue)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    private func fileStatusRow(file: GitFileStatus, isStaged: Bool) -> some View {
        HStack {
            Text(file.status.rawValue)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(statusColor(file.status))
                .frame(width: 20)

            Text(file.path)
                .font(.subheadline)
                .lineLimit(1)

            Spacer()

            if isStaged {
                Button {
                    viewModel.unstageFile(path: file.path)
                } label: {
                    Image(systemName: "minus.circle")
                        .foregroundColor(.red)
                }
            } else {
                Button {
                    viewModel.stageFile(path: file.path)
                } label: {
                    Image(systemName: "plus.circle")
                        .foregroundColor(.blue)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func statusColor(_ status: GitFileState) -> Color {
        switch status {
        case .added:
            return .green
        case .modified:
            return .orange
        case .deleted:
            return .red
        case .renamed:
            return .blue
        }
    }

    private var commitSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("提交")
                    .font(.headline)

                Spacer()

                Button {
                    Task { await viewModel.generateCommitMessage() }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                        Text("AI生成")
                    }
                    .font(.caption)
                }
                .disabled(viewModel.isLoading)
            }

            TextEditor(text: $viewModel.commitMessage)
                .frame(height: 100)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)

            Button {
                Task { await viewModel.commit() }
            } label: {
                HStack {
                    if viewModel.isLoading {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "checkmark.circle")
                    }
                    Text("提交")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoading)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - Commits View

    private var commitsView: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if viewModel.commits.isEmpty {
                    Text("暂无提交记录")
                        .foregroundColor(.secondary)
                        .padding()
                } else {
                    ForEach(viewModel.commits, id: \.hash) { commit in
                        commitRow(commit: commit)
                    }
                }
            }
            .padding()
        }
    }

    private func commitRow(commit: GitCommit) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(commit.hash.prefix(7)))
                    .font(.system(.caption, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.blue.opacity(0.1))
                    .foregroundColor(.blue)
                    .cornerRadius(4)

                Spacer()

                Text(commit.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(commit.message)
                .font(.subheadline)
                .lineLimit(2)

            Text(commit.author)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .onTapGesture {
            viewModel.showCommitDetails(commitHash: commit.hash)
        }
    }

    // MARK: - Branches View

    private var branchesView: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Create branch button
                Button {
                    newBranchName = ""
                    showCreateBranchSheet = true
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("创建新分支")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)

                // Branch list
                ForEach(viewModel.branches, id: \.name) { branch in
                    branchRow(branch: branch)
                }
            }
            .padding()
        }
    }

    private func branchRow(branch: GitBranch) -> some View {
        HStack {
            Image(systemName: branch.isCurrent ? "checkmark.circle.fill" : "arrow.triangle.branch")
                .foregroundColor(branch.isCurrent ? .green : .secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(branch.name)
                    .font(.subheadline)
                    .fontWeight(branch.isCurrent ? .semibold : .regular)

                if let lastCommit = branch.lastCommit {
                    Text(lastCommit.prefix(7))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            if !branch.isCurrent {
                Menu {
                    Button {
                        Task { await viewModel.checkout(branchName: branch.name) }
                    } label: {
                        Label("切换", systemImage: "arrow.right.circle")
                    }

                    Button {
                        Task { await viewModel.merge(sourceBranch: branch.name) }
                    } label: {
                        Label("合并到当前分支", systemImage: "arrow.triangle.merge")
                    }

                    Divider()

                    Button(role: .destructive) {
                        Task { await viewModel.deleteBranch(name: branch.name) }
                    } label: {
                        Label("删除", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - Create Branch Sheet

    private var createBranchSheet: some View {
        NavigationView {
            Form {
                Section(header: Text("分支名称")) {
                    TextField("feature/new-feature", text: $newBranchName)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }

                Section(footer: Text("新分支将基于当前分支 '\(viewModel.currentBranch)' 创建")) {
                    // Info
                }
            }
            .navigationTitle("创建分支")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        showCreateBranchSheet = false
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        Task {
                            await viewModel.createBranch(name: newBranchName)
                            showCreateBranchSheet = false
                        }
                    }
                    .disabled(newBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoading)
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    GitOperationsView(projectId: "test-project")
}
