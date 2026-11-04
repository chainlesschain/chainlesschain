const input = {
  id: "goal-1",
  name: "observer",
  scope: "project",
  connection: "C:/native connection.json",
  checkpoint: "C:/native checkpoint.json",
  checkpointMode: "new",
};
function packet() {
  const goalRef = {
    id: "goal-1",
    storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
    revision: 2,
    controlGeneration: 1,
  };
  const time = "2026-11-04T12:00:00.000Z";
  return {
    schema: "chainlesschain.goal-extension-history/v1",
    goalRef,
    plugin: { name: "observer", scope: "project", version: "0.1.0" },
    observedAt: time,
    delivery: "at-least-once",
    entries: [
      {
        id: "goal-event-" + "a".repeat(64),
        sequence: 1,
        sourceRef: { ...goalRef, revision: 1 },
        recordedAt: time,
        event: {
          type: "risk.review.completed",
          goalRef: { ...goalRef },
          summary: "<script>Historical observation</script>",
          occurredAt: time,
        },
      },
    ],
    scannedCount: 2,
    nextCursor: "signed_cursor",
    hasMore: true,
    truncated: false,
    retainedFrom: 1,
    highWatermark: 3,
  };
}
module.exports = { input, packet };
