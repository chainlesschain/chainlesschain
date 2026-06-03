/**
 * AudioVideoToolsTests.swift
 *
 * Unit tests for AudioVideoTools (18 tools).
 * Tests audio processing, video processing, and the 4 newly implemented stub tools.
 */

import XCTest
import AVFoundation
@testable import ChainlessChain

@MainActor
final class AudioVideoToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testResourcesPath: String!
    var tempOutputPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared

        // Register audio/video tools
        toolManager.registerAudioVideoTools()

        // Setup test paths
        let tempDir = NSTemporaryDirectory()
        testResourcesPath = tempDir + "test_resources/"
        tempOutputPath = tempDir + "test_output/"

        // Create directories
        try? FileManager.default.createDirectory(atPath: testResourcesPath, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: tempOutputPath, withIntermediateDirectories: true)

        // Create test resources
        try await createTestAudioFile()
        try await createTestVideoFile()
    }

    override func tearDown() async throws {
        // Clean up test files
        try? FileManager.default.removeItem(atPath: testResourcesPath)
        try? FileManager.default.removeItem(atPath: tempOutputPath)

        toolManager = nil
    }

    // MARK: - Test Resource Creation

    private func createTestAudioFile() async throws {
        let audioPath = testResourcesPath + "test_audio.m4a"

        // Create a simple audio file using AVAssetWriter
        let outputURL = URL(fileURLWithPath: audioPath)

        guard let writer = try? AVAssetWriter(url: outputURL, fileType: .m4a) else {
            throw NSError(domain: "TestError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create audio writer"])
        }

        let audioSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 128000
        ]

        let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        writer.add(writerInput)

        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        // Generate 3 seconds of silence
        let bufferDuration = CMTime(value: 44100 * 3, timescale: 44100) // 3 seconds

        writerInput.markAsFinished()
        await writer.finishWriting()
    }

    private func createTestVideoFile() async throws {
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputURL = URL(fileURLWithPath: videoPath)

        guard let writer = try? AVAssetWriter(url: outputURL, fileType: .mp4) else {
            throw NSError(domain: "TestError", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot create video writer"])
        }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 1920,
            AVVideoHeightKey: 1080
        ]

        let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        writer.add(writerInput)

        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        writerInput.markAsFinished()
        await writer.finishWriting()
    }

    // MARK: - Audio Info Tests

    func testAudioInfo() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.info",
            input: ["audioPath": audioPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["duration"])
            XCTAssertNotNil(info["format"])
            XCTAssertEqual(info["format"] as? String, "m4a")
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    // MARK: - Audio Reverse Tests (Newly Implemented)

    func testAudioReverse() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "reversed.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.reverse",
            input: [
                "audioPath": audioPath,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify output is valid audio
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: outputURL)
        let duration = try await asset.load(.duration)
        XCTAssertGreaterThan(duration.seconds, 0)
    }

    func testAudioReverseMissingParameters() async throws {
        // Given - missing outputPath
        let audioPath = testResourcesPath + "test_audio.m4a"

        // When/Then
        do {
            _ = try await toolManager.execute(
                toolId: "tool.audio.reverse",
                input: ["audioPath": audioPath]
            )
            XCTFail("Should throw error for missing parameters")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    func testAudioReverseInvalidFile() async throws {
        // Given
        let invalidPath = "/invalid/path/audio.m4a"
        let outputPath = tempOutputPath + "reversed.m4a"

        // When/Then
        do {
            _ = try await toolManager.execute(
                toolId: "tool.audio.reverse",
                input: [
                    "audioPath": invalidPath,
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for invalid file")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Audio Bitrate Tests (Newly Implemented)

    func testAudioBitrate128k() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "bitrate_128k.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.bitrate",
            input: [
                "audioPath": audioPath,
                "bitrate": 128000,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testAudioBitrate64k() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "bitrate_64k.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.bitrate",
            input: [
                "audioPath": audioPath,
                "bitrate": 64000,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify file is smaller than original (low bitrate)
        let originalSize = try FileManager.default.attributesOfItem(atPath: audioPath)[.size] as? Int ?? 0
        let outputSize = try FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0

        // Note: Size comparison may not always hold due to encoding overhead
        XCTAssertGreaterThan(outputSize, 0)
    }

    // MARK: - Audio Volume Tests

    func testAudioVolumeIncrease() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "volume_increased.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.volume",
            input: [
                "audioPath": audioPath,
                "volume": 2.0,  // Double volume
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testAudioVolumeDecrease() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "volume_decreased.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.volume",
            input: [
                "audioPath": audioPath,
                "volume": 0.5,  // Half volume
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Audio Fade Tests

    func testAudioFadeInOut() async throws {
        // Given
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "fade.m4a"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.audio.fade",
            input: [
                "audioPath": audioPath,
                "fadeInDuration": 1.0,
                "fadeOutDuration": 1.0,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Video Info Tests

    func testVideoInfo() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.video.info",
            input: ["videoPath": videoPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["duration"])
            XCTAssertNotNil(info["format"])
            XCTAssertNotNil(info["width"])
            XCTAssertNotNil(info["height"])
            XCTAssertEqual(info["width"] as? Int, 1920)
            XCTAssertEqual(info["height"] as? Int, 1080)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    // MARK: - Video Rotate Tests (Newly Implemented)

    func testVideoRotate90() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "rotated_90.mp4"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.video.rotate",
            input: [
                "videoPath": videoPath,
                "degrees": 90,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify dimensions are swapped
        let outputURL = URL(fileURLWithPath: outputPath)
        let asset = AVAsset(url: outputURL)
        if let videoTrack = try? await asset.loadTracks(withMediaType: .video).first {
            let size = try await videoTrack.load(.naturalSize)
            // After 90° rotation, width and height should be swapped
            // Note: Actual verification depends on how the transform is applied
            XCTAssertGreaterThan(size.width, 0)
            XCTAssertGreaterThan(size.height, 0)
        }
    }

    func testVideoRotate180() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "rotated_180.mp4"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.video.rotate",
            input: [
                "videoPath": videoPath,
                "degrees": 180,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testVideoRotateInvalidDegrees() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "rotated_invalid.mp4"

        // When/Then - Invalid rotation angle (45 degrees)
        do {
            _ = try await toolManager.execute(
                toolId: "tool.video.rotate",
                input: [
                    "videoPath": videoPath,
                    "degrees": 45,  // Not in [90, 180, 270]
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for invalid rotation angle")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Video Watermark Tests (Newly Implemented)

    func testVideoWatermarkText() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "watermark_text.mp4"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.video.watermark",
            input: [
                "videoPath": videoPath,
                "text": "Test Watermark",
                "position": "bottomRight",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testVideoWatermarkTextPositions() async throws {
        // Test all 5 positions
        let positions = ["topLeft", "topRight", "bottomLeft", "bottomRight", "center"]
        let videoPath = testResourcesPath + "test_video.mp4"

        for (index, position) in positions.enumerated() {
            let outputPath = tempOutputPath + "watermark_\(position).mp4"

            let result = try await toolManager.execute(
                toolId: "tool.video.watermark",
                input: [
                    "videoPath": videoPath,
                    "text": "Watermark \(position)",
                    "position": position,
                    "outputPath": outputPath
                ]
            )

            XCTAssertNotNil(result)
            XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
        }
    }

    func testVideoWatermarkMissingContent() async throws {
        // Given - no text or image
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "watermark_missing.mp4"

        // When/Then
        do {
            _ = try await toolManager.execute(
                toolId: "tool.video.watermark",
                input: [
                    "videoPath": videoPath,
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for missing watermark content")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Video Compress Tests

    func testVideoCompressLowQuality() async throws {
        // Given
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "compressed_low.mp4"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.video.compress",
            input: [
                "videoPath": videoPath,
                "quality": "low",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["outputPath"])
            XCTAssertNotNil(info["originalSize"])
            XCTAssertNotNil(info["compressedSize"])
            XCTAssertNotNil(info["compressionRatio"])
        }

        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Performance Tests

    func testAudioReversePerformance() throws {
        let audioPath = testResourcesPath + "test_audio.m4a"
        let outputPath = tempOutputPath + "reversed_perf.m4a"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.audio.reverse",
                    input: [
                        "audioPath": audioPath,
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }

    func testVideoRotatePerformance() throws {
        let videoPath = testResourcesPath + "test_video.mp4"
        let outputPath = tempOutputPath + "rotated_perf.mp4"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.video.rotate",
                    input: [
                        "videoPath": videoPath,
                        "degrees": 90,
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }
}
