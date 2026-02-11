//
//  CreateHookView.swift
//  ChainlessChain
//
//  创建钩子视图
//  用于创建新钩子的表单
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 创建钩子视图
struct CreateHookView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = CreateHookViewModel()
    @State private var currentStep = 0

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 步骤指示器
                StepIndicator(currentStep: currentStep, totalSteps: 4)
                    .padding()

                // 步骤内容
                TabView(selection: $currentStep) {
                    basicInfoStep.tag(0)
                    eventConfigStep.tag(1)
                    scriptStep.tag(2)
                    reviewStep.tag(3)
                }
                .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))

                // 底部按钮
                bottomButtons
            }
            .navigationTitle("创建钩子")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
            .alert("创建成功", isPresented: $viewModel.showSuccess) {
                Button("确定") { dismiss() }
            } message: {
                Text("钩子「\(viewModel.name)」已创建成功")
            }
            .alert("创建失败", isPresented: $viewModel.showError) {
                Button("确定") { }
            } message: {
                Text(viewModel.errorMessage)
            }
        }
    }

    // MARK: - 步骤1：基本信息

    private var basicInfoStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("基本信息")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("设置钩子的名称和类型")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                // 名称
                VStack(alignment: .leading, spacing: 8) {
                    Text("钩子名称")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextField("输入钩子名称", text: $viewModel.name)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                }

                // 描述
                VStack(alignment: .leading, spacing: 8) {
                    Text("描述（可选）")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextField("描述钩子的用途", text: $viewModel.description)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                }

                // 类型选择
                VStack(alignment: .leading, spacing: 8) {
                    Text("执行类型")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    ForEach(HookType.allCases, id: \.self) { type in
                        HookTypeOption(
                            type: type,
                            isSelected: viewModel.type == type
                        ) {
                            viewModel.type = type
                        }
                    }
                }

                // 启用状态
                Toggle(isOn: $viewModel.enabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("创建后启用")
                            .font(.subheadline)
                        Text("启用后钩子将立即生效")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.top, 8)
            }
            .padding()
        }
    }

    // MARK: - 步骤2：事件配置

    private var eventConfigStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("事件配置")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("选择触发钩子的事件")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                // 事件选择
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(eventCategories, id: \.0) { category, events in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(category)
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundColor(.secondary)

                            ForEach(events, id: \.self) { event in
                                EventOption(
                                    event: event,
                                    isSelected: viewModel.event == event
                                ) {
                                    viewModel.event = event
                                }
                            }
                        }
                    }
                }

                Divider()

                // 优先级
                VStack(alignment: .leading, spacing: 8) {
                    Text("优先级")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Picker("优先级", selection: $viewModel.priorityLevel) {
                        Text("高 (100)").tag(100)
                        Text("普通 (500)").tag(500)
                        Text("低 (900)").tag(900)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }

                // 超时设置
                VStack(alignment: .leading, spacing: 8) {
                    Text("超时时间")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    HStack {
                        Slider(value: $viewModel.timeout, in: 5...60, step: 5)
                        Text("\(Int(viewModel.timeout))秒")
                            .font(.subheadline)
                            .frame(width: 50)
                    }
                }

                // 匹配工具（如果是工具相关事件）
                if viewModel.event.isToolEvent {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("匹配工具（可选）")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        TextField("输入工具名称，用逗号分隔", text: $viewModel.matchToolsInput)
                            .textFieldStyle(RoundedBorderTextFieldStyle())

                        Text("留空则匹配所有工具")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding()
        }
    }

    // MARK: - 步骤3：脚本编辑

    private var scriptStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("脚本内容")
                .font(.title2)
                .fontWeight(.bold)
                .padding(.horizontal)

            if viewModel.type == .command {
                // Shell命令输入
                VStack(alignment: .leading, spacing: 8) {
                    Text("Shell命令")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextEditor(text: $viewModel.command)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 100)
                        .padding(8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)

                    Text("命令将在Shell中执行，环境变量HOOK_EVENT和HOOK_DATA可用")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal)
            } else if viewModel.type == .script {
                // 脚本语言选择
                VStack(alignment: .leading, spacing: 8) {
                    Text("脚本语言")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Picker("语言", selection: $viewModel.scriptLanguage) {
                        Text("JavaScript").tag(ScriptLanguage.javascript)
                        Text("Python").tag(ScriptLanguage.python)
                        Text("Bash").tag(ScriptLanguage.bash)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                .padding(.horizontal)

                // 脚本编辑器
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("脚本代码")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Spacer()

                        Button(action: insertTemplate) {
                            Text("插入模板")
                                .font(.caption)
                        }
                    }

                    TextEditor(text: $viewModel.script)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 200)
                        .padding(8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                }
                .padding(.horizontal)

                // 帮助文本
                VStack(alignment: .leading, spacing: 4) {
                    Text("可用变量:")
                        .font(.caption)
                        .fontWeight(.medium)

                    Text("• hookContext - 包含事件、时间戳和数据")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("• result - 设置action为'continue'/'reject'/'modify'")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color.blue.opacity(0.1))
                .cornerRadius(8)
                .padding(.horizontal)
            } else {
                // 同步/异步类型说明
                VStack(spacing: 16) {
                    Image(systemName: "info.circle")
                        .font(.largeTitle)
                        .foregroundColor(.blue)

                    Text(viewModel.type == .sync ? "同步钩子" : "异步钩子")
                        .font(.headline)

                    Text(viewModel.type == .sync ?
                         "同步钩子将在主线程执行，可以阻止或修改操作。" :
                         "异步钩子将在后台执行，不会阻塞主操作。")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Spacer()
        }
        .padding(.top)
    }

    // MARK: - 步骤4：确认

    private var reviewStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("确认创建")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("请确认以下配置信息")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                // 配置摘要
                VStack(spacing: 12) {
                    ReviewRow(label: "名称", value: viewModel.name)
                    ReviewRow(label: "类型", value: viewModel.type.rawValue)
                    ReviewRow(label: "事件", value: viewModel.event.rawValue)
                    ReviewRow(label: "优先级", value: "\(viewModel.priorityLevel)")
                    ReviewRow(label: "超时", value: "\(Int(viewModel.timeout))秒")
                    ReviewRow(label: "状态", value: viewModel.enabled ? "启用" : "禁用")

                    if !viewModel.matchToolsInput.isEmpty {
                        ReviewRow(label: "匹配工具", value: viewModel.matchToolsInput)
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)

                // 脚本预览
                if viewModel.type == .script && !viewModel.script.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("脚本预览")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Text(viewModel.script)
                            .font(.system(.caption, design: .monospaced))
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                    }
                } else if viewModel.type == .command && !viewModel.command.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("命令预览")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Text(viewModel.command)
                            .font(.system(.caption, design: .monospaced))
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                    }
                }

                // 验证结果
                if !viewModel.validationErrors.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("验证问题")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.red)

                        ForEach(viewModel.validationErrors, id: \.self) { error in
                            HStack {
                                Image(systemName: "exclamationmark.circle")
                                    .foregroundColor(.red)
                                Text(error)
                                    .font(.caption)
                            }
                        }
                    }
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(8)
                }
            }
            .padding()
        }
    }

    // MARK: - 底部按钮

    private var bottomButtons: some View {
        HStack(spacing: 16) {
            if currentStep > 0 {
                Button(action: { withAnimation { currentStep -= 1 } }) {
                    HStack {
                        Image(systemName: "chevron.left")
                        Text("上一步")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(10)
                }
            }

            Button(action: nextStep) {
                HStack {
                    Text(currentStep == 3 ? "创建钩子" : "下一步")
                    if currentStep < 3 {
                        Image(systemName: "chevron.right")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(canProceed ? Color.blue : Color.gray)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(!canProceed)
        }
        .padding()
    }

    // MARK: - 计算属性

    private var eventCategories: [(String, [HookEvent])] {
        [
            ("IPC", [.preIPCCall, .postIPCCall, .ipcError]),
            ("工具", [.preToolUse, .postToolUse, .toolError]),
            ("会话", [.sessionStart, .sessionEnd, .preCompact, .postCompact]),
            ("Agent", [.agentStart, .agentStop, .taskAssigned, .taskCompleted]),
            ("文件", [.preFileAccess, .postFileAccess, .fileModified])
        ]
    }

    private var canProceed: Bool {
        switch currentStep {
        case 0: return !viewModel.name.isEmpty
        case 1: return true
        case 2: return viewModel.type == .sync || viewModel.type == .async ||
                       (viewModel.type == .command && !viewModel.command.isEmpty) ||
                       (viewModel.type == .script && !viewModel.script.isEmpty)
        case 3: return viewModel.validationErrors.isEmpty
        default: return false
        }
    }

    // MARK: - 方法

    private func nextStep() {
        if currentStep < 3 {
            withAnimation {
                currentStep += 1
                if currentStep == 3 {
                    viewModel.validate()
                }
            }
        } else {
            viewModel.createHook()
        }
    }

    private func insertTemplate() {
        switch viewModel.scriptLanguage {
        case .javascript:
            viewModel.script = """
            // 钩子脚本示例
            console.log('事件:', hookContext.event);

            if (hookContext.data.tool === 'example') {
                result.action = 'reject';
                result.message = '操作被拒绝';
            } else {
                result.action = 'continue';
            }
            """
        case .python:
            viewModel.script = """
            # 钩子脚本示例
            print('事件:', hook_context['event'])

            if hook_context['data'].get('tool') == 'example':
                result['action'] = 'reject'
                result['message'] = '操作被拒绝'
            else:
                result['action'] = 'continue'
            """
        case .bash:
            viewModel.script = """
            #!/bin/bash
            # 钩子脚本示例
            echo "事件: $HOOK_EVENT"

            # 返回JSON结果
            echo '{"action": "continue"}'
            """
        }
    }
}

// MARK: - ViewModel

@MainActor
class CreateHookViewModel: ObservableObject {
    @Published var name = ""
    @Published var description = ""
    @Published var type: HookType = .sync
    @Published var event: HookEvent = .preToolUse
    @Published var enabled = true
    @Published var priorityLevel = 500
    @Published var timeout: Double = 30
    @Published var matchToolsInput = ""
    @Published var command = ""
    @Published var script = ""
    @Published var scriptLanguage: ScriptLanguage = .javascript

    @Published var validationErrors: [String] = []
    @Published var showSuccess = false
    @Published var showError = false
    @Published var errorMessage = ""

    func validate() {
        validationErrors = []

        if name.isEmpty {
            validationErrors.append("请输入钩子名称")
        }

        if type == .command && command.isEmpty {
            validationErrors.append("请输入Shell命令")
        }

        if type == .script && script.isEmpty {
            validationErrors.append("请输入脚本内容")
        }

        // 验证脚本语法
        if type == .script && !script.isEmpty {
            let result = HookScriptExecutor.shared.validateScript(
                script: script,
                language: scriptLanguage
            )
            if !result.isValid {
                validationErrors.append(contentsOf: result.errors)
            }
        }
    }

    func createHook() {
        let matchTools = matchToolsInput.isEmpty ? nil :
            matchToolsInput.split(separator: ",").map { String($0.trimmingCharacters(in: .whitespaces)) }

        let hook = HookConfig(
            event: event,
            name: name,
            type: type,
            priority: priorityLevel,
            enabled: enabled,
            timeout: Int(timeout),
            command: type == .command ? command : nil,
            script: type == .script ? script : nil,
            matchTools: matchTools
        )

        do {
            try HookRepository.shared.addHook(hook)
            showSuccess = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - 辅助视图

private struct StepIndicator: View {
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<totalSteps, id: \.self) { step in
                Circle()
                    .fill(step <= currentStep ? Color.blue : Color.gray.opacity(0.3))
                    .frame(width: 8, height: 8)

                if step < totalSteps - 1 {
                    Rectangle()
                        .fill(step < currentStep ? Color.blue : Color.gray.opacity(0.3))
                        .frame(height: 2)
                }
            }
        }
    }
}

private struct HookTypeOption: View {
    let type: HookType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .blue : .gray)

                VStack(alignment: .leading, spacing: 2) {
                    Text(type.rawValue)
                        .font(.subheadline)
                        .foregroundColor(.primary)

                    Text(typeDescription)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }
            .padding()
            .background(isSelected ? Color.blue.opacity(0.1) : Color(.secondarySystemBackground))
            .cornerRadius(10)
        }
    }

    private var typeDescription: String {
        switch type {
        case .sync: return "同步执行，可阻止操作"
        case .async: return "异步执行，不阻塞"
        case .command: return "执行Shell命令"
        case .script: return "执行脚本文件"
        }
    }
}

private struct EventOption: View {
    let event: HookEvent
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .blue : .gray)

                Text(event.rawValue)
                    .font(.subheadline)
                    .foregroundColor(.primary)

                Spacer()
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
            .cornerRadius(8)
        }
    }
}

private struct ReviewRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
        }
    }
}

// MARK: - HookEvent Extension

extension HookEvent {
    var isToolEvent: Bool {
        switch self {
        case .preToolUse, .postToolUse, .toolError:
            return true
        default:
            return false
        }
    }
}

// MARK: - 预览

#if DEBUG
struct CreateHookView_Previews: PreviewProvider {
    static var previews: some View {
        CreateHookView()
    }
}
#endif
