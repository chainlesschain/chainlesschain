import SwiftUI
import CoreP2P

/// 手输 6 位 code 配对屏 — Phase 1.6 完整实现。
///
/// **布局**：Android 端无对位（cc CLI 通路），iOS 此屏自行设计。约束：
/// 6 位数字 keypad → 自动校验 → 提交按钮 disable 直到 6 位输全 → 错误状态
/// 文案与 Flow B 错误分类对齐 + 引导用户回退到「扫描桌面」。
///
/// **wire**：详见 design doc §6.5 修订版（信令复用方案）。本 view 不感知
/// 桌面端 `pairing-code:<code>` 别名注册细节，全部抽象进 ViewModel。
struct ManualPairingView: View {
    @EnvironmentObject var deps: PairingDependencies

    var body: some View {
        Inner(deps: deps)
    }
}

private struct Inner: View {
    @StateObject private var vm: ManualPairingViewModel
    @FocusState private var codeFieldFocused: Bool
    @State private var nowMillis: Int64 = 0
    private let countdownTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(deps: PairingDependencies) {
        _vm = StateObject(wrappedValue: ManualPairingViewModel(
            signalingGate: deps.signalingGate,
            messageBus: deps.messageBus,
            deviceInfoProvider: deps.deviceInfoProvider ?? IOSPairingDeviceInfoProvider(),
            clock: deps.clock,
            currentDIDProvider: deps.currentDIDProvider
        ))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                switch vm.state {
                case .entering:
                    enteringContent
                case .submitting:
                    statusBlock(title: "正在通知桌面…", detail: nil, showSpinner: true, primary: nil)
                case .waitingForConfirm(let code, let expiresAt):
                    waitingContent(code: code, expiresAt: expiresAt)
                case .completed:
                    statusBlock(
                        title: "配对成功",
                        detail: "桌面已确认配对",
                        showSpinner: false,
                        primary: ("完成", { vm.reset() })
                    )
                case .failed(let reason):
                    statusBlock(
                        title: "配对失败",
                        detail: reason,
                        showSpinner: false,
                        primary: ("重试", { vm.reset() })
                    )
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .onAppear { codeFieldFocused = true }
        .onReceive(countdownTimer) { _ in
            nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        }
    }

    // MARK: - Entering

    private var enteringContent: some View {
        VStack(spacing: 16) {
            Image(systemName: "keyboard")
                .font(.system(size: 60))
                .foregroundColor(.blue)
                .padding(.top, 16)

            Text("输入桌面配对码")
                .font(.title3).fontWeight(.semibold)

            Text("在桌面端打开「设置 → 移动桥」查看 6 位配对码")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            TextField("123456", text: $vm.code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .multilineTextAlignment(.center)
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .focused($codeFieldFocused)
                .onChange(of: vm.code) { new in
                    // 限制 6 位数字
                    let filtered = new.filter { $0.isNumber }.prefix(6)
                    if filtered != Substring(new) {
                        vm.code = String(filtered)
                    }
                }
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
                .padding(.horizontal, 32)

            Button {
                vm.submit()
            } label: {
                Label("提交", systemImage: "paperplane.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 32)
            .disabled(vm.code.count != 6)

            Text("此通道为兜底方案，QR 不可用时使用。优先建议「扫描桌面」。")
                .font(.caption2)
                .foregroundColor(Color.secondary.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)
        }
    }

    // MARK: - Waiting for confirm

    private func waitingContent(code: String, expiresAt: Int64) -> some View {
        VStack(spacing: 12) {
            Spacer().frame(height: 24)
            ProgressView().scaleEffect(1.4)
                .padding(.bottom, 8)
            Text("已通知桌面 \(code)")
                .font(.title3).fontWeight(.semibold)
            Text(remainingLabel(expiresAtMillis: expiresAt))
                .font(.callout)
                .foregroundColor(.secondary)
            Text("等待桌面端确认配对…")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("取消", role: .cancel) {
                vm.reset()
            }
            .buttonStyle(.bordered)
            .padding(.top, 16)
        }
    }

    // MARK: - Status block (submitting / completed / failed)

    private func statusBlock(
        title: String,
        detail: String?,
        showSpinner: Bool,
        primary: (label: String, action: () -> Void)?
    ) -> some View {
        VStack(spacing: 12) {
            Spacer().frame(height: 32)
            if showSpinner {
                ProgressView().scaleEffect(1.4)
                    .padding(.bottom, 8)
            }
            Text(title)
                .font(.title3).fontWeight(.semibold)
                .multilineTextAlignment(.center)
            if let detail = detail {
                Text(detail)
                    .font(.callout)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            if let p = primary {
                Button(p.label, action: p.action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.top, 16)
            }
        }
    }

    private func remainingLabel(expiresAtMillis: Int64) -> String {
        let remainingMs = max(0, expiresAtMillis - nowMillis)
        let totalSec = Int(remainingMs / 1000)
        return "\(totalSec) 秒后超时"
    }
}

#Preview {
    NavigationView {
        ManualPairingView()
            .environmentObject(PairingDependencies())
    }
}
