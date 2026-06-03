import SwiftUI
import CoreP2P

/// Flow A 主屏 — Phase 1.5 完整实现。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// `android-app/feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/DesktopPairingScreen.kt`
/// + `viewmodel/DesktopPairingViewModel.kt`（W3.2-W3.6 真机 E2E 验证）。
///
/// 状态机 5 态 (.idle → .displaying → .completed/.expired/.failed) 与 Android
/// sealed class 1:1。Displaying 屏含 QR + 6 位 code monospace 大字 + 元数据
/// 行 (DID/DeviceID/设备名 manual-entry support，与 Android W3.6 一致) +
/// "5 分钟内有效" 倒计时。
///
/// HIG 偏离：Compose `Card` (elevation) → SwiftUI 默认背景 + RoundedRectangle
/// stroke；Compose `TopAppBar` 的 close icon → SwiftUI 系统返回（由父
/// `PairingHomeView` 的 segmented picker 提供 tab 切换，不需自己 close）。
struct DesktopPairingView: View {
    @EnvironmentObject var deps: PairingDependencies

    var body: some View {
        Inner(deps: deps)
    }
}

private struct Inner: View {
    @StateObject private var vm: DesktopPairingViewModel
    @State private var nowMillis: Int64 = 0
    private let countdownTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(deps: PairingDependencies) {
        _vm = StateObject(wrappedValue: DesktopPairingViewModel(
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
                case .idle:
                    ProgressView().padding(.top, 64)
                case .displaying(let json, let code, let expiresAt):
                    displayingContent(json: json, code: code, expiresAt: expiresAt)
                case .completed:
                    statusBlock(title: "配对成功", detail: nil, primary: ("完成", { vm.cancelPairing() }))
                case .expired:
                    statusBlock(title: "配对码已过期", detail: "请重新生成", primary: ("重新生成", { vm.startPairing() }))
                case .failed(let reason):
                    statusBlock(title: "配对失败", detail: reason, primary: ("重试", { vm.startPairing() }))
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .onAppear {
            if case .idle = vm.state {
                vm.startPairing()
            }
            nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        }
        .onReceive(countdownTimer) { _ in
            nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        }
    }

    // MARK: - Subviews

    private func displayingContent(json: String, code: String, expiresAt: Int64) -> some View {
        VStack(spacing: 16) {
            Text("在桌面端打开 设置 → 移动桥 → 扫描或手动输入")
                .font(.body)
                .multilineTextAlignment(.center)

            // QR Card —— 白底 + 边框确保暗色主题下扫描对比度足够
            VStack {
                QrCodeImage(payload: json, size: 240)
            }
            .padding(16)
            .background(Color.white)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(.separator), lineWidth: 2)
            )

            Text("或在桌面手动输入：")
                .font(.body)
                .foregroundColor(.secondary)

            Text(code)
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .tracking(8)
                .padding(.vertical, 4)

            // W3.6 manual-entry support：DID / Device ID / 设备名
            VStack(spacing: 4) {
                if case .displaying = vm.state {
                    metaRow(label: "DID", value: extractField(from: json, key: "did"))
                    metaRow(label: "Device ID", value: extractField(from: json, key: "deviceId"))
                    metaRow(label: "设备名", value: extractField(from: json, key: "name"))
                }
            }

            Text(remainingLabel(expiresAtMillis: expiresAt))
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 8)

            Button("取消", role: .cancel) {
                vm.cancelPairing()
            }
            .buttonStyle(.bordered)
            .padding(.top, 4)
        }
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(spacing: 4) {
            Text("\(label)：")
                .font(.caption2)
                .foregroundColor(.secondary)
            Text(value)
                .font(.system(.caption2, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    private func statusBlock(title: String, detail: String?, primary: (label: String, action: () -> Void)) -> some View {
        VStack(spacing: 12) {
            Spacer().frame(height: 32)
            Text(title)
                .font(.title3).fontWeight(.semibold)
            if let detail = detail {
                Text(detail)
                    .font(.callout)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Button(primary.label, action: primary.action)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 16)
        }
    }

    // MARK: - Helpers

    /// 从 JSON 字符串里 best-effort 抽取字段，仅用于 manual-entry meta rows 的展示
    /// （payload 已签名 + Codable round-trip 过，安全）。失败返空字符串。
    private func extractField(from json: String, key: String) -> String {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return "" }
        if let direct = obj[key] as? String { return direct }
        if let info = obj["deviceInfo"] as? [String: Any], let v = info[key] as? String { return v }
        return ""
    }

    private func remainingLabel(expiresAtMillis: Int64) -> String {
        let remainingMs = max(0, expiresAtMillis - nowMillis)
        let totalSec = Int(remainingMs / 1000)
        let m = totalSec / 60
        let s = totalSec % 60
        return String(format: "%d 分 %02d 秒内有效", m, s)
    }
}

#Preview {
    NavigationView {
        DesktopPairingView()
            .environmentObject(PairingDependencies())
    }
}
