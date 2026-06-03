import { describe, it, expect } from "vitest";
import {
  eventsToJson,
  eventsToNdjson,
  eventsToCsv,
  suggestFilename,
} from "../../src/utils/pdhExport.js";

const ev = (overrides = {}) => ({
  id: "ev-1",
  subtype: "chat.message",
  occurredAt: 1700000000000,
  actor: "wxid_self",
  place: null,
  content: { text: "Hello, world" },
  source: { adapter: "wechat", adapterVersion: "0.1", capturedAt: 0, capturedBy: "t" },
  ...overrides,
});

describe("eventsToJson", () => {
  it("produces a pretty-printed JSON array", () => {
    const out = eventsToJson([ev()]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ev-1");
    expect(out).toContain("\n  ");
  });

  it("handles empty array", () => {
    expect(eventsToJson([])).toBe("[]");
  });
});

describe("eventsToNdjson", () => {
  it("one JSON object per line, trailing newline", () => {
    const out = eventsToNdjson([ev({ id: "a" }), ev({ id: "b" })]);
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
    expect(JSON.parse(lines[1]).id).toBe("b");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("empty array produces just a newline", () => {
    expect(eventsToNdjson([])).toBe("\n");
  });
});

describe("eventsToCsv", () => {
  it("emits header + scalar columns + JSON-stringified nested fields", () => {
    const out = eventsToCsv([ev()]);
    const [header, row] = out.trim().split("\n");
    expect(header).toBe(
      "id,subtype,occurredAt,occurredAtIso,actor,place,adapter,summary,contentJson,extraJson"
    );
    const cells = row.split(",");
    // Adapter column should be "wechat"
    expect(cells).toContain("wechat");
    // contentJson cell contains the JSON object — it'll be quoted because of
    // embedded commas + quotes; just verify the row has at least 10 fields.
    // Re-parse using a more tolerant split since CSV quoting is in play:
    expect(out).toContain('"{""text"":""Hello, world""}"');
  });

  it("escapes commas / quotes / newlines per RFC 4180", () => {
    const out = eventsToCsv([
      ev({
        id: "with,comma",
        content: { text: 'he said "hi"\nbye' },
      }),
    ]);
    expect(out).toContain('"with,comma"');           // comma in id wrapped in quotes
    expect(out).toContain('""hi""');                  // quotes doubled
    expect(out).toContain("\nbye");                   // newline preserved in escaped cell
  });

  it("renders occurredAtIso when occurredAt is set", () => {
    const out = eventsToCsv([ev()]);
    expect(out).toMatch(/2023-11-14T22:13:20\.000Z/); // 1700000000000 = 2023-11-14 22:13:20 UTC
  });

  it("empty events → header only + trailing newline", () => {
    const out = eventsToCsv([]);
    expect(out).toBe(
      "id,subtype,occurredAt,occurredAtIso,actor,place,adapter,summary,contentJson,extraJson\n"
    );
  });
});

describe("suggestFilename", () => {
  it("includes format extension and ISO-ish date", () => {
    const fn = suggestFilename("csv");
    expect(fn).toMatch(/^pdh-events-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("appends category suffix when given", () => {
    const fn = suggestFilename("ndjson", "shopping");
    expect(fn).toMatch(/^pdh-events-\d{4}-\d{2}-\d{2}-shopping\.ndjson$/);
  });

  it("ndjson keeps its extension", () => {
    expect(suggestFilename("ndjson").endsWith(".ndjson")).toBe(true);
  });
});
