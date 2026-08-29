package com.chainlesschain.android.core.agentprotocol

/**
 * Process-local CAS guard for Remote Session approval cards.
 *
 * The CLI remains the durable HumanTask authority. This registry only prevents
 * one Android transport card from sending duplicate/conflicting responses and
 * rolls a failed transport reservation back to a retryable pending state.
 */
class ApprovalSettlementRegistry(
    private val maxResolvedIds: Int = 1_024,
) {
    enum class Status {
        PENDING,
        RESPONDING,
        INTERRUPTING,
    }

    private val approvals = linkedMapOf<String, Status>()
    private val resolvedIds = linkedSetOf<String>()

    @Synchronized
    fun open(requestId: String): Boolean {
        val id = normalize(requestId) ?: return false
        if (id in approvals || id in resolvedIds) return false
        approvals[id] = Status.PENDING
        return true
    }

    @Synchronized
    fun beginDecision(requestId: String): Boolean =
        begin(requestId, Status.RESPONDING)

    @Synchronized
    fun beginInterrupt(): List<String> = approvals.entries
        .filter { it.value == Status.PENDING }
        .onEach { it.setValue(Status.INTERRUPTING) }
        .map { it.key }

    @Synchronized
    fun complete(requestId: String, reservation: Status, accepted: Boolean): Boolean {
        val id = normalize(requestId) ?: return false
        if (reservation == Status.PENDING || approvals[id] != reservation) return false
        if (!accepted) {
            approvals[id] = Status.PENDING
        } else if (reservation == Status.INTERRUPTING) {
            approvals.remove(id)
            rememberResolved(id)
        }
        return true
    }

    @Synchronized
    fun resolve(requestId: String): Boolean {
        val id = normalize(requestId) ?: return false
        val removed = approvals.remove(id) != null
        rememberResolved(id)
        return removed
    }

    @Synchronized
    fun invalidateAll() {
        approvals.clear()
        resolvedIds.clear()
    }

    @Synchronized
    fun size(): Int = approvals.size

    @Synchronized
    fun status(requestId: String): Status? = normalize(requestId)?.let(approvals::get)

    @Synchronized
    private fun begin(requestId: String, reservation: Status): Boolean {
        val id = normalize(requestId) ?: return false
        if (approvals[id] != Status.PENDING) return false
        approvals[id] = reservation
        return true
    }

    private fun rememberResolved(requestId: String) {
        resolvedIds += requestId
        while (resolvedIds.size > maxResolvedIds.coerceAtLeast(1)) {
            resolvedIds.remove(resolvedIds.first())
        }
    }

    private fun normalize(requestId: String?): String? =
        requestId?.trim()?.takeIf(String::isNotEmpty)
}
