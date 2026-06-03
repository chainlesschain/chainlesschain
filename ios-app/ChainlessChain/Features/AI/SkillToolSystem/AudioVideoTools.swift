import Foundation
import AVFoundation
import CoreMedia
import UIKit
import QuartzCore

/// 音频和视频处理工具集
public enum AudioVideoTools {

    // MARK: - 音频处理工具 (10个)

    /// 获取音频信息
    private static let audioInfoTool = Tool(
        id: "tool.audio.info",
        name: "音频信息",
        description: "获取音频文件的详细信息",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "音频信息（时长、格式、采样率等）",
        tags: ["audio", "info"]
    )

    private static let audioInfoExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath") else {
            return .failure(error: "缺少音频路径")
        }

        let url = URL(fileURLWithPath: audioPath)
        let asset = AVAsset(url: url)

        let duration = asset.duration.seconds
        let tracks = asset.tracks(withMediaType: .audio)

        guard let audioTrack = tracks.first else {
            return .failure(error: "无法读取音频轨道")
        }

        let fileSize = (try? FileManager.default.attributesOfItem(atPath: audioPath)[.size] as? Int) ?? 0

        var info: [String: Any] = [:]
        info["duration"] = duration
        info["format"] = url.pathExtension
        info["fileSize"] = fileSize
        info["fileSizeMB"] = Double(fileSize) / 1024 / 1024
        info["trackCount"] = tracks.count

        if let formatDescriptions = audioTrack.formatDescriptions as? [CMFormatDescription],
           let description = formatDescriptions.first {
            if let audioStreamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(description) {
                info["sampleRate"] = audioStreamBasicDescription.pointee.mSampleRate
                info["channels"] = audioStreamBasicDescription.pointee.mChannelsPerFrame
            }
        }

        return .success(data: info)
    }

    /// 音频格式转换
    private static let audioConvertTool = Tool(
        id: "tool.audio.convert",
        name: "音频格式转换",
        description: "转换音频文件格式",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "format", type: .string, description: "目标格式(m4a/aac/mp3)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "convert"]
    )

    private static let audioConvertExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let format = input.getString("format"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        let fileType: AVFileType
        switch format.lowercased() {
        case "m4a", "aac":
            fileType = .m4a
        case "mp3":
            fileType = .mp3
        default:
            return .failure(error: "不支持的格式: \(format)")
        }

        exportSession.outputFileType = fileType
        exportSession.outputURL = outputURL

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            switch exportSession.status {
            case .completed:
                result = .success(data: outputPath)
            case .failed:
                result = .failure(error: "转换失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            case .cancelled:
                result = .failure(error: "转换已取消")
            default:
                result = .failure(error: "未知状态")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 音频裁剪
    private static let audioTrimTool = Tool(
        id: "tool.audio.trim",
        name: "音频裁剪",
        description: "裁剪音频文件的指定时间段",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "startTime", type: .number, description: "开始时间(秒)", required: true),
            ToolParameter(name: "endTime", type: .number, description: "结束时间(秒)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "trim"]
    )

    private static let audioTrimExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let startTime = input.getDouble("startTime"),
              let endTime = input.getDouble("endTime"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let startCMTime = CMTime(seconds: startTime, preferredTimescale: 600)
        let endCMTime = CMTime(seconds: endTime, preferredTimescale: 600)
        let timeRange = CMTimeRange(start: startCMTime, end: endCMTime)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a
        exportSession.timeRange = timeRange

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "裁剪失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 音频合并
    private static let audioMergeTool = Tool(
        id: "tool.audio.merge",
        name: "音频合并",
        description: "合并多个音频文件",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPaths", type: .array, description: "音频文件路径数组", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "merge"]
    )

    private static let audioMergeExecutor: ToolExecutor = { input in
        guard let audioPaths = input.getArray("audioPaths") as? [String],
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            return .failure(error: "无法创建音轨")
        }

        var currentTime = CMTime.zero

        for audioPath in audioPaths {
            let url = URL(fileURLWithPath: audioPath)
            let asset = AVAsset(url: url)

            guard let assetTrack = asset.tracks(withMediaType: .audio).first else {
                continue
            }

            let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

            do {
                try compositionTrack.insertTimeRange(timeRange, of: assetTrack, at: currentTime)
                currentTime = CMTimeAdd(currentTime, asset.duration)
            } catch {
                return .failure(error: "合并失败: \(error.localizedDescription)")
            }
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "导出失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 音量调整
    private static let audioVolumeTool = Tool(
        id: "tool.audio.volume",
        name: "音量调整",
        description: "调整音频音量",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "volume", type: .number, description: "音量倍数(0.1-10.0)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "volume"]
    )

    private static let audioVolumeExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let volume = input.getDouble("volume"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
              let assetTrack = asset.tracks(withMediaType: .audio).first else {
            return .failure(error: "无法读取音轨")
        }

        let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

        do {
            try compositionTrack.insertTimeRange(timeRange, of: assetTrack, at: .zero)
        } catch {
            return .failure(error: "处理失败: \(error.localizedDescription)")
        }

        let audioMix = AVMutableAudioMix()
        let audioMixParam = AVMutableAudioMixInputParameters(track: compositionTrack)
        audioMixParam.setVolume(Float(volume), at: .zero)
        audioMix.inputParameters = [audioMixParam]

        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a
        exportSession.audioMix = audioMix

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "处理失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 提取音频
    private static let audioExtractTool = Tool(
        id: "tool.audio.extract",
        name: "提取音频",
        description: "从视频文件中提取音频",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "extract"]
    )

    private static let audioExtractExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "提取失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 音频反转
    private static let audioReverseTool = Tool(
        id: "tool.audio.reverse",
        name: "音频反转",
        description: "反转音频播放（倒放）",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "reverse"]
    )

    private static let audioReverseExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
            return .failure(error: "无法读取音频轨道")
        }

        // 创建 AVAssetReader
        guard let assetReader = try? AVAssetReader(asset: asset) else {
            return .failure(error: "无法创建读取器")
        }

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]

        let readerOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: outputSettings)
        assetReader.add(readerOutput)

        // 创建 AVAssetWriter
        guard let assetWriter = try? AVAssetWriter(url: outputURL, fileType: .m4a) else {
            return .failure(error: "无法创建写入器")
        }

        let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 128000
        ])

        assetWriter.add(writerInput)

        // 收集所有音频样本
        var audioSamples: [CMSampleBuffer] = []

        assetReader.startReading()
        while let sampleBuffer = readerOutput.copyNextSampleBuffer() {
            audioSamples.append(sampleBuffer)
        }

        guard assetReader.status == .completed else {
            return .failure(error: "读取音频失败")
        }

        // 反转样本
        audioSamples.reverse()

        // 写入反转后的样本
        assetWriter.startWriting()
        assetWriter.startSession(atSourceTime: .zero)

        let semaphore = DispatchSemaphore(value: 0)
        var writeResult: ToolResult!

        writerInput.requestMediaDataWhenReady(on: DispatchQueue(label: "audio.reverse")) {
            for sample in audioSamples {
                while !writerInput.isReadyForMoreMediaData {
                    Thread.sleep(forTimeInterval: 0.01)
                }
                writerInput.append(sample)
            }

            writerInput.markAsFinished()
            assetWriter.finishWriting {
                if assetWriter.status == .completed {
                    writeResult = .success(data: outputPath)
                } else {
                    writeResult = .failure(error: "写入失败: \(assetWriter.error?.localizedDescription ?? "未知错误")")
                }
                semaphore.signal()
            }
        }

        semaphore.wait()
        return writeResult
    }

    /// 音频淡入淡出
    private static let audioFadeTool = Tool(
        id: "tool.audio.fade",
        name: "音频淡入淡出",
        description: "为音频添加淡入淡出效果",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "fadeInDuration", type: .number, description: "淡入时长(秒)", required: false, defaultValue: "0"),
            ToolParameter(name: "fadeOutDuration", type: .number, description: "淡出时长(秒)", required: false, defaultValue: "0"),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "fade"]
    )

    private static let audioFadeExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let fadeInDuration = input.getDouble("fadeInDuration") ?? 0
        let fadeOutDuration = input.getDouble("fadeOutDuration") ?? 0

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
              let assetTrack = asset.tracks(withMediaType: .audio).first else {
            return .failure(error: "无法读取音轨")
        }

        let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

        do {
            try compositionTrack.insertTimeRange(timeRange, of: assetTrack, at: .zero)
        } catch {
            return .failure(error: "处理失败: \(error.localizedDescription)")
        }

        let audioMix = AVMutableAudioMix()
        let audioMixParam = AVMutableAudioMixInputParameters(track: compositionTrack)

        // 淡入
        if fadeInDuration > 0 {
            audioMixParam.setVolumeRamp(fromStartVolume: 0.0, toEndVolume: 1.0, timeRange: CMTimeRange(start: .zero, duration: CMTime(seconds: fadeInDuration, preferredTimescale: 600)))
        }

        // 淡出
        if fadeOutDuration > 0 {
            let fadeOutStart = CMTimeSubtract(asset.duration, CMTime(seconds: fadeOutDuration, preferredTimescale: 600))
            audioMixParam.setVolumeRamp(fromStartVolume: 1.0, toEndVolume: 0.0, timeRange: CMTimeRange(start: fadeOutStart, duration: CMTime(seconds: fadeOutDuration, preferredTimescale: 600)))
        }

        audioMix.inputParameters = [audioMixParam]

        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a
        exportSession.audioMix = audioMix

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "处理失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 音频比特率
    private static let audioBitrateTool = Tool(
        id: "tool.audio.bitrate",
        name: "音频比特率",
        description: "调整音频比特率",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPath", type: .string, description: "音频文件路径", required: true),
            ToolParameter(name: "bitrate", type: .number, description: "目标比特率(bps)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "bitrate"]
    )

    private static let audioBitrateExecutor: ToolExecutor = { input in
        guard let audioPath = input.getString("audioPath"),
              let bitrate = input.getDouble("bitrate"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: audioPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
            return .failure(error: "无法读取音频轨道")
        }

        // 创建 AVAssetReader
        guard let assetReader = try? AVAssetReader(asset: asset) else {
            return .failure(error: "无法创建读取器")
        }

        let readerOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM
        ])
        assetReader.add(readerOutput)

        // 创建 AVAssetWriter with 指定比特率
        guard let assetWriter = try? AVAssetWriter(url: outputURL, fileType: .m4a) else {
            return .failure(error: "无法创建写入器")
        }

        // 获取原始采样率和声道数
        var sampleRate: Double = 44100
        var channels: UInt32 = 2

        if let formatDescriptions = audioTrack.formatDescriptions as? [CMFormatDescription],
           let description = formatDescriptions.first {
            if let audioStreamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(description) {
                sampleRate = audioStreamBasicDescription.pointee.mSampleRate
                channels = audioStreamBasicDescription.pointee.mChannelsPerFrame
            }
        }

        let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: Int(bitrate)
        ])

        assetWriter.add(writerInput)

        // 开始读写
        assetWriter.startWriting()
        assetWriter.startSession(atSourceTime: .zero)
        assetReader.startReading()

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        writerInput.requestMediaDataWhenReady(on: DispatchQueue(label: "audio.bitrate")) {
            while assetReader.status == .reading {
                if let sampleBuffer = readerOutput.copyNextSampleBuffer() {
                    if !writerInput.append(sampleBuffer) {
                        break
                    }
                } else {
                    break
                }
            }

            writerInput.markAsFinished()
            assetWriter.finishWriting {
                if assetWriter.status == .completed {
                    result = .success(data: outputPath)
                } else {
                    result = .failure(error: "处理失败: \(assetWriter.error?.localizedDescription ?? "未知错误")")
                }
                semaphore.signal()
            }
        }

        semaphore.wait()
        return result
    }

    /// 音频混音
    private static let audioMixTool = Tool(
        id: "tool.audio.mix",
        name: "音频混音",
        description: "混合多个音频文件",
        category: .system,
        parameters: [
            ToolParameter(name: "audioPaths", type: .array, description: "音频文件路径数组", required: true),
            ToolParameter(name: "volumes", type: .array, description: "各音频的音量(0-1)", required: false),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["audio", "mix"]
    )

    private static let audioMixExecutor: ToolExecutor = { input in
        guard let audioPaths = input.getArray("audioPaths") as? [String],
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let volumes = input.getArray("volumes") as? [Double] ?? Array(repeating: 1.0, count: audioPaths.count)

        let composition = AVMutableComposition()
        var compositionTracks: [AVMutableCompositionTrack] = []

        // 为每个音频创建独立轨道
        for (index, audioPath) in audioPaths.enumerated() {
            let url = URL(fileURLWithPath: audioPath)
            let asset = AVAsset(url: url)

            guard let compositionTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
                  let assetTrack = asset.tracks(withMediaType: .audio).first else {
                continue
            }

            let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

            do {
                try compositionTrack.insertTimeRange(timeRange, of: assetTrack, at: .zero)
                compositionTracks.append(compositionTrack)
            } catch {
                return .failure(error: "混音失败: \(error.localizedDescription)")
            }
        }

        // 设置音量
        let audioMix = AVMutableAudioMix()
        var inputParameters: [AVMutableAudioMixInputParameters] = []

        for (index, track) in compositionTracks.enumerated() {
            let audioMixParam = AVMutableAudioMixInputParameters(track: track)
            let volume = volumes[safe: index] ?? 1.0
            audioMixParam.setVolume(Float(volume), at: .zero)
            inputParameters.append(audioMixParam)
        }

        audioMix.inputParameters = inputParameters

        let outputURL = URL(fileURLWithPath: outputPath)
        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a
        exportSession.audioMix = audioMix

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "导出失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    // MARK: - 视频处理工具 (8个)

    /// 获取视频信息
    private static let videoInfoTool = Tool(
        id: "tool.video.info",
        name: "视频信息",
        description: "获取视频文件的详细信息",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "视频信息（时长、分辨率、格式等）",
        tags: ["video", "info"]
    )

    private static let videoInfoExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath") else {
            return .failure(error: "缺少视频路径")
        }

        let url = URL(fileURLWithPath: videoPath)
        let asset = AVAsset(url: url)

        let duration = asset.duration.seconds
        let videoTracks = asset.tracks(withMediaType: .video)
        let audioTracks = asset.tracks(withMediaType: .audio)

        var info: [String: Any] = [:]
        info["duration"] = duration
        info["format"] = url.pathExtension
        info["videoTrackCount"] = videoTracks.count
        info["audioTrackCount"] = audioTracks.count

        if let videoTrack = videoTracks.first {
            let size = videoTrack.naturalSize
            let transform = videoTrack.preferredTransform
            let videoSize = size.applying(transform)

            info["width"] = Int(abs(videoSize.width))
            info["height"] = Int(abs(videoSize.height))
            info["frameRate"] = videoTrack.nominalFrameRate
        }

        let fileSize = (try? FileManager.default.attributesOfItem(atPath: videoPath)[.size] as? Int) ?? 0
        info["fileSize"] = fileSize
        info["fileSizeMB"] = Double(fileSize) / 1024 / 1024

        return .success(data: info)
    }

    /// 视频截图
    private static let videoScreenshotTool = Tool(
        id: "tool.video.screenshot",
        name: "视频截图",
        description: "在指定时间点截取视频画面",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "time", type: .number, description: "截图时间点(秒)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "screenshot"]
    )

    private static let videoScreenshotExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let time = input.getDouble("time"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let url = URL(fileURLWithPath: videoPath)
        let asset = AVAsset(url: url)
        let imageGenerator = AVAssetImageGenerator(asset: asset)
        imageGenerator.appliesPreferredTrackTransform = true

        let cmTime = CMTime(seconds: time, preferredTimescale: 600)

        do {
            let cgImage = try imageGenerator.copyCGImage(at: cmTime, actualTime: nil)
            let image = UIImage(cgImage: cgImage)

            guard let data = image.jpegData(compressionQuality: 0.9) else {
                return .failure(error: "无法生成图像数据")
            }

            let outputURL = URL(fileURLWithPath: outputPath)
            try data.write(to: outputURL)

            return .success(data: outputPath)
        } catch {
            return .failure(error: "截图失败: \(error.localizedDescription)")
        }
    }

    /// 视频裁剪
    private static let videoTrimTool = Tool(
        id: "tool.video.trim",
        name: "视频裁剪",
        description: "裁剪视频的指定时间段",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "startTime", type: .number, description: "开始时间(秒)", required: true),
            ToolParameter(name: "endTime", type: .number, description: "结束时间(秒)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "trim"]
    )

    private static let videoTrimExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let startTime = input.getDouble("startTime"),
              let endTime = input.getDouble("endTime"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let startCMTime = CMTime(seconds: startTime, preferredTimescale: 600)
        let endCMTime = CMTime(seconds: endTime, preferredTimescale: 600)
        let timeRange = CMTimeRange(start: startCMTime, end: endCMTime)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4
        exportSession.timeRange = timeRange

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "裁剪失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 视频合并
    private static let videoMergeTool = Tool(
        id: "tool.video.merge",
        name: "视频合并",
        description: "合并多个视频文件",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPaths", type: .array, description: "视频文件路径数组", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "merge"]
    )

    private static let videoMergeExecutor: ToolExecutor = { input in
        guard let videoPaths = input.getArray("videoPaths") as? [String],
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            return .failure(error: "无法创建轨道")
        }

        var currentTime = CMTime.zero

        for videoPath in videoPaths {
            let url = URL(fileURLWithPath: videoPath)
            let asset = AVAsset(url: url)

            if let assetVideoTrack = asset.tracks(withMediaType: .video).first {
                let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

                do {
                    try videoTrack.insertTimeRange(timeRange, of: assetVideoTrack, at: currentTime)
                } catch {
                    return .failure(error: "合并视频失败: \(error.localizedDescription)")
                }
            }

            if let assetAudioTrack = asset.tracks(withMediaType: .audio).first {
                let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

                do {
                    try audioTrack.insertTimeRange(timeRange, of: assetAudioTrack, at: currentTime)
                } catch {
                    // 音频合并失败不影响视频
                }
            }

            currentTime = CMTimeAdd(currentTime, asset.duration)
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "导出失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 视频压缩
    private static let videoCompressTool = Tool(
        id: "tool.video.compress",
        name: "视频压缩",
        description: "压缩视频文件以减小大小",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "quality", type: .string, description: "压缩质量(low/medium/high)", required: false, defaultValue: "medium"),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .object,
        returnDescription: "压缩结果（输出路径、原始大小、压缩后大小）",
        tags: ["video", "compress"]
    )

    private static let videoCompressExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let quality = input.getString("quality") ?? "medium"

        let preset: String
        switch quality.lowercased() {
        case "low":
            preset = AVAssetExportPresetLowQuality
        case "medium":
            preset = AVAssetExportPresetMediumQuality
        case "high":
            preset = AVAssetExportPresetHighestQuality
        default:
            preset = AVAssetExportPresetMediumQuality
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let originalSize = (try? FileManager.default.attributesOfItem(atPath: videoPath)[.size] as? Int) ?? 0

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: preset) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                let compressedSize = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int) ?? 0
                let compressionRatio = Double(compressedSize) / Double(originalSize)

                result = .success(data: [
                    "outputPath": outputPath,
                    "originalSize": originalSize,
                    "compressedSize": compressedSize,
                    "compressionRatio": compressionRatio,
                    "savedBytes": originalSize - compressedSize
                ])
            } else {
                result = .failure(error: "压缩失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 视频格式转换
    private static let videoConvertTool = Tool(
        id: "tool.video.convert",
        name: "视频格式转换",
        description: "转换视频文件格式",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "format", type: .string, description: "目标格式(mp4/mov/m4v)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "convert"]
    )

    private static let videoConvertExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let format = input.getString("format"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        let fileType: AVFileType
        switch format.lowercased() {
        case "mp4":
            fileType = .mp4
        case "mov":
            fileType = .mov
        case "m4v":
            fileType = .m4v
        default:
            return .failure(error: "不支持的格式: \(format)")
        }

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = fileType

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "转换失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 视频旋转
    private static let videoRotateTool = Tool(
        id: "tool.video.rotate",
        name: "视频旋转",
        description: "旋转视频画面",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "degrees", type: .number, description: "旋转角度(90/180/270)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "rotate"]
    )

    private static let videoRotateExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let degrees = input.getDouble("degrees"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        // 验证旋转角度
        guard [90, 180, 270, -90, -180, -270].contains(Int(degrees)) else {
            return .failure(error: "旋转角度必须是90、180或270度")
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            return .failure(error: "无法读取视频轨道")
        }

        // 创建组合
        let composition = AVMutableComposition()
        guard let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            return .failure(error: "无法创建视频轨道")
        }

        let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

        do {
            try compositionVideoTrack.insertTimeRange(timeRange, of: videoTrack, at: .zero)
        } catch {
            return .failure(error: "插入视频轨道失败: \(error.localizedDescription)")
        }

        // 计算旋转变换
        let radians = degrees * .pi / 180
        var transform = videoTrack.preferredTransform

        let rotateTransform = CGAffineTransform(rotationAngle: CGFloat(radians))
        transform = transform.concatenating(rotateTransform)

        // 获取视频尺寸
        let videoSize = videoTrack.naturalSize
        let rotatedSize: CGSize

        // 根据旋转角度调整视频尺寸
        if Int(degrees) % 180 == 0 {
            rotatedSize = videoSize
        } else {
            rotatedSize = CGSize(width: videoSize.height, height: videoSize.width)
        }

        // 创建视频组合指令
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = timeRange

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
        layerInstruction.setTransform(transform, at: .zero)

        instruction.layerInstructions = [layerInstruction]

        // 创建视频组合
        let videoComposition = AVMutableVideoComposition()
        videoComposition.instructions = [instruction]
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.renderSize = rotatedSize

        // 添加音频轨道（如果存在）
        if let audioTrack = asset.tracks(withMediaType: .audio).first {
            if let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? compositionAudioTrack.insertTimeRange(timeRange, of: audioTrack, at: .zero)
            }
        }

        // 导出
        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4
        exportSession.videoComposition = videoComposition

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "旋转失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// 视频添加水印
    private static let videoWatermarkTool = Tool(
        id: "tool.video.watermark",
        name: "视频水印",
        description: "为视频添加文字或图片水印",
        category: .system,
        parameters: [
            ToolParameter(name: "videoPath", type: .string, description: "视频文件路径", required: true),
            ToolParameter(name: "text", type: .string, description: "水印文字", required: false),
            ToolParameter(name: "imagePath", type: .string, description: "水印图片路径", required: false),
            ToolParameter(name: "position", type: .string, description: "位置", required: false, defaultValue: "bottomRight"),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["video", "watermark"]
    )

    private static let videoWatermarkExecutor: ToolExecutor = { input in
        guard let videoPath = input.getString("videoPath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let text = input.getString("text")
        let imagePath = input.getString("imagePath")
        let position = input.getString("position") ?? "bottomRight"

        // 至少需要文字或图片其中一个
        guard text != nil || imagePath != nil else {
            return .failure(error: "必须提供文字水印或图片水印")
        }

        let inputURL = URL(fileURLWithPath: videoPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: inputURL)

        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            return .failure(error: "无法读取视频轨道")
        }

        // 创建组合
        let composition = AVMutableComposition()
        guard let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            return .failure(error: "无法创建视频轨道")
        }

        let timeRange = CMTimeRange(start: .zero, duration: asset.duration)

        do {
            try compositionVideoTrack.insertTimeRange(timeRange, of: videoTrack, at: .zero)
        } catch {
            return .failure(error: "插入视频轨道失败: \(error.localizedDescription)")
        }

        // 添加音频轨道（如果存在）
        if let audioTrack = asset.tracks(withMediaType: .audio).first {
            if let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? compositionAudioTrack.insertTimeRange(timeRange, of: audioTrack, at: .zero)
            }
        }

        // 获取视频尺寸
        let videoSize = videoTrack.naturalSize
        let transform = videoTrack.preferredTransform
        let videoRect = CGRect(origin: .zero, size: videoSize).applying(transform)
        let renderSize = CGSize(width: abs(videoRect.width), height: abs(videoRect.height))

        // 创建水印图层
        let watermarkLayer = CALayer()
        watermarkLayer.frame = CGRect(origin: .zero, size: renderSize)

        // 添加文字水印
        if let watermarkText = text {
            let textLayer = CATextLayer()
            textLayer.string = watermarkText
            textLayer.fontSize = min(renderSize.width, renderSize.height) * 0.05
            textLayer.foregroundColor = UIColor.white.cgColor
            textLayer.shadowColor = UIColor.black.cgColor
            textLayer.shadowOpacity = 0.8
            textLayer.shadowOffset = CGSize(width: 1, height: 1)
            textLayer.shadowRadius = 2
            textLayer.alignmentMode = .center

            let textSize = (watermarkText as NSString).size(withAttributes: [
                .font: UIFont.systemFont(ofSize: textLayer.fontSize)
            ])

            // 根据位置设置水印坐标
            let margin: CGFloat = 20
            let textFrame: CGRect

            switch position.lowercased() {
            case "topleft":
                textFrame = CGRect(x: margin, y: renderSize.height - textSize.height - margin, width: textSize.width, height: textSize.height)
            case "topright":
                textFrame = CGRect(x: renderSize.width - textSize.width - margin, y: renderSize.height - textSize.height - margin, width: textSize.width, height: textSize.height)
            case "bottomleft":
                textFrame = CGRect(x: margin, y: margin, width: textSize.width, height: textSize.height)
            case "bottomright":
                textFrame = CGRect(x: renderSize.width - textSize.width - margin, y: margin, width: textSize.width, height: textSize.height)
            case "center":
                textFrame = CGRect(x: (renderSize.width - textSize.width) / 2, y: (renderSize.height - textSize.height) / 2, width: textSize.width, height: textSize.height)
            default:
                textFrame = CGRect(x: renderSize.width - textSize.width - margin, y: margin, width: textSize.width, height: textSize.height)
            }

            textLayer.frame = textFrame
            watermarkLayer.addSublayer(textLayer)
        }

        // 添加图片水印
        if let watermarkImagePath = imagePath {
            let imageURL = URL(fileURLWithPath: watermarkImagePath)
            if let image = UIImage(contentsOfFile: imageURL.path) {
                let imageLayer = CALayer()
                imageLayer.contents = image.cgImage

                let imageWidth = min(renderSize.width * 0.2, image.size.width)
                let imageHeight = imageWidth * image.size.height / image.size.width

                let margin: CGFloat = 20
                let imageFrame: CGRect

                switch position.lowercased() {
                case "topleft":
                    imageFrame = CGRect(x: margin, y: renderSize.height - imageHeight - margin, width: imageWidth, height: imageHeight)
                case "topright":
                    imageFrame = CGRect(x: renderSize.width - imageWidth - margin, y: renderSize.height - imageHeight - margin, width: imageWidth, height: imageHeight)
                case "bottomleft":
                    imageFrame = CGRect(x: margin, y: margin, width: imageWidth, height: imageHeight)
                case "bottomright":
                    imageFrame = CGRect(x: renderSize.width - imageWidth - margin, y: margin, width: imageWidth, height: imageHeight)
                case "center":
                    imageFrame = CGRect(x: (renderSize.width - imageWidth) / 2, y: (renderSize.height - imageHeight) / 2, width: imageWidth, height: imageHeight)
                default:
                    imageFrame = CGRect(x: renderSize.width - imageWidth - margin, y: margin, width: imageWidth, height: imageHeight)
                }

                imageLayer.frame = imageFrame
                watermarkLayer.addSublayer(imageLayer)
            }
        }

        // 创建视频图层
        let videoLayer = CALayer()
        videoLayer.frame = CGRect(origin: .zero, size: renderSize)

        // 创建父图层
        let parentLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: renderSize)
        parentLayer.addSublayer(videoLayer)
        parentLayer.addSublayer(watermarkLayer)

        // 创建视频组合
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parentLayer)

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = timeRange

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
        layerInstruction.setTransform(transform, at: .zero)

        instruction.layerInstructions = [layerInstruction]
        videoComposition.instructions = [instruction]

        // 导出
        guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            return .failure(error: "无法创建导出会话")
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4
        exportSession.videoComposition = videoComposition

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        exportSession.exportAsynchronously {
            if exportSession.status == .completed {
                result = .success(data: outputPath)
            } else {
                result = .failure(error: "添加水印失败: \(exportSession.error?.localizedDescription ?? "未知错误")")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    // MARK: - 所有音视频工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 音频处理工具 (10)
            (audioInfoTool, audioInfoExecutor),
            (audioConvertTool, audioConvertExecutor),
            (audioTrimTool, audioTrimExecutor),
            (audioMergeTool, audioMergeExecutor),
            (audioVolumeTool, audioVolumeExecutor),
            (audioExtractTool, audioExtractExecutor),
            (audioReverseTool, audioReverseExecutor),
            (audioFadeTool, audioFadeExecutor),
            (audioBitrateTool, audioBitrateExecutor),
            (audioMixTool, audioMixExecutor),

            // 视频处理工具 (8)
            (videoInfoTool, videoInfoExecutor),
            (videoScreenshotTool, videoScreenshotExecutor),
            (videoTrimTool, videoTrimExecutor),
            (videoMergeTool, videoMergeExecutor),
            (videoCompressTool, videoCompressExecutor),
            (videoConvertTool, videoConvertExecutor),
            (videoRotateTool, videoRotateExecutor),
            (videoWatermarkTool, videoWatermarkExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

// 数组安全访问扩展
extension Array {
    subscript(safe index: Int) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}

/// 工具管理器扩展 - 注册音视频工具
extension ToolManager {
    /// 注册所有音视频工具
    public func registerAudioVideoTools() {
        for (tool, executor) in AudioVideoTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(AudioVideoTools.totalCount) 个音视频工具")
    }
}
