import SwiftUI

struct LLMSettingsView: View {
    @StateObject private var viewModel = LLMSettingsViewModel()
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            Form {
                // Provider Selection
                Section("LLM 提供商") {
                    Picker("提供商", selection: $viewModel.selectedProvider) {
                        Text("Ollama (本地)").tag(LLMProvider.ollama)
                        Text("OpenAI").tag(LLMProvider.openai)
                        Text("Anthropic (Claude)").tag(LLMProvider.anthropic)
                        Text("DeepSeek").tag(LLMProvider.deepseek)
                        Text("火山引擎").tag(LLMProvider.volcengine)
                        Text("自定义").tag(LLMProvider.custom)
                    }
                    .pickerStyle(.menu)
                }

                // Configuration
                Section("配置") {
                    TextField("Base URL", text: $viewModel.baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if viewModel.selectedProvider != .ollama {
                        SecureField("API Key", text: $viewModel.apiKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    TextField("默认模型", text: $viewModel.model)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                // Status
                Section("状态") {
                    HStack {
                        Text("服务状态")
                        Spacer()
                        if viewModel.isChecking {
                            ProgressView()
                        } else {
                            Image(systemName: viewModel.isAvailable ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(viewModel.isAvailable ? .green : .red)
                            Text(viewModel.isAvailable ? "可用" : "不可用")
                                .foregroundColor(viewModel.isAvailable ? .green : .red)
                        }
                    }

                    if !viewModel.availableModels.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("可用模型 (\(viewModel.availableModels.count))")
                                .font(.caption)
                                .foregroundColor(.gray)

                            ForEach(viewModel.availableModels.prefix(5), id: \.self) { model in
                                Text("• \(model)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            if viewModel.availableModels.count > 5 {
                                Text("... 还有 \(viewModel.availableModels.count - 5) 个模型")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        }
                    }

                    if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Actions
                Section {
                    Button(action: {
                        Task {
                            await viewModel.checkStatus()
                        }
                    }) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                            Text("检查连接")
                        }
                    }
                    .disabled(viewModel.isChecking)

                    Button(action: {
                        Task {
                            await viewModel.saveAndApply()
                            dismiss()
                        }
                    }) {
                        HStack {
                            Image(systemName: "checkmark")
                            Text("保存并应用")
                        }
                    }
                    .disabled(viewModel.isChecking)
                }
            }
            .navigationTitle("LLM 设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
            .onAppear {
                viewModel.loadCurrentSettings()
            }
        }
    }
}

@MainActor
class LLMSettingsViewModel: ObservableObject {
    @Published var selectedProvider: LLMProvider = .ollama
    @Published var baseURL: String = "http://localhost:11434"
    @Published var apiKey: String = ""
    @Published var model: String = "qwen2:7b"

    @Published var isChecking = false
    @Published var isAvailable = false
    @Published var availableModels: [String] = []
    @Published var errorMessage: String?

    private let llmManager = LLMManager.shared

    func loadCurrentSettings() {
        selectedProvider = llmManager.currentProvider
        // Load from UserDefaults or config
        if let data = UserDefaults.standard.data(forKey: "llm_config"),
           let config = try? JSONDecoder().decode(SavedConfig.self, from: data) {
            baseURL = config.baseURL
            apiKey = config.apiKey ?? ""
            model = config.model
        }
    }

    func checkStatus() async {
        isChecking = true
        errorMessage = nil

        do {
            // Temporarily switch to test the configuration
            try await llmManager.switchProvider(
                selectedProvider,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                baseURL: baseURL,
                model: model
            )

            let status = try await llmManager.checkStatus()
            isAvailable = status.available
            availableModels = status.models

            if !isAvailable, let error = status.error {
                errorMessage = error
            }
        } catch {
            isAvailable = false
            errorMessage = error.localizedDescription
        }

        isChecking = false
    }

    func saveAndApply() async {
        do {
            try await llmManager.switchProvider(
                selectedProvider,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                baseURL: baseURL,
                model: model
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private struct SavedConfig: Codable {
        let provider: LLMProvider
        let apiKey: String?
        let baseURL: String
        let model: String
    }
}

#Preview {
    LLMSettingsView()
}
