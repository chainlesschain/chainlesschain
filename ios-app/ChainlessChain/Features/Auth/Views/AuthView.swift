import SwiftUI
import CoreCommon

struct AuthView: View {
    @EnvironmentObject var viewModel: AuthViewModel
    @EnvironmentObject var appState: AppState

    var body: some View {
        ZStack {
            // 背景渐变
            LinearGradient(
                gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.purple.opacity(0.1)]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            if viewModel.isFirstTimeSetup {
                SetupPINView()
            } else if viewModel.showBiometricPrompt && viewModel.canUseBiometric() {
                BiometricAuthView()
            } else {
                PINEntryView()
            }
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
                    .scaleEffect(1.5)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.3))
            }
        }
        .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("确定") {
                viewModel.errorMessage = nil
            }
        } message: {
            if let error = viewModel.errorMessage {
                Text(error)
            }
        }
    }
}

// MARK: - Setup PIN View

struct SetupPINView: View {
    @EnvironmentObject var viewModel: AuthViewModel
    @State private var pin = ""
    @State private var confirmPin = ""
    @State private var step = 1

    var body: some View {
        VStack(spacing: 30) {
            // Logo
            Image(systemName: "lock.shield.fill")
                .resizable()
                .frame(width: 80, height: 80)
                .foregroundColor(.blue)

            Text("设置 PIN 码")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(step == 1 ? "请输入 6 位 PIN 码" : "请再次输入 PIN 码")
                .font(.subheadline)
                .foregroundColor(.gray)

            // PIN 输入框
            SecureField("PIN", text: step == 1 ? $pin : $confirmPin)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .frame(maxWidth: 300)
                .multilineTextAlignment(.center)
                .font(.title2)
                .onChange(of: pin) { oldValue, newValue in
                    if newValue.count > 8 {
                        pin = String(newValue.prefix(8))
                    }
                }
                .onChange(of: confirmPin) { oldValue, newValue in
                    if newValue.count > 8 {
                        confirmPin = String(newValue.prefix(8))
                    }
                }

            // 提示
            Text("PIN 码用于解锁应用和加密数据")
                .font(.caption)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()

            // 下一步按钮
            Button(action: handleNext) {
                Text(step == 1 ? "下一步" : "完成")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
            }
            .disabled(step == 1 ? pin.count < 6 : confirmPin.count < 6)
            .padding(.horizontal)
        }
        .padding()
    }

    private func handleNext() {
        if step == 1 {
            step = 2
        } else {
            // 验证两次输入是否一致
            guard pin == confirmPin else {
                viewModel.errorMessage = "两次输入的 PIN 码不一致"
                confirmPin = ""
                step = 1
                pin = ""
                return
            }

            // 设置 PIN
            Task {
                do {
                    try await viewModel.setupPIN(pin)
                } catch {
                    viewModel.handleError(error)
                    pin = ""
                    confirmPin = ""
                    step = 1
                }
            }
        }
    }
}

// MARK: - PIN Entry View

struct PINEntryView: View {
    @EnvironmentObject var viewModel: AuthViewModel
    @State private var pin = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // Logo
            Image(systemName: "lock.fill")
                .resizable()
                .frame(width: 60, height: 60)
                .foregroundColor(.blue)

            Text("ChainlessChain")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("请输入 PIN 码")
                .font(.subheadline)
                .foregroundColor(.gray)

            // PIN 输入框
            SecureField("PIN", text: $pin)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .frame(maxWidth: 300)
                .multilineTextAlignment(.center)
                .font(.title2)
                .focused($isFocused)
                .onChange(of: pin) { oldValue, newValue in
                    if newValue.count > 8 {
                        pin = String(newValue.prefix(8))
                    }
                    if newValue.count >= 6 {
                        // 自动提交
                        handleLogin()
                    }
                }
                .onAppear {
                    isFocused = true
                }

            Spacer()

            // 生物识别按钮
            if viewModel.canUseBiometric() {
                Button(action: {
                    Task {
                        do {
                            try await viewModel.authenticateWithBiometric()
                        } catch {
                            viewModel.handleError(error)
                        }
                    }
                }) {
                    HStack {
                        Image(systemName: viewModel.biometricType() == "Face ID" ? "faceid" : "touchid")
                        Text("使用 \(viewModel.biometricType())")
                    }
                    .font(.headline)
                    .foregroundColor(.blue)
                    .padding()
                }
            }

            // 解锁按钮
            Button(action: handleLogin) {
                Text("解锁")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(pin.count >= 6 ? Color.blue : Color.gray)
                    .cornerRadius(12)
            }
            .disabled(pin.count < 6)
            .padding(.horizontal)
        }
        .padding()
    }

    private func handleLogin() {
        guard pin.count >= 6 else { return }

        Task {
            do {
                try await viewModel.authenticateWithPIN(pin)
            } catch {
                viewModel.handleError(error)
                pin = ""
            }
        }
    }
}

// MARK: - Biometric Auth View

struct BiometricAuthView: View {
    @EnvironmentObject var viewModel: AuthViewModel
    @State private var showPINEntry = false

    var body: some View {
        if showPINEntry {
            PINEntryView()
        } else {
            VStack(spacing: 30) {
                Spacer()

                Image(systemName: viewModel.biometricType() == "Face ID" ? "faceid" : "touchid")
                    .resizable()
                    .frame(width: 80, height: 80)
                    .foregroundColor(.blue)

                Text("ChainlessChain")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("使用 \(viewModel.biometricType()) 解锁")
                    .font(.subheadline)
                    .foregroundColor(.gray)

                Spacer()

                Button(action: {
                    Task {
                        do {
                            try await viewModel.authenticateWithBiometric()
                        } catch {
                            viewModel.handleError(error)
                        }
                    }
                }) {
                    Text("解锁")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                .padding(.horizontal)

                Button(action: {
                    showPINEntry = true
                }) {
                    Text("使用 PIN 码")
                        .font(.headline)
                        .foregroundColor(.blue)
                }
                .padding()
            }
            .padding()
            .onAppear {
                // 自动触发生物识别
                Task {
                    try await Task.sleep(for: .milliseconds(500))
                    do {
                        try await viewModel.authenticateWithBiometric()
                    } catch {
                        // 失败时不显示错误,让用户手动触发
                    }
                }
            }
        }
    }
}

#Preview("Setup") {
    AuthView()
        .environmentObject({
            let vm = AuthViewModel()
            vm.isFirstTimeSetup = true
            return vm
        }())
        .environmentObject(AppState.shared)
}

#Preview("Login") {
    AuthView()
        .environmentObject(AuthViewModel())
        .environmentObject(AppState.shared)
}
