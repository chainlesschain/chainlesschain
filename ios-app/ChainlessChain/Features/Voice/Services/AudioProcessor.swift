import Foundation
import AVFoundation
import Accelerate

// MARK: - AudioProcessor
/// Audio processing utilities for voice system
/// Ported from PC: voice/audio-processor.js
///
/// Features:
/// - Audio format conversion
/// - Voice activity detection (VAD)
/// - Audio level metering
/// - Buffer management
/// - Audio effects
///
/// Version: v1.7.0
/// Date: 2026-02-10

class AudioProcessor {

    // MARK: - Properties

    private let logger = Logger.shared

    /// Processing queue
    private let processingQueue = DispatchQueue(label: "com.chainlesschain.audio.processing", qos: .userInitiated)

    /// VAD settings
    struct VADSettings {
        var energyThreshold: Float = 0.02
        var zeroCrossingThreshold: Float = 0.1
        var minSpeechDuration: TimeInterval = 0.1
        var minSilenceDuration: TimeInterval = 0.5
    }
    var vadSettings = VADSettings()

    /// Audio meter
    private var peakLevel: Float = 0
    private var averageLevel: Float = 0

    // MARK: - Initialization

    init() {}

    // MARK: - Buffer Conversion

    /// Convert AVAudioPCMBuffer to AudioBuffer
    func convertBuffer(_ avBuffer: AVAudioPCMBuffer) -> AudioBuffer {
        guard let channelData = avBuffer.floatChannelData else {
            return AudioBuffer(samples: [], sampleRate: avBuffer.format.sampleRate)
        }

        let frameLength = Int(avBuffer.frameLength)
        let channelCount = Int(avBuffer.format.channelCount)

        // Mix to mono if stereo
        var samples = [Float](repeating: 0, count: frameLength)

        if channelCount == 1 {
            samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))
        } else {
            for frame in 0..<frameLength {
                var sum: Float = 0
                for channel in 0..<channelCount {
                    sum += channelData[channel][frame]
                }
                samples[frame] = sum / Float(channelCount)
            }
        }

        return AudioBuffer(
            samples: samples,
            sampleRate: avBuffer.format.sampleRate,
            channels: 1
        )
    }

    /// Convert AudioBuffer to AVAudioPCMBuffer
    func convertToAVBuffer(_ buffer: AudioBuffer, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let avBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(buffer.samples.count)) else {
            return nil
        }

        avBuffer.frameLength = AVAudioFrameCount(buffer.samples.count)

        if let channelData = avBuffer.floatChannelData {
            for (index, sample) in buffer.samples.enumerated() {
                channelData[0][index] = sample
            }
        }

        return avBuffer
    }

    /// Convert Data to AudioBuffer
    func dataToBuffer(_ data: Data, format: AudioFormat, sampleRate: Double) -> AudioBuffer {
        switch format {
        case .pcm, .wav:
            return AudioBuffer.fromData(data, sampleRate: sampleRate)
        default:
            // For compressed formats, would need decoder
            logger.warning("[AudioProcessor] Compressed format decoding not implemented")
            return AudioBuffer(samples: [], sampleRate: sampleRate)
        }
    }

    /// Convert AudioBuffer to Data
    func bufferToData(_ buffer: AudioBuffer, format: AudioFormat) -> Data {
        switch format {
        case .pcm, .wav:
            return buffer.toData()
        default:
            // For compressed formats, would need encoder
            logger.warning("[AudioProcessor] Compressed format encoding not implemented")
            return buffer.toData()
        }
    }

    // MARK: - Voice Activity Detection

    /// Detect voice activity in buffer
    func detectVoiceActivity(_ buffer: AudioBuffer) -> VADResult {
        let energy = calculateEnergy(buffer.samples)
        let zeroCrossings = calculateZeroCrossings(buffer.samples)
        let normalizedZC = Float(zeroCrossings) / Float(buffer.samples.count)

        // Simple VAD based on energy and zero-crossing rate
        let isVoice = energy > vadSettings.energyThreshold &&
                      normalizedZC > vadSettings.zeroCrossingThreshold

        return VADResult(
            isSpeech: isVoice,
            confidence: min(energy / vadSettings.energyThreshold, 1.0),
            startTime: 0,
            endTime: buffer.duration,
            averageEnergy: energy,
            peakEnergy: buffer.peakAmplitude
        )
    }

    /// Calculate RMS energy
    func calculateEnergy(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }

        var sum: Float = 0
        vDSP_svesq(samples, 1, &sum, vDSP_Length(samples.count))
        return sqrt(sum / Float(samples.count))
    }

    /// Calculate zero-crossing rate
    func calculateZeroCrossings(_ samples: [Float]) -> Int {
        guard samples.count > 1 else { return 0 }

        var crossings = 0
        for i in 1..<samples.count {
            if (samples[i] >= 0 && samples[i-1] < 0) ||
               (samples[i] < 0 && samples[i-1] >= 0) {
                crossings += 1
            }
        }
        return crossings
    }

    // MARK: - Audio Level Metering

    /// Update audio level meters
    func updateMeter(with buffer: AudioBuffer) -> (peak: Float, average: Float) {
        peakLevel = buffer.peakAmplitude
        averageLevel = buffer.rmsEnergy
        return (peakLevel, averageLevel)
    }

    /// Get current levels in dB
    func getLevelsInDB() -> (peak: Float, average: Float) {
        let peakDB = peakLevel > 0 ? 20 * log10(peakLevel) : -160
        let avgDB = averageLevel > 0 ? 20 * log10(averageLevel) : -160
        return (peakDB, avgDB)
    }

    // MARK: - Resampling

    /// Resample audio to target sample rate
    func resample(_ buffer: AudioBuffer, to targetSampleRate: Double) -> AudioBuffer {
        guard buffer.sampleRate != targetSampleRate else { return buffer }

        let ratio = targetSampleRate / buffer.sampleRate
        let newLength = Int(Double(buffer.samples.count) * ratio)

        var inputFloat = buffer.samples
        var outputFloat = [Float](repeating: 0, count: newLength)

        // Simple linear interpolation resampling
        // For production, use vDSP_vgenp or AudioConverter
        for i in 0..<newLength {
            let srcIndex = Double(i) / ratio
            let srcIndexFloor = Int(srcIndex)
            let srcIndexCeil = min(srcIndexFloor + 1, buffer.samples.count - 1)
            let frac = Float(srcIndex - Double(srcIndexFloor))

            outputFloat[i] = inputFloat[srcIndexFloor] * (1 - frac) + inputFloat[srcIndexCeil] * frac
        }

        return AudioBuffer(samples: outputFloat, sampleRate: targetSampleRate, channels: buffer.channels)
    }

    // MARK: - Audio Effects

    /// Apply gain to audio
    func applyGain(_ buffer: AudioBuffer, gain: Float) -> AudioBuffer {
        var samples = buffer.samples
        var gainValue = gain
        vDSP_vsmul(samples, 1, &gainValue, &samples, 1, vDSP_Length(samples.count))
        return AudioBuffer(samples: samples, sampleRate: buffer.sampleRate, channels: buffer.channels)
    }

    /// Normalize audio to peak level
    func normalize(_ buffer: AudioBuffer, targetPeak: Float = 0.95) -> AudioBuffer {
        let currentPeak = buffer.peakAmplitude
        guard currentPeak > 0 else { return buffer }

        let gain = targetPeak / currentPeak
        return applyGain(buffer, gain: gain)
    }

    /// Apply low-pass filter
    func applyLowPassFilter(_ buffer: AudioBuffer, cutoffFrequency: Float) -> AudioBuffer {
        // Simple one-pole low-pass filter
        let rc = 1.0 / (2.0 * Float.pi * cutoffFrequency)
        let dt = 1.0 / Float(buffer.sampleRate)
        let alpha = dt / (rc + dt)

        var samples = buffer.samples
        var filtered = [Float](repeating: 0, count: samples.count)

        if !samples.isEmpty {
            filtered[0] = samples[0]
            for i in 1..<samples.count {
                filtered[i] = filtered[i-1] + alpha * (samples[i] - filtered[i-1])
            }
        }

        return AudioBuffer(samples: filtered, sampleRate: buffer.sampleRate, channels: buffer.channels)
    }

    /// Apply high-pass filter
    func applyHighPassFilter(_ buffer: AudioBuffer, cutoffFrequency: Float) -> AudioBuffer {
        // Simple one-pole high-pass filter
        let rc = 1.0 / (2.0 * Float.pi * cutoffFrequency)
        let dt = 1.0 / Float(buffer.sampleRate)
        let alpha = rc / (rc + dt)

        var samples = buffer.samples
        var filtered = [Float](repeating: 0, count: samples.count)

        if !samples.isEmpty {
            filtered[0] = samples[0]
            for i in 1..<samples.count {
                filtered[i] = alpha * (filtered[i-1] + samples[i] - samples[i-1])
            }
        }

        return AudioBuffer(samples: filtered, sampleRate: buffer.sampleRate, channels: buffer.channels)
    }

    /// Remove DC offset
    func removeDCOffset(_ buffer: AudioBuffer) -> AudioBuffer {
        guard !buffer.samples.isEmpty else { return buffer }

        // Calculate mean
        var mean: Float = 0
        vDSP_meanv(buffer.samples, 1, &mean, vDSP_Length(buffer.samples.count))

        // Subtract mean
        var samples = buffer.samples
        var negativeMean = -mean
        vDSP_vsadd(samples, 1, &negativeMean, &samples, 1, vDSP_Length(samples.count))

        return AudioBuffer(samples: samples, sampleRate: buffer.sampleRate, channels: buffer.channels)
    }

    // MARK: - Silence Detection

    /// Find silence segments in audio
    func findSilenceSegments(_ buffer: AudioBuffer, threshold: Float = 0.01, minDuration: TimeInterval = 0.5) -> [(start: TimeInterval, end: TimeInterval)] {
        var segments: [(start: TimeInterval, end: TimeInterval)] = []

        let samplesPerFrame = Int(buffer.sampleRate * 0.02) // 20ms frames
        let frameCount = buffer.samples.count / samplesPerFrame

        var silenceStart: Int?

        for frame in 0..<frameCount {
            let startSample = frame * samplesPerFrame
            let endSample = min(startSample + samplesPerFrame, buffer.samples.count)
            let frameSamples = Array(buffer.samples[startSample..<endSample])

            let energy = calculateEnergy(frameSamples)
            let isSilent = energy < threshold

            if isSilent && silenceStart == nil {
                silenceStart = startSample
            } else if !isSilent && silenceStart != nil {
                let duration = Double(startSample - silenceStart!) / buffer.sampleRate
                if duration >= minDuration {
                    segments.append((
                        start: Double(silenceStart!) / buffer.sampleRate,
                        end: Double(startSample) / buffer.sampleRate
                    ))
                }
                silenceStart = nil
            }
        }

        // Handle trailing silence
        if let start = silenceStart {
            let duration = Double(buffer.samples.count - start) / buffer.sampleRate
            if duration >= minDuration {
                segments.append((
                    start: Double(start) / buffer.sampleRate,
                    end: buffer.duration
                ))
            }
        }

        return segments
    }

    /// Trim silence from start and end
    func trimSilence(_ buffer: AudioBuffer, threshold: Float = 0.01) -> AudioBuffer {
        guard !buffer.samples.isEmpty else { return buffer }

        // Find first non-silent sample
        var startIndex = 0
        for i in 0..<buffer.samples.count {
            if abs(buffer.samples[i]) > threshold {
                startIndex = max(0, i - Int(buffer.sampleRate * 0.01)) // Keep 10ms lead-in
                break
            }
        }

        // Find last non-silent sample
        var endIndex = buffer.samples.count - 1
        for i in stride(from: buffer.samples.count - 1, through: 0, by: -1) {
            if abs(buffer.samples[i]) > threshold {
                endIndex = min(buffer.samples.count - 1, i + Int(buffer.sampleRate * 0.01)) // Keep 10ms tail
                break
            }
        }

        if startIndex >= endIndex {
            return buffer
        }

        let trimmedSamples = Array(buffer.samples[startIndex...endIndex])
        return AudioBuffer(samples: trimmedSamples, sampleRate: buffer.sampleRate, channels: buffer.channels)
    }

    // MARK: - Audio Analysis

    /// Calculate spectral centroid (brightness)
    func calculateSpectralCentroid(_ buffer: AudioBuffer) -> Float {
        // Simplified - would use FFT for proper implementation
        let zeroCrossings = calculateZeroCrossings(buffer.samples)
        return Float(zeroCrossings) / Float(buffer.samples.count) * Float(buffer.sampleRate) / 2
    }

    /// Calculate audio duration
    func calculateDuration(_ data: Data, format: AudioFormat, sampleRate: Double, channels: Int, bitsPerSample: Int) -> TimeInterval {
        let bytesPerSample = bitsPerSample / 8
        let bytesPerFrame = bytesPerSample * channels
        let totalFrames = data.count / bytesPerFrame
        return TimeInterval(totalFrames) / sampleRate
    }

    // MARK: - Format Conversion

    /// Convert between audio formats (placeholder for actual encoding)
    func convert(_ data: Data, from sourceFormat: AudioFormat, to targetFormat: AudioFormat, sampleRate: Double) throws -> Data {
        // In production, would use AVAudioConverter or external libraries
        logger.info("[AudioProcessor] Format conversion: \(sourceFormat) -> \(targetFormat)")

        // If same format, return as-is
        if sourceFormat == targetFormat {
            return data
        }

        // PCM to PCM is direct copy
        if sourceFormat == .pcm && targetFormat == .wav {
            return addWAVHeader(to: data, sampleRate: sampleRate, channels: 1, bitsPerSample: 16)
        }

        // For other conversions, would need actual encoding
        logger.warning("[AudioProcessor] Format conversion not fully implemented")
        return data
    }

    /// Add WAV header to PCM data
    func addWAVHeader(to pcmData: Data, sampleRate: Double, channels: Int, bitsPerSample: Int) -> Data {
        var header = Data()

        let bytesPerSample = bitsPerSample / 8
        let byteRate = Int(sampleRate) * channels * bytesPerSample
        let blockAlign = channels * bytesPerSample
        let dataSize = pcmData.count
        let fileSize = 36 + dataSize

        // RIFF header
        header.append(contentsOf: "RIFF".utf8)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(fileSize).littleEndian) { Array($0) })
        header.append(contentsOf: "WAVE".utf8)

        // fmt chunk
        header.append(contentsOf: "fmt ".utf8)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian) { Array($0) }) // chunk size
        header.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) }) // PCM format
        header.append(contentsOf: withUnsafeBytes(of: UInt16(channels).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt32(byteRate).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(blockAlign).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(bitsPerSample).littleEndian) { Array($0) })

        // data chunk
        header.append(contentsOf: "data".utf8)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(dataSize).littleEndian) { Array($0) })

        return header + pcmData
    }
}
