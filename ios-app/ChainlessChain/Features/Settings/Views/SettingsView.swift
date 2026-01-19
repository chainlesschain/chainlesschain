import SwiftUI
import CoreCommon

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingLogoutAlert = false
    @State private var showingChangePINSheet = false
    @State private var biometricEnabled = UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.biometricEnabled)
    @State private var autoSyncEnabled = UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.autoSyncEnabled)

    var body: some View {
        NavigationView {
            Form {
                // 账户信息
                Section("账户") {
                    if let did = appState.currentDID {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("DID")
                                .font(.caption)
                                .foregroundColor(.gray)
                            Text(did)
                                .font(.footnote)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    Button("更改 PIN 码") {
                        showingChangePINSheet = true
                    }
                }

                // 安全设置
                Section("安全") {
                    Toggle("生物识别解锁", isOn: $biometricEnabled)
                        .onChange(of: biometricEnabled) { _, newValue in
                            UserDefaults.standard.set(newValue, forKey: AppConstants.UserDefaults.biometricEnabled)
                        }

                    NavigationLink("数据备份") {
                        Text("备份功能即将推出")
                    }
                }

                // AI 设置
                Section("AI 功能") {
                    NavigationLink("LLM 配置") {
                        LLMSettingsView()
                    }
                }

                // 同步设置
                Section("同步") {
                    Toggle("自动同步", isOn: $autoSyncEnabled)
                        .onChange(of: autoSyncEnabled) { _, newValue in
                            UserDefaults.standard.set(newValue, forKey: AppConstants.UserDefaults.autoSyncEnabled)
                        }

                    Button("立即同步") {
                        // TODO: Trigger sync
                    }
                }

                // 关于
                Section("关于") {
                    HStack {
                        Text("版本")
                        Spacer()
                        Text(AppConstants.App.version)
                            .foregroundColor(.gray)
                    }

                    HStack {
                        Text("构建号")
                        Spacer()
                        Text(AppConstants.App.buildNumber)
                            .foregroundColor(.gray)
                    }

                    Link("项目主页", destination: URL(string: "https://github.com/yourusername/chainlesschain")!)
                    Link("帮助文档", destination: URL(string: "https://docs.chainlesschain.com")!)
                }

                // 退出登录
                Section {
                    Button(role: .destructive) {
                        showingLogoutAlert = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("退出登录")
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("设置")
            .alert("确认退出", isPresented: $showingLogoutAlert) {
                Button("取消", role: .cancel) {}
                Button("退出", role: .destructive) {
                    appState.logout()
                }
            } message: {
                Text("确定要退出登录吗?")
            }
            .sheet(isPresented: $showingChangePINSheet) {
                ChangePINView()
            }
        }
    }
}

struct ChangePINView: View {
    @State private var oldPIN = ""
    @State private var newPIN = ""
    @State private var confirmPIN = ""
    @State private var errorMessage: String?
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section("当前 PIN 码") {
                    SecureField("输入当前 PIN 码", text: $oldPIN)
                        .keyboardType(.numberPad)
                }

                Section("新 PIN 码") {
                    SecureField("输入新 PIN 码", text: $newPIN)
                        .keyboardType(.numberPad)

                    SecureField("确认新 PIN 码", text: $confirmPIN)
                        .keyboardType(.numberPad)
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("更改 PIN 码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        changePIN()
                    }
                    .disabled(oldPIN.count < 6 || newPIN.count < 6 || confirmPIN.count < 6)
                }
            }
        }
    }

    private func changePIN() {
        guard newPIN == confirmPIN else {
            errorMessage = "两次输入的新 PIN 码不一致"
            return
        }

        // TODO: Implement PIN change
        dismiss()
    }
}

#Preview {
    SettingsView()
        .environmentObject(AppState.shared)
}
