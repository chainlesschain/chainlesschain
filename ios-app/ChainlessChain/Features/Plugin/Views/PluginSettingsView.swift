//
//  PluginSettingsView.swift
//  ChainlessChain
//
//  插件设置视图
//  配置插件的各项设置
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 插件设置视图
struct PluginSettingsView: View {
    let plugin: Plugin
    @Environment(\.dismiss) var dismiss

    @State private var settings: [String: Any] = [:]
    @State private var confirmAllActions = false
    @State private var maxRequestsPerMinute = 60
    @State private var isSaving = false

    var body: some View {
        NavigationView {
            Form {
                // 基本设置
                Section(header: Text("基本设置")) {
                    Toggle("确认所有动作", isOn: $confirmAllActions)

                    Stepper(
                        "每分钟最大请求: \(maxRequestsPerMinute)",
                        value: $maxRequestsPerMinute,
                        in: 1...200
                    )
                }

                // 插件自定义设置
                if !plugin.manifest.settings.isEmpty {
                    Section(header: Text("插件设置")) {
                        ForEach(plugin.manifest.settings) { setting in
                            settingRow(setting)
                        }
                    }
                }

                // 权限管理
                Section(header: Text("权限管理")) {
                    permissionsList
                }

                // 重置
                Section {
                    Button(action: resetSettings) {
                        HStack {
                            Image(systemName: "arrow.counterclockwise")
                            Text("重置为默认设置")
                        }
                        .foregroundColor(.orange)
                    }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        saveSettings()
                    }
                    .disabled(isSaving)
                }
            }
            .onAppear {
                loadSettings()
            }
        }
    }

    // MARK: - 设置行

    @ViewBuilder
    private func settingRow(_ setting: PluginSetting) -> some View {
        switch setting.type {
        case .boolean:
            Toggle(setting.title, isOn: Binding(
                get: { settings[setting.key] as? Bool ?? false },
                set: { settings[setting.key] = $0 }
            ))

        case .string:
            VStack(alignment: .leading, spacing: 4) {
                Text(setting.title)
                    .font(.subheadline)

                if let description = setting.description {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                TextField("", text: Binding(
                    get: { settings[setting.key] as? String ?? "" },
                    set: { settings[setting.key] = $0 }
                ))
                .textFieldStyle(RoundedBorderTextFieldStyle())
            }

        case .number:
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(setting.title)
                        .font(.subheadline)

                    Spacer()

                    Text("\(Int(settings[setting.key] as? Double ?? 0))")
                        .foregroundColor(.secondary)
                }

                if let validation = setting.validation,
                   let min = validation.min,
                   let max = validation.max {
                    Slider(
                        value: Binding(
                            get: { settings[setting.key] as? Double ?? min },
                            set: { settings[setting.key] = $0 }
                        ),
                        in: min...max
                    )
                }
            }

        case .select:
            if let options = setting.options {
                Picker(setting.title, selection: Binding(
                    get: { settings[setting.key] as? String ?? "" },
                    set: { settings[setting.key] = $0 }
                )) {
                    ForEach(options, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
            }

        case .multiSelect:
            if let options = setting.options {
                VStack(alignment: .leading, spacing: 8) {
                    Text(setting.title)
                        .font(.subheadline)

                    ForEach(options, id: \.value) { option in
                        let selectedValues = settings[setting.key] as? [String] ?? []
                        let isSelected = selectedValues.contains(option.value)

                        Button(action: {
                            var values = selectedValues
                            if isSelected {
                                values.removeAll { $0 == option.value }
                            } else {
                                values.append(option.value)
                            }
                            settings[setting.key] = values
                        }) {
                            HStack {
                                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                                    .foregroundColor(isSelected ? .blue : .gray)
                                Text(option.label)
                                    .foregroundColor(.primary)
                            }
                        }
                    }
                }
            }

        case .color:
            ColorPicker(setting.title, selection: Binding(
                get: {
                    if let hex = settings[setting.key] as? String {
                        return Color(hex: hex)
                    }
                    return .blue
                },
                set: { color in
                    settings[setting.key] = color.toHex()
                }
            ))

        case .file, .folder:
            VStack(alignment: .leading, spacing: 4) {
                Text(setting.title)
                    .font(.subheadline)

                HStack {
                    Text(settings[setting.key] as? String ?? "未选择")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    Button("选择") {
                        // 文件选择器
                    }
                    .font(.caption)
                }
            }
        }
    }

    // MARK: - 权限列表

    private var permissionsList: some View {
        Group {
            ForEach(plugin.permissions.grantedPermissions, id: \.self) { permission in
                HStack {
                    Image(systemName: permissionIcon(permission))
                        .foregroundColor(permissionColor(permission))
                        .frame(width: 24)

                    Text(permissionDisplayName(permission))
                        .font(.subheadline)

                    Spacer()

                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                }
            }
        }
    }

    // MARK: - 方法

    private func loadSettings() {
        // 加载已保存的设置
        for setting in plugin.manifest.settings {
            if let defaultValue = setting.defaultValue {
                settings[setting.key] = defaultValue.value
            }
        }
    }

    private func saveSettings() {
        isSaving = true

        // 保存设置
        Task {
            defer { isSaving = false }

            // 更新插件策略
            let policy = PluginSpecificPolicy(
                enabled: true,
                confirmAllActions: confirmAllActions,
                maxRequestsPerMinute: maxRequestsPerMinute
            )

            PluginSecurityPolicy.shared.updatePluginPolicy(plugin.id, policy: policy)

            // 保存自定义设置到UserDefaults或其他存储
            // ...

            dismiss()
        }
    }

    private func resetSettings() {
        // 重置为默认值
        for setting in plugin.manifest.settings {
            if let defaultValue = setting.defaultValue {
                settings[setting.key] = defaultValue.value
            } else {
                settings.removeValue(forKey: setting.key)
            }
        }

        confirmAllActions = false
        maxRequestsPerMinute = 60
    }

    private func permissionIcon(_ permission: String) -> String {
        if permission.contains("filesystem") { return "folder" }
        if permission.contains("network") { return "network" }
        if permission.contains("system") { return "gearshape.2" }
        if permission.contains("ai") { return "brain" }
        if permission.contains("blockchain") { return "link" }
        return "checkmark.shield"
    }

    private func permissionColor(_ permission: String) -> Color {
        if permission.contains("transfer") || permission.contains("sign") { return .red }
        if permission.contains("write") || permission.contains("shell") { return .orange }
        return .blue
    }

    private func permissionDisplayName(_ permission: String) -> String {
        let mapping: [String: String] = [
            "filesystem.read": "读取文件",
            "filesystem.write": "写入文件",
            "filesystem.execute": "执行程序",
            "network.http": "HTTP网络访问",
            "network.websocket": "WebSocket连接",
            "system.clipboard": "剪贴板访问",
            "system.notifications": "发送通知",
            "system.shell": "Shell执行",
            "ai.chat": "AI对话",
            "ai.embedding": "向量嵌入",
            "ai.toolUse": "AI工具使用",
            "blockchain.read": "读取区块链",
            "blockchain.sign": "签名交易",
            "blockchain.transfer": "转账权限"
        ]
        return mapping[permission] ?? permission
    }
}

// MARK: - Color Extensions

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    func toHex() -> String {
        guard let components = UIColor(self).cgColor.components else {
            return "#000000"
        }

        let r = Int(components[0] * 255)
        let g = Int(components[1] * 255)
        let b = Int(components[2] * 255)

        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

// MARK: - 预览

#if DEBUG
struct PluginSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        PluginSettingsView(plugin: Plugin(
            name: "Test Plugin",
            version: "1.0.0"
        ))
    }
}
#endif
