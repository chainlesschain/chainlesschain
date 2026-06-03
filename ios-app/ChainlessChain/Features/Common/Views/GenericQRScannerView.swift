import SwiftUI
import AVFoundation

/// 通用 QR 扫码 view — 从 `QRScannerView` 提取，无业务校验、文案可定制。
/// 任何模块（WalletConnect / 桌面配对 / 未来好友添加等）扫码都用本 view。
///
/// **不要**在本 view 内做 payload 格式校验 — 透传任意 string 给 `onScan`。
/// memory `desktop_qr_pairing_flow_b.md` 坑 #4：social `QRCodeScannerViewModel`
/// 内置 ChainlessChain-only 校验把桌面 pairing JSON 直接 reject，灾难。
struct GenericQRScannerView: View {
    let prompt: String
    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var scannedCode: String?
    @State private var isAuthorized = false

    var body: some View {
        NavigationView {
            ZStack {
                if isAuthorized {
                    QRScannerRepresentable(onScan: { code in
                        guard scannedCode == nil else { return }
                        scannedCode = code
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onScan(code)
                        dismiss()
                    })
                    .ignoresSafeArea()

                    VStack {
                        Spacer()
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white, lineWidth: 3)
                            .frame(width: 250, height: 250)
                            .background(Color.clear)
                        Spacer()
                        Text(prompt)
                            .font(.subheadline)
                            .foregroundColor(.white)
                            .padding()
                            .background(Color.black.opacity(0.6))
                            .cornerRadius(8)
                            .padding(.bottom, 40)
                    }
                } else {
                    VStack(spacing: 20) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        Text("需要相机权限")
                            .font(.headline)
                        Text("请在系统设置中允许 ChainlessChain 使用相机")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("打开设置") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("扫描 QR 码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                        .foregroundColor(.white)
                }
            }
            .onAppear {
                checkCameraPermission()
            }
        }
    }

    private func checkCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            isAuthorized = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    isAuthorized = granted
                }
            }
        default:
            isAuthorized = false
        }
    }
}

// MARK: - UIKit Bridge

struct QRScannerRepresentable: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onScan = onScan
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onScan: ((String) -> Void)?

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasScanned = false

    override func viewDidLoad() {
        super.viewDidLoad()
        setupCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startScanning()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopScanning()
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            return
        }
        if session.canAddInput(input) {
            session.addInput(input)
        }
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            output.metadataObjectTypes = [.qr]
        }
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        captureSession = session
        previewLayer = preview
    }

    private func startScanning() {
        guard let session = captureSession, !session.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    private func stopScanning() {
        guard let session = captureSession, session.isRunning else { return }
        session.stopRunning()
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasScanned,
              let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let code = metadataObject.stringValue else {
            return
        }
        hasScanned = true
        stopScanning()
        onScan?(code)
    }
}
