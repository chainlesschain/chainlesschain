import SwiftUI
import UIKit

/// 远程桌面 frame 渲染 view — Phase 6.6.4 (OQ-6 B 实现)。
///
/// UIViewRepresentable 包裹 UIImageView，30 FPS 替换 image 走 UIKit 路径，
/// 避免 SwiftUI Image 在 30 FPS 重建触发 layout pass (Phase 6.6 doc Trap D2)。
///
/// **关键 Trap D2 防御**:
/// - `makeUIView` 只调一次创建 UIImageView
/// - `updateUIView` 仅在 frameData binding 变化时调 `imageView.image = ...`
/// - SwiftUI re-render 触发 updateUIView 时若 frameData 未变 = no-op (Coordinator 比对)
/// - autoreleasepool 包 UIImage decode 减峰值内存（Trap D9 部分缓解；完整 fix 留 v0.2）
struct DesktopFrameView: UIViewRepresentable {
    /// base64-encoded JPEG/PNG frame data；nil = no frame yet
    let frameData: String?
    let contentMode: UIView.ContentMode

    init(frameData: String?, contentMode: UIView.ContentMode = .scaleAspectFit) {
        self.frameData = frameData
        self.contentMode = contentMode
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = contentMode
        view.backgroundColor = .black
        view.clipsToBounds = true
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }

    func updateUIView(_ uiView: UIImageView, context: Context) {
        // Trap D2: 仅在 frameData 真变化时 decode + 更新
        guard let data = frameData, data != context.coordinator.lastFrameData else {
            if frameData == nil && context.coordinator.lastFrameData != nil {
                // 显式 nil = 清空（stopSession 后）
                uiView.image = nil
                context.coordinator.lastFrameData = nil
            }
            return
        }
        autoreleasepool {
            // 容忍 data: URL 前缀（`data:image/jpeg;base64,...`）
            let cleaned = data.hasPrefix("data:")
                ? String(data.split(separator: ",", maxSplits: 1).last ?? "")
                : data
            if let imageData = Data(base64Encoded: cleaned),
               let image = UIImage(data: imageData) {
                uiView.image = image
            }
        }
        context.coordinator.lastFrameData = data
    }

    final class Coordinator {
        var lastFrameData: String? = nil
    }
}
