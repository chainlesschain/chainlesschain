//
//  MetricCardView.swift
//  ChainlessChain
//
//  指标卡片视图
//  显示单个性能指标
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 指标卡片视图
struct MetricCardView: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    var subtitle: String?
    var trend: Trend?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 头部
            HStack {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundColor(color)

                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if let trend = trend {
                    TrendIndicator(trend: trend)
                }
            }

            // 数值
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.primary)

            // 副标题
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - 趋势指示器

struct TrendIndicator: View {
    let trend: Trend

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: trend.icon)
                .font(.caption2)

            Text(trend.text)
                .font(.caption2)
        }
        .foregroundColor(trend.color)
    }
}

/// 趋势类型
enum Trend {
    case up(Double)
    case down(Double)
    case stable

    var icon: String {
        switch self {
        case .up: return "arrow.up.right"
        case .down: return "arrow.down.right"
        case .stable: return "arrow.right"
        }
    }

    var text: String {
        switch self {
        case .up(let value): return String(format: "+%.1f%%", value)
        case .down(let value): return String(format: "%.1f%%", value)
        case .stable: return "0%"
        }
    }

    var color: Color {
        switch self {
        case .up: return .red
        case .down: return .green
        case .stable: return .gray
        }
    }
}

// MARK: - 大型指标卡片

struct LargeMetricCardView: View {
    let title: String
    let value: String
    let unit: String
    let icon: String
    let color: Color
    var progress: Double?
    var maxValue: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 头部
            HStack {
                ZStack {
                    Circle()
                        .fill(color.opacity(0.1))
                        .frame(width: 40, height: 40)

                    Image(systemName: icon)
                        .font(.title3)
                        .foregroundColor(color)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    if let maxValue = maxValue {
                        Text("最大: \(String(format: "%.0f", maxValue))\(unit)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()
            }

            // 数值
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundColor(.primary)

                Text(unit)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            // 进度条
            if let progress = progress {
                ProgressBar(value: progress, color: color)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - 进度条

struct ProgressBar: View {
    let value: Double
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.gray.opacity(0.2))
                    .frame(height: 8)

                RoundedRectangle(cornerRadius: 4)
                    .fill(color)
                    .frame(width: geometry.size.width * min(max(value, 0), 1), height: 8)
            }
        }
        .frame(height: 8)
    }
}

// MARK: - 圆形指标卡片

struct CircularMetricCardView: View {
    let title: String
    let value: Double
    let maxValue: Double
    let unit: String
    let color: Color

    private var progress: Double {
        min(value / maxValue, 1.0)
    }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                // 背景圆环
                Circle()
                    .stroke(Color.gray.opacity(0.2), lineWidth: 8)
                    .frame(width: 80, height: 80)

                // 进度圆环
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 80, height: 80)
                    .rotationEffect(.degrees(-90))

                // 数值
                VStack(spacing: 0) {
                    Text(String(format: "%.0f", value))
                        .font(.title3)
                        .fontWeight(.bold)

                    Text(unit)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 迷你指标视图

struct MiniMetricView: View {
    let icon: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundColor(color)

            Text(value)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1))
        .cornerRadius(8)
    }
}

// MARK: - 预览

#if DEBUG
struct MetricCardView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 16) {
            MetricCardView(
                title: "CPU",
                value: "45.2%",
                icon: "cpu",
                color: .blue,
                trend: .up(5.2)
            )

            LargeMetricCardView(
                title: "内存使用",
                value: "256",
                unit: "MB",
                icon: "memorychip",
                color: .green,
                progress: 0.6,
                maxValue: 500
            )

            CircularMetricCardView(
                title: "FPS",
                value: 58,
                maxValue: 60,
                unit: "FPS",
                color: .orange
            )
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }
}
#endif
