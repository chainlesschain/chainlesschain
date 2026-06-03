import SwiftUI
import CoreP2P

/// 媒体控制主屏 — Phase 6.2（主屏 batch 1 — media skill UI 收口）。
///
/// 3 板块：
/// 1. **音量条**（getVolume + setVolume 实时；mute 按钮）
/// 2. **播放控制**（mediaControl 6 按钮: prev/play/pause/next/stop/playPause）+
///    当前播放信息（getPlaybackStatus track/artist/source）
/// 3. **音频设备**（getDevices — 输入/输出设备列表）
struct RemoteMediaView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    @State private var volume: Double = 50
    @State private var muted: Bool = false
    @State private var volumeLoading: Bool = false
    @State private var playbackTrack: String? = nil
    @State private var playbackArtist: String? = nil
    @State private var playbackSource: String? = nil
    @State private var playing: Bool = false
    @State private var devices: [MediaDevice] = []
    @State private var lastError: String? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                volumeSection
                playbackSection
                devicesSection
                if let err = lastError {
                    errorBanner(err)
                }
            }
            .padding(12)
        }
        .refreshable { await loadAll() }
        .task { await loadAll() }
    }

    // MARK: - 音量

    private var volumeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("音量", icon: "speaker.wave.2")
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    Button {
                        Task { await toggleMute() }
                    } label: {
                        Image(systemName: muted ? "speaker.slash.fill" : "speaker.fill")
                            .font(.system(size: 20))
                            .foregroundColor(muted ? .orange : .accentColor)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Color(.tertiarySystemBackground)))
                    }
                    .buttonStyle(.plain)

                    Slider(value: $volume, in: 0...100, step: 1) { editing in
                        if !editing { Task { await applyVolume() } }
                    }
                    .disabled(volumeLoading || muted)

                    Text("\(Int(volume))")
                        .font(.system(.subheadline, design: .monospaced))
                        .frame(width: 32, alignment: .trailing)
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    // MARK: - 播放控制

    private var playbackSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("正在播放", icon: "music.note")
            VStack(alignment: .leading, spacing: 8) {
                if let t = playbackTrack {
                    Text(t).font(.headline).lineLimit(1)
                    HStack(spacing: 8) {
                        if let a = playbackArtist { Text(a) }
                        if let s = playbackSource {
                            Text("·").foregroundColor(.secondary)
                            Text(s).foregroundColor(.secondary)
                        }
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                } else {
                    Text(playing ? "正在播放…" : "无播放信息")
                        .foregroundColor(.secondary)
                        .font(.subheadline)
                }
                HStack(spacing: 14) {
                    controlButton(systemName: "backward.fill") {
                        await sendControl(.previous)
                    }
                    controlButton(systemName: "stop.fill", small: true) {
                        await sendControl(.stop)
                    }
                    controlButton(systemName: playing ? "pause.fill" : "play.fill", big: true) {
                        await sendControl(playing ? .pause : .play)
                    }
                    controlButton(systemName: "playpause.fill", small: true) {
                        await sendControl(.playPause)
                    }
                    controlButton(systemName: "forward.fill") {
                        await sendControl(.next)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        }
    }

    private func controlButton(systemName: String, big: Bool = false, small: Bool = false,
                                action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Image(systemName: systemName)
                .font(.system(size: big ? 28 : (small ? 18 : 22), weight: .semibold))
                .foregroundColor(.accentColor)
                .frame(width: big ? 56 : (small ? 36 : 44),
                       height: big ? 56 : (small ? 36 : 44))
                .background(Circle().fill(Color(.tertiarySystemBackground)))
        }
        .buttonStyle(.plain)
    }

    // MARK: - 设备

    private var devicesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("音频设备 (\(devices.count))", icon: "headphones")
            if devices.isEmpty {
                placeholderCard("无设备或未加载")
            } else {
                ForEach(devices, id: \.id) { d in
                    deviceRow(d)
                }
            }
        }
    }

    private func deviceRow(_ d: MediaDevice) -> some View {
        HStack {
            Image(systemName: d.type == "input" ? "mic" : "speaker.wave.2")
                .foregroundColor(d.isDefault ? .accentColor : .secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(d.name).font(.subheadline)
                if let type = d.type {
                    Text(type)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
            if d.isDefault {
                Text("默认")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                    .foregroundColor(.accentColor)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(.secondarySystemBackground)))
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon)
            Text(title).font(.headline)
        }
        .foregroundColor(.primary)
    }

    private func placeholderCard(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
            Text(msg).font(.caption)
            Spacer()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.1)))
    }

    // MARK: - Actions

    private func loadAll() async {
        lastError = nil
        do {
            async let vol = remoteDeps.media.getVolume(pcPeerId: pcPeerId)
            async let pb = remoteDeps.media.getPlaybackStatus(pcPeerId: pcPeerId)
            async let dev = remoteDeps.media.getDevices(pcPeerId: pcPeerId)

            let v = try await vol
            await MainActor.run {
                self.volume = Double(v.volume)
                self.muted = v.muted
            }

            if let p = try? await pb {
                await MainActor.run {
                    self.playing = p.playing
                    self.playbackTrack = p.track
                    self.playbackArtist = p.artist
                    self.playbackSource = p.source
                }
            }

            let d = try await dev
            await MainActor.run { self.devices = d.devices }
        } catch {
            await MainActor.run { lastError = "加载失败：\(error.localizedDescription)" }
        }
    }

    private func applyVolume() async {
        volumeLoading = true
        defer { volumeLoading = false }
        do {
            _ = try await remoteDeps.media.setVolume(pcPeerId: pcPeerId, volume: Int(volume))
        } catch {
            await MainActor.run { lastError = "音量设置失败：\(error.localizedDescription)" }
        }
    }

    private func toggleMute() async {
        do {
            let r = try await remoteDeps.media.toggleMute(pcPeerId: pcPeerId)
            await MainActor.run { self.muted = r.muted }
        } catch {
            await MainActor.run { lastError = "静音切换失败：\(error.localizedDescription)" }
        }
    }

    private func sendControl(_ action: MediaControlAction) async {
        do {
            _ = try await remoteDeps.media.mediaControl(pcPeerId: pcPeerId, action: action)
            if action == .play { await MainActor.run { playing = true } }
            if action == .pause || action == .stop { await MainActor.run { playing = false } }
        } catch {
            await MainActor.run { lastError = "\(action.rawValue) 失败：\(error.localizedDescription)" }
        }
    }
}
