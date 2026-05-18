import Foundation

/// 媒体控制 typed RPC wrapper — Phase 6.2 (主屏 batch 1)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/MediaCommands.kt` 桌面已支持 10 method 子集
/// （桌面 case ⊂ Android 55 method invoke；Android 多 45 method 缺桌面 impl 留 Phase 7+ debt
///  — 含 camera / microphone / recording / playlist / equalizer / app 级音量等）。
///
/// **wire 协议**（与桌面 `media-handler.js` 对齐）：
/// - 音量：getVolume / setVolume / mute / unmute / toggleMute
/// - 设备：getDevices (输入+输出列表)
/// - 播放：getPlaybackStatus / mediaControl (play/pause/next/previous/stop)
/// - 提示音：playSound / stopSound
public actor MediaCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - 音量

    public func getVolume(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> VolumeResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.getVolume",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, VolumeResponse.decode)
    }

    public func setVolume(
        pcPeerId: String,
        volume: Int,
        mobileDid: String? = nil
    ) async throws -> SetVolumeResponse {
        guard volume >= 0 && volume <= 100 else {
            throw RemoteSkillError.invalidArgument("media.setVolume: volume must be 0-100")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.setVolume",
            params: ["volume": volume],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SetVolumeResponse.decode)
    }

    public func mute(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> MuteResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.mute",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, MuteResponse.decode)
    }

    public func unmute(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> MuteResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.unmute",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, MuteResponse.decode)
    }

    public func toggleMute(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> MuteResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.toggleMute",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, MuteResponse.decode)
    }

    // MARK: - 设备

    public func getDevices(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> MediaDevicesResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.getDevices",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, MediaDevicesResponse.decode)
    }

    // MARK: - 播放

    public func getPlaybackStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PlaybackStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.getPlaybackStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PlaybackStatusResponse.decode)
    }

    /// 统一播放控制（play/pause/next/previous/stop/playPause）。
    public func mediaControl(
        pcPeerId: String,
        action: MediaControlAction,
        mobileDid: String? = nil
    ) async throws -> MediaControlResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.mediaControl",
            params: ["action": action.rawValue],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, MediaControlResponse.decode)
    }

    // MARK: - 提示音

    /// 播放本地提示音（system beep / 自定义 soundId）。
    public func playSound(
        pcPeerId: String,
        soundId: String? = nil,
        volume: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> SoundActionResponse {
        var params: [String: Any] = [:]
        if let s = soundId { params["soundId"] = s }
        if let v = volume {
            guard v >= 0 && v <= 100 else {
                throw RemoteSkillError.invalidArgument("media.playSound: volume must be 0-100")
            }
            params["volume"] = v
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.playSound",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SoundActionResponse.decode)
    }

    public func stopSound(
        pcPeerId: String,
        soundId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> SoundActionResponse {
        var params: [String: Any] = [:]
        if let s = soundId { params["soundId"] = s }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "media.stopSound",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SoundActionResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
