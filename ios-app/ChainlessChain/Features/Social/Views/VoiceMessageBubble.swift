import SwiftUI

/// VoiceMessageBubble - Display and playback UI for voice messages
struct VoiceMessageBubble: View {
    let message: P2PViewModel.ChatMessage
    let isOutgoing: Bool

    @StateObject private var playbackManager = VoicePlaybackManager.shared

    private var isCurrentlyPlaying: Bool {
        playbackManager.currentMessageId == message.id && playbackManager.isPlaying
    }

    private var currentProgress: Double {
        playbackManager.currentMessageId == message.id ? playbackManager.progress : 0
    }

    var body: some View {
        HStack(spacing: 10) {
            // Play/Pause button
            Button(action: togglePlayback) {
                Image(systemName: isCurrentlyPlaying ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .foregroundColor(isOutgoing ? .white : .blue)
                    .frame(width: 32, height: 32)
            }

            // Waveform + progress
            VStack(alignment: .leading, spacing: 4) {
                // Waveform visualization
                GeometryReader { geometry in
                    HStack(spacing: 2) {
                        ForEach(0..<waveformBarCount(width: geometry.size.width), id: \.self) { index in
                            RoundedRectangle(cornerRadius: 1)
                                .fill(waveformBarColor(index: index, total: waveformBarCount(width: geometry.size.width)))
                                .frame(width: 3, height: waveformBarHeight(index: index))
                        }
                    }
                }
                .frame(height: 20)

                // Duration
                HStack {
                    if isCurrentlyPlaying {
                        Text(VoicePlaybackManager.formatDuration(playbackManager.currentTime))
                            .font(.caption2)
                            .foregroundColor(isOutgoing ? .white.opacity(0.8) : .secondary)
                    }
                    Spacer()
                    Text(VoicePlaybackManager.formatDuration(message.audioDuration ?? 0))
                        .font(.caption2)
                        .foregroundColor(isOutgoing ? .white.opacity(0.8) : .secondary)
                }
            }
            .frame(minWidth: 120)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(isOutgoing ? Color.blue : Color(UIColor.systemGray5))
        .cornerRadius(16)
        .frame(maxWidth: 240)
    }

    private func togglePlayback() {
        guard let audioData = getAudioData() else { return }
        playbackManager.toggle(data: audioData, messageId: message.id)
    }

    private func getAudioData() -> Data? {
        if let data = message.audioData {
            return data
        }
        // Try to decode from base64 content
        if message.content.hasPrefix("data:audio") {
            if let base64Start = message.content.range(of: ";base64,") {
                let base64String = String(message.content[base64Start.upperBound...])
                return Data(base64Encoded: base64String)
            }
        }
        return Data(base64Encoded: message.content)
    }

    private func waveformBarCount(width: CGFloat) -> Int {
        max(10, Int(width / 5))
    }

    private func waveformBarColor(index: Int, total: Int) -> Color {
        let position = Double(index) / Double(total)
        if position <= currentProgress {
            return isOutgoing ? .white : .blue
        }
        return isOutgoing ? .white.opacity(0.4) : Color.gray.opacity(0.4)
    }

    private func waveformBarHeight(index: Int) -> CGFloat {
        // Generate pseudo-random waveform based on message ID and index
        let seed = message.id.hashValue &+ index
        let normalized = abs(Double(seed % 100)) / 100.0
        return CGFloat(4 + normalized * 16)
    }
}
