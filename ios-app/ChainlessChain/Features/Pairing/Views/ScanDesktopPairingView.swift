import SwiftUI
import CoreP2P

/// Flow B 主屏 — Phase 1.3 完整实现。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// `android-app/feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/ScanDesktopPairingScreen.kt`
/// （Xiaomi 24115RA8EC 真机 E2E 验证 commit `c47cbc649`）。状态机 4 态 + 错误
/// 文案分类 + Surface 而非 Scaffold（避免 Success 白屏 bug）— 都照抄。
///
/// HIG 偏离：Compose `Surface` → SwiftUI `.background(Color(.systemBackground))`
/// + frame 撑满；Compose `CircularProgressIndicator` → `ProgressView()`。
struct ScanDesktopPairingView: View {
    @EnvironmentObject var deps: PairingDependencies

    var body: some View {
        // 把 deps 透传给 inner — @StateObject 才能在 init 一次构造 VM 并被 SwiftUI 观察。
        // 直接在外层 @EnvironmentObject + @StateObject 配合会因 env 未就绪而 crash。
        Inner(deps: deps)
    }
}

private struct Inner: View {
    @StateObject private var vm: ScanDesktopPairingViewModel
    @State private var showScanner = false

    init(deps: PairingDependencies) {
        _vm = StateObject(wrappedValue: ScanDesktopPairingViewModel(
            signalingGate: deps.signalingGate,
            signalingConfig: deps.signalingConfig,
            pairedDesktopsStore: deps.pairedDesktopsStore,
            deviceInfoProvider: deps.deviceInfoProvider ?? IOSPairingDeviceInfoProvider(),
            clock: deps.clock,
            currentDIDProvider: deps.currentDIDProvider
        ))
    }

    var body: some View {
        Group {
            switch vm.state {
            case .scanning:
                scanningContent
            case .sending(let desktopName):
                statusContent(
                    title: "正在通知桌面 \(desktopName)…",
                    detail: nil,
                    showSpinner: true,
                    primary: nil,
                    secondary: nil
                )
            case .success(let desktopName):
                statusContent(
                    title: "配对成功",
                    detail: "已与 \(desktopName) 建立配对",
                    showSpinner: false,
                    primary: ("完成", { showScanner = false }),
                    secondary: nil
                )
            case .failed(let reason):
                statusContent(
                    title: "配对失败",
                    detail: reason,
                    showSpinner: false,
                    primary: ("重试", { vm.retry(); showScanner = true }),
                    secondary: ("返回", {})
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .sheet(isPresented: $showScanner) {
            GenericQRScannerView(
                prompt: "将桌面屏幕上的 QR 码放入框内",
                onScan: { rawJson in
                    vm.onQrScanned(rawJson)
                }
            )
        }
    }

    // MARK: - Subviews

    private var scanningContent: some View {
        VStack(spacing: 16) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 80))
                .foregroundColor(.blue)
                .padding(.top, 32)

            Text("扫描桌面 QR")
                .font(.title3).fontWeight(.semibold)

            Text("打开桌面端 → 设置 → 移动桥 → 显示 QR 码，然后用此屏摄像头扫描。")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                showScanner = true
            } label: {
                Label("开始扫描", systemImage: "camera")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 32)
            .padding(.top, 16)
        }
    }

    private func statusContent(
        title: String,
        detail: String?,
        showSpinner: Bool,
        primary: (label: String, action: () -> Void)?,
        secondary: (label: String, action: () -> Void)?
    ) -> some View {
        VStack(spacing: 16) {
            Spacer()
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
                    .padding(.horizontal, 32)
            }
            if let p = primary {
                Button(p.label, action: p.action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.top, 8)
            }
            if let s = secondary {
                Button(s.label, action: s.action)
                    .buttonStyle(.bordered)
                    .controlSize(.large)
            }
            Spacer()
        }
        .padding(.horizontal, 24)
    }
}

#Preview {
    NavigationView {
        ScanDesktopPairingView()
            .environmentObject(PairingDependencies())
    }
}
