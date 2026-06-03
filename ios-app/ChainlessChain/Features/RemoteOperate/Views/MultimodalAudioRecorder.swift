import Foundation
import AVFoundation
import SwiftUI

/// Phase 6.4 v0.3 — `AIExtendedMultimodalView` 实时录音 helper。
///
/// 包 AVAudioRecorder + AVAudioSession + 计时器，对外暴露 @Published 状态：
/// - `isRecording` / `duration` / `error` / `recordedFileURL`
///
/// **流程**：
/// 1. caller 调 `requestPermissionAndStart()` — 触发系统麦克权限弹窗 (一次性)
/// 2. 录音中 timer 每 0.1s tick 更新 duration
/// 3. caller 调 `stop()` 拿 `.m4a` 文件 URL + base64 字符串
///
/// **Info.plist 已配 `NSMicrophoneUsageDescription`**（中文："需要访问麦克风…"）。
///
/// 录文件落 NSTemporaryDirectory()/cc_record_<timestamp>.m4a，
/// caller 处理完后应 cleanup（本类不自动清，留给 caller 决策何时清）。
@MainActor
public final class MultimodalAudioRecorder: ObservableObject {

    @Published public var isRecording: Bool = false
    @Published public var duration: TimeInterval = 0
    @Published public var error: String?
    @Published public var lastFileURL: URL?

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var timer: Timer?

    public init() {}

    /// 一键请求权限 + 开录。失败设 error；若用户拒绝权限返 false。
    public func requestPermissionAndStart() async -> Bool {
        guard !isRecording else { return false }

        // iOS 17+ 用 AVAudioApplication.requestRecordPermission，
        // 16-17 之间用 AVAudioSession.sharedInstance().requestRecordPermission。
        // 这里用兼容 16 的旧 API（项目最低 deployment 16.0）。
        let granted: Bool = await withCheckedContinuation { cont in
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                cont.resume(returning: ok)
            }
        }
        guard granted else {
            self.error = "麦克风权限被拒绝"
            return false
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true, options: [])
        } catch {
            self.error = "音频会话激活失败: \(error)"
            return false
        }

        let url = NSTemporaryDirectory().appending("cc_record_\(Int(Date().timeIntervalSince1970)).m4a")
        let fileURL = URL(fileURLWithPath: url)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000.0,           // 16kHz 适合 Whisper
            AVNumberOfChannelsKey: 1,           // mono 减小体积
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: fileURL, settings: settings)
            r.prepareToRecord()
            guard r.record() else {
                self.error = "AVAudioRecorder.record 返回 false"
                return false
            }
            recorder = r
            isRecording = true
            startedAt = Date()
            duration = 0
            error = nil
            // Timer 在主线程
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self = self, let start = self.startedAt else { return }
                    self.duration = Date().timeIntervalSince(start)
                }
            }
            return true
        } catch {
            self.error = "AVAudioRecorder 创建失败: \(error)"
            return false
        }
    }

    /// 停止录音 + 返 (fileURL, base64Data)；失败返 nil。
    public func stop() -> (URL, String)? {
        guard isRecording, let r = recorder else { return nil }
        r.stop()
        timer?.invalidate()
        timer = nil
        isRecording = false

        let url = r.url
        recorder = nil
        startedAt = nil

        do {
            let data = try Data(contentsOf: url)
            let b64 = data.base64EncodedString()
            self.lastFileURL = url
            // 释放音频会话（其它播放路径不受影响）
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            return (url, b64)
        } catch {
            self.error = "读录音文件失败: \(error)"
            return nil
        }
    }

    /// 取消并删录音（用户中途放弃）。
    public func cancel() {
        guard isRecording, let r = recorder else { return }
        r.stop()
        timer?.invalidate()
        timer = nil
        isRecording = false
        let url = r.url
        recorder = nil
        startedAt = nil
        try? FileManager.default.removeItem(at: url)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
