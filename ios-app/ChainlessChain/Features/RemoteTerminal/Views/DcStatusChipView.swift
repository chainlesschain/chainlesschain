import SwiftUI
import CoreP2P

/// Phase 2.4 顶部状态 chip — 显示当前 transport 路径。
///
/// **布局参考**：Android `TerminalListScreen.kt` chip（绿=DC / 黄=relay）。
/// HIG 偏离白名单：Compose `AssistChip` → SwiftUI `Capsule` + filled bg。
struct DcStatusChipView: View {
    let state: TerminalListViewModel.HandshakeState

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundColor(textColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(bgColor)
        .clipShape(Capsule())
    }

    private var label: String {
        switch state {
        case .idle:                          return "未连接"
        case .connecting:                    return "握手中…"
        case .connectedDataChannel:          return "P2P 直连"
        case .connectedSignalingFallback:    return "中继路径"
        case .failed(let reason):            return "握手失败：\(reason)"
        }
    }

    private var dotColor: Color {
        switch state {
        case .connectedDataChannel:          return .green
        case .connectedSignalingFallback:    return .orange
        case .connecting:                    return .blue
        case .idle:                          return .gray
        case .failed:                        return .red
        }
    }

    private var textColor: Color {
        switch state {
        case .failed:                        return .red
        default:                             return .primary
        }
    }

    private var bgColor: Color {
        switch state {
        case .connectedDataChannel:          return Color.green.opacity(0.15)
        case .connectedSignalingFallback:    return Color.orange.opacity(0.15)
        case .connecting:                    return Color.blue.opacity(0.12)
        case .idle:                          return Color(.tertiarySystemBackground)
        case .failed:                        return Color.red.opacity(0.12)
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        DcStatusChipView(state: .idle)
        DcStatusChipView(state: .connecting)
        DcStatusChipView(state: .connectedDataChannel)
        DcStatusChipView(state: .connectedSignalingFallback)
        DcStatusChipView(state: .failed(reason: "连接超时"))
    }
    .padding()
}
