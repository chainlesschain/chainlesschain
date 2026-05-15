import Foundation

/// 桌面截屏 SwiftUI ViewModel — Phase 3.5 (OQ-1: CoreP2P placement)。
///
/// **行为**：
/// - tap "截屏" → `ScreenshotCommands.capture` → 拿 base64 → decode 成 Data
///   暴露给 View（View 用 UIImage(data:) 显示）
/// - tap "保存到相册" → View 用 UIImage 保存 (OQ-2: 显式按钮，非自动)
/// - tap "再截一张" → reset state 重新触发
///
/// **内存管理**（design doc §7.4 trap）：base64 解码完立即释放原始 string；
/// `decodedImageData` `@Published` clear 上张前显式 = nil；UIImage 实际渲染
/// 由 View 持有 + autoreleasepool wrapping (在 View 端)。
@MainActor
public final class ScreenshotViewModel: ObservableObject {

    @Published public private(set) var lastCaptureMetadata: ScreenCaptureResult?
    @Published public private(set) var decodedImageData: Data?
    @Published public private(set) var busy: Bool = false
    @Published public private(set) var lastError: String?
    /// 最近一次保存到相册的结果（成功 / 失败原因）。View 显 toast / banner 用。
    @Published public private(set) var lastSaveStatus: String?

    public let pcPeerId: String

    private let screenshot: ScreenshotCommands
    private let currentDIDProvider: () -> String?

    public init(
        pcPeerId: String,
        screenshot: ScreenshotCommands,
        currentDIDProvider: @escaping () -> String?
    ) {
        self.pcPeerId = pcPeerId
        self.screenshot = screenshot
        self.currentDIDProvider = currentDIDProvider
    }

    /// 触发桌面截屏 + decode base64。
    public func capture() async {
        // 释放上一张 decoded data，让 GC 回收前一张大 buffer (内存 spike 防御)
        decodedImageData = nil
        lastSaveStatus = nil
        busy = true
        defer { busy = false }
        do {
            let meta = try await screenshot.capture(
                pcPeerId: pcPeerId,
                mobileDid: currentDIDProvider()
            )
            lastCaptureMetadata = meta
            // base64 decode — autoreleasepool 包让中间 buffer 立即回收
            // (Swift 的 NSData.init(base64Encoded:) 是 ObjC 桥，autoreleasepool 有效)
            let decoded: Data? = autoreleasepool {
                Data(base64Encoded: meta.imageBase64, options: .ignoreUnknownCharacters)
            }
            guard let imageData = decoded else {
                lastError = "图片解码失败：base64 无效"
                return
            }
            decodedImageData = imageData
            lastError = nil
        } catch {
            lastError = formatError(error)
        }
    }

    /// 重置 — UI tap "再截一张" 时调，让 View 切回 capture 按钮态。
    public func reset() {
        decodedImageData = nil
        lastCaptureMetadata = nil
        lastError = nil
        lastSaveStatus = nil
    }

    /// View 端保存成功 / 失败后回调本方法显 banner。
    public func reportSaveResult(success: Bool, errorMessage: String? = nil) {
        if success {
            lastSaveStatus = "已保存到相册"
        } else {
            lastSaveStatus = "保存失败：\(errorMessage ?? "未知错误")"
        }
    }

    public func clearError() {
        lastError = nil
    }

    public func clearSaveStatus() {
        lastSaveStatus = nil
    }

    private func formatError(_ error: Error) -> String {
        switch error {
        case RemoteSkillError.remoteError(_, let msg):
            return "桌面端错误：\(msg)"
        case RemoteSkillError.malformedResult(let detail):
            return "响应解析失败：\(detail)"
        default:
            return (error as NSError).localizedDescription
        }
    }
}
