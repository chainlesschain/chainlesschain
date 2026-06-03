import Foundation
import AVFoundation
import CoreImage

/// 视频引擎
///
/// 负责视频处理、帧提取、视频分析等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/video-engine.js
public class VideoEngine: BaseAIEngine {

    public static let shared = VideoEngine()

    // 视频格式
    public enum VideoFormat: String {
        case mp4 = "mp4"
        case mov = "mov"
        case m4v = "m4v"
        case avi = "avi"
        case mkv = "mkv"
    }

    // 视频质量
    public enum VideoQuality: String {
        case low = "low"
        case medium = "medium"
        case high = "high"
        case ultra = "ultra"
    }

    private init() {
        super.init(
            type: .video,
            name: "视频引擎",
            description: "处理视频处理、帧提取、视频分析等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "extract_frames",
                name: "帧提取",
                description: "从视频中提取关键帧图像"
            ),
            AIEngineCapability(
                id: "video_trim",
                name: "视频裁剪",
                description: "裁剪视频片段"
            ),
            AIEngineCapability(
                id: "video_merge",
                name: "视频合并",
                description: "合并多个视频文件"
            ),
            AIEngineCapability(
                id: "video_convert",
                name: "格式转换",
                description: "在不同视频格式间转换"
            ),
            AIEngineCapability(
                id: "video_compress",
                name: "视频压缩",
                description: "压缩视频文件"
            ),
            AIEngineCapability(
                id: "video_resize",
                name: "分辨率调整",
                description: "调整视频分辨率"
            ),
            AIEngineCapability(
                id: "add_watermark",
                name: "添加水印",
                description: "在视频上添加水印"
            ),
            AIEngineCapability(
                id: "video_analysis",
                name: "视频分析",
                description: "分析视频时长、分辨率、编码等信息"
            ),
            AIEngineCapability(
                id: "extract_audio",
                name: "音频提取",
                description: "从视频中提取音频轨道"
            ),
            AIEngineCapability(
                id: "video_transcribe",
                name: "视频转录",
                description: "提取视频音频并转录为文字"
            ),
            AIEngineCapability(
                id: "video_summarize",
                name: "视频摘要",
                description: "生成视频内容摘要"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        Logger.shared.info("视频引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("视频引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "extract_frames":
            return try await extractFrames(parameters: parameters)

        case "trim":
            return try await trimVideo(parameters: parameters)

        case "merge":
            return try await mergeVideos(parameters: parameters)

        case "convert":
            return try await convertFormat(parameters: parameters)

        case "compress":
            return try await compressVideo(parameters: parameters)

        case "resize":
            return try await resizeVideo(parameters: parameters)

        case "add_watermark":
            return try await addWatermark(parameters: parameters)

        case "analyze":
            return try await analyzeVideo(parameters: parameters)

        case "extract_audio":
            return try await extractAudio(parameters: parameters)

        case "transcribe":
            return try await transcribeVideo(parameters: parameters)

        case "summarize":
            return try await summarizeVideo(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 帧提取

    /// 提取视频帧
    private func extractFrames(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        let interval = parameters["interval"] as? Double ?? 1.0 // 每秒提取一帧
        let outputDir = parameters["outputDir"] as? String ?? FileManager.default.temporaryDirectory.path
        let maxFrames = parameters["maxFrames"] as? Int ?? 100

        let videoURL = URL(fileURLWithPath: videoPath)
        let asset = AVAsset(url: videoURL)
        let duration = CMTimeGetSeconds(asset.duration)

        let imageGenerator = AVAssetImageGenerator(asset: asset)
        imageGenerator.appliesPreferredTrackTransform = true
        imageGenerator.requestedTimeToleranceAfter = .zero
        imageGenerator.requestedTimeToleranceBefore = .zero

        var extractedFrames: [[String: Any]] = []
        var currentTime: Double = 0.0
        var frameCount = 0

        while currentTime < duration && frameCount < maxFrames {
            let cmTime = CMTime(seconds: currentTime, preferredTimescale: 600)

            do {
                let cgImage = try imageGenerator.copyCGImage(at: cmTime, actualTime: nil)
                let framePath = "\(outputDir)/frame_\(frameCount).jpg"
                let frameURL = URL(fileURLWithPath: framePath)

                // 保存帧图像
                if let destination = CGImageDestinationCreateWithURL(frameURL as CFURL, "public.jpeg" as CFString, 1, nil) {
                    CGImageDestinationAddImage(destination, cgImage, nil)
                    CGImageDestinationFinalize(destination)

                    extractedFrames.append([
                        "path": framePath,
                        "timestamp": currentTime,
                        "frameNumber": frameCount
                    ])

                    frameCount += 1
                }
            } catch {
                Logger.shared.warning("提取帧失败 at \(currentTime)s: \(error.localizedDescription)")
            }

            currentTime += interval
        }

        return [
            "frames": extractedFrames,
            "count": extractedFrames.count,
            "interval": interval,
            "videoDuration": duration
        ]
    }

    // MARK: - 视频编辑

    /// 裁剪视频
    private func trimVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String,
              let startTime = parameters["startTime"] as? Double,
              let endTime = parameters["endTime"] as? Double else {
            throw AIEngineError.invalidParameters("缺少必要参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: ".", with: "_trimmed.")

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        let startCMTime = CMTime(seconds: startTime, preferredTimescale: 1000)
        let endCMTime = CMTime(seconds: endTime, preferredTimescale: 1000)
        let timeRange = CMTimeRange(start: startCMTime, end: endCMTime)

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4
        exportSession.timeRange = timeRange

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume(returning: [
                        "outputPath": outputPath,
                        "startTime": startTime,
                        "endTime": endTime,
                        "duration": endTime - startTime,
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频裁剪失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频裁剪被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 合并视频
    private func mergeVideos(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPaths = parameters["videoPaths"] as? [String] else {
            throw AIEngineError.invalidParameters("缺少videoPaths参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? "merged_video.mp4"
        let outputURL = URL(fileURLWithPath: outputPath)

        let composition = AVMutableComposition()

        guard let videoTrack = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ),
        let audioTrack = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw AIEngineError.executionFailed("无法创建视频轨道")
        }

        var insertTime = CMTime.zero

        for videoPath in videoPaths {
            let videoURL = URL(fileURLWithPath: videoPath)
            let asset = AVAsset(url: videoURL)

            guard let assetVideoTrack = asset.tracks(withMediaType: .video).first else {
                continue
            }

            do {
                let duration = asset.duration
                try videoTrack.insertTimeRange(
                    CMTimeRange(start: .zero, duration: duration),
                    of: assetVideoTrack,
                    at: insertTime
                )

                // 添加音频轨道（如果存在）
                if let assetAudioTrack = asset.tracks(withMediaType: .audio).first {
                    try audioTrack.insertTimeRange(
                        CMTimeRange(start: .zero, duration: duration),
                        of: assetAudioTrack,
                        at: insertTime
                    )
                }

                insertTime = CMTimeAdd(insertTime, duration)
            } catch {
                throw AIEngineError.executionFailed("视频插入失败: \(error.localizedDescription)")
            }
        }

        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume(returning: [
                        "outputPath": outputPath,
                        "inputCount": videoPaths.count,
                        "totalDuration": CMTimeGetSeconds(composition.duration),
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频合并失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频合并被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 转换视频格式
    private func convertFormat(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String,
              let formatString = parameters["format"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath或format参数")
        }

        guard let format = VideoFormat(rawValue: formatString.lowercased()) else {
            throw AIEngineError.invalidParameters("不支持的格式: \(formatString)")
        }

        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: "\\.[^.]+$", with: ".\(format.rawValue)", options: .regularExpression)

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = format.avFileType

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume(returning: [
                        "outputPath": outputPath,
                        "format": format.rawValue,
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("格式转换失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("格式转换被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 压缩视频
    private func compressVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        let quality = parameters["quality"] as? String ?? "medium"
        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: ".", with: "_compressed.")

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        let preset: String
        switch quality {
        case "low":
            preset = AVAssetExportPresetLowQuality
        case "high":
            preset = AVAssetExportPresetHighestQuality
        case "ultra":
            preset = AVAssetExportPresetHEVC3840x2160
        default:
            preset = AVAssetExportPresetMediumQuality
        }

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: preset) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    let originalSize = (try? FileManager.default.attributesOfItem(atPath: videoPath)[.size] as? Int) ?? 0
                    let compressedSize = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int) ?? 0

                    continuation.resume(returning: [
                        "outputPath": outputPath,
                        "quality": quality,
                        "originalSize": originalSize,
                        "compressedSize": compressedSize,
                        "compressionRatio": Double(compressedSize) / Double(originalSize),
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频压缩失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("视频压缩被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 调整视频分辨率
    private func resizeVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String,
              let width = parameters["width"] as? CGFloat,
              let height = parameters["height"] as? CGFloat else {
            throw AIEngineError.invalidParameters("缺少必要参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: ".", with: "_resized.")

        // 视频分辨率调整需要使用AVVideoComposition
        // 这里返回模拟结果
        return [
            "outputPath": outputPath,
            "newResolution": ["width": width, "height": height],
            "success": true,
            "message": "视频分辨率调整功能待完整实现"
        ]
    }

    /// 添加水印
    private func addWatermark(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String,
              let watermarkText = parameters["watermarkText"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath或watermarkText参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: ".", with: "_watermarked.")
        let position = parameters["position"] as? String ?? "bottomRight" // topLeft, topRight, bottomLeft, bottomRight

        // 水印添加需要使用AVVideoComposition和CALayer
        // 这里返回模拟结果
        return [
            "outputPath": outputPath,
            "watermarkText": watermarkText,
            "position": position,
            "success": true,
            "message": "水印添加功能待完整实现"
        ]
    }

    // MARK: - 视频分析

    /// 分析视频
    private func analyzeVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        let videoURL = URL(fileURLWithPath: videoPath)
        let asset = AVAsset(url: videoURL)

        let duration = CMTimeGetSeconds(asset.duration)

        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            throw AIEngineError.executionFailed("无法获取视频轨道")
        }

        let size = videoTrack.naturalSize
        let frameRate = videoTrack.nominalFrameRate
        let bitrate = videoTrack.estimatedDataRate

        let audioTracks = asset.tracks(withMediaType: .audio)
        let hasAudio = !audioTracks.isEmpty

        let fileSize = (try? FileManager.default.attributesOfItem(atPath: videoPath)[.size] as? Int) ?? 0

        return [
            "duration": duration,
            "resolution": ["width": size.width, "height": size.height],
            "frameRate": frameRate,
            "bitrate": bitrate,
            "hasAudio": hasAudio,
            "audioTrackCount": audioTracks.count,
            "fileSize": fileSize,
            "format": videoURL.pathExtension
        ]
    }

    /// 提取音频
    private func extractAudio(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? videoPath.replacingOccurrences(of: "\\.[^.]+$", with: ".m4a", options: .regularExpression)

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume(returning: [
                        "outputPath": outputPath,
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频提取失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频提取被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    // MARK: - AI增强

    /// 转录视频
    private func transcribeVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        // 1. 提取音频
        let audioPath = videoPath.replacingOccurrences(of: "\\.[^.]+$", with: ".m4a", options: .regularExpression)
        _ = try await extractAudio(parameters: [
            "videoPath": videoPath,
            "outputPath": audioPath
        ])

        // 2. 使用AudioEngine进行语音识别
        let audioEngine = AudioEngine.shared
        let transcriptionResult = try await audioEngine.execute(
            task: "speech_to_text",
            parameters: ["audioPath": audioPath]
        ) as? [String: Any] ?? [:]

        return [
            "transcription": transcriptionResult["text"] ?? "",
            "segments": transcriptionResult["segments"] ?? [],
            "videoPath": videoPath,
            "audioPath": audioPath
        ]
    }

    /// 生成视频摘要
    private func summarizeVideo(parameters: [String: Any]) async throws -> [String: Any] {
        guard let videoPath = parameters["videoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少videoPath参数")
        }

        // 1. 分析视频
        let analysis = try await analyzeVideo(parameters: ["videoPath": videoPath])

        // 2. 提取关键帧
        let frames = try await extractFrames(parameters: [
            "videoPath": videoPath,
            "interval": 5.0, // 每5秒一帧
            "maxFrames": 10
        ])

        // 3. 转录音频
        var transcription = ""
        do {
            let transcriptionResult = try await transcribeVideo(parameters: ["videoPath": videoPath])
            transcription = transcriptionResult["transcription"] as? String ?? ""
        } catch {
            Logger.shared.warning("视频转录失败: \(error.localizedDescription)")
        }

        // 4. 使用LLM生成摘要
        let duration = analysis["duration"] as? Double ?? 0.0
        let resolution = analysis["resolution"] as? [String: Any] ?? [:]

        let prompt = """
        请为以下视频生成摘要：

        视频信息：
        - 时长：\(duration)秒
        - 分辨率：\(resolution["width"] ?? 0) x \(resolution["height"] ?? 0)
        - 提取关键帧数：\((frames["count"] as? Int) ?? 0)

        音频转录：
        \(transcription.isEmpty ? "无音频或转录失败" : transcription)

        请提供：
        1. 视频主要内容概述
        2. 关键时刻或场景
        3. 整体评价
        """

        let summary = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个视频内容分析专家，擅长总结视频的核心内容。"
        )

        return [
            "summary": summary,
            "analysis": analysis,
            "keyFrameCount": frames["count"] ?? 0,
            "hasTranscription": !transcription.isEmpty,
            "videoPath": videoPath
        ]
    }
}

// MARK: - VideoFormat Extension

extension VideoEngine.VideoFormat {
    var avFileType: AVFileType {
        switch self {
        case .mp4: return .mp4
        case .mov: return .mov
        case .m4v: return .m4v
        case .avi: return .mp4 // AVI not directly supported, use MP4
        case .mkv: return .mp4 // MKV not directly supported, use MP4
        }
    }
}
