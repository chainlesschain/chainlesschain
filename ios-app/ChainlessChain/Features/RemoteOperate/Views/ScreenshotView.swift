import SwiftUI
import UIKit
import Photos
import CoreP2P

/// 桌面截屏 skill view — Phase 3.5 v0.1。
///
/// **OQ-2 决策**：显式"保存到相册"按钮（不自动保存）— iOS HIG 强调用户 explicit
/// consent，避免 Photos permission prompt 时序混乱。
///
/// **布局**：
/// - 无截图状态：大 capture button + 提示文案
/// - 有截图：图片预览（缩放适配）+ "保存到相册" + "再截一张" 按钮
struct ScreenshotView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            screenshot: remoteDeps.screenshot,
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

private struct Inner: View {
    @StateObject private var vm: ScreenshotViewModel

    init(pcPeerId: String, screenshot: ScreenshotCommands, currentDIDProvider: @escaping () -> String?) {
        _vm = StateObject(wrappedValue: ScreenshotViewModel(
            pcPeerId: pcPeerId,
            screenshot: screenshot,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let err = vm.lastError {
                    errorBanner(err)
                }
                if let saveStatus = vm.lastSaveStatus {
                    saveBanner(saveStatus)
                }

                if let imageData = vm.decodedImageData,
                   let uiImage = autoreleasepool(invoking: { UIImage(data: imageData) }) {
                    capturedView(uiImage: uiImage)
                } else {
                    emptyView
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Subviews

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer().frame(height: 40)
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 80))
                .foregroundColor(.secondary)
            Text("桌面截屏")
                .font(.title3).fontWeight(.semibold)
            Text("点击下方按钮触发桌面端截屏并显示在 iPhone")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                Task { await vm.capture() }
            } label: {
                if vm.busy {
                    HStack(spacing: 8) {
                        ProgressView().tint(.white)
                        Text("截屏中…")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Label("立即截屏", systemImage: "camera.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(vm.busy)
            .padding(.horizontal, 32)
            .padding(.top, 16)
            Text("v0.1 仅截主屏；区域选择 / OCR 留 v0.2+")
                .font(.caption2)
                .foregroundColor(Color.secondary.opacity(0.7))
            Spacer().frame(height: 40)
        }
    }

    private func capturedView(uiImage: UIImage) -> some View {
        VStack(spacing: 12) {
            // metadata header
            if let meta = vm.lastCaptureMetadata {
                HStack {
                    Image(systemName: "info.circle")
                        .foregroundColor(.secondary)
                    Text("\(meta.width) × \(meta.height) · \(meta.format.uppercased()) · \(formatBytes(meta.estimatedDecodedBytes))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 8)
            }

            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 12) {
                Button {
                    saveToAlbum(uiImage)
                } label: {
                    Label("保存到相册", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(vm.busy)

                Button {
                    Task { await vm.capture() }
                } label: {
                    Label("再截一张", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(vm.busy)
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(message)
                .font(.caption).lineLimit(3)
            Spacer()
            Button { vm.clearError() } label: {
                Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.1)))
    }

    private func saveBanner(_ message: String) -> some View {
        let isSuccess = message.contains("已保存")
        return HStack(spacing: 8) {
            Image(systemName: isSuccess ? "checkmark.circle.fill" : "xmark.octagon.fill")
                .foregroundColor(isSuccess ? .green : .red)
            Text(message).font(.caption)
            Spacer()
            Button { vm.clearSaveStatus() } label: {
                Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill((isSuccess ? Color.green : Color.red).opacity(0.1)))
    }

    // MARK: - Save to album

    private func saveToAlbum(_ image: UIImage) {
        // OQ-2: 显式按钮触发；Photos permission 在第一次保存时由系统弹 prompt
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            DispatchQueue.main.async {
                guard status == .authorized || status == .limited else {
                    Task { @MainActor in
                        vm.reportSaveResult(success: false, errorMessage: "未授权 Photos 写入权限")
                    }
                    return
                }
                PHPhotoLibrary.shared().performChanges({
                    PHAssetCreationRequest.creationRequestForAsset(from: image)
                }) { success, error in
                    Task { @MainActor in
                        vm.reportSaveResult(success: success, errorMessage: error?.localizedDescription)
                    }
                }
            }
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.2f MB", Double(bytes) / (1024 * 1024))
    }
}
