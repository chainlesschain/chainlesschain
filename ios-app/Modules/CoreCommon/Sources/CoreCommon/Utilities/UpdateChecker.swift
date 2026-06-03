import Foundation

/// In-app 版本更新检查 — Phase 6.10。
///
/// 通过 Apple iTunes Lookup API 查询 App Store 上当前 bundleId 的最新版本，与
/// 本地 `CFBundleShortVersionString` 比对，若有更新返 [UpdateAvailable]。
/// 由 UI (UpdateBannerView) 决定是否显示横幅 + tap 跳 App Store。
///
/// **不做 OTA 下载** — iOS 不允许绕开 App Store（memory `iOS_对标_Android_Phase_6_Plan.md`
/// §3 OQ-4 = B：TestFlight beta channel 走 Apple 原生 prompt，正式版用户走 App Store
/// 跳转）。Android UpdateChecker 直链 .apk 在 iOS 是被禁的。
///
/// **首次启动行为**：bundleId 在 App Store 未发布 → results=[] → 返 nil (无 banner)。
/// 这让 ad-hoc TestFlight 阶段不会因 lookup miss 报错。
public actor UpdateChecker {

    public static let shared = UpdateChecker()

    /// 依赖注入：URLSession + 当前本地版本 — 测试时可 mock。
    private let urlSession: URLSession
    private let bundleIdProvider: @Sendable () -> String
    private let localVersionProvider: @Sendable () -> String
    private let country: String

    public init(
        urlSession: URLSession = .shared,
        bundleIdProvider: @Sendable @escaping () -> String = { AppConstants.App.bundleId },
        localVersionProvider: @Sendable @escaping () -> String = { AppConstants.App.version },
        country: String = "us"
    ) {
        self.urlSession = urlSession
        self.bundleIdProvider = bundleIdProvider
        self.localVersionProvider = localVersionProvider
        self.country = country
    }

    /// 检查更新。返：
    /// - `.available(remoteVersion, trackUrl)` — 远端有更新（remote > local）
    /// - `.upToDate` — 本地等于或新于远端
    /// - `.notListed` — App Store 未找到（首次发布前 / 仅 TestFlight 期 / lookup 失败的容错）
    public func check() async -> UpdateCheckResult {
        let bundleId = bundleIdProvider()
        let localVersion = localVersionProvider()

        // App Store Lookup URL — `https://itunes.apple.com/lookup?bundleId=X&country=Y`
        var components = URLComponents(string: "https://itunes.apple.com/lookup")!
        components.queryItems = [
            URLQueryItem(name: "bundleId", value: bundleId),
            URLQueryItem(name: "country", value: country)
        ]
        guard let url = components.url else { return .notListed }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return .notListed
            }
            guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let results = parsed["results"] as? [[String: Any]],
                  let first = results.first else {
                return .notListed
            }
            guard let remoteVersion = first["version"] as? String,
                  !remoteVersion.isEmpty else {
                return .notListed
            }
            let trackUrl = first["trackViewUrl"] as? String

            if Self.compareSemver(local: localVersion, remote: remoteVersion) == .ascending {
                return .available(remoteVersion: remoteVersion, trackUrl: trackUrl)
            } else {
                return .upToDate
            }
        } catch {
            return .notListed
        }
    }

    /// Semver-like 比较（仅按 `.` 分段 + 数字比较；非数字段视为 0）。
    /// `5.0.3` < `5.0.4` → `.ascending`
    /// `5.0.3` == `5.0.3` → `.same`
    /// `5.1.0` > `5.0.3` → `.descending`
    static func compareSemver(local: String, remote: String) -> ComparisonResult {
        let localParts = local.split(separator: ".").map { Int($0) ?? 0 }
        let remoteParts = remote.split(separator: ".").map { Int($0) ?? 0 }
        let maxLen = max(localParts.count, remoteParts.count)
        for i in 0..<maxLen {
            let l = i < localParts.count ? localParts[i] : 0
            let r = i < remoteParts.count ? remoteParts[i] : 0
            if l < r { return .ascending }
            if l > r { return .descending }
        }
        return .same
    }
}

/// 更新检查结果。
public enum UpdateCheckResult: Sendable, Equatable {
    /// App Store 上发现更新。`trackUrl` 是 App Store 页面 URL（用户点 banner 跳转）。
    case available(remoteVersion: String, trackUrl: String?)

    /// 本地版本 ≥ App Store 版本。
    case upToDate

    /// App Store 未找到此 bundleId / 网络失败 / lookup miss — 不显示 banner，无害。
    case notListed
}

/// 比较结果 — 用于 UpdateChecker.compareSemver。
public enum ComparisonResult: Sendable, Equatable {
    case ascending     // local < remote → 有更新
    case same          // local == remote
    case descending    // local > remote (一般不会出现，除非本地是 TestFlight 比 App Store 新)
}
