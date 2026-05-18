import SwiftUI
import CoreImage.CIFilterBuiltins

/// CoreImage QR 渲染 — Flow A 用，未来任何「显示 QR 给对端扫」场景复用。
///
/// **关键**：`CIQRCodeGenerator` 默认输出极小（~23×23 px），直接 SwiftUI Image
/// 渲染会糊。修法 = `CGAffineTransform(scaleX: scale, y: scale)` 放大到目标
/// 像素 + `.interpolation(.none)` 关掉 SwiftUI 平滑（保持 QR 黑白边界锐利）。
///
/// `correctionLevel` 默认 H（30% 容错），扫描时手抖/反光鲁棒性更好；payload 短
/// 时（<150 char）H 不会过度增加密度。
struct QrCodeImage: View {
    let payload: String
    let size: CGFloat
    let correctionLevel: String

    init(payload: String, size: CGFloat = 240, correctionLevel: String = "H") {
        self.payload = payload
        self.size = size
        self.correctionLevel = correctionLevel
    }

    var body: some View {
        Group {
            if let image = generateQRImage() {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size, height: size)
                    .background(Color.white)
            } else {
                // 极少数情况（payload 超大 / CIFilter 故障）— 显示占位
                Rectangle()
                    .fill(Color(.systemGray5))
                    .frame(width: size, height: size)
                    .overlay(
                        Text("QR 生成失败")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    )
            }
        }
    }

    private func generateQRImage() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = correctionLevel
        guard let output = filter.outputImage else { return nil }

        // 计算 scale 让 CIImage 输出 ≥ 目标 size 像素（Retina × 3 留余）
        let targetPx = size * UIScreen.main.scale
        let outputExtent = output.extent.width  // CI 默认 ~23
        let scale = max(1, targetPx / outputExtent)
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let context = CIContext(options: nil)
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

#Preview {
    VStack(spacing: 16) {
        QrCodeImage(payload: #"{"type":"device-pairing","code":"123456"}"#)
        QrCodeImage(payload: "https://chainlesschain.com", size: 160)
    }
    .padding()
}
