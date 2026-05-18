import SwiftUI
import AVFoundation

/// VoiceMessageRecorder - Recording UI for voice messages
struct VoiceMessageRecorder: View {
    let onComplete: (Data, TimeInterval) -> Void
    let onCancel: () -> Void

    @StateObject private var recorder = VoiceRecorderState()

    var body: some View {
        VStack(spacing: 20) {
            // Title
            Text(recorder.isRecording ? "正在录音..." : "准备录音")
                .font(.headline)

            // Volume indicator
            HStack(spacing: 3) {
                ForEach(0..<20, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(barColor(for: index))
                        .frame(width: 6, height: barHeight(for: index))
                        .animation(.easeInOut(duration: 0.1), value: recorder.audioLevel)
                }
            }
            .frame(height: 50)

            // Duration display
            Text(VoicePlaybackManager.formatDuration(recorder.duration))
                .font(.system(size: 36, weight: .light, design: .monospaced))
                .foregroundColor(recorder.isRecording ? .red : .primary)

            // Max duration hint
            if recorder.duration > 50 {
                Text("最长录制 60 秒")
                    .font(.caption)
                    .foregroundColor(.orange)
            }

            // Controls
            HStack(spacing: 40) {
                // Cancel button
                Button(action: {
                    recorder.cancelRecording()
                    onCancel()
                }) {
                    VStack(spacing: 4) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(.gray)
                        Text("取消")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                }

                // Record/Stop button
                Button(action: {
                    if recorder.isRecording {
                        if let (data, duration) = recorder.stopRecording() {
                            onComplete(data, duration)
                        }
                    } else {
                        recorder.startRecording()
                    }
                }) {
                    VStack(spacing: 4) {
                        ZStack {
                            Circle()
                                .fill(recorder.isRecording ? Color.red : Color.blue)
                                .frame(width: 64, height: 64)

                            if recorder.isRecording {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white)
                                    .frame(width: 22, height: 22)
                            } else {
                                Circle()
                                    .fill(Color.white)
                                    .frame(width: 24, height: 24)
                            }
                        }
                        Text(recorder.isRecording ? "停止" : "录音")
                            .font(.caption)
                            .foregroundColor(recorder.isRecording ? .red : .blue)
                    }
                }

                // Send button (only when recording)
                Button(action: {
                    if let (data, duration) = recorder.stopRecording() {
                        onComplete(data, duration)
                    }
                }) {
                    VStack(spacing: 4) {
                        Image(systemName: "paperplane.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(recorder.isRecording ? .green : .gray)
                        Text("发送")
                            .font(.caption)
                            .foregroundColor(recorder.isRecording ? .green : .gray)
                    }
                }
                .disabled(!recorder.isRecording)
            }
        }
        .padding(30)
        .onDisappear {
            recorder.cancelRecording()
        }
    }

    private func barColor(for index: Int) -> Color {
        let threshold = Double(index) / 20.0
        if recorder.audioLevel > threshold {
            return recorder.isRecording ? .red : .blue
        }
        return Color.gray.opacity(0.3)
    }

    private func barHeight(for index: Int) -> CGFloat {
        let threshold = Double(index) / 20.0
        if recorder.audioLevel > threshold {
            return CGFloat(10 + (recorder.audioLevel - threshold) * 80)
        }
        return 10
    }
}

// MARK: - Voice Recorder State

@MainActor
class VoiceRecorderState: ObservableObject {
    @Published var isRecording = false
    @Published var duration: TimeInterval = 0
    @Published var audioLevel: Double = 0

    private var audioRecorder: AVAudioRecorder?
    private var durationTimer: Timer?
    private var levelTimer: Timer?
    private var tempFileURL: URL?

    private let maxDuration: TimeInterval = 60

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            Logger.shared.error("[VoiceRecorder] Audio session error: \(error)")
            return
        }

        // Create temp file
        let fileName = "voice_\(UUID().uuidString).m4a"
        tempFileURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

        guard let url = tempFileURL else { return }

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            AVEncoderBitRateKey: 128000
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.isMeteringEnabled = true
            audioRecorder?.prepareToRecord()
            audioRecorder?.record(forDuration: maxDuration)

            isRecording = true
            duration = 0
            audioLevel = 0

            startTimers()
        } catch {
            Logger.shared.error("[VoiceRecorder] Failed to start recording: \(error)")
        }
    }

    func stopRecording() -> (Data, TimeInterval)? {
        guard isRecording else { return nil }

        audioRecorder?.stop()
        stopTimers()
        isRecording = false

        let finalDuration = duration

        // Deactivate audio session
        try? AVAudioSession.sharedInstance().setActive(false)

        // Read recorded data
        guard let url = tempFileURL,
              let data = try? Data(contentsOf: url) else {
            return nil
        }

        // Cleanup temp file
        try? FileManager.default.removeItem(at: url)
        tempFileURL = nil

        guard finalDuration >= 1.0 else {
            // Too short
            return nil
        }

        return (data, finalDuration)
    }

    func cancelRecording() {
        audioRecorder?.stop()
        stopTimers()
        isRecording = false

        // Cleanup temp file
        if let url = tempFileURL {
            try? FileManager.default.removeItem(at: url)
            tempFileURL = nil
        }

        try? AVAudioSession.sharedInstance().setActive(false)
    }

    private func startTimers() {
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, self.isRecording else { return }
                self.duration += 0.1
                if self.duration >= self.maxDuration {
                    _ = self.stopRecording()
                }
            }
        }

        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                self.audioRecorder?.updateMeters()
                let level = self.audioRecorder?.averagePower(forChannel: 0) ?? -160
                // Convert dB to 0.0-1.0 range (-160 to 0 dB)
                let normalizedLevel = max(0, (level + 60) / 60)
                self.audioLevel = Double(normalizedLevel)
            }
        }
    }

    private func stopTimers() {
        durationTimer?.invalidate()
        durationTimer = nil
        levelTimer?.invalidate()
        levelTimer = nil
    }
}
