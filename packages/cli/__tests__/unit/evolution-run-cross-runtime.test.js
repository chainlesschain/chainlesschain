import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { projectCliEvolutionRun } from "../../src/lib/evolution/evolution-run-runtime-adapter.js";
import { projectGraphEvolutionRun } from "../../src/lib/graph-kernel/evolution-run-runtime-adapter.js";

const require = createRequire(import.meta.url);
const { projectDesktopEvolutionRun } = require("../../../../desktop-app-vue/src/main/ai-engine/evolution/evolution-run-runtime-adapter.js");
const { EVENT_TYPES, EVOLUTION_RUN_EVENT_SCHEMA, compactEvolutionRun } = evolutionRun;

const d = (n) => `sha256:${String(n).padStart(64, "0")}`;
const event = (sequence, type, subjectId, data = {}) => ({
  schema: EVOLUTION_RUN_EVENT_SCHEMA,
  tenantId: "tenant-a",
  runId: "run-canonical-1",
  eventId: `event-${sequence}`,
  sequence,
  type,
  subjectId,
  payloadDigest: d(sequence),
  artifactRef: data.artifactRef ?? null,
  keyRef: data.keyRef ?? null,
  data: data.metadata ?? {},
});

const events = [
  event(1, EVENT_TYPES.RUN_STARTED, "run-canonical-1"),
  event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "raw-1", { artifactRef: "artifact://raw/1", keyRef: "kms://key/1" }),
  event(3, EVENT_TYPES.RAW_ANNOTATED, "raw-1", { metadata: { outcome: "success", tags: ["repeatable"], synthesisStatus: "eligible" } }),
  event(4, EVENT_TYPES.WIKI_REVISION_RECORDED, "wiki-rev-1"),
  event(5, EVENT_TYPES.SKILL_CANDIDATE_RECORDED, "candidate-1", { artifactRef: "artifact://candidate/1" }),
  event(6, EVENT_TYPES.EVAL_RECORDED, "eval-1", { metadata: { decision: "accepted" } }),
  event(7, EVENT_TYPES.RELEASE_ACTIVATED, "release-1"),
  event(8, EVENT_TYPES.RUN_COMPLETED, "run-canonical-1"),
];

describe("canonical EvolutionRun cross-runtime projection", () => {
  it("returns the exact same state and digest in CLI, Desktop and Graph", () => {
    const cli = projectCliEvolutionRun(events);
    expect(projectDesktopEvolutionRun(events)).toEqual(cli);
    expect(projectGraphEvolutionRun(events)).toEqual(cli);
    expect(cli).toMatchObject({ status: "completed", eventCount: 8 });
  });

  it("is deterministic under duplicates, arrival disorder and crash replay", () => {
    const expected = projectCliEvolutionRun(events);
    const shuffled = [events[6], events[1], events[4], events[0], events[7], events[2], events[5], events[3], events[4]];
    expect(projectCliEvolutionRun(shuffled)).toEqual(expected);
    expect(projectCliEvolutionRun(JSON.parse(JSON.stringify(shuffled)))).toEqual(expected);
  });

  it("preserves the exact projection across compaction plus later events", () => {
    const first = projectCliEvolutionRun(events.slice(0, 5));
    const snapshot = compactEvolutionRun(first);
    const resumed = projectCliEvolutionRun([events[1], events[4], ...events.slice(5)], { snapshot });
    expect(resumed).toEqual(projectCliEvolutionRun(events));
  });

  it("allows record-replay candidates to share the run without a Wiki revision", () => {
    const direct = projectCliEvolutionRun([
      events[0],
      event(2, EVENT_TYPES.SKILL_CANDIDATE_RECORDED, "record-replay-candidate", {
        artifactRef: "artifact://record-replay/candidate",
      }),
    ]);
    expect(direct.wiki.revision).toBeNull();
    expect(direct.registry.candidates["record-replay-candidate"]).toBeDefined();
  });

  it("models annotations and tombstones as appended lineage events", () => {
    const tombstone = event(9, EVENT_TYPES.RAW_TOMBSTONED, "raw-1", { keyRef: "kms://destroyed/1", metadata: { reason: "user-delete" } });
    const projection = projectCliEvolutionRun([...events, tombstone]);
    expect(projection.raw.events["raw-1"]).toBeDefined();
    expect(projection.raw.annotations["raw-1"].outcome).toBe("success");
    expect(projection.raw.tombstones["raw-1"]).toMatchObject({ reason: "user-delete", keyRef: "kms://destroyed/1" });
  });

  it("rejects conflicting duplicates, mixed runs and late pre-compaction events", () => {
    expect(() => projectCliEvolutionRun([...events, { ...events[0], payloadDigest: d(99) }])).toThrow(/conflicting duplicate/);
    expect(() => projectCliEvolutionRun([...events, { ...events[0], eventId: "other", runId: "other-run" }])).toThrow(/cross-tenant or cross-run/);
    const snapshot = compactEvolutionRun(projectCliEvolutionRun(events.slice(0, 5)));
    expect(() => projectCliEvolutionRun([event(4, EVENT_TYPES.WIKI_REVISION_RECORDED, "late")], { snapshot })).toThrow(/older than/);
  });

  it("rejects sensitive raw content and requires digest-bound references", () => {
    expect(() => projectCliEvolutionRun([{ ...events[1], data: { payload: "secret" } }])).toThrow(/artifact reference/);
    expect(() => projectCliEvolutionRun([{ ...events[1], payloadDigest: "not-a-digest" }])).toThrow(/sha256/);
  });
});
