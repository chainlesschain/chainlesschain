//
//  RecordingListView.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Recording management and playback
//

import SwiftUI

// MARK: - RecordingListView

/// Lists recordings with playback controls
struct RecordingListView: View {
    @StateObject private var recorder = ScreenRecorder.shared
    @StateObject private var replay = ActionReplay.shared
    @StateObject private var viewModel = ComputerUseViewModel.shared

    var body: some View {
        VStack(spacing: 0) {
            // Recording controls
            recordingControlBar

            if recorder.recordings.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(recorder.recordings) { recording in
                        RecordingRow(recording: recording) {
                            // Delete action
                            recorder.deleteRecording(id: recording.id)
                        }
                    }
                }
                .listStyle(.plain)
            }

            // Replay status
            if replay.state != .idle {
                replayStatusBar
            }
        }
    }

    // MARK: - Recording Control Bar

    private var recordingControlBar: some View {
        HStack {
            // Record/Stop button
            Button(action: { viewModel.toggleRecording() }) {
                HStack(spacing: 6) {
                    Image(systemName: viewModel.isRecording ? "stop.circle.fill" : "record.circle")
                        .foregroundColor(viewModel.isRecording ? .red : .blue)
                    Text(viewModel.isRecording ? "Stop" : "Record")
                        .font(.subheadline)
                }
            }
            .buttonStyle(.bordered)

            if viewModel.isRecording {
                // Pause/Resume
                Button(action: {
                    if recorder.state == .recording {
                        recorder.pauseRecording()
                    } else {
                        recorder.resumeRecording()
                    }
                }) {
                    Image(systemName: recorder.state == .paused ? "play.fill" : "pause.fill")
                }
                .buttonStyle(.bordered)

                // Frame count
                Text("\(recorder.currentRecording?.frameCount ?? 0) frames")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text("\(recorder.recordings.count) recordings")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(UIColor.secondarySystemBackground))
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "video.slash")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Recordings")
                .font(.headline)
                .foregroundColor(.secondary)
            Text("Tap Record to capture a browser session")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - Replay Status

    private var replayStatusBar: some View {
        VStack(spacing: 4) {
            ProgressView(value: replay.progress, total: 100)
                .progressViewStyle(.linear)

            HStack {
                Text("Replaying: \(replay.currentIndex)/\(replay.totalActions)")
                    .font(.caption)

                Spacer()

                // Replay controls
                HStack(spacing: 12) {
                    Button(action: { replay.pause() }) {
                        Image(systemName: "pause.fill")
                    }
                    .disabled(replay.state != .playing)

                    Button(action: {
                        Task { await replay.resume() }
                    }) {
                        Image(systemName: "play.fill")
                    }
                    .disabled(replay.state != .paused)

                    Button(action: { replay.stop() }) {
                        Image(systemName: "stop.fill")
                    }
                }
                .font(.caption)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(Color(UIColor.tertiarySystemBackground))
    }
}

// MARK: - Recording Row

private struct RecordingRow: View {
    let recording: CURecordingMetadata
    let onDelete: () -> Void

    private var durationString: String {
        let duration = recording.duration
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    private var dateString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: recording.startTime)
    }

    var body: some View {
        HStack {
            // Thumbnail placeholder
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(UIColor.tertiarySystemBackground))
                .frame(width: 50, height: 38)
                .overlay(
                    Image(systemName: "play.rectangle")
                        .foregroundColor(.secondary)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(dateString)
                    .font(.subheadline)

                HStack(spacing: 8) {
                    Label("\(recording.frameCount)", systemImage: "photo.stack")
                    Label(durationString, systemImage: "clock")
                    Label(String(format: "%.0f fps", recording.fps), systemImage: "speedometer")
                }
                .font(.caption2)
                .foregroundColor(.secondary)
            }

            Spacer()

            Button(action: onDelete) {
                Image(systemName: "trash")
                    .foregroundColor(.red)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

struct RecordingListView_Previews: PreviewProvider {
    static var previews: some View {
        RecordingListView()
    }
}
