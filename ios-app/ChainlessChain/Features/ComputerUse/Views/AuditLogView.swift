//
//  AuditLogView.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Audit log viewer with filtering
//

import SwiftUI

// MARK: - AuditLogView

/// Displays audit log entries with filtering by risk level and action type
struct AuditLogView: View {
    @StateObject private var auditLogger = CUAuditLogger.shared
    @State private var selectedRisk: CURiskLevel?
    @State private var searchText: String = ""

    private var filteredEntries: [CUAuditEntry] {
        var entries = auditLogger.entries.reversed() as [CUAuditEntry]

        if let risk = selectedRisk {
            entries = entries.filter { $0.riskLevel == risk }
        }

        if !searchText.isEmpty {
            entries = entries.filter {
                $0.action.rawValue.localizedCaseInsensitiveContains(searchText) ||
                $0.action.displayName.localizedCaseInsensitiveContains(searchText) ||
                ($0.error ?? "").localizedCaseInsensitiveContains(searchText)
            }
        }

        return Array(entries.prefix(200))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Filters
            VStack(spacing: 8) {
                // Search
                TextField("Search actions...", text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)

                // Risk level filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(title: "All", isSelected: selectedRisk == nil) {
                            selectedRisk = nil
                        }
                        ForEach(CURiskLevel.allCases, id: \.rawValue) { risk in
                            FilterChip(
                                title: risk.displayName,
                                isSelected: selectedRisk == risk,
                                color: colorForRisk(risk)
                            ) {
                                selectedRisk = selectedRisk == risk ? nil : risk
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical, 8)

            // Entries count
            HStack {
                Text("\(filteredEntries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Clear") {
                    auditLogger.clear()
                }
                .font(.caption)
                .foregroundColor(.red)
            }
            .padding(.horizontal)
            .padding(.bottom, 4)

            // Entry list
            List(filteredEntries) { entry in
                AuditEntryRow(entry: entry)
            }
            .listStyle(.plain)
        }
    }

    private func colorForRisk(_ risk: CURiskLevel) -> Color {
        switch risk {
        case .low: return .green
        case .medium: return .yellow
        case .high: return .orange
        case .critical: return .red
        }
    }
}

// MARK: - Audit Entry Row

private struct AuditEntryRow: View {
    let entry: CUAuditEntry

    private var timeString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: entry.timestamp)
    }

    var body: some View {
        HStack(spacing: 8) {
            // Risk indicator
            Circle()
                .fill(riskColor)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(entry.action.displayName)
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Spacer()

                    Text(timeString)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                HStack(spacing: 4) {
                    // Success/failure
                    Image(systemName: entry.success ? "checkmark.circle" : "xmark.circle")
                        .font(.caption2)
                        .foregroundColor(entry.success ? .green : .red)

                    // Duration
                    Text(String(format: "%.0fms", entry.duration))
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    // Risk badge
                    Text(entry.riskLevel.rawValue)
                        .font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(riskColor.opacity(0.2))
                        .foregroundColor(riskColor)
                        .cornerRadius(3)
                }

                // Error message if present
                if let error = entry.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundColor(.red)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var riskColor: Color {
        switch entry.riskLevel {
        case .low: return .green
        case .medium: return .yellow
        case .high: return .orange
        case .critical: return .red
        }
    }
}

// MARK: - Filter Chip

private struct FilterChip: View {
    let title: String
    let isSelected: Bool
    var color: Color = .blue
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(isSelected ? color.opacity(0.2) : Color(UIColor.tertiarySystemBackground))
                .foregroundColor(isSelected ? color : .secondary)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(isSelected ? color : Color.clear, lineWidth: 1)
                )
        }
    }
}

// MARK: - Preview

struct AuditLogView_Previews: PreviewProvider {
    static var previews: some View {
        AuditLogView()
    }
}
