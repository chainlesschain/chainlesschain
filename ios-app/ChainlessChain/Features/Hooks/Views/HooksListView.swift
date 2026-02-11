//
//  HooksListView.swift
//  ChainlessChain
//
//  钩子列表视图
//  显示和管理所有钩子
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 钩子列表视图
struct HooksListView: View {
    @StateObject private var repository = HookRepositoryViewModel()
    @State private var searchText = ""
    @State private var selectedEvent: HookEvent?
    @State private var showCreateHook = false
    @State private var selectedHook: HookConfig?

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索和过滤
                searchAndFilterBar

                // 钩子列表
                if repository.hooks.isEmpty {
                    emptyView
                } else {
                    hooksList
                }
            }
            .navigationTitle("钩子管理")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showCreateHook = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showCreateHook) {
                CreateHookView()
            }
            .sheet(item: $selectedHook) { hook in
                HookDetailView(hook: hook)
            }
            .onAppear {
                repository.loadHooks()
            }
        }
    }

    // MARK: - 搜索和过滤栏

    private var searchAndFilterBar: some View {
        VStack(spacing: 8) {
            // 搜索栏
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.gray)

                TextField("搜索钩子...", text: $searchText)

                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.gray)
                    }
                }
            }
            .padding(10)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)

            // 事件过滤器
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    EventFilterChip(title: "全部", isSelected: selectedEvent == nil) {
                        selectedEvent = nil
                    }

                    ForEach(eventCategories, id: \.0) { category, events in
                        Menu {
                            ForEach(events, id: \.self) { event in
                                Button(event.rawValue) {
                                    selectedEvent = event
                                }
                            }
                        } label: {
                            EventFilterChip(
                                title: category,
                                isSelected: events.contains(where: { $0 == selectedEvent })
                            )
                        }
                    }
                }
            }
        }
        .padding()
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            Text("没有配置钩子")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("钩子允许在特定事件发生时执行自定义逻辑")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button(action: { showCreateHook = true }) {
                Text("创建钩子")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }

            Spacer()
        }
    }

    // MARK: - 钩子列表

    private var hooksList: some View {
        List {
            ForEach(filteredHooks) { hook in
                HookRow(hook: hook) {
                    selectedHook = hook
                } onToggle: { enabled in
                    repository.toggleHook(hook.id, enabled: enabled)
                }
            }
            .onDelete { indexSet in
                for index in indexSet {
                    let hook = filteredHooks[index]
                    repository.deleteHook(hook.id)
                }
            }
        }
        .listStyle(InsetGroupedListStyle())
    }

    // MARK: - 计算属性

    private var filteredHooks: [HookConfig] {
        var result = repository.hooks

        if let event = selectedEvent {
            result = result.filter { $0.event == event }
        }

        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                $0.event.rawValue.lowercased().contains(query)
            }
        }

        return result.sorted { $0.priority < $1.priority }
    }

    private var eventCategories: [(String, [HookEvent])] {
        [
            ("IPC", [.preIPCCall, .postIPCCall, .ipcError]),
            ("工具", [.preToolUse, .postToolUse, .toolError]),
            ("会话", [.sessionStart, .sessionEnd, .preCompact, .postCompact]),
            ("Agent", [.agentStart, .agentStop, .taskAssigned, .taskCompleted]),
            ("文件", [.preFileAccess, .postFileAccess, .fileModified])
        ]
    }
}

// MARK: - 事件过滤标签

struct EventFilterChip: View {
    let title: String
    let isSelected: Bool
    var action: (() -> Void)?

    var body: some View {
        Button(action: { action?() }) {
            Text(title)
                .font(.caption)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.blue : Color(.secondarySystemBackground))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(16)
        }
    }
}

// MARK: - 钩子行

struct HookRow: View {
    let hook: HookConfig
    let onTap: () -> Void
    let onToggle: (Bool) -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // 类型图标
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(typeColor.opacity(0.1))
                        .frame(width: 40, height: 40)

                    Image(systemName: typeIcon)
                        .foregroundColor(typeColor)
                }

                // 信息
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(hook.name)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)

                        Text(hook.event.rawValue)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.1))
                            .foregroundColor(.blue)
                            .cornerRadius(4)
                    }

                    HStack(spacing: 8) {
                        Text(hook.type.rawValue)
                            .font(.caption)
                            .foregroundColor(.secondary)

                        if hook.executionCount > 0 {
                            Text("•")
                                .foregroundColor(.secondary)

                            Text("\(hook.executionCount)次执行")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Spacer()

                // 开关
                Toggle("", isOn: Binding(
                    get: { hook.enabled },
                    set: { onToggle($0) }
                ))
                .labelsHidden()
            }
        }
        .buttonStyle(PlainButtonStyle())
    }

    private var typeIcon: String {
        switch hook.type {
        case .sync: return "arrow.right"
        case .async: return "arrow.triangle.2.circlepath"
        case .command: return "terminal"
        case .script: return "doc.text"
        }
    }

    private var typeColor: Color {
        switch hook.type {
        case .sync: return .blue
        case .async: return .green
        case .command: return .orange
        case .script: return .purple
        }
    }
}

// MARK: - ViewModel

@MainActor
class HookRepositoryViewModel: ObservableObject {
    @Published var hooks: [HookConfig] = []

    private let repository = HookRepository.shared

    func loadHooks() {
        hooks = repository.getAllHooks()
    }

    func toggleHook(_ id: String, enabled: Bool) {
        try? repository.setHookEnabled(id, enabled: enabled)
        loadHooks()
    }

    func deleteHook(_ id: String) {
        try? repository.deleteHook(id)
        loadHooks()
    }
}

// MARK: - 预览

#if DEBUG
struct HooksListView_Previews: PreviewProvider {
    static var previews: some View {
        HooksListView()
    }
}
#endif
