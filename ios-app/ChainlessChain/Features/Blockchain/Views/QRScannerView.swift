import SwiftUI
import AVFoundation

/// QRScannerView - Camera-based QR code scanner for WalletConnect pairing
struct QRScannerView: View {
    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var scannedCode: String?
    @State private var isAuthorized = false
    @State private var showPermissionAlert = false

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

                    // Overlay with scan frame
                    VStack {
                        Spacer()

                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white, lineWidth: 3)
                            .frame(width: 250, height: 250)
                            .background(Color.clear)

                        Spacer()

                        Text("将 WalletConnect QR 码放入框内")
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

// MARK: - QR Scanner UIKit Representable

struct QRScannerRepresentable: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onScan = onScan
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

// MARK: - QR Scanner View Controller

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
