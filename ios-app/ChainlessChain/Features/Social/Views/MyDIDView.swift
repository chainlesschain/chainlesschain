import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins

/// 我的 DID + 二维码（与 Android `MyQRCodeScreen` 对齐）。
/// 二维码用系统 CoreImage 生成，无需第三方库。
struct MyDIDView: View {
    @Environment(\.dismiss) private var dismiss
    let did: String
    @State private var copied = false

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Spacer()

                if let img = Self.qrImage(from: did) {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 240, height: 240)
                        .padding()
                        .background(Color.white)
                        .cornerRadius(16)
                        .shadow(radius: 4)
                } else {
                    Image(systemName: "qrcode")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 200, height: 200)
                        .foregroundColor(.gray)
                }

                Text("我的 DID")
                    .font(.headline)

                Text(did.isEmpty ? "尚未生成 DID" : did)
                    .font(.system(.footnote, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .padding(.horizontal)

                Button {
                    UIPasteboard.general.string = did
                    copied = true
                } label: {
                    Label(copied ? "已复制" : "复制 DID", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .disabled(did.isEmpty)

                Text("让好友扫描或输入你的 DID 即可添加你为好友。")
                    .font(.caption)
                    .foregroundColor(.gray)
                    .multilineTextAlignment(.center)
                    .padding()

                Spacer()
            }
            .padding()
            .navigationTitle("我的二维码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    static func qrImage(from string: String) -> UIImage? {
        guard !string.isEmpty else { return nil }
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
