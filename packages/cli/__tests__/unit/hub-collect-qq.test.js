import { describe, expect, it, vi } from "vitest";

import { _internal } from "../../src/commands/hub.js";

describe("collect-qq transactional ingest", () => {
  it("writes the complete parsed graph through putBatchResolved once", () => {
    const event = { id: "event-1", type: "event" };
    const person = { id: "person-1", type: "person" };
    const topic = { id: "topic-1", type: "topic" };
    const conflictResolver = vi.fn();
    const putBatchResolved = vi.fn((batch, options) => ({
      counts: {
        events: batch.events.length,
        persons: batch.persons.length,
        places: batch.places.length,
        items: batch.items.length,
        topics: batch.topics.length,
      },
      resolvedBatch: batch,
      conflicts: [],
      resolver: options.conflictResolver,
    }));

    const result = _internal.ingestQqParsedBatch(
      { putBatchResolved },
      {
        events: [event],
        persons: [person],
        topics: [topic],
      },
      conflictResolver,
    );

    expect(putBatchResolved).toHaveBeenCalledTimes(1);
    expect(putBatchResolved).toHaveBeenCalledWith(
      {
        events: [event],
        persons: [person],
        places: [],
        items: [],
        topics: [topic],
      },
      { conflictResolver },
    );
    expect(result).toMatchObject({
      counts: { events: 1, persons: 1, topics: 1 },
      resolver: conflictResolver,
    });
  });

  it("keeps the legacy bare event-array parser shape transactional", () => {
    const putBatchResolved = vi.fn((batch) => ({
      counts: { events: batch.events.length },
      resolvedBatch: batch,
      conflicts: [],
    }));

    _internal.ingestQqParsedBatch(
      { putBatchResolved },
      [{ id: "legacy-event", type: "event" }],
      vi.fn(),
    );

    expect(putBatchResolved.mock.calls[0][0]).toMatchObject({
      events: [{ id: "legacy-event", type: "event" }],
      persons: [],
      topics: [],
    });
  });

  it("fails closed when transactional quality resolution is unavailable", () => {
    expect(() =>
      _internal.ingestQqParsedBatch({}, { events: [] }, vi.fn()),
    ).toThrow(/putBatchResolved/);
    expect(() =>
      _internal.ingestQqParsedBatch(
        { putBatchResolved: vi.fn() },
        { events: [] },
        null,
      ),
    ).toThrow(/quality conflict resolver/);
  });
});
