//
//  ComputerUseView.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Main container view with TabView
//

import SwiftUI

// MARK: - ComputerUseView

/// Main Computer Use container with tabs
public struct ComputerUseView: View {
    @StateObject private var viewModel = ComputerUseViewModel.shared
    @State private var selectedTab = 0

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Tab Picker
                Picker("", selection: $selectedTab) {
                    Text("Browser").tag(0)
                    Text("Controls").tag(1)
                    Text("Audit").tag(2)
                    Text("Recordings").tag(3)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                // Tab Content
                TabView(selection: $selectedTab) {
                    // Browser Tab
                    ComputerUseBrowserView()
                        .tag(0)

                    // Control Panel Tab
                    ComputerUseControlPanel()
                        .tag(1)

                    // Audit Log Tab
                    AuditLogView()
                        .tag(2)

                    // Recordings Tab
                    RecordingListView()
                        .tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Bottom Status Bar
                statusBar
            }
            .navigationTitle("Computer Use")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { viewModel.toggleRecording() }) {
                            Label(
                                viewModel.isRecording ? "Stop Recording" : "Start Recording",
                                systemImage: viewModel.isRecording ? "stop.circle" : "record.circle"
                            )
                        }

                        Divider()

                        Menu("Safety Level") {
                            ForEach(CUSafetyLevel.allCases, id: \.rawValue) { level in
                                Button(action: { viewModel.setSafetyLevel(level) }) {
                                    HStack {
                                        Text(level.displayName)
                                        if level == viewModel.safetyLevel {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        }

                        Divider()

                        NavigationLink(destination: WorkflowEditorView()) {
                            Label("Workflows", systemImage: "list.bullet.rectangle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task {
                if !viewModel.isInitialized {
                    viewModel.initialize()
                }
            }
            .alert("Error", isPresented: $viewModel.showingError) {
                Button("OK") { viewModel.showingError = false }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
        }
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack {
            // Operation count
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill")
                    .font(.caption2)
                Text("\(viewModel.totalOperations)")
                    .font(.caption)
            }
            .foregroundColor(.secondary)

            Spacer()

            // Success rate
            HStack(spacing: 4) {
                Circle()
                    .fill(viewModel.successRate > 90 ? Color.green :
                            viewModel.successRate > 70 ? Color.orange : Color.red)
                    .frame(width: 6, height: 6)
                Text(String(format: "%.0f%%", viewModel.successRate))
                    .font(.caption)
            }
            .foregroundColor(.secondary)

            Spacer()

            // Safety level
            Text(viewModel.safetyLevel.displayName)
                .font(.caption)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.blue.opacity(0.1))
                .cornerRadius(4)

            Spacer()

            // Recording indicator
            if viewModel.isRecording {
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 6, height: 6)
                    Text("REC")
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(Color(UIColor.secondarySystemBackground))
    }
}

// MARK: - Preview

struct ComputerUseView_Previews: PreviewProvider {
    static var previews: some View {
        ComputerUseView()
    }
}
