import SwiftUI
import CoreCommon

/// In-app update 横幅 — Phase 6.10。
///
/// 启动后由 `UpdateBannerOverlay`（注入 ContentView）后台 task 调用
/// `UpdateChecker.shared.check()`；若返 `.available` 则显横幅，tap → 跳 App Store
/// (`UIApplication.shared.open(trackUrl)`)。
///
/// **UX 决策**：
/// - 横幅出现在屏幕顶部（不阻塞当前页面交互；与 Apple Mail / Slack pattern 一致）
/// - 右上角 X 关闭，session 内不再显（持久化"已忽略某版本"留 v0.2）
/// - tap 横幅本身 = 跳 App Store；点 X = dismiss
/// - 无 banner = 静默（无 toast，避免打扰 — 多数用户已是最新版）
public struct UpdateBannerView: View {
    let remoteVersion: String
    let localVersion: String
    let trackUrl: String?
    let onTap: () -> Void
    let onDismiss: () -> Void

    public init(remoteVersion: String, localVersion: String,
                trackUrl: String?, onTap: @escaping () -> Void,
                onDismiss: @escaping () -> Void) {
        self.remoteVersion = remoteVersion
        self.localVersion = localVersion
        self.trackUrl = trackUrl
        self.onTap = onTap
        self.onDismiss = onDismiss
    }

    public var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.down.app.fill")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(.accentColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text("新版本可用：\(remoteVersion)")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    Text("当前版本 \(localVersion)，点击前往 App Store 升级")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                        .font(.system(size: 20))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.secondarySystemBackground))
                    .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

/// 顶层 overlay — 注入 ContentView 让横幅自动出现/消失。
/// 内部启动 check task on appear；维护 dismissed-this-session 状态。
public struct UpdateBannerOverlay<Content: View>: View {
    let content: Content

    @State private var remoteVersion: String? = nil
    @State private var trackUrl: String? = nil
    @State private var dismissed: Bool = false
    @State private var checked: Bool = false

    /// 测试 / SwiftUI preview 时可注入 mock checker。生产取 .shared。
    let checker: UpdateChecker
    let openURL: @Sendable (URL) -> Void

    public init(
        checker: UpdateChecker = .shared,
        openURL: @Sendable @escaping (URL) -> Void = { url in
            #if canImport(UIKit)
            DispatchQueue.main.async {
                UIApplication.shared.open(url)
            }
            #endif
        },
        @ViewBuilder content: () -> Content
    ) {
        self.checker = checker
        self.openURL = openURL
        self.content = content()
    }

    public var body: some View {
        ZStack(alignment: .top) {
            content
            if let remote = remoteVersion, !dismissed {
                UpdateBannerView(
                    remoteVersion: remote,
                    localVersion: AppConstants.App.version,
                    trackUrl: trackUrl,
                    onTap: {
                        if let s = trackUrl, let url = URL(string: s) {
                            openURL(url)
                        }
                    },
                    onDismiss: { dismissed = true }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.5, dampingFraction: 0.8),
                           value: remoteVersion)
            }
        }
        .task {
            // 每 session 只 check 一次（启动后 3s 延迟，避开冷启动繁忙窗口）
            guard !checked else { return }
            checked = true
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            let result = await checker.check()
            await MainActor.run {
                switch result {
                case .available(let v, let url):
                    self.remoteVersion = v
                    self.trackUrl = url
                case .upToDate, .notListed:
                    break  // 静默
                }
            }
        }
    }
}
