//
//  PriceHistoryChartView.swift
//  ChainlessChain
//
//  价格历史图表视图
//  显示NFT/Token价格趋势
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 价格历史图表视图
struct PriceHistoryChartView: View {
    let data: [PriceDataPoint]
    let title: String
    var showLegend: Bool = true

    @State private var selectedTimeRange: ChartTimeRange = .week
    @State private var selectedPoint: PriceDataPoint?
    @State private var highlightPosition: CGFloat = 0

    private var filteredData: [PriceDataPoint] {
        let cutoffDate: Date
        switch selectedTimeRange {
        case .day:
            cutoffDate = Date().addingTimeInterval(-86400)
        case .week:
            cutoffDate = Date().addingTimeInterval(-7 * 86400)
        case .month:
            cutoffDate = Date().addingTimeInterval(-30 * 86400)
        case .year:
            cutoffDate = Date().addingTimeInterval(-365 * 86400)
        case .all:
            return data
        }
        return data.filter { $0.date >= cutoffDate }
    }

    private var priceChange: Double {
        guard let first = filteredData.first?.price,
              let last = filteredData.last?.price,
              first > 0 else {
            return 0
        }
        return ((last - first) / first) * 100
    }

    private var minPrice: Double {
        filteredData.map { $0.price }.min() ?? 0
    }

    private var maxPrice: Double {
        filteredData.map { $0.price }.max() ?? 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 标题和统计
            headerView

            // 时间范围选择器
            timeRangePicker

            // 图表
            chartView
                .frame(height: 200)

            // 图例
            if showLegend {
                legendView
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 头部视图

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)

                if let currentPrice = filteredData.last?.price {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(formatPrice(currentPrice))
                            .font(.title2)
                            .fontWeight(.bold)

                        HStack(spacing: 2) {
                            Image(systemName: priceChange >= 0 ? "arrow.up" : "arrow.down")
                                .font(.caption)

                            Text(String(format: "%.2f%%", abs(priceChange)))
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        .foregroundColor(priceChange >= 0 ? .green : .red)
                    }
                }
            }

            Spacer()

            // 选中点信息
            if let point = selectedPoint {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(formatPrice(point.price))
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    Text(formatDate(point.date))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    // MARK: - 时间范围选择器

    private var timeRangePicker: some View {
        HStack(spacing: 4) {
            ForEach(ChartTimeRange.allCases, id: \.self) { range in
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedTimeRange = range
                        selectedPoint = nil
                    }
                }) {
                    Text(range.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(selectedTimeRange == range ?
                                    Color.blue : Color.gray.opacity(0.1))
                        .foregroundColor(selectedTimeRange == range ?
                                          .white : .primary)
                        .cornerRadius(8)
                }
            }
        }
    }

    // MARK: - 图表视图

    private var chartView: some View {
        GeometryReader { geometry in
            ZStack {
                // 背景网格
                gridLines(in: geometry.size)

                // 价格曲线
                if !filteredData.isEmpty {
                    // 填充区域
                    areaPath(in: geometry.size)
                        .fill(
                            LinearGradient(
                                colors: [
                                    (priceChange >= 0 ? Color.green : Color.red).opacity(0.3),
                                    (priceChange >= 0 ? Color.green : Color.red).opacity(0.05)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )

                    // 曲线
                    linePath(in: geometry.size)
                        .stroke(
                            priceChange >= 0 ? Color.green : Color.red,
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
                        )

                    // 选中点指示器
                    if let point = selectedPoint,
                       let index = filteredData.firstIndex(where: { $0.id == point.id }) {
                        let x = xPosition(for: index, in: geometry.size)
                        let y = yPosition(for: point.price, in: geometry.size)

                        Circle()
                            .fill(Color.white)
                            .frame(width: 10, height: 10)
                            .overlay(
                                Circle()
                                    .stroke(priceChange >= 0 ? Color.green : Color.red, lineWidth: 2)
                            )
                            .position(x: x, y: y)

                        // 垂直线
                        Path { path in
                            path.move(to: CGPoint(x: x, y: 0))
                            path.addLine(to: CGPoint(x: x, y: geometry.size.height))
                        }
                        .stroke(Color.gray.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4]))
                    }
                } else {
                    Text("暂无数据")
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        updateSelectedPoint(at: value.location, in: geometry.size)
                    }
                    .onEnded { _ in
                        // 可选：结束时清除选中点
                        // selectedPoint = nil
                    }
            )
        }
    }

    // MARK: - 网格线

    private func gridLines(in size: CGSize) -> some View {
        ZStack {
            // 水平线
            ForEach(0..<5) { i in
                Path { path in
                    let y = size.height * CGFloat(i) / 4
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                }
                .stroke(Color.gray.opacity(0.1), lineWidth: 1)
            }
        }
    }

    // MARK: - 线路径

    private func linePath(in size: CGSize) -> Path {
        Path { path in
            guard filteredData.count > 1 else { return }

            let points = filteredData.enumerated().map { index, point in
                CGPoint(
                    x: xPosition(for: index, in: size),
                    y: yPosition(for: point.price, in: size)
                )
            }

            path.move(to: points[0])

            for i in 1..<points.count {
                // 使用贝塞尔曲线平滑
                let previousPoint = points[i - 1]
                let currentPoint = points[i]

                let midX = (previousPoint.x + currentPoint.x) / 2
                path.addCurve(
                    to: currentPoint,
                    control1: CGPoint(x: midX, y: previousPoint.y),
                    control2: CGPoint(x: midX, y: currentPoint.y)
                )
            }
        }
    }

    // MARK: - 填充区域路径

    private func areaPath(in size: CGSize) -> Path {
        Path { path in
            guard filteredData.count > 1 else { return }

            let points = filteredData.enumerated().map { index, point in
                CGPoint(
                    x: xPosition(for: index, in: size),
                    y: yPosition(for: point.price, in: size)
                )
            }

            path.move(to: CGPoint(x: 0, y: size.height))
            path.addLine(to: points[0])

            for i in 1..<points.count {
                let previousPoint = points[i - 1]
                let currentPoint = points[i]

                let midX = (previousPoint.x + currentPoint.x) / 2
                path.addCurve(
                    to: currentPoint,
                    control1: CGPoint(x: midX, y: previousPoint.y),
                    control2: CGPoint(x: midX, y: currentPoint.y)
                )
            }

            path.addLine(to: CGPoint(x: size.width, y: size.height))
            path.closeSubpath()
        }
    }

    // MARK: - 图例视图

    private var legendView: some View {
        HStack {
            // 最低价
            VStack(alignment: .leading, spacing: 2) {
                Text("最低")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Text(formatPrice(minPrice))
                    .font(.caption)
                    .fontWeight(.medium)
            }

            Spacer()

            // 最高价
            VStack(alignment: .trailing, spacing: 2) {
                Text("最高")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Text(formatPrice(maxPrice))
                    .font(.caption)
                    .fontWeight(.medium)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - 辅助方法

    private func xPosition(for index: Int, in size: CGSize) -> CGFloat {
        guard filteredData.count > 1 else { return size.width / 2 }
        return size.width * CGFloat(index) / CGFloat(filteredData.count - 1)
    }

    private func yPosition(for price: Double, in size: CGSize) -> CGFloat {
        let range = maxPrice - minPrice
        guard range > 0 else { return size.height / 2 }

        let normalizedPrice = (price - minPrice) / range
        return size.height * (1 - CGFloat(normalizedPrice))
    }

    private func updateSelectedPoint(at location: CGPoint, in size: CGSize) {
        guard !filteredData.isEmpty else { return }

        let stepWidth = size.width / CGFloat(max(filteredData.count - 1, 1))
        let index = Int((location.x / stepWidth).rounded())
        let clampedIndex = max(0, min(index, filteredData.count - 1))

        selectedPoint = filteredData[clampedIndex]
    }

    private func formatPrice(_ price: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 4
        formatter.minimumFractionDigits = 2
        return (formatter.string(from: NSNumber(value: price)) ?? "0") + " ETH"
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        switch selectedTimeRange {
        case .day:
            formatter.dateFormat = "HH:mm"
        case .week, .month:
            formatter.dateFormat = "MM/dd"
        case .year, .all:
            formatter.dateFormat = "yyyy/MM"
        }
        return formatter.string(from: date)
    }
}

// MARK: - 时间范围枚举

enum ChartTimeRange: CaseIterable {
    case day
    case week
    case month
    case year
    case all

    var displayName: String {
        switch self {
        case .day: return "1天"
        case .week: return "7天"
        case .month: return "30天"
        case .year: return "1年"
        case .all: return "全部"
        }
    }
}

// MARK: - 迷你价格图表（用于列表）

struct MiniPriceChart: View {
    let data: [Double]
    let isPositive: Bool

    var body: some View {
        GeometryReader { geometry in
            if data.count > 1 {
                let minValue = data.min() ?? 0
                let maxValue = data.max() ?? 1
                let range = maxValue - minValue

                Path { path in
                    for (index, value) in data.enumerated() {
                        let x = geometry.size.width * CGFloat(index) / CGFloat(data.count - 1)
                        let normalizedY = range > 0 ? (value - minValue) / range : 0.5
                        let y = geometry.size.height * (1 - CGFloat(normalizedY))

                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(
                    isPositive ? Color.green : Color.red,
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round)
                )
            }
        }
    }
}

// MARK: - 烛台图（可选高级功能）

struct CandlestickData: Identifiable {
    let id = UUID()
    let date: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double

    var isPositive: Bool {
        close >= open
    }
}

struct CandlestickChartView: View {
    let data: [CandlestickData]

    private var minPrice: Double {
        data.map { $0.low }.min() ?? 0
    }

    private var maxPrice: Double {
        data.map { $0.high }.max() ?? 1
    }

    var body: some View {
        GeometryReader { geometry in
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(data) { candle in
                    candleView(for: candle, in: geometry.size)
                }
            }
        }
    }

    private func candleView(for candle: CandlestickData, in size: CGSize) -> some View {
        let range = maxPrice - minPrice
        let candleWidth: CGFloat = max(4, (size.width / CGFloat(data.count)) - 2)

        return GeometryReader { geo in
            ZStack {
                // 影线
                Path { path in
                    let highY = size.height * (1 - CGFloat((candle.high - minPrice) / range))
                    let lowY = size.height * (1 - CGFloat((candle.low - minPrice) / range))

                    path.move(to: CGPoint(x: geo.size.width / 2, y: highY))
                    path.addLine(to: CGPoint(x: geo.size.width / 2, y: lowY))
                }
                .stroke(candle.isPositive ? Color.green : Color.red, lineWidth: 1)

                // 实体
                let openY = size.height * (1 - CGFloat((candle.open - minPrice) / range))
                let closeY = size.height * (1 - CGFloat((candle.close - minPrice) / range))
                let bodyTop = min(openY, closeY)
                let bodyHeight = max(abs(closeY - openY), 1)

                Rectangle()
                    .fill(candle.isPositive ? Color.green : Color.red)
                    .frame(width: candleWidth, height: bodyHeight)
                    .position(x: geo.size.width / 2, y: bodyTop + bodyHeight / 2)
            }
        }
        .frame(width: candleWidth)
    }
}

// MARK: - 预览

#if DEBUG
struct PriceHistoryChartView_Previews: PreviewProvider {
    static var sampleData: [PriceDataPoint] {
        (0..<30).map { day in
            PriceDataPoint(
                date: Date().addingTimeInterval(TimeInterval(-day * 86400)),
                price: Double.random(in: 1...10)
            )
        }.reversed()
    }

    static var previews: some View {
        VStack {
            PriceHistoryChartView(
                data: sampleData,
                title: "地板价历史"
            )

            MiniPriceChart(
                data: [1.0, 1.2, 1.1, 1.5, 1.3, 1.8, 2.0],
                isPositive: true
            )
            .frame(width: 80, height: 30)
            .padding()
        }
        .padding()
    }
}
#endif
