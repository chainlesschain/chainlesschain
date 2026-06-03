import SwiftUI

// MARK: - Animated Message Status Icon

/// 消息状态动画图标
struct AnimatedMessageStatus: View {
    let status: MessageStatusType
    var size: CGFloat = 14
    var animated: Bool = true

    @State private var isAnimating = false

    enum MessageStatusType {
        case sending
        case sent
        case delivered
        case read
        case failed

        var icon: String {
            switch self {
            case .sending: return "clock"
            case .sent: return "checkmark"
            case .delivered: return "checkmark.circle"
            case .read: return "checkmark.circle.fill"
            case .failed: return "exclamationmark.circle.fill"
            }
        }

        var color: Color {
            switch self {
            case .sending: return .gray
            case .sent: return .gray
            case .delivered: return .gray
            case .read: return .blue
            case .failed: return .red
            }
        }
    }

    var body: some View {
        Group {
            switch status {
            case .sending:
                sendingView
            case .sent:
                sentView
            case .delivered:
                deliveredView
            case .read:
                readView
            case .failed:
                failedView
            }
        }
        .onAppear {
            if animated {
                withAnimation(.easeInOut(duration: 0.3)) {
                    isAnimating = true
                }
            }
        }
    }

    private var sendingView: some View {
        ProgressView()
            .scaleEffect(0.6)
            .frame(width: size, height: size)
    }

    private var sentView: some View {
        Image(systemName: "checkmark")
            .font(.system(size: size * 0.8, weight: .semibold))
            .foregroundColor(.gray)
            .scaleEffect(isAnimating ? 1.0 : 0.5)
            .opacity(isAnimating ? 1.0 : 0)
    }

    private var deliveredView: some View {
        HStack(spacing: -size * 0.3) {
            Image(systemName: "checkmark")
            Image(systemName: "checkmark")
        }
        .font(.system(size: size * 0.7, weight: .semibold))
        .foregroundColor(.gray)
        .scaleEffect(isAnimating ? 1.0 : 0.5)
        .opacity(isAnimating ? 1.0 : 0)
    }

    private var readView: some View {
        HStack(spacing: -size * 0.3) {
            Image(systemName: "checkmark")
            Image(systemName: "checkmark")
        }
        .font(.system(size: size * 0.7, weight: .semibold))
        .foregroundColor(.blue)
        .scaleEffect(isAnimating ? 1.0 : 0.5)
        .opacity(isAnimating ? 1.0 : 0)
    }

    private var failedView: some View {
        Image(systemName: "exclamationmark.circle.fill")
            .font(.system(size: size))
            .foregroundColor(.red)
            .scaleEffect(isAnimating ? 1.0 : 1.2)
    }
}

// MARK: - Typing Indicator

/// 正在输入指示器
struct TypingIndicator: View {
    @State private var animationOffset: [CGFloat] = [0, 0, 0]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Color.gray)
                    .frame(width: 8, height: 8)
                    .offset(y: animationOffset[index])
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.systemGray5))
        .cornerRadius(16)
        .onAppear {
            startAnimation()
        }
    }

    private func startAnimation() {
        for i in 0..<3 {
            withAnimation(
                Animation
                    .easeInOut(duration: 0.5)
                    .repeatForever(autoreverses: true)
                    .delay(Double(i) * 0.15)
            ) {
                animationOffset[i] = -6
            }
        }
    }
}

// MARK: - Shimmer Loading Effect

/// 骨架屏加载效果
struct ShimmerView: View {
    @State private var isAnimating = false

    var body: some View {
        LinearGradient(
            gradient: Gradient(colors: [
                Color(.systemGray5),
                Color(.systemGray4),
                Color(.systemGray5)
            ]),
            startPoint: .leading,
            endPoint: .trailing
        )
        .mask(
            Rectangle()
        )
        .offset(x: isAnimating ? 200 : -200)
        .animation(
            Animation.linear(duration: 1.5)
                .repeatForever(autoreverses: false),
            value: isAnimating
        )
        .onAppear {
            isAnimating = true
        }
    }
}

/// 消息骨架屏
struct MessageSkeletonView: View {
    var isOutgoing: Bool = false

    var body: some View {
        HStack {
            if isOutgoing { Spacer() }

            VStack(alignment: isOutgoing ? .trailing : .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(.systemGray5))
                    .frame(width: CGFloat.random(in: 100...200), height: 40)
                    .overlay(ShimmerView())
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(.systemGray6))
                    .frame(width: 60, height: 12)
                    .overlay(ShimmerView())
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }

            if !isOutgoing { Spacer() }
        }
        .padding(.horizontal)
    }
}

// MARK: - Pull to Refresh with Haptic

/// 下拉刷新视图
struct PullToRefresh: View {
    @Binding var isRefreshing: Bool
    var onRefresh: () async -> Void

    var body: some View {
        GeometryReader { geometry in
            if geometry.frame(in: .global).minY > 50 {
                Spacer()
                    .onAppear {
                        if !isRefreshing {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            isRefreshing = true
                            Task {
                                await onRefresh()
                                await MainActor.run {
                                    isRefreshing = false
                                }
                            }
                        }
                    }
            }

            HStack {
                Spacer()
                if isRefreshing {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.down")
                        .foregroundColor(.gray)
                }
                Spacer()
            }
        }
        .frame(height: 50)
    }
}

// MARK: - Toast Message

/// Toast 提示
struct ToastView: View {
    let message: String
    var type: ToastType = .info
    @Binding var isPresented: Bool

    enum ToastType {
        case success
        case error
        case warning
        case info

        var icon: String {
            switch self {
            case .success: return "checkmark.circle.fill"
            case .error: return "xmark.circle.fill"
            case .warning: return "exclamationmark.triangle.fill"
            case .info: return "info.circle.fill"
            }
        }

        var color: Color {
            switch self {
            case .success: return .green
            case .error: return .red
            case .warning: return .orange
            case .info: return .blue
            }
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: type.icon)
                .foregroundColor(type.color)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 10, x: 0, y: 5)
        )
        .transition(.move(edge: .top).combined(with: .opacity))
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                withAnimation {
                    isPresented = false
                }
            }
        }
    }
}

/// Toast 容器修饰符
struct ToastModifier: ViewModifier {
    @Binding var isPresented: Bool
    let message: String
    let type: ToastView.ToastType

    func body(content: Content) -> some View {
        ZStack {
            content

            VStack {
                if isPresented {
                    ToastView(message: message, type: type, isPresented: $isPresented)
                        .padding(.top, 50)
                }
                Spacer()
            }
            .animation(.spring(), value: isPresented)
        }
    }
}

extension View {
    func toast(isPresented: Binding<Bool>, message: String, type: ToastView.ToastType = .info) -> some View {
        modifier(ToastModifier(isPresented: isPresented, message: message, type: type))
    }
}

// MARK: - Haptic Feedback Button

/// 带触觉反馈的按钮
struct HapticButton<Content: View>: View {
    let action: () -> Void
    let content: Content
    var feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle = .medium

    @State private var isPressed = false

    init(
        feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle = .medium,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.feedbackStyle = feedbackStyle
        self.action = action
        self.content = content()
    }

    var body: some View {
        content
            .scaleEffect(isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: isPressed)
            .onTapGesture {
                UIImpactFeedbackGenerator(style: feedbackStyle).impactOccurred()
                isPressed = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    isPressed = false
                }
                action()
            }
    }
}

// MARK: - Connection Status Banner

/// 连接状态横幅
struct ConnectionStatusBanner: View {
    let status: ConnectionStatus
    @State private var isVisible = true

    enum ConnectionStatus {
        case connected
        case connecting
        case disconnected
        case reconnecting

        var message: String {
            switch self {
            case .connected: return "已连接"
            case .connecting: return "连接中..."
            case .disconnected: return "连接断开"
            case .reconnecting: return "重新连接中..."
            }
        }

        var color: Color {
            switch self {
            case .connected: return .green
            case .connecting: return .orange
            case .disconnected: return .red
            case .reconnecting: return .orange
            }
        }

        var icon: String {
            switch self {
            case .connected: return "wifi"
            case .connecting: return "wifi.exclamationmark"
            case .disconnected: return "wifi.slash"
            case .reconnecting: return "arrow.clockwise"
            }
        }
    }

    var body: some View {
        if isVisible && status != .connected {
            HStack(spacing: 8) {
                if status == .connecting || status == .reconnecting {
                    ProgressView()
                        .scaleEffect(0.8)
                        .tint(.white)
                } else {
                    Image(systemName: status.icon)
                }

                Text(status.message)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(status.color)
            .cornerRadius(20)
            .transition(.move(edge: .top).combined(with: .opacity))
            .onAppear {
                if status == .connected {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation {
                            isVisible = false
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Empty State View

/// 空状态视图
struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    init(
        icon: String,
        title: String,
        subtitle: String? = nil,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text(title)
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundColor(.primary)

            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let actionTitle = actionTitle, let action = action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .cornerRadius(10)
                }
                .padding(.top, 8)
            }
        }
        .padding(32)
    }
}

// MARK: - Adaptive Color

/// 自适应颜色（暗黑模式支持）
struct AdaptiveColor {
    static let messageBubbleOutgoing = Color("MessageBubbleOutgoing", bundle: nil)
    static let messageBubbleIncoming = Color("MessageBubbleIncoming", bundle: nil)

    static func messageBubble(isOutgoing: Bool, colorScheme: ColorScheme) -> Color {
        if isOutgoing {
            return colorScheme == .dark ? Color.blue.opacity(0.8) : Color.blue
        } else {
            return colorScheme == .dark ? Color(.systemGray5) : Color(.systemGray6)
        }
    }

    static func textColor(isOutgoing: Bool, colorScheme: ColorScheme) -> Color {
        if isOutgoing {
            return .white
        } else {
            return colorScheme == .dark ? .white : .primary
        }
    }
}

// MARK: - Swipe Actions Helper

/// 滑动操作修饰符
struct SwipeActionModifier: ViewModifier {
    let leadingActions: [SwipeAction]
    let trailingActions: [SwipeAction]

    struct SwipeAction: Identifiable {
        let id = UUID()
        let icon: String
        let color: Color
        let action: () -> Void
    }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                ForEach(leadingActions) { swipeAction in
                    Button(action: swipeAction.action) {
                        Image(systemName: swipeAction.icon)
                    }
                    .tint(swipeAction.color)
                }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                ForEach(trailingActions) { swipeAction in
                    Button(action: swipeAction.action) {
                        Image(systemName: swipeAction.icon)
                    }
                    .tint(swipeAction.color)
                }
            }
    }
}

// MARK: - Previews

#Preview("Message Status") {
    VStack(spacing: 20) {
        HStack(spacing: 20) {
            AnimatedMessageStatus(status: .sending)
            AnimatedMessageStatus(status: .sent)
            AnimatedMessageStatus(status: .delivered)
            AnimatedMessageStatus(status: .read)
            AnimatedMessageStatus(status: .failed)
        }

        TypingIndicator()

        MessageSkeletonView(isOutgoing: false)
        MessageSkeletonView(isOutgoing: true)

        ConnectionStatusBanner(status: .reconnecting)

        EmptyStateView(
            icon: "message.circle",
            title: "暂无消息",
            subtitle: "开始与好友聊天吧",
            actionTitle: "开始聊天"
        ) {
            print("Action tapped")
        }
    }
    .padding()
}
