import SwiftUI

/// QRScannerView - WalletConnect 专用扫码屏，对 GenericQRScannerView 的 thin wrapper。
///
/// **不要**在这里加 WalletConnect-specific 校验，让 callback 拿到 raw string。
/// 通用 view 在 `Features/Common/Views/GenericQRScannerView.swift` —— 任何新功能
/// 直接用 GenericQRScannerView 不要 import 本文件。
struct QRScannerView: View {
    let onScan: (String) -> Void

    var body: some View {
        GenericQRScannerView(
            prompt: "将 WalletConnect QR 码放入框内",
            onScan: onScan
        )
    }
}
