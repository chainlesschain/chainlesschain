import { describe, it, expect } from "vitest";
import { EventRuntimeProducer } from "../../src/lib/event-runtime-producer.js";
import { AgentIPCBus } from "../../src/lib/agent-ipc-bus.js";

function store() {
  const records = [];
  return {
    records,
    enqueue: (queue, event, options) => {
      const record = { id: options.id, queue, event, metadata: options.metadata, duplicate: records.some((r) => r.id === options.id) };
      if (!record.duplicate) records.push(record);
      return record;
    },
  };
}

describe("EventRuntimeProducer", () => {
  it("adds an immutable origin envelope and deduplicates", () => {
    const s = store();
    const p = new EventRuntimeProducer({ store: s, now: () => 42 });
    const first = p.publish({ type: "webhook", value: 1 }, { origin: "webhook", id: "evt-1" });
    const second = p.publish({ type: "webhook", value: 1 }, { origin: "webhook", id: "evt-1" });
    expect(first.event).toMatchObject({ origin: "webhook", producedAt: 42, authority: "system" });
    expect(second.duplicate).toBe(true);
    expect(s.records).toHaveLength(1);
  });

  it("rejects forged/unknown producer origins", () => {
    const p = new EventRuntimeProducer({ store: store() });
    expect(() => p.publish({}, { origin: "user" })).toThrow(/unsupported event origin/);
  });

  it("durably publishes Agent IPC interaction requests", async () => {
    const s = store();
    s.acknowledgeInbox = (id, result) => {
      const row = s.records.find((r) => r.id === id);
      if (row) row.result = result;
      return row;
    };
    const bus = new AgentIPCBus({ runtimeStore: s });
    const pending = bus.requestInteraction("agent-1", {
      sessionId: "s1",
      turnId: "t1",
      type: "question",
      prompt: "continue?",
    });
    const request = bus.getPendingRequests()[0];
    expect(s.records[0].event.type).toBe("interaction_request");
    expect(s.records[0].metadata.producer).toBe("agent-ipc");
    expect(bus.respond(request.requestId, { accepted: true })).toBe(true);
    await expect(pending).resolves.toEqual({ accepted: true });
    expect(s.records[0].result.response).toEqual({ accepted: true });
  });
});
