//
//  MobileAction.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Mobile-specific actions (screenshots, device info, haptics)
//  Adapted from: desktop-app-vue/src/main/browser/actions/desktop-action.js
//
//  Key difference: Replaces desktop robotjs with UIKit screenshots, device info, and haptics.
//  No system-level mouse/keyboard control on iOS.
//

import UIKit
import WebKit

// MARK: - MobileAction Protocol

/// Protocol for mobile-specific actions
public protocol MobileActionProtocol {
    func captureAppScreenshot() async throws -> ComputerUseResult
    func captureWebViewScreenshot(webView: WKWebView) async throws -> ComputerUseResult
    func getDeviceInfo() -> ComputerUseResult
    func triggerHaptic(type: CUHapticType) -> ComputerUseResult
}

// MARK: - MobileAction

/// Implements mobile-specific actions for iOS
public class MobileAction: MobileActionProtocol {
    public static let shared = MobileAction()

    private let metrics = ComputerUseMetrics.shared
    private let auditLogger = CUAuditLogger.shared

    private init() {
        Logger.shared.info("[MobileAction] Initialized")
    }

    // MARK: - App Screenshot

    /// Capture a screenshot of the entire app window
    @MainActor
    public func captureAppScreenshot() async throws -> ComputerUseResult {
        let start = Date()

        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            return .fail(action: .appScreenshot, error: "No active window found")
        }

        let renderer = UIGraphicsImageRenderer(size: window.bounds.size)
        let image = renderer.image { ctx in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }

        guard let jpegData = image.jpegData(compressionQuality: 0.85) else {
            return .fail(action: .appScreenshot, error: "Failed to encode screenshot")
        }

        let base64 = jpegData.base64EncodedString()
        let duration = Date().timeIntervalSince(start) * 1000

        auditLogger.log(action: .appScreenshot, success: true, duration: duration)
        metrics.recordAction(type: .appScreenshot, success: true, duration: duration)

        return .ok(action: .appScreenshot, data: [
            "base64": .string(base64),
            "width": .int(Int(image.size.width * image.scale)),
            "height": .int(Int(image.size.height * image.scale)),
            "format": .string("jpeg"),
            "size": .int(jpegData.count)
        ], duration: duration)
    }

    // MARK: - WebView Screenshot

    /// Capture a screenshot of a WKWebView
    @MainActor
    public func captureWebViewScreenshot(webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()

        let config = WKSnapshotConfiguration()
        config.snapshotWidth = NSNumber(value: Int(webView.bounds.width))

        do {
            let image = try await webView.takeSnapshot(configuration: config)

            guard let jpegData = image.jpegData(compressionQuality: 0.85) else {
                return .fail(action: .screenshot, error: "Failed to encode WebView screenshot")
            }

            let base64 = jpegData.base64EncodedString()
            let duration = Date().timeIntervalSince(start) * 1000

            auditLogger.log(action: .screenshot, success: true, duration: duration)
            metrics.recordAction(type: .screenshot, success: true, duration: duration)

            return .ok(action: .screenshot, data: [
                "base64": .string(base64),
                "width": .int(Int(image.size.width * image.scale)),
                "height": .int(Int(image.size.height * image.scale)),
                "format": .string("jpeg"),
                "size": .int(jpegData.count)
            ], duration: duration)

        } catch {
            let duration = Date().timeIntervalSince(start) * 1000
            auditLogger.log(action: .screenshot, success: false, error: error.localizedDescription, duration: duration)
            metrics.recordAction(type: .screenshot, success: false, duration: duration)
            return .fail(action: .screenshot, error: error.localizedDescription, duration: duration)
        }
    }

    // MARK: - Device Info

    /// Get current device information
    public func getDeviceInfo() -> ComputerUseResult {
        let start = Date()
        let device = UIDevice.current
        let screen = UIScreen.main

        let info: [String: AnyCodableValue] = [
            "name": .string(device.name),
            "model": .string(device.model),
            "systemName": .string(device.systemName),
            "systemVersion": .string(device.systemVersion),
            "identifierForVendor": .string(device.identifierForVendor?.uuidString ?? "unknown"),
            "batteryLevel": .double(Double(device.batteryLevel)),
            "batteryState": .string(batteryStateString(device.batteryState)),
            "screenWidth": .double(Double(screen.bounds.width)),
            "screenHeight": .double(Double(screen.bounds.height)),
            "screenScale": .double(Double(screen.scale)),
            "nativeWidth": .double(Double(screen.nativeBounds.width)),
            "nativeHeight": .double(Double(screen.nativeBounds.height)),
            "brightness": .double(Double(screen.brightness)),
            "orientation": .string(orientationString(device.orientation)),
            "isMultitaskingSupported": .bool(device.isMultitaskingSupported)
        ]

        let duration = Date().timeIntervalSince(start) * 1000
        auditLogger.log(action: .deviceInfo, success: true, duration: duration)
        metrics.recordAction(type: .deviceInfo, success: true, duration: duration)

        return .ok(action: .deviceInfo, data: info, duration: duration)
    }

    // MARK: - Haptic Feedback

    /// Trigger haptic feedback
    public func triggerHaptic(type: CUHapticType) -> ComputerUseResult {
        let start = Date()

        switch type {
        case .light:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .medium:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .heavy:
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case .success:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .error:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .selection:
            UISelectionFeedbackGenerator().selectionChanged()
        }

        let duration = Date().timeIntervalSince(start) * 1000
        auditLogger.log(action: .haptic, params: ["type": .string(type.rawValue)],
                        success: true, duration: duration)
        metrics.recordAction(type: .haptic, success: true, duration: duration)

        return .ok(action: .haptic, data: ["type": .string(type.rawValue)], duration: duration)
    }

    // MARK: - Helpers

    private func batteryStateString(_ state: UIDevice.BatteryState) -> String {
        switch state {
        case .unknown: return "unknown"
        case .unplugged: return "unplugged"
        case .charging: return "charging"
        case .full: return "full"
        @unknown default: return "unknown"
        }
    }

    private func orientationString(_ orientation: UIDeviceOrientation) -> String {
        switch orientation {
        case .portrait: return "portrait"
        case .portraitUpsideDown: return "portraitUpsideDown"
        case .landscapeLeft: return "landscapeLeft"
        case .landscapeRight: return "landscapeRight"
        case .faceUp: return "faceUp"
        case .faceDown: return "faceDown"
        default: return "unknown"
        }
    }
}
