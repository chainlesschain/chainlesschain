import SwiftUI
import CoreCommon
import CoreSecurity
import CoreDatabase

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingLogoutAlert = false
    @State private var showingChangePINSheet = false
    @State private var biometricEnabled = UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.biometricEnabled)
    @State private var autoSyncEnabled = UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.autoSyncEnabled)
    @State private var isSyncing = false
    @State private var syncStatusMessage: String?

    var body: some View {
        NavigationView {
            Form {
                // Account Info
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

                // Security Settings
                Section("安全") {
                    Toggle("生物识别解锁", isOn: $biometricEnabled)
                        .onChange(of: biometricEnabled) { _, newValue in
                            UserDefaults.standard.set(newValue, forKey: AppConstants.UserDefaults.biometricEnabled)
                            if newValue {
                                enableBiometricAuth()
                            }
                        }

                    NavigationLink("数据备份") {
                        DataBackupView()
                    }
                }

                // Notifications
                Section("通知") {
                    NavigationLink {
                        NotificationSettingsView()
                    } label: {
                        HStack {
                            Label("通知设置", systemImage: "bell.badge")
                            Spacer()
                        }
                    }
                }

                // AI Settings
                Section("AI 功能") {
                    NavigationLink("LLM 配置") {
                        LLMSettingsView()
                    }
                }

                // Sync Settings
                Section("同步") {
                    Toggle("自动同步", isOn: $autoSyncEnabled)
                        .onChange(of: autoSyncEnabled) { _, newValue in
                            UserDefaults.standard.set(newValue, forKey: AppConstants.UserDefaults.autoSyncEnabled)
                        }

                    Button {
                        triggerManualSync()
                    } label: {
                        HStack {
                            Text("立即同步")
                            Spacer()
                            if isSyncing {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else if let message = syncStatusMessage {
                                Text(message)
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        }
                    }
                    .disabled(isSyncing)
                }

                // About
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

                    Link("项目主页", destination: URL(string: "https://github.com/chainlesschain/chainlesschain")!)
                    Link("帮助文档", destination: URL(string: "https://docs.chainlesschain.com")!)
                }

                // Logout
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

    private func enableBiometricAuth() {
        Task {
            let authManager = BiometricAuthManager.shared
            let supported = authManager.isBiometricAvailable()
            if !supported {
                await MainActor.run {
                    biometricEnabled = false
                    UserDefaults.standard.set(false, forKey: AppConstants.UserDefaults.biometricEnabled)
                }
            }
        }
    }

    private func triggerManualSync() {
        isSyncing = true
        syncStatusMessage = nil

        Task {
            // Simulate sync operation
            do {
                // Sync knowledge base
                try await syncKnowledgeBase()

                // Sync conversations
                try await syncConversations()

                await MainActor.run {
                    isSyncing = false
                    syncStatusMessage = "同步完成"

                    // Clear message after 3 seconds
                    Task {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        await MainActor.run {
                            syncStatusMessage = nil
                        }
                    }
                }

                Logger.shared.info("Manual sync completed", category: "Sync")
            } catch {
                await MainActor.run {
                    isSyncing = false
                    syncStatusMessage = "同步失败"
                }
                Logger.shared.error("Manual sync failed", error: error, category: "Sync")
            }
        }
    }

    private func syncKnowledgeBase() async throws {
        // Placeholder for knowledge base sync
        try await Task.sleep(nanoseconds: 500_000_000)
    }

    private func syncConversations() async throws {
        // Placeholder for conversation sync
        try await Task.sleep(nanoseconds: 500_000_000)
    }
}

// MARK: - Change PIN View

struct ChangePINView: View {
    @State private var currentPIN = ""
    @State private var newPIN = ""
    @State private var confirmPIN = ""
    @State private var errorMessage: String?
    @State private var isChanging = false
    @State private var showSuccess = false
    @Environment(\.dismiss) var dismiss

    private let keychain = KeychainManager.shared
    private let crypto = CryptoManager.shared
    private let logger = Logger.shared

    var body: some View {
        NavigationView {
            Form {
                Section {
                    SecureField("输入当前 PIN 码", text: $currentPIN)
                        .keyboardType(.numberPad)
                        .textContentType(.password)
                } header: {
                    Text("当前 PIN 码")
                } footer: {
                    Text("输入您的 6 位数字 PIN 码")
                }

                Section {
                    SecureField("输入新 PIN 码", text: $newPIN)
                        .keyboardType(.numberPad)
                        .textContentType(.newPassword)

                    SecureField("确认新 PIN 码", text: $confirmPIN)
                        .keyboardType(.numberPad)
                        .textContentType(.newPassword)
                } header: {
                    Text("新 PIN 码")
                } footer: {
                    Text("请输入 6 位数字作为新 PIN 码")
                }

                if let error = errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
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
                    .disabled(!isValidInput || isChanging)
                }
            }
            .alert("PIN 码已更改", isPresented: $showSuccess) {
                Button("确定") { dismiss() }
            } message: {
                Text("您的 PIN 码已成功更新")
            }
            .interactiveDismissDisabled(isChanging)
        }
    }

    private var isValidInput: Bool {
        currentPIN.count >= 6 && newPIN.count >= 6 && confirmPIN.count >= 6
    }

    private func changePIN() {
        errorMessage = nil

        // Validate new PIN matches confirmation
        guard newPIN == confirmPIN else {
            errorMessage = "两次输入的新 PIN 码不一致"
            return
        }

        // Validate PIN is numeric
        guard newPIN.allSatisfy({ $0.isNumber }) else {
            errorMessage = "PIN 码必须是数字"
            return
        }

        // Validate PIN length
        guard newPIN.count == 6 else {
            errorMessage = "PIN 码必须是 6 位数字"
            return
        }

        // Validate new PIN is different
        guard newPIN != currentPIN else {
            errorMessage = "新 PIN 码不能与当前 PIN 码相同"
            return
        }

        isChanging = true

        Task {
            do {
                // Verify current PIN
                let storedHashData = try keychain.load(forKey: AppConstants.Keychain.pinHashKey)
                let isValid = crypto.verifyPIN(currentPIN, storedHash: storedHashData)

                guard isValid else {
                    await MainActor.run {
                        errorMessage = "当前 PIN 码错误"
                        isChanging = false
                    }
                    return
                }

                // Hash new PIN
                guard let newPINHash = crypto.hashPIN(newPIN) else {
                    await MainActor.run {
                        errorMessage = "生成新 PIN 哈希失败"
                        isChanging = false
                    }
                    return
                }

                // Load current salt
                let salt = try keychain.load(forKey: AppConstants.Keychain.dbSaltKey)

                // Derive new database encryption key from new PIN
                let newDbKey = try crypto.deriveKey(password: newPIN, salt: salt)

                // Re-encrypt database with new key
                try await reEncryptDatabase(oldPIN: currentPIN, newKey: newDbKey, salt: salt)

                // Save new PIN hash to keychain
                try keychain.save(newPINHash, forKey: AppConstants.Keychain.pinHashKey)

                logger.info("PIN changed successfully", category: "Security")

                await MainActor.run {
                    isChanging = false
                    showSuccess = true
                }
            } catch KeychainError.notFound {
                await MainActor.run {
                    errorMessage = "未找到已保存的 PIN 码，请重新登录"
                    isChanging = false
                }
            } catch {
                logger.error("Failed to change PIN", error: error, category: "Security")
                await MainActor.run {
                    errorMessage = "更改 PIN 码失败: \(error.localizedDescription)"
                    isChanging = false
                }
            }
        }
    }

    private func reEncryptDatabase(oldPIN: String, newKey: Data, salt: Data) async throws {
        // The database re-encryption is handled by DatabaseManager
        // This involves:
        // 1. Exporting data with old key
        // 2. Re-importing with new key
        // For SQLCipher, we use PRAGMA rekey

        let database = DatabaseManager.shared

        // Export current data (backup)
        // Then change the encryption key
        try database.changeEncryptionKey(newKey)

        logger.info("Database re-encrypted with new key", category: "Security")
    }
}

// MARK: - Data Backup View

struct DataBackupView: View {
    @State private var lastBackupDate: Date?
    @State private var isBackingUp = false
    @State private var backupProgress: Double = 0
    @State private var showExportSheet = false

    var body: some View {
        List {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("上次备份")
                            .font(.subheadline)
                        if let date = lastBackupDate {
                            Text(date, style: .relative)
                                .font(.caption)
                                .foregroundColor(.gray)
                        } else {
                            Text("从未备份")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }
                    Spacer()
                    if isBackingUp {
                        ProgressView(value: backupProgress)
                            .frame(width: 100)
                    }
                }

                Button {
                    createBackup()
                } label: {
                    Label("立即备份", systemImage: "arrow.clockwise.icloud")
                }
                .disabled(isBackingUp)
            } header: {
                Text("iCloud 备份")
            } footer: {
                Text("备份将加密存储在您的 iCloud 账户中")
            }

            Section {
                Button {
                    showExportSheet = true
                } label: {
                    Label("导出数据", systemImage: "square.and.arrow.up")
                }

                NavigationLink {
                    ImportDataView()
                } label: {
                    Label("导入数据", systemImage: "square.and.arrow.down")
                }
            } header: {
                Text("本地备份")
            }
        }
        .navigationTitle("数据备份")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showExportSheet) {
            ExportDataSheet()
        }
        .onAppear {
            loadLastBackupDate()
        }
    }

    private func loadLastBackupDate() {
        lastBackupDate = UserDefaults.standard.object(forKey: "lastBackupDate") as? Date
    }

    private func createBackup() {
        isBackingUp = true
        backupProgress = 0

        Task {
            // Simulate backup progress
            for i in 1...10 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                await MainActor.run {
                    backupProgress = Double(i) / 10.0
                }
            }

            await MainActor.run {
                lastBackupDate = Date()
                UserDefaults.standard.set(lastBackupDate, forKey: "lastBackupDate")
                isBackingUp = false
            }
        }
    }
}

// MARK: - Import Data View

struct ImportDataView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 60))
                .foregroundColor(.blue)

            Text("导入数据")
                .font(.title2)
                .fontWeight(.semibold)

            Text("从备份文件恢复您的数据")
                .font(.subheadline)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)

            Button {
                // Import action
            } label: {
                Label("选择备份文件", systemImage: "folder")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .padding(.horizontal, 40)
            .padding(.top, 20)

            Spacer()
        }
        .padding(.top, 60)
        .navigationTitle("导入数据")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Export Data Sheet

struct ExportDataSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var includeKnowledge = true
    @State private var includeConversations = true
    @State private var includeContacts = true
    @State private var isExporting = false

    var body: some View {
        NavigationView {
            List {
                Section {
                    Toggle("知识库", isOn: $includeKnowledge)
                    Toggle("对话记录", isOn: $includeConversations)
                    Toggle("联系人", isOn: $includeContacts)
                } header: {
                    Text("选择要导出的数据")
                }

                Section {
                    Button {
                        exportData()
                    } label: {
                        HStack {
                            Spacer()
                            if isExporting {
                                ProgressView()
                                    .padding(.trailing, 8)
                            }
                            Text("导出")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(isExporting || (!includeKnowledge && !includeConversations && !includeContacts))
                }
            }
            .navigationTitle("导出数据")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }

    private func exportData() {
        isExporting = true

        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)

            await MainActor.run {
                isExporting = false
                dismiss()
            }
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AppState.shared)
}
