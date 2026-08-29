import Foundation

/// Process-local compare-and-set guard for one Remote Session approval card.
///
/// The CLI remains the durable HumanTask authority. This registry prevents an
/// iOS transport card from sending duplicate or conflicting responses and rolls
/// a failed transport reservation back to a retryable pending state.
final class RemoteApprovalSettlementRegistry {
    enum Status: Equatable {
        case pending
        case responding
        case interrupting
    }

    private let lock = NSLock()
    private let maxResolvedIds: Int
    private var approvals: [String: Status] = [:]
    private var resolvedIds: Set<String> = []
    private var resolvedOrder: [String] = []

    init(maxResolvedIds: Int = 1_024) {
        self.maxResolvedIds = max(1, maxResolvedIds)
    }

    @discardableResult
    func open(_ requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let id = normalize(requestId), approvals[id] == nil, !resolvedIds.contains(id) else {
            return false
        }
        approvals[id] = .pending
        return true
    }

    func beginDecision(_ requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let id = normalize(requestId), approvals[id] == .pending else { return false }
        approvals[id] = .responding
        return true
    }

    func beginInterrupt() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        let pending = approvals.compactMap { key, value in value == .pending ? key : nil }
        for id in pending {
            approvals[id] = .interrupting
        }
        return pending
    }

    @discardableResult
    func complete(_ requestId: String, reservation: Status, accepted: Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard reservation != .pending,
              let id = normalize(requestId),
              approvals[id] == reservation
        else { return false }
        if !accepted {
            approvals[id] = .pending
        } else if reservation == .interrupting {
            approvals.removeValue(forKey: id)
            rememberResolved(id)
        }
        return true
    }

    @discardableResult
    func resolve(_ requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let id = normalize(requestId) else { return false }
        let removed = approvals.removeValue(forKey: id) != nil
        rememberResolved(id)
        return removed
    }

    func invalidateAll() {
        lock.lock()
        defer { lock.unlock() }
        approvals.removeAll()
        resolvedIds.removeAll()
        resolvedOrder.removeAll()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return approvals.count
    }

    func status(of requestId: String) -> Status? {
        lock.lock()
        defer { lock.unlock() }
        guard let id = normalize(requestId) else { return nil }
        return approvals[id]
    }

    private func rememberResolved(_ requestId: String) {
        if resolvedIds.insert(requestId).inserted {
            resolvedOrder.append(requestId)
        }
        while resolvedOrder.count > maxResolvedIds {
            let evicted = resolvedOrder.removeFirst()
            resolvedIds.remove(evicted)
        }
    }

    private func normalize(_ requestId: String) -> String? {
        let id = requestId.trimmingCharacters(in: .whitespacesAndNewlines)
        return id.isEmpty ? nil : id
    }
}
