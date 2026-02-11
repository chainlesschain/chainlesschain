//
//  PerformanceChartView.swift
//  ChainlessChain
//
//  性能图表视图
//  显示性能指标的时序图
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 性能图表视图
struct PerformanceChartView: View {
    let title: String
    let data: [Double]
    let color: Color
    var unit: String = ""
    var maxValue: Double?
    var showStats: Bool = true

    // 计算的统计值
    private var stats: ChartStats {
        guard !data.isEmpty else {
            return ChartStats(current: 0, min: 0, max: 0, avg: 0)
        }

        let current = data.last ?? 0
        let minValue = data.min() ?? 0
        let maxValue = data.max() ?? 0
        let avgValue = data.reduce(0, +) / Double(data.count)

        return ChartStats(
            current: current,
            min: minValue,
            max: maxValue,
            avg: avgValue
        )
    }

    private var chartMaxValue: Double {
        if let max = maxValue {
            return max
        }
        return (stats.max * 1.2).rounded(.up)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 标题和当前值
            HStack {
                Text(title)
                    .font(.headline)

                Spacer()

                Text(String(format: "%.1f\(unit)", stats.current))
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(color)
            }

            // 图表
            if data.isEmpty {
                emptyChart
            } else {
                chartContent
            }

            // 统计信息
            if showStats && !data.isEmpty {
                statsBar
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 空图表

    private var emptyChart: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.gray.opacity(0.1))
                .frame(height: 120)

            Text("暂无数据")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - 图表内容

    private var chartContent: some View {
        GeometryReader { geometry in
            ZStack {
                // 背景网格
                gridLines(in: geometry.size)

                // 折线图
                lineChart(in: geometry.size)

                // 区域填充
                areaFill(in: geometry.size)
            }
        }
        .frame(height: 120)
    }

    // MARK: - 网格线

    private func gridLines(in size: CGSize) -> some View {
        let lineCount = 4

        return ZStack {
            // 水平线
            ForEach(0..<lineCount, id: \.self) { i in
                let y = size.height * Double(i) / Double(lineCount - 1)
                Path { path in
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                }
                .stroke(Color.gray.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [4]))
            }
        }
    }

    // MARK: - 折线图

    private func lineChart(in size: CGSize) -> some View {
        Path { path in
            guard data.count >= 2 else { return }

            let stepX = size.width / Double(data.count - 1)

            for (index, value) in data.enumerated() {
                let x = Double(index) * stepX
                let y = size.height - (value / chartMaxValue) * size.height

                if index == 0 {
                    path.move(to: CGPoint(x: x, y: y))
                } else {
                    path.addLine(to: CGPoint(x: x, y: y))
                }
            }
        }
        .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }

    // MARK: - 区域填充

    private func areaFill(in size: CGSize) -> some View {
        Path { path in
            guard data.count >= 2 else { return }

            let stepX = size.width / Double(data.count - 1)

            // 起点
            path.move(to: CGPoint(x: 0, y: size.height))

            // 数据点
            for (index, value) in data.enumerated() {
                let x = Double(index) * stepX
                let y = size.height - (value / chartMaxValue) * size.height
                path.addLine(to: CGPoint(x: x, y: y))
            }

            // 封闭路径
            path.addLine(to: CGPoint(x: size.width, y: size.height))
            path.closeSubpath()
        }
        .fill(
            LinearGradient(
                gradient: Gradient(colors: [color.opacity(0.3), color.opacity(0.05)]),
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    // MARK: - 统计栏

    private var statsBar: some View {
        HStack(spacing: 16) {
            StatItem(label: "最小", value: stats.min, unit: unit, color: .green)
            StatItem(label: "平均", value: stats.avg, unit: unit, color: .blue)
            StatItem(label: "最大", value: stats.max, unit: unit, color: .red)
        }
    }
}

// MARK: - 图表统计

private struct ChartStats {
    let current: Double
    let min: Double
    let max: Double
    let avg: Double
}

// MARK: - 统计项

private struct StatItem: View {
    let label: String
    let value: Double
    let unit: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)

            Text(String(format: "%.1f\(unit)", value))
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 实时图表视图

struct RealtimeChartView: View {
    @Binding var data: [Double]
    let maxPoints: Int
    let color: Color
    var unit: String = ""
    var maxValue: Double?

    private var chartMaxValue: Double {
        if let max = maxValue {
            return max
        }
        return ((data.max() ?? 0) * 1.2).rounded(.up)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // 折线
                Path { path in
                    guard data.count >= 2 else { return }

                    let stepX = geometry.size.width / Double(maxPoints - 1)

                    for (index, value) in data.suffix(maxPoints).enumerated() {
                        let x = Double(index) * stepX
                        let y = geometry.size.height - (value / chartMaxValue) * geometry.size.height

                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round))

                // 当前值指示点
                if let lastValue = data.last {
                    let x = geometry.size.width
                    let y = geometry.size.height - (lastValue / chartMaxValue) * geometry.size.height

                    Circle()
                        .fill(color)
                        .frame(width: 8, height: 8)
                        .position(x: x, y: y)
                }
            }
        }
    }
}

// MARK: - 对比图表视图

struct ComparisonChartView: View {
    let title: String
    let datasets: [(name: String, data: [Double], color: Color)]
    var unit: String = ""

    private var maxValue: Double {
        let allValues = datasets.flatMap { $0.data }
        return ((allValues.max() ?? 0) * 1.2).rounded(.up)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 标题
            Text(title)
                .font(.headline)

            // 图例
            HStack(spacing: 16) {
                ForEach(datasets.indices, id: \.self) { index in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(datasets[index].color)
                            .frame(width: 8, height: 8)

                        Text(datasets[index].name)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // 图表
            GeometryReader { geometry in
                ZStack {
                    // 每个数据集的折线
                    ForEach(datasets.indices, id: \.self) { datasetIndex in
                        let dataset = datasets[datasetIndex]

                        Path { path in
                            guard dataset.data.count >= 2 else { return }

                            let stepX = geometry.size.width / Double(dataset.data.count - 1)

                            for (index, value) in dataset.data.enumerated() {
                                let x = Double(index) * stepX
                                let y = geometry.size.height - (value / maxValue) * geometry.size.height

                                if index == 0 {
                                    path.move(to: CGPoint(x: x, y: y))
                                } else {
                                    path.addLine(to: CGPoint(x: x, y: y))
                                }
                            }
                        }
                        .stroke(dataset.color, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    }
                }
            }
            .frame(height: 120)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }
}

// MARK: - 预览

#if DEBUG
struct PerformanceChartView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 16) {
            PerformanceChartView(
                title: "CPU使用率",
                data: [30, 45, 50, 35, 60, 55, 40, 45, 50, 55],
                color: .blue,
                unit: "%",
                maxValue: 100
            )

            ComparisonChartView(
                title: "内存对比",
                datasets: [
                    ("使用中", [100, 120, 150, 140, 160, 155], .blue),
                    ("缓存", [50, 60, 55, 65, 70, 60], .green)
                ],
                unit: "MB"
            )
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }
}
#endif
