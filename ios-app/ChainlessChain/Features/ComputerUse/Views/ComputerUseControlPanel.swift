//
//  ComputerUseControlPanel.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Action buttons and controls
//

import SwiftUI

// MARK: - ComputerUseControlPanel

/// Control panel with action buttons, safe mode toggle, and metrics
struct ComputerUseControlPanel: View {
    @StateObject private var viewModel = ComputerUseViewModel.shared
    @State private var coordinateX: String = ""
    @State private var coordinateY: String = ""
    @State private var inputText: String = ""
    @State private var visualDescription: String = ""
    @State private var analysisPrompt: String = ""
    @State private var analysisResult: String = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Quick Actions
                quickActionsSection

                // Coordinate Actions
                coordinateSection

                // Text Input
                textInputSection

                // Vision Actions
                visionSection

                // Safety Settings
                safetySection

                // Metrics Summary
                metricsSection
            }
            .padding()
        }
    }

    // MARK: - Quick Actions

    private var quickActionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick Actions")
                .font(.headline)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                ActionButton(title: "Screenshot", icon: "camera.fill", color: .blue) {
                    Task { await viewModel.takeScreenshot() }
                }
                ActionButton(title: "Analyze", icon: "eye.fill", color: .purple) {
                    Task { await viewModel.analyzePage() }
                }
                ActionButton(title: "Device Info", icon: "iphone", color: .green) {
                    Task { await viewModel.executeAction(.deviceInfo) }
                }
                ActionButton(title: "Scroll Down", icon: "arrow.down", color: .orange) {
                    Task {
                        await viewModel.executeAction(.scroll,
                                                       params: ["x": .double(0), "y": .double(0),
                                                                "deltaX": .double(0), "deltaY": .double(300)])
                    }
                }
                ActionButton(title: "Scroll Up", icon: "arrow.up", color: .orange) {
                    Task {
                        await viewModel.executeAction(.scroll,
                                                       params: ["x": .double(0), "y": .double(0),
                                                                "deltaX": .double(0), "deltaY": .double(-300)])
                    }
                }
                ActionButton(title: "Haptic", icon: "hand.tap.fill", color: .pink) {
                    Task { await viewModel.executeAction(.haptic, params: ["type": .string("medium")]) }
                }
            }
        }
    }

    // MARK: - Coordinate Actions

    private var coordinateSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Coordinate Action")
                .font(.headline)

            HStack {
                TextField("X", text: $coordinateX)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)

                TextField("Y", text: $coordinateY)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)

                Button("Tap") {
                    guard let x = Double(coordinateX), let y = Double(coordinateY) else { return }
                    Task { await viewModel.tapAt(x: x, y: y) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(coordinateX.isEmpty || coordinateY.isEmpty)
            }
        }
    }

    // MARK: - Text Input

    private var textInputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Text Input")
                .font(.headline)

            HStack {
                TextField("Text to type", text: $inputText)
                    .textFieldStyle(.roundedBorder)

                Button("Type") {
                    Task {
                        await viewModel.executeAction(.type, params: ["text": .string(inputText)])
                        inputText = ""
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(inputText.isEmpty)
            }

            // Common keys
            HStack(spacing: 8) {
                ForEach(["Enter", "Tab", "Escape", "Backspace"], id: \.self) { key in
                    Button(key) {
                        Task { await viewModel.executeAction(.key, params: ["key": .string(key)]) }
                    }
                    .buttonStyle(.bordered)
                    .font(.caption)
                }
            }
        }
    }

    // MARK: - Vision Actions

    private var visionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vision AI")
                .font(.headline)

            // Visual click
            HStack {
                TextField("Describe element to click", text: $visualDescription)
                    .textFieldStyle(.roundedBorder)

                Button("Visual Tap") {
                    Task { await viewModel.visualTap(description: visualDescription) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(visualDescription.isEmpty)
            }

            // Analysis
            HStack {
                TextField("Analysis prompt (optional)", text: $analysisPrompt)
                    .textFieldStyle(.roundedBorder)

                Button("Analyze") {
                    Task {
                        let result = await viewModel.analyzePage(prompt: analysisPrompt.isEmpty ? nil : analysisPrompt)
                        analysisResult = result ?? "No result"
                    }
                }
                .buttonStyle(.bordered)
            }

            if !analysisResult.isEmpty {
                Text(analysisResult)
                    .font(.caption)
                    .padding(8)
                    .background(Color(UIColor.tertiarySystemBackground))
                    .cornerRadius(8)
                    .frame(maxHeight: 150)
            }
        }
    }

    // MARK: - Safety Settings

    private var safetySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Safety")
                .font(.headline)

            Picker("Level", selection: $viewModel.safetyLevel) {
                ForEach(CUSafetyLevel.allCases, id: \.rawValue) { level in
                    Text(level.displayName).tag(level)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: viewModel.safetyLevel) { newLevel in
                viewModel.setSafetyLevel(newLevel)
            }
        }
    }

    // MARK: - Metrics

    private var metricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Metrics")
                .font(.headline)

            HStack {
                MetricCard(title: "Operations", value: "\(viewModel.totalOperations)", color: .blue)
                MetricCard(title: "Success", value: String(format: "%.0f%%", viewModel.successRate), color: .green)
            }

            // Last result
            if let result = viewModel.lastResult {
                HStack {
                    Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundColor(result.success ? .green : .red)
                    Text(result.action.displayName)
                        .font(.caption)
                    Spacer()
                    Text(String(format: "%.0fms", result.duration))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(8)
                .background(Color(UIColor.tertiarySystemBackground))
                .cornerRadius(6)
            }
        }
    }
}

// MARK: - Action Button

private struct ActionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.title3)
                Text(title)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(color.opacity(0.1))
            .foregroundColor(color)
            .cornerRadius(8)
        }
    }
}

// MARK: - Metric Card

private struct MetricCard: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(color)
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color(UIColor.tertiarySystemBackground))
        .cornerRadius(8)
    }
}

// MARK: - Preview

struct ComputerUseControlPanel_Previews: PreviewProvider {
    static var previews: some View {
        ComputerUseControlPanel()
    }
}
