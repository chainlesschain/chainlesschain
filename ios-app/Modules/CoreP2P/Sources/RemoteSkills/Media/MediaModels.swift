import Foundation

/// 音频设备信息 — `media.getDevices` 返单项。
public struct MediaDevice: Sendable, Equatable {
    public let id: String
    public let name: String
    public let type: String?              // input / output
    public let isDefault: Bool
    public let isActive: Bool?

    public init(id: String, name: String, type: String? = nil,
                isDefault: Bool = false, isActive: Bool? = nil) {
        self.id = id; self.name = name; self.type = type
        self.isDefault = isDefault; self.isActive = isActive
    }

    internal static func from(_ d: [String: Any]) -> MediaDevice {
        return MediaDevice(
            id: (d["id"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            type: d["type"] as? String,
            isDefault: (d["isDefault"] as? Bool) ?? false,
            isActive: d["isActive"] as? Bool
        )
    }
}

/// `media.getDevices` 响应。
public struct MediaDevicesResponse: Sendable, Equatable {
    public let success: Bool
    public let devices: [MediaDevice]

    public init(success: Bool, devices: [MediaDevice]) {
        self.success = success; self.devices = devices
    }

    public static func decode(_ json: String) throws -> MediaDevicesResponse {
        let d = try parseDict(json)
        let arr = (d["devices"] as? [[String: Any]]) ?? []
        return MediaDevicesResponse(
            success: (d["success"] as? Bool) ?? false,
            devices: arr.map { MediaDevice.from($0) }
        )
    }
}

/// `media.getVolume` 响应。
public struct VolumeResponse: Sendable, Equatable {
    public let success: Bool
    public let volume: Int            // 0-100
    public let muted: Bool
    public let platform: String?

    public init(success: Bool, volume: Int, muted: Bool, platform: String? = nil) {
        self.success = success; self.volume = volume
        self.muted = muted; self.platform = platform
    }

    public static func decode(_ json: String) throws -> VolumeResponse {
        let d = try parseDict(json)
        return VolumeResponse(
            success: (d["success"] as? Bool) ?? true,  // 部分桌面返简化形式无 success
            volume: (d["volume"] as? Int) ?? 0,
            muted: (d["muted"] as? Bool) ?? false,
            platform: d["platform"] as? String
        )
    }
}

/// `media.setVolume` 响应。
public struct SetVolumeResponse: Sendable, Equatable {
    public let success: Bool
    public let volume: Int
    public let message: String

    public init(success: Bool, volume: Int, message: String) {
        self.success = success; self.volume = volume; self.message = message
    }

    public static func decode(_ json: String) throws -> SetVolumeResponse {
        let d = try parseDict(json)
        return SetVolumeResponse(
            success: (d["success"] as? Bool) ?? false,
            volume: (d["volume"] as? Int) ?? 0,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `media.mute` / `unmute` / `toggleMute` 响应。
public struct MuteResponse: Sendable, Equatable {
    public let success: Bool
    public let muted: Bool
    public let message: String

    public init(success: Bool, muted: Bool, message: String) {
        self.success = success; self.muted = muted; self.message = message
    }

    public static func decode(_ json: String) throws -> MuteResponse {
        let d = try parseDict(json)
        return MuteResponse(
            success: (d["success"] as? Bool) ?? false,
            muted: (d["muted"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `media.getPlaybackStatus` 响应。
public struct PlaybackStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let playing: Bool
    public let track: String?
    public let artist: String?
    public let album: String?
    public let position: Double?       // seconds
    public let duration: Double?
    public let source: String?         // spotify / apple-music / browser 等

    public init(success: Bool, playing: Bool, track: String? = nil,
                artist: String? = nil, album: String? = nil,
                position: Double? = nil, duration: Double? = nil, source: String? = nil) {
        self.success = success; self.playing = playing
        self.track = track; self.artist = artist; self.album = album
        self.position = position; self.duration = duration; self.source = source
    }

    public static func decode(_ json: String) throws -> PlaybackStatusResponse {
        let d = try parseDict(json)
        return PlaybackStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            playing: (d["playing"] as? Bool) ?? false,
            track: d["track"] as? String,
            artist: d["artist"] as? String,
            album: d["album"] as? String,
            position: d["position"] as? Double,
            duration: d["duration"] as? Double,
            source: d["source"] as? String
        )
    }
}

/// `media.mediaControl` 响应（统一播放控制命令）。
public struct MediaControlResponse: Sendable, Equatable {
    public let success: Bool
    public let action: String          // play / pause / next / previous / stop
    public let message: String

    public init(success: Bool, action: String, message: String) {
        self.success = success; self.action = action; self.message = message
    }

    public static func decode(_ json: String) throws -> MediaControlResponse {
        let d = try parseDict(json)
        return MediaControlResponse(
            success: (d["success"] as? Bool) ?? false,
            action: (d["action"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `media.playSound` / `stopSound` 响应。
public struct SoundActionResponse: Sendable, Equatable {
    public let success: Bool
    public let soundId: String?
    public let message: String

    public init(success: Bool, soundId: String? = nil, message: String) {
        self.success = success; self.soundId = soundId; self.message = message
    }

    public static func decode(_ json: String) throws -> SoundActionResponse {
        let d = try parseDict(json)
        return SoundActionResponse(
            success: (d["success"] as? Bool) ?? false,
            soundId: d["soundId"] as? String,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 媒体播放控制动作 — `media.mediaControl` 的 action 参数。
public enum MediaControlAction: String, Sendable, Equatable {
    case play
    case pause
    case playPause
    case next
    case previous
    case stop
}
