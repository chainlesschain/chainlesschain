const MEMORY_MUTATION_EVENTS = new Set([
  "memory.candidate.created",
  "memory.activated",
  "memory.reinforced",
  "memory.superseded",
  "memory.expired",
]);

export function contextPlanCreatedNotification(plan) {
  return {
    method: "context/event",
    params: { type: "context.plan.created", plan },
  };
}

export function memoryRecalledNotification(result) {
  return {
    method: "memory/event",
    params: { type: "memory.recalled", result },
  };
}

export function memoryMutationNotification(mutation) {
  if (!MEMORY_MUTATION_EVENTS.has(mutation?.event?.type)) return null;
  return {
    method: "memory/event",
    params: {
      type: mutation.event.type,
      memory_id: mutation.record.memoryId,
      revision: mutation.record.revision,
      record_digest: mutation.record.digest,
      record: mutation.record,
    },
  };
}

export function memoryDeletionNotification(receipt, operationId = receipt?.requestId) {
  if (!receipt?.memoryId || !receipt?.recordDigest || !receipt?.revision) {
    return null;
  }
  const purged = receipt.status === "purged";
  return {
    method: "memory/event",
    params: {
      type: purged ? "memory.purged" : "memory.deleted",
      operation_id: operationId,
      request_id: receipt.requestId || operationId,
      memory_id: receipt.memoryId,
      revision: receipt.revision,
      record_digest: receipt.recordDigest,
      ...(purged ? { receipt } : {}),
    },
  };
}
