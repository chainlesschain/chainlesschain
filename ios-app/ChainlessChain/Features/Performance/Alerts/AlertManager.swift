//
//  AlertManager.swift
//  ChainlessChain
//
//  性能告警管理器
//  监控性能指标并触发告警
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import CoreCommon

// MARK: - Performance Alert

/// 性能告警
public struct PerformanceAlert: Identifiable {
    public let id: String
    public let type: AlertType
    public let severity: AlertSeverity
    public let message: String
    public let timestamp: Date
    public var value: Double?
    public var threshold: Double?
    public var isResolved: Bool = false
    public var resolvedAt: Date?

    public enum AlertType: String, CaseIterable {
        case highCPU = "high_cpu"
        case highMemory = "high_memory"
        case lowFPS = "low_fps"
        case thermalWarning = "thermal_warning"
        case lowBattery = "low_battery"
        case lowDiskSpace = "low_disk_space"
        case slowOperation = "slow_operation"
        case networkError = "network_error"
        case crash = "crash"

        public var displayName: String {
            switch self {
            case .highCPU: return "CPU使用率过高"
            case .highMemory: return "内存使用过高"
            case .lowFPS: return "帧率过低"
            case .thermalWarning: return "设备过热"
            case .lowBattery: return "电量不足"
            case .lowDiskSpace: return "磁盘空间不足"
            case .slowOperation: return "操作响应慢"
            case .networkError: return "网络异常"
            case .crash: return "应用崩溃"
            }
        }

        public var icon: String {
            switch self {
            case .highCPU: return "cpu"
            case .highMemory: return "memorychip"
            case .lowFPS: return "speedometer"
            case .thermalWarning: return "thermometer"
            case .lowBattery: return "battery.25"
            case .lowDiskSpace: return "internaldrive"
            case .slowOperation: return "clock"
            case .networkError: return "wifi.exclamationmark"
            case .crash: return "exclamationmark.triangle"
            }
        }
    }

    public enum AlertSeverity: String, Comparable {
        case info
        case warning
        case critical

        public var displayName: String {
            switch self {
            case .info: return "信息"
            case .warning: return "警告"
            case .critical: return "严重"
            }
        }

        public var color: String {
            switch self {
            case .info: return "blue"
            case .warning: return "orange"
            case .critical: return "red"
            }
        }

        public static func < (lhs: AlertSeverity, rhs: AlertSeverity) -> Bool {
            let order: [AlertSeverity] = [.info, .warning, .critical]
            return order.firstIndex(of: lhs)! < order.firstIndex(of: rhs)!
        }
    }

    public init(
        id: String = UUID().uuidString,
        type: AlertType,
        severity: AlertSeverity,
        message: String,
        timestamp: Date = Date(),
        value: Double? = nil,
        threshold: Double? = nil
    ) {
        self.id = id
        self.type = type
        self.severity = severity
        self.message = message
        self.timestamp = timestamp
        self.value = value
        self.threshold = threshold
    }
}

// MARK: - Alert Threshold

/// 告警阈值配置
public struct AlertThresholds {
    public var cpuWarning: Double = 70
    public var cpuCritical: Double = 90
    public var memoryWarningMB: Double = 300
    public var memoryCriticalMB: Double = 500
    public var fpsWarning: Double = 30
    public var fpsCritical: Double = 20
    public var diskSpaceWarningMB: Double = 500
    public var diskSpaceCriticalMB: Double = 100
    public var batteryWarning: Double = 20
    public var batteryCritical: Double = 10
    public var slowOperationMs: Double = 500

    public init() {}
}

// MARK: - Alert Manager

/// 告警管理器
@MainActor
public class AlertManager: ObservableObject {
    public static let shared = AlertManager()

    // MARK: - Published Properties

    @Published public var activeAlerts: [PerformanceAlert] = []
    @Published public var alertHistory: [PerformanceAlert] = []
    @Published public var isEnabled: Bool = true

    // MARK: - Properties

    public var thresholds = AlertThresholds()

    private var cancellables = Set<AnyCancellable>()
    private let maxHistoryCount = 100

    // 告警去重窗口（秒）
    private var lastAlertTimes: [PerformanceAlert.AlertType: Date] = [:]
    private let deduplicationWindow: TimeInterval = 60

    // 事件发布
    public let alertTriggered = PassthroughSubject<PerformanceAlert, Never>()
    public let alertResolved = PassthroughSubject<PerformanceAlert, Never>()

    // MARK: - Initialization

    private init() {
        setupMonitoring()
        Logger.shared.info("[AlertManager] 初始化完成")
    }

    // MARK: - Setup

    private func setupMonitoring() {
        // 监听性能指标更新
        PerformanceMonitor.shared.metricsUpdated
            .receive(on: DispatchQueue.main)
            .sink { [weak self] metrics in
                self?.checkMetrics(metrics)
            }
            .store(in: &cancellables)

        // 监听慢操作
        PerformanceMonitor.shared.slowOperationDetected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] trace in
                self?.handleSlowOperation(trace)
            }
            .store(in: &cancellables)
    }

    // MARK: - Metrics Check

    private func checkMetrics(_ metrics: PerformanceMetrics) {
        guard isEnabled else { return }

        // 检查CPU
        checkCPU(metrics.cpuUsage)

        // 检查内存
        checkMemory(metrics.memoryUsageMB)

        // 检查FPS
        checkFPS(metrics.fps)

        // 检查磁盘空间
        checkDiskSpace(metrics.diskFreeMB)

        // 检查电池
        checkBattery(metrics.batteryLevel)

        // 检查热状态
        checkThermalState(metrics.thermalState)

        // 自动解决已恢复的告警
        resolveRecoveredAlerts(metrics)
    }

    private func checkCPU(_ usage: Double) {
        if usage >= thresholds.cpuCritical {
            triggerAlert(
                type: .highCPU,
                severity: .critical,
                message: "CPU使用率达到 \(String(format: "%.1f", usage))%",
                value: usage,
                threshold: thresholds.cpuCritical
            )
        } else if usage >= thresholds.cpuWarning {
            triggerAlert(
                type: .highCPU,
                severity: .warning,
                message: "CPU使用率偏高: \(String(format: "%.1f", usage))%",
                value: usage,
                threshold: thresholds.cpuWarning
            )
        }
    }

    private func checkMemory(_ usageMB: Double) {
        if usageMB >= thresholds.memoryCriticalMB {
            triggerAlert(
                type: .highMemory,
                severity: .critical,
                message: "内存使用达到 \(String(format: "%.0f", usageMB))MB",
                value: usageMB,
                threshold: thresholds.memoryCriticalMB
            )
        } else if usageMB >= thresholds.memoryWarningMB {
            triggerAlert(
                type: .highMemory,
                severity: .warning,
                message: "内存使用偏高: \(String(format: "%.0f", usageMB))MB",
                value: usageMB,
                threshold: thresholds.memoryWarningMB
            )
        }
    }

    private func checkFPS(_ fps: Double) {
        guard fps > 0 else { return }

        if fps <= thresholds.fpsCritical {
            triggerAlert(
                type: .lowFPS,
                severity: .critical,
                message: "帧率严重下降: \(String(format: "%.0f", fps)) FPS",
                value: fps,
                threshold: thresholds.fpsCritical
            )
        } else if fps <= thresholds.fpsWarning {
            triggerAlert(
                type: .lowFPS,
                severity: .warning,
                message: "帧率下降: \(String(format: "%.0f", fps)) FPS",
                value: fps,
                threshold: thresholds.fpsWarning
            )
        }
    }

    private func checkDiskSpace(_ freeMB: Double) {
        if freeMB <= thresholds.diskSpaceCriticalMB {
            triggerAlert(
                type: .lowDiskSpace,
                severity: .critical,
                message: "磁盘空间严重不足: 仅剩 \(String(format: "%.0f", freeMB))MB",
                value: freeMB,
                threshold: thresholds.diskSpaceCriticalMB
            )
        } else if freeMB <= thresholds.diskSpaceWarningMB {
            triggerAlert(
                type: .lowDiskSpace,
                severity: .warning,
                message: "磁盘空间不足: 仅剩 \(String(format: "%.0f", freeMB))MB",
                value: freeMB,
                threshold: thresholds.diskSpaceWarningMB
            )
        }
    }

    private func checkBattery(_ level: Double) {
        if level <= thresholds.batteryCritical && level > 0 {
            triggerAlert(
                type: .lowBattery,
                severity: .critical,
                message: "电量严重不足: \(String(format: "%.0f", level))%",
                value: level,
                threshold: thresholds.batteryCritical
            )
        } else if level <= thresholds.batteryWarning && level > 0 {
            triggerAlert(
                type: .lowBattery,
                severity: .warning,
                message: "电量不足: \(String(format: "%.0f", level))%",
                value: level,
                threshold: thresholds.batteryWarning
            )
        }
    }

    private func checkThermalState(_ state: ProcessInfo.ThermalState) {
        switch state {
        case .critical:
            triggerAlert(
                type: .thermalWarning,
                severity: .critical,
                message: "设备严重过热，性能已受限"
            )
        case .serious:
            triggerAlert(
                type: .thermalWarning,
                severity: .warning,
                message: "设备温度过高，请注意散热"
            )
        default:
            break
        }
    }

    private func handleSlowOperation(_ trace: OperationTrace) {
        guard let durationMs = trace.durationMs else { return }

        let severity: PerformanceAlert.AlertSeverity
        if durationMs > thresholds.slowOperationMs * 2 {
            severity = .critical
        } else {
            severity = .warning
        }

        triggerAlert(
            type: .slowOperation,
            severity: severity,
            message: "操作 '\(trace.name)' 耗时 \(String(format: "%.0f", durationMs))ms",
            value: durationMs,
            threshold: thresholds.slowOperationMs
        )
    }

    // MARK: - Alert Management

    /// 触发告警
    public func triggerAlert(
        type: PerformanceAlert.AlertType,
        severity: PerformanceAlert.AlertSeverity,
        message: String,
        value: Double? = nil,
        threshold: Double? = nil
    ) {
        // 去重检查
        if let lastTime = lastAlertTimes[type],
           Date().timeIntervalSince(lastTime) < deduplicationWindow {
            return
        }

        let alert = PerformanceAlert(
            type: type,
            severity: severity,
            message: message,
            value: value,
            threshold: threshold
        )

        // 更新去重时间
        lastAlertTimes[type] = Date()

        // 添加到活跃告警
        activeAlerts.append(alert)

        // 发布事件
        alertTriggered.send(alert)

        Logger.shared.warning("[AlertManager] 触发告警: \(type.displayName) - \(message)")
    }

    /// 解决告警
    public func resolveAlert(_ alertId: String) {
        guard let index = activeAlerts.firstIndex(where: { $0.id == alertId }) else {
            return
        }

        var alert = activeAlerts.remove(at: index)
        alert.isResolved = true
        alert.resolvedAt = Date()

        // 添加到历史
        alertHistory.insert(alert, at: 0)
        if alertHistory.count > maxHistoryCount {
            alertHistory.removeLast()
        }

        // 发布事件
        alertResolved.send(alert)

        Logger.shared.info("[AlertManager] 告警已解决: \(alert.type.displayName)")
    }

    /// 自动解决已恢复的告警
    private func resolveRecoveredAlerts(_ metrics: PerformanceMetrics) {
        var alertsToResolve: [String] = []

        for alert in activeAlerts {
            switch alert.type {
            case .highCPU:
                if metrics.cpuUsage < thresholds.cpuWarning * 0.8 {
                    alertsToResolve.append(alert.id)
                }
            case .highMemory:
                if metrics.memoryUsageMB < thresholds.memoryWarningMB * 0.8 {
                    alertsToResolve.append(alert.id)
                }
            case .lowFPS:
                if metrics.fps > thresholds.fpsWarning * 1.2 {
                    alertsToResolve.append(alert.id)
                }
            case .thermalWarning:
                if metrics.thermalState == .nominal || metrics.thermalState == .fair {
                    alertsToResolve.append(alert.id)
                }
            default:
                break
            }
        }

        for alertId in alertsToResolve {
            resolveAlert(alertId)
        }
    }

    /// 清除所有告警
    public func clearAllAlerts() {
        for alert in activeAlerts {
            resolveAlert(alert.id)
        }
    }

    /// 获取告警统计
    public func getAlertStats() -> AlertStats {
        let now = Date()
        let last24h = now.addingTimeInterval(-86400)

        let recent = alertHistory.filter { $0.timestamp >= last24h }

        return AlertStats(
            totalAlerts: alertHistory.count,
            activeCount: activeAlerts.count,
            last24hCount: recent.count,
            criticalCount: activeAlerts.filter { $0.severity == .critical }.count,
            byType: Dictionary(grouping: recent, by: { $0.type }).mapValues { $0.count }
        )
    }
}

// MARK: - Alert Stats

/// 告警统计
public struct AlertStats {
    public let totalAlerts: Int
    public let activeCount: Int
    public let last24hCount: Int
    public let criticalCount: Int
    public let byType: [PerformanceAlert.AlertType: Int]
}
