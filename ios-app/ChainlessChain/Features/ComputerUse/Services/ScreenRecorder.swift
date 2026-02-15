//
//  ScreenRecorder.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Screenshot-sequence screen recording
//  Adapted from: desktop-app-vue/src/main/browser/actions/screen-recorder.js
//
//  Uses WKWebView.takeSnapshot() at configurable FPS to create screenshot sequences.
//  Frames stored as JPEG in a temporary directory with metadata.json.
//

import Foundation
import UIKit
import WebKit
import Combine

// MARK: - Recording Metadata

/// Metadata for a recording session
public struct CURecordingMetadata: Codable, Identifiable {
    public let id: String
    public let startTime: Date
    public var endTime: Date?
    public var frameCount: Int
    public var fps: Double
    public let quality: Double
    public let directory: String

    public var duration: TimeInterval {
        (endTime ?? Date()).timeIntervalSince(startTime)
    }
}

// MARK: - Frame Info

/// Information about a single recorded frame
public struct CUFrameInfo: Codable {
    public let index: Int
    public let filename: String
    public let timestamp: Date
    public let size: Int
}

// MARK: - ScreenRecorder

/// Records WKWebView snapshots as image sequences
public class ScreenRecorder: ObservableObject {
    public static let shared = ScreenRecorder()

    @Published public private(set) var state: CURecordingState = .idle
    @Published public private(set) var currentRecording: CURecordingMetadata?
    @Published public private(set) var recordings: [CURecordingMetadata] = []

    private var timer: Timer?
    private var frames: [CUFrameInfo] = []
    private var recordingDir: URL?
    private weak var webView: WKWebView?

    // Configuration
    private var fps: Double = 2.0
    private var quality: Double = 0.7
    private var maxDuration: TimeInterval = 300 // 5 minutes

    // Base directory
    private let baseDirectory: URL

    private init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        baseDirectory = docs.appendingPathComponent(".chainlesschain").appendingPathComponent("recordings")

        do {
            try FileManager.default.createDirectory(at: baseDirectory, withIntermediateDirectories: true)
        } catch {
            Logger.shared.error("[ScreenRecorder] Failed to create recordings dir: \(error.localizedDescription)")
        }

        loadRecordingsList()
        Logger.shared.info("[ScreenRecorder] Initialized, dir: \(baseDirectory.path)")
    }

    // MARK: - Start Recording

    /// Start recording WKWebView snapshots
    @MainActor
    public func startRecording(webView: WKWebView, fps: Double = 2.0, quality: Double = 0.7) throws {
        guard state == .idle || state == .stopped else {
            throw CURecorderError.alreadyRecording
        }

        let recordingId = UUID().uuidString
        let dir = baseDirectory.appendingPathComponent(recordingId)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        self.webView = webView
        self.fps = min(max(fps, 0.5), 10.0) // Clamp 0.5-10 FPS
        self.quality = min(max(quality, 0.1), 1.0)
        self.recordingDir = dir
        self.frames = []

        let metadata = CURecordingMetadata(
            id: recordingId,
            startTime: Date(),
            frameCount: 0,
            fps: self.fps,
            quality: self.quality,
            directory: dir.path
        )
        currentRecording = metadata
        state = .recording

        // Start capture timer
        let interval = 1.0 / self.fps
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.captureFrame()
            }
        }

        // Auto-stop after max duration
        DispatchQueue.main.asyncAfter(deadline: .now() + maxDuration) { [weak self] in
            if self?.state == .recording {
                self?.stopRecording()
            }
        }

        Logger.shared.info("[ScreenRecorder] Recording started: \(recordingId), fps: \(self.fps)")
    }

    // MARK: - Pause / Resume

    /// Pause recording
    public func pauseRecording() {
        guard state == .recording else { return }
        timer?.invalidate()
        timer = nil
        state = .paused
        Logger.shared.info("[ScreenRecorder] Recording paused")
    }

    /// Resume recording
    @MainActor
    public func resumeRecording() {
        guard state == .paused, let _ = webView else { return }
        state = .recording

        let interval = 1.0 / fps
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.captureFrame()
            }
        }
        Logger.shared.info("[ScreenRecorder] Recording resumed")
    }

    // MARK: - Stop Recording

    /// Stop recording and save metadata
    public func stopRecording() {
        timer?.invalidate()
        timer = nil
        state = .stopped

        currentRecording?.endTime = Date()
        currentRecording?.frameCount = frames.count

        // Save metadata
        if let recording = currentRecording, let dir = recordingDir {
            saveMetadata(recording: recording, frames: frames, to: dir)
            recordings.append(recording)
        }

        webView = nil
        Logger.shared.info("[ScreenRecorder] Recording stopped, frames: \(frames.count)")
    }

    // MARK: - Frame Capture

    @MainActor
    private func captureFrame() async {
        guard state == .recording, let webView = webView, let dir = recordingDir else { return }

        let config = WKSnapshotConfiguration()
        config.snapshotWidth = NSNumber(value: Int(webView.bounds.width))

        do {
            let image = try await webView.takeSnapshot(configuration: config)
            guard let data = image.jpegData(compressionQuality: quality) else { return }

            let index = frames.count
            let filename = String(format: "frame_%05d.jpg", index)
            let fileURL = dir.appendingPathComponent(filename)

            try data.write(to: fileURL)

            let info = CUFrameInfo(
                index: index,
                filename: filename,
                timestamp: Date(),
                size: data.count
            )
            frames.append(info)
            currentRecording?.frameCount = frames.count

        } catch {
            Logger.shared.warning("[ScreenRecorder] Frame capture failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Frame Access

    /// Get frame data as base64
    public func getFrame(recordingId: String, index: Int) -> String? {
        let dir = baseDirectory.appendingPathComponent(recordingId)
        let filename = String(format: "frame_%05d.jpg", index)
        let fileURL = dir.appendingPathComponent(filename)

        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return data.base64EncodedString()
    }

    /// Get all frame info for a recording
    public func getFrames(recordingId: String) -> [CUFrameInfo] {
        let dir = baseDirectory.appendingPathComponent(recordingId)
        let metaURL = dir.appendingPathComponent("metadata.json")

        guard let data = try? Data(contentsOf: metaURL),
              let meta = try? JSONDecoder().decode(RecordingFile.self, from: data) else { return [] }
        return meta.frames
    }

    // MARK: - Delete Recording

    /// Delete a recording and its files
    public func deleteRecording(id: String) {
        let dir = baseDirectory.appendingPathComponent(id)
        try? FileManager.default.removeItem(at: dir)
        recordings.removeAll { $0.id == id }
        Logger.shared.info("[ScreenRecorder] Recording deleted: \(id)")
    }

    // MARK: - Persistence

    private struct RecordingFile: Codable {
        let recording: CURecordingMetadata
        let frames: [CUFrameInfo]
    }

    private func saveMetadata(recording: CURecordingMetadata, frames: [CUFrameInfo], to dir: URL) {
        let file = RecordingFile(recording: recording, frames: frames)
        let metaURL = dir.appendingPathComponent("metadata.json")

        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(file)
            try data.write(to: metaURL)
        } catch {
            Logger.shared.error("[ScreenRecorder] Failed to save metadata: \(error.localizedDescription)")
        }
    }

    private func loadRecordingsList() {
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: baseDirectory, includingPropertiesForKeys: nil
        ) else { return }

        for dir in contents where dir.hasDirectoryPath {
            let metaURL = dir.appendingPathComponent("metadata.json")
            if let data = try? Data(contentsOf: metaURL),
               let file = try? JSONDecoder().decode(RecordingFile.self, from: data) {
                recordings.append(file.recording)
            }
        }

        recordings.sort { $0.startTime > $1.startTime }
    }
}

// MARK: - Errors

enum CURecorderError: LocalizedError {
    case alreadyRecording
    case notRecording

    var errorDescription: String? {
        switch self {
        case .alreadyRecording: return "Recording is already in progress"
        case .notRecording: return "No recording in progress"
        }
    }
}
