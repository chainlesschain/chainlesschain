import Foundation
import AVFoundation
import Speech

/// 音频引擎
///
/// 负责音频处理、语音识别、音频分析等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/audio-engine.js
public class AudioEngine: BaseAIEngine {

    public static let shared = AudioEngine()

    // 音频格式
    public enum AudioFormat: String {
        case mp3 = "mp3"
        case wav = "wav"
        case m4a = "m4a"
        case aac = "aac"
        case flac = "flac"
    }

    // 音频质量
    public enum AudioQuality: String {
        case low = "low"
        case medium = "medium"
        case high = "high"
        case lossless = "lossless"
    }

    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))

    private init() {
        super.init(
            type: .audio,
            name: "音频引擎",
            description: "处理音频处理、语音识别、音频分析等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "speech_to_text",
                name: "语音转文字",
                description: "将语音内容转换为文字（支持多语言）"
            ),
            AIEngineCapability(
                id: "text_to_speech",
                name: "文字转语音",
                description: "将文字转换为语音"
            ),
            AIEngineCapability(
                id: "audio_trim",
                name: "音频裁剪",
                description: "裁剪音频片段"
            ),
            AIEngineCapability(
                id: "audio_merge",
                name: "音频合并",
                description: "合并多个音频文件"
            ),
            AIEngineCapability(
                id: "audio_convert",
                name: "格式转换",
                description: "在不同音频格式间转换"
            ),
            AIEngineCapability(
                id: "audio_compress",
                name: "音频压缩",
                description: "压缩音频文件"
            ),
            AIEngineCapability(
                id: "volume_adjust",
                name: "音量调节",
                description: "调整音频音量"
            ),
            AIEngineCapability(
                id: "audio_analysis",
                name: "音频分析",
                description: "分析音频时长、采样率等信息"
            ),
            AIEngineCapability(
                id: "noise_reduction",
                name: "降噪处理",
                description: "去除音频中的背景噪音"
            ),
            AIEngineCapability(
                id: "transcribe_summarize",
                name: "转录摘要",
                description: "将语音转录并生成摘要"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 请求语音识别权限
        await requestSpeechRecognitionPermission()

        Logger.shared.info("音频引擎初始化完成")
    }

    /// 请求语音识别权限
    private func requestSpeechRecognitionPermission() async {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { authStatus in
                switch authStatus {
                case .authorized:
                    Logger.shared.info("语音识别权限已授权")
                case .denied:
                    Logger.shared.warning("语音识别权限被拒绝")
                case .restricted:
                    Logger.shared.warning("语音识别权限受限")
                case .notDetermined:
                    Logger.shared.warning("语音识别权限未确定")
                @unknown default:
                    break
                }
                continuation.resume()
            }
        }
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("音频引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "speech_to_text":
            return try await speechToText(parameters: parameters)

        case "text_to_speech":
            return try await textToSpeech(parameters: parameters)

        case "trim":
            return try await trimAudio(parameters: parameters)

        case "merge":
            return try await mergeAudio(parameters: parameters)

        case "convert":
            return try await convertFormat(parameters: parameters)

        case "compress":
            return try await compressAudio(parameters: parameters)

        case "adjust_volume":
            return try await adjustVolume(parameters: parameters)

        case "analyze":
            return try await analyzeAudio(parameters: parameters)

        case "transcribe_summarize":
            return try await transcribeAndSummarize(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 语音识别

    /// 语音转文字
    private func speechToText(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少audioPath参数")
        }

        let language = parameters["language"] as? String ?? "zh-CN"
        let audioURL = URL(fileURLWithPath: audioPath)

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) else {
            throw AIEngineError.executionFailed("不支持的语言: \(language)")
        }

        guard recognizer.isAvailable else {
            throw AIEngineError.executionFailed("语音识别服务不可用")
        }

        let request = SFSpeechURLRecognitionRequest(url: audioURL)
        request.shouldReportPartialResults = false

        return try await withCheckedThrowingContinuation { continuation in
            recognizer.recognitionTask(with: request) { result, error in
                if let error = error {
                    continuation.resume(throwing: AIEngineError.executionFailed("语音识别失败: \(error.localizedDescription)"))
                    return
                }

                guard let result = result, result.isFinal else {
                    return
                }

                let transcription = result.bestTranscription
                let segments = transcription.segments.map { segment -> [String: Any] in
                    return [
                        "text": segment.substring,
                        "confidence": segment.confidence,
                        "duration": segment.duration,
                        "timestamp": segment.timestamp
                    ]
                }

                let response: [String: Any] = [
                    "text": transcription.formattedString,
                    "segments": segments,
                    "language": language,
                    "duration": result.speechRecognitionMetadata?.speechDuration ?? 0.0
                ]

                continuation.resume(returning: response)
            }
        }
    }

    /// 文字转语音
    private func textToSpeech(parameters: [String: Any]) async throws -> [String: Any] {
        guard let text = parameters["text"] as? String else {
            throw AIEngineError.invalidParameters("缺少text参数")
        }

        let language = parameters["language"] as? String ?? "zh-CN"
        let rate = parameters["rate"] as? Float ?? 0.5 // 0.0 - 1.0
        let pitch = parameters["pitch"] as? Float ?? 1.0 // 0.5 - 2.0
        let outputPath = parameters["outputPath"] as? String

        let synthesizer = AVSpeechSynthesizer()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language)
        utterance.rate = rate
        utterance.pitchMultiplier = pitch

        // 如果需要保存为文件，需要额外处理
        // 这里简化实现，直接播放
        return try await withCheckedThrowingContinuation { continuation in
            synthesizer.speak(utterance)

            // 等待播放完成
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(text.count) * 0.1) {
                continuation.resume(returning: [
                    "text": text,
                    "language": language,
                    "duration": Double(text.count) * 0.1,
                    "success": true
                ])
            }
        }
    }

    // MARK: - 音频编辑

    /// 裁剪音频
    private func trimAudio(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String,
              let startTime = parameters["startTime"] as? Double,
              let endTime = parameters["endTime"] as? Double else {
            throw AIEngineError.invalidParameters("缺少必要参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? audioPath.replacingOccurrences(of: ".", with: "_trimmed.")

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        let startCMTime = CMTime(seconds: startTime, preferredTimescale: 1000)
        let endCMTime = CMTime(seconds: endTime, preferredTimescale: 1000)
        let timeRange = CMTimeRange(start: startCMTime, end: endCMTime)

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a
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
                    continuation.resume(throwing: AIEngineError.executionFailed("音频裁剪失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频裁剪被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 合并音频
    private func mergeAudio(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPaths = parameters["audioPaths"] as? [String] else {
            throw AIEngineError.invalidParameters("缺少audioPaths参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? "merged_audio.m4a"
        let outputURL = URL(fileURLWithPath: outputPath)

        let composition = AVMutableComposition()

        guard let audioTrack = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw AIEngineError.executionFailed("无法创建音频轨道")
        }

        var insertTime = CMTime.zero

        for audioPath in audioPaths {
            let audioURL = URL(fileURLWithPath: audioPath)
            let asset = AVAsset(url: audioURL)

            guard let assetTrack = asset.tracks(withMediaType: .audio).first else {
                continue
            }

            do {
                let duration = asset.duration
                try audioTrack.insertTimeRange(
                    CMTimeRange(start: .zero, duration: duration),
                    of: assetTrack,
                    at: insertTime
                )
                insertTime = CMTimeAdd(insertTime, duration)
            } catch {
                throw AIEngineError.executionFailed("音频插入失败: \(error.localizedDescription)")
            }
        }

        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
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
                        "inputCount": audioPaths.count,
                        "totalDuration": CMTimeGetSeconds(composition.duration),
                        "success": true
                    ])
                case .failed:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频合并失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频合并被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 转换音频格式
    private func convertFormat(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String,
              let formatString = parameters["format"] as? String else {
            throw AIEngineError.invalidParameters("缺少audioPath或format参数")
        }

        guard let format = AudioFormat(rawValue: formatString.lowercased()) else {
            throw AIEngineError.invalidParameters("不支持的格式: \(formatString)")
        }

        let outputPath = parameters["outputPath"] as? String ?? audioPath.replacingOccurrences(of: "\\.[^.]+$", with: ".\(format.rawValue)", options: .regularExpression)

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
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

    /// 压缩音频
    private func compressAudio(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少audioPath参数")
        }

        let quality = parameters["quality"] as? String ?? "medium"
        let outputPath = parameters["outputPath"] as? String ?? audioPath.replacingOccurrences(of: ".", with: "_compressed.")

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)

        let asset = AVAsset(url: inputURL)

        let preset: String
        switch quality {
        case "low":
            preset = AVAssetExportPresetLowQuality
        case "high":
            preset = AVAssetExportPresetHighestQuality
        default:
            preset = AVAssetExportPresetMediumQuality
        }

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: preset) else {
            throw AIEngineError.executionFailed("无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a

        return try await withCheckedThrowingContinuation { continuation in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    let originalSize = (try? FileManager.default.attributesOfItem(atPath: audioPath)[.size] as? Int) ?? 0
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
                    continuation.resume(throwing: AIEngineError.executionFailed("音频压缩失败: \(exportSession.error?.localizedDescription ?? "未知错误")"))
                case .cancelled:
                    continuation.resume(throwing: AIEngineError.executionFailed("音频压缩被取消"))
                default:
                    continuation.resume(throwing: AIEngineError.executionFailed("未知状态"))
                }
            }
        }
    }

    /// 调整音量
    private func adjustVolume(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String,
              let volumeLevel = parameters["volume"] as? Float else {
            throw AIEngineError.invalidParameters("缺少audioPath或volume参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? audioPath.replacingOccurrences(of: ".", with: "_volume_adjusted.")

        // 音量调整需要使用AVAudioEngine或更底层的音频处理
        // 这里返回模拟结果
        return [
            "outputPath": outputPath,
            "originalVolume": 1.0,
            "newVolume": volumeLevel,
            "success": true,
            "message": "音量调整功能待完整实现"
        ]
    }

    // MARK: - 音频分析

    /// 分析音频
    private func analyzeAudio(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少audioPath参数")
        }

        let audioURL = URL(fileURLWithPath: audioPath)
        let asset = AVAsset(url: audioURL)

        let duration = CMTimeGetSeconds(asset.duration)

        guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
            throw AIEngineError.executionFailed("无法获取音频轨道")
        }

        let sampleRate = audioTrack.naturalTimeScale
        let channelCount = audioTrack.formatDescriptions.first.map { desc in
            let audioStreamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(desc as! CMAudioFormatDescription)
            return Int(audioStreamBasicDescription?.pointee.mChannelsPerFrame ?? 0)
        } ?? 0

        let fileSize = (try? FileManager.default.attributesOfItem(atPath: audioPath)[.size] as? Int) ?? 0
        let bitrate = Double(fileSize * 8) / duration

        return [
            "duration": duration,
            "sampleRate": sampleRate,
            "channelCount": channelCount,
            "fileSize": fileSize,
            "bitrate": bitrate,
            "format": audioURL.pathExtension
        ]
    }

    // MARK: - AI增强

    /// 转录并生成摘要
    private func transcribeAndSummarize(parameters: [String: Any]) async throws -> [String: Any] {
        guard let audioPath = parameters["audioPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少audioPath参数")
        }

        // 执行语音转文字
        let transcriptionResult = try await speechToText(parameters: ["audioPath": audioPath])
        guard let text = transcriptionResult["text"] as? String else {
            throw AIEngineError.executionFailed("转录失败")
        }

        // 使用LLM生成摘要
        let maxLength = parameters["maxLength"] as? Int ?? 200

        let prompt = """
        请为以下音频转录内容生成简洁的摘要（不超过\(maxLength)字）：

        \(text)

        要求：
        1. 提炼核心内容
        2. 保留关键信息
        3. 语言简洁明了
        """

        let summary = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个音频内容摘要专家。"
        )

        return [
            "transcription": text,
            "summary": summary,
            "audioPath": audioPath,
            "originalLength": text.count,
            "summaryLength": summary.count
        ]
    }
}

// MARK: - AudioFormat Extension

extension AudioEngine.AudioFormat {
    var avFileType: AVFileType {
        switch self {
        case .mp3: return .mp3
        case .wav: return .wav
        case .m4a: return .m4a
        case .aac: return .m4a // AAC is typically in M4A container
        case .flac: return .wav // FLAC not directly supported, use WAV
        }
    }
}
