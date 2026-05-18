import SwiftUI
import CoreP2P

/// Phase 6.4 v0.2 — `AIExtendedView` Agents 子界面。
///
/// 4 method UI 覆盖：listAgents → list / 点击 = selectedAgent 详情 + run 输入框
/// + 运行按钮 → runAgent 返 RunAgentResponse → 显示 output / status / runId
/// + Stop 按钮 → stopAgent 清状态。
///
/// **明确简化**：streaming 输出（agent 持续吐 stdout）暂未支持 — runAgent 返
/// 完整 output 一次性显示。真 stream 需类似 chat 的 chunk 协议，留 v0.3。
struct AIExtendedAgentsView: View {
    @ObservedObject var viewModel: RemoteAIExtendedViewModel

    var body: some View {
        VStack(spacing: 0) {
            statusBanner
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    agentsSection
                    Divider()
                    runSection
                    if viewModel.agentRun != nil {
                        Divider()
                        runResultSection
                    }
                }
                .padding()
            }
        }
        .task {
            if viewModel.agents.isEmpty {
                await viewModel.loadAgents()
            }
        }
    }

    // MARK: - banner: list 可用性 + 刷新

    private var statusBanner: some View {
        HStack {
            Image(systemName: viewModel.agentsAvailable ? "checkmark.circle.fill" : "xmark.octagon.fill")
                .foregroundColor(viewModel.agentsAvailable ? .green : .red)
            Text(viewModel.agentsAvailable
                 ? "Agent manager 可用 · \(viewModel.agents.count) agents"
                 : "Agent manager 不可用（桌面无 agents 模块）")
                .font(.caption)
            Spacer()
            Button { Task { await viewModel.loadAgents() } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(viewModel.agentsLoading)
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(Color(.systemGray6))
    }

    // MARK: - agents list

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Agents").font(.headline)
            if viewModel.agentsLoading {
                ProgressView()
            } else if viewModel.agents.isEmpty {
                Text("无可用 agent")
                    .font(.caption).foregroundColor(.secondary)
            } else {
                ForEach(viewModel.agents, id: \.id) { agent in
                    agentRow(agent)
                }
            }
        }
    }

    private func agentRow(_ a: AgentInfo) -> some View {
        Button {
            viewModel.selectedAgent = a
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(a.name ?? a.id).font(.body).fontWeight(.medium)
                    if let desc = a.description {
                        Text(desc).font(.caption).foregroundColor(.secondary).lineLimit(2)
                    } else {
                        Text(a.id).font(.caption2).foregroundColor(.secondary)
                    }
                }
                Spacer()
                if viewModel.selectedAgent?.id == a.id {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(.blue)
                }
            }
            .padding(8)
            .background(
                viewModel.selectedAgent?.id == a.id
                ? Color.blue.opacity(0.08)
                : Color(.systemGray6)
            )
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    // MARK: - run section

    private var runSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("运行 Agent").font(.headline)
            if let a = viewModel.selectedAgent {
                Text("当前选中：\(a.name ?? a.id)").font(.caption).foregroundColor(.secondary)
            } else {
                Text("请先在上方选一个 agent").font(.caption).foregroundColor(.orange)
            }

            TextField("输入（agent 起始 prompt，可空）", text: $viewModel.agentInput, axis: .vertical)
                .lineLimit(3...6)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)

            Toggle(isOn: $viewModel.agentStreamEnabled) {
                Label("流式输出 (v0.3)", systemImage: "waveform.path.ecg")
                    .font(.caption)
            }
            .toggleStyle(.switch)
            .disabled(viewModel.agentRunning)

            HStack {
                Button {
                    Task { await viewModel.runSelectedAgent() }
                } label: {
                    if viewModel.agentRunning && !viewModel.agentStreamEnabled {
                        ProgressView()
                    } else {
                        Label("执行", systemImage: "play.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.agentRunning || viewModel.selectedAgent == nil)

                if viewModel.agentRun != nil
                    && (!viewModel.agentStreamEnabled || !viewModel.agentStreamComplete) {
                    Button {
                        Task { await viewModel.stopCurrentAgentRun() }
                    } label: {
                        Label("停止", systemImage: "stop.fill")
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }
        }
    }

    // MARK: - run result

    private var runResultSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("运行结果").font(.headline)
                if viewModel.agentStreamEnabled && !viewModel.agentStreamComplete
                    && viewModel.agentStreamId != nil {
                    // 流式进行中 — 闪烁点指示
                    HStack(spacing: 4) {
                        Circle().fill(Color.blue).frame(width: 8, height: 8)
                            .opacity(0.6)
                        Text("流式接收中…").font(.caption).foregroundColor(.blue)
                    }
                }
                Spacer()
            }
            if let run = viewModel.agentRun {
                HStack {
                    if let id = run.runId {
                        Text("Run ID: \(id)").font(.caption2).foregroundColor(.secondary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    Spacer()
                    Text(run.status)
                        .font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(statusColor(run.status).opacity(0.15))
                        .foregroundColor(statusColor(run.status))
                        .cornerRadius(4)
                }
                // v0.3 streaming: 优先显累积的 streamOutput；fallback 用 run.output
                let displayed: String = viewModel.agentStreamEnabled
                    ? viewModel.agentStreamOutput
                    : (run.output ?? "")
                if !displayed.isEmpty {
                    ScrollView {
                        Text(displayed)
                            .font(.system(.body, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 300)
                } else if viewModel.agentStreamEnabled && !viewModel.agentStreamComplete {
                    Text("等待第一个 chunk…").font(.caption).foregroundColor(.secondary)
                        .padding(.vertical, 8)
                } else {
                    Text("(无输出)").font(.caption).foregroundColor(.secondary)
                        .padding(.vertical, 8)
                }
                if let err = viewModel.agentStreamError {
                    Text("⚠️ \(err)")
                        .font(.caption).foregroundColor(.red)
                        .padding(.top, 4)
                }
            }
        }
    }

    private func statusColor(_ s: String) -> Color {
        switch s.lowercased() {
        case "running": return .blue
        case "complete", "completed", "succeeded": return .green
        case "failed", "error": return .red
        case "stopped", "cancelled": return .orange
        default: return .gray
        }
    }
}
