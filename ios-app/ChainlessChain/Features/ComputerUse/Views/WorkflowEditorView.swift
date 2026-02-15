//
//  WorkflowEditorView.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Workflow creation and management
//

import SwiftUI

// MARK: - WorkflowEditorView

/// View for creating, editing, and running workflows
struct WorkflowEditorView: View {
    @StateObject private var engine = ComputerUseWorkflowEngine.shared
    @StateObject private var viewModel = ComputerUseViewModel.shared
    @State private var showingNewWorkflow = false
    @State private var editingWorkflow: CUWorkflow?
    @State private var newWorkflowName: String = ""
    @State private var newWorkflowDescription: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Workflow execution status
            if engine.state == .running || engine.state == .paused {
                executionStatusBar
            }

            if engine.workflows.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(engine.workflows) { workflow in
                        WorkflowRow(
                            workflow: workflow,
                            isRunning: engine.state == .running,
                            onRun: { runWorkflow(workflow) },
                            onEdit: { editingWorkflow = workflow },
                            onDelete: { engine.deleteWorkflow(id: workflow.id) }
                        )
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Workflows")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: { showingNewWorkflow = true }) {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewWorkflow) {
            newWorkflowSheet
        }
        .sheet(item: $editingWorkflow) { workflow in
            workflowDetailSheet(workflow)
        }
    }

    // MARK: - Execution Status

    private var executionStatusBar: some View {
        VStack(spacing: 4) {
            ProgressView(value: engine.progress, total: 100)
                .progressViewStyle(.linear)

            HStack {
                Circle()
                    .fill(engine.state == .running ? Color.green : Color.orange)
                    .frame(width: 6, height: 6)

                Text(engine.state == .running ? "Running" : "Paused")
                    .font(.caption)

                Text("Step \(engine.currentStepIndex + 1)/\(engine.totalSteps)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                HStack(spacing: 12) {
                    if engine.state == .running {
                        Button("Pause") { engine.pause() }
                            .font(.caption)
                    }
                    if engine.state == .paused {
                        Button("Resume") { engine.resume() }
                            .font(.caption)
                    }
                    Button("Cancel") { engine.cancel() }
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "list.bullet.rectangle")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Workflows")
                .font(.headline)
                .foregroundColor(.secondary)
            Text("Create a workflow to automate browser actions")
                .font(.caption)
                .foregroundColor(.secondary)
            Button("Create Workflow") {
                showingNewWorkflow = true
            }
            .buttonStyle(.borderedProminent)
            Spacer()
        }
    }

    // MARK: - New Workflow Sheet

    private var newWorkflowSheet: some View {
        NavigationView {
            Form {
                Section("Workflow Info") {
                    TextField("Name", text: $newWorkflowName)
                    TextField("Description", text: $newWorkflowDescription, axis: .vertical)
                        .lineLimit(3)
                }

                Section("Quick Templates") {
                    Button("Navigate + Screenshot") {
                        createWorkflow(steps: [
                            CUWorkflowStep(type: .action, label: "Navigate", config: [
                                "action": .string("navigate"),
                                "params": .dictionary(["url": .string("https://example.com")])
                            ]),
                            CUWorkflowStep(type: .wait, label: "Wait", config: [
                                "duration": .double(2000)
                            ]),
                            CUWorkflowStep(type: .action, label: "Screenshot", config: [
                                "action": .string("screenshot"),
                                "params": .dictionary([:])
                            ])
                        ])
                    }

                    Button("Scroll + Analyze") {
                        createWorkflow(steps: [
                            CUWorkflowStep(type: .action, label: "Scroll Down", config: [
                                "action": .string("scroll"),
                                "params": .dictionary(["deltaY": .double(300)])
                            ]),
                            CUWorkflowStep(type: .wait, label: "Wait", config: [
                                "duration": .double(1000)
                            ]),
                            CUWorkflowStep(type: .action, label: "Analyze", config: [
                                "action": .string("vision_analyze"),
                                "params": .dictionary([:])
                            ])
                        ])
                    }
                }
            }
            .navigationTitle("New Workflow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingNewWorkflow = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        createWorkflow(steps: [])
                    }
                    .disabled(newWorkflowName.isEmpty)
                }
            }
        }
    }

    // MARK: - Workflow Detail

    private func workflowDetailSheet(_ workflow: CUWorkflow) -> some View {
        NavigationView {
            List {
                Section("Info") {
                    LabeledContent("Name", value: workflow.name)
                    LabeledContent("Steps", value: "\(workflow.steps.count)")
                    LabeledContent("Created", value: formatDate(workflow.createdAt))
                }

                Section("Steps") {
                    ForEach(Array(workflow.steps.enumerated()), id: \.element.id) { index, step in
                        HStack {
                            Text("\(index + 1)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(width: 24)

                            VStack(alignment: .leading) {
                                Text(step.label ?? step.type.rawValue)
                                    .font(.subheadline)
                                Text(step.type.rawValue)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle(workflow.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { editingWorkflow = nil }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Run") {
                        editingWorkflow = nil
                        runWorkflow(workflow)
                    }
                    .disabled(engine.state == .running)
                }
            }
        }
    }

    // MARK: - Actions

    private func createWorkflow(steps: [CUWorkflowStep]) {
        let workflow = CUWorkflow(
            name: newWorkflowName.isEmpty ? "Untitled" : newWorkflowName,
            description: newWorkflowDescription,
            steps: steps
        )
        engine.saveWorkflow(workflow)
        newWorkflowName = ""
        newWorkflowDescription = ""
        showingNewWorkflow = false
    }

    private func runWorkflow(_ workflow: CUWorkflow) {
        guard let webView = viewModel.webView else { return }
        Task {
            try? await engine.run(
                workflow: workflow,
                webView: webView,
                agent: ComputerUseAgent.shared
            )
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Workflow Row

private struct WorkflowRow: View {
    let workflow: CUWorkflow
    let isRunning: Bool
    let onRun: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(workflow.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack(spacing: 8) {
                    Label("\(workflow.steps.count) steps", systemImage: "list.number")
                    if !workflow.description.isEmpty {
                        Text(workflow.description)
                            .lineLimit(1)
                    }
                }
                .font(.caption2)
                .foregroundColor(.secondary)
            }

            Spacer()

            HStack(spacing: 8) {
                Button(action: onRun) {
                    Image(systemName: "play.fill")
                        .foregroundColor(.green)
                }
                .disabled(isRunning)

                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .foregroundColor(.blue)
                }

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

struct WorkflowEditorView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            WorkflowEditorView()
        }
    }
}
