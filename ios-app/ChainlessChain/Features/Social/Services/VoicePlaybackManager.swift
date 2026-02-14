import Foundation
import AVFoundation
import Combine

/// VoicePlaybackManager - Audio playback service for voice messages
@MainActor
class VoicePlaybackManager: NSObject, ObservableObject {
    static let shared = VoicePlaybackManager()

    @Published var isPlaying = false
    @Published var progress: Double = 0.0
    @Published var currentTime: TimeInterval = 0.0
    @Published var duration: TimeInterval = 0.0
    @Published var currentMessageId: String?

    private var audioPlayer: AVAudioPlayer?
    private var progressTimer: Timer?

    private override init() {
        super.init()
    }

    // MARK: - Playback Control

    /// Play audio data for a message
    func play(data: Data, messageId: String) {
        // Stop current playback if playing a different message
        if currentMessageId != messageId {
            stop()
        }

        do {
            // Configure audio session for playback
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)

            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.delegate = self
            audioPlayer?.prepareToPlay()

            duration = audioPlayer?.duration ?? 0
            currentMessageId = messageId
            isPlaying = true
            progress = 0.0
            currentTime = 0.0

            audioPlayer?.play()
            startProgressTimer()
        } catch {
            Logger.shared.error("[VoicePlayback] Failed to play audio: \(error)")
            reset()
        }
    }

    /// Stop playback
    func stop() {
        audioPlayer?.stop()
        stopProgressTimer()
        reset()
    }

    /// Toggle play/pause
    func toggle(data: Data, messageId: String) {
        if isPlaying && currentMessageId == messageId {
            pause()
        } else if !isPlaying && currentMessageId == messageId {
            resume()
        } else {
            play(data: data, messageId: messageId)
        }
    }

    /// Pause playback
    func pause() {
        audioPlayer?.pause()
        isPlaying = false
        stopProgressTimer()
    }

    /// Resume playback
    func resume() {
        audioPlayer?.play()
        isPlaying = true
        startProgressTimer()
    }

    /// Seek to position (0.0 - 1.0)
    func seek(to position: Double) {
        guard let player = audioPlayer else { return }
        let targetTime = position * player.duration
        player.currentTime = targetTime
        currentTime = targetTime
        progress = position
    }

    // MARK: - Progress Timer

    private func startProgressTimer() {
        stopProgressTimer()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateProgress()
            }
        }
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    private func updateProgress() {
        guard let player = audioPlayer, player.duration > 0 else { return }
        currentTime = player.currentTime
        progress = player.currentTime / player.duration
    }

    private func reset() {
        isPlaying = false
        progress = 0.0
        currentTime = 0.0
        duration = 0.0
        currentMessageId = nil
        audioPlayer = nil
    }

    // MARK: - Helpers

    /// Format duration for display (e.g. "0:05", "1:23")
    static func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - AVAudioPlayerDelegate

extension VoicePlaybackManager: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            stopProgressTimer()
            reset()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            Logger.shared.error("[VoicePlayback] Decode error: \(error?.localizedDescription ?? "unknown")")
            stopProgressTimer()
            reset()
        }
    }
}
