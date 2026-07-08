/**
 * Read-only "cc team" monitor — pure parse + summarize of the
 * `cc team run --state <file>` v2 snapshot. Headless.
 */
import { describe, it, expect } from "vitest";
import {
  parseTeamState,
  summarizeTeam,
  TEAM_STATUSES,
} from "../../../vscode-extension/src/team-monitor.js";

// A minimal v2 snapshot, matching team.js persist(): registry.tasks.tasks[]
// with lease/dependsOn/key/attempts under each task's metadata.
function snap(tasks, extra = {}) {
  return JSON.stringify({
    version: 2,
    registry: { registry: { byKey: [] }, tasks: { tasks } },
    members: extra.members || [],
    budget: extra.budget || null,
  });
}
const task = (id, status, md = {}) => ({
  id,
  title: id + " title",
  status,
  metadata: { key: id, dependsOn: [], ...md },
});

describe("parseTeamState", () => {
  it("flattens tasks with lease holder, deps, attempts from metadata", () => {
    const state = parseTeamState(
      snap([
        task("a", "completed"),
        task("b", "in_progress", {
          dependsOn: ["a"],
          attempts: 2,
          lease: { holder: "mate-1", expiresAt: 9_000 },
        }),
      ]),
    );
    expect(state.ok).toBe(true);
    expect(state.version).toBe(2);
    expect(state.tasks[0]).toMatchObject({
      id: "a",
      title: "a title",
      status: "completed",
      holder: null,
    });
    expect(state.tasks[1]).toMatchObject({
      id: "b",
      status: "in_progress",
      dependsOn: ["a"],
      attempts: 2,
      holder: "mate-1",
      leaseExpiresAt: 9000,
    });
  });

  it("accepts a pre-parsed object as well as a JSON string", () => {
    const obj = JSON.parse(snap([task("a", "pending")]));
    expect(parseTeamState(obj).ok).toBe(true);
  });

  it("fails cleanly on non-JSON, non-object, and a wrong-shape file", () => {
    expect(parseTeamState("{bad").ok).toBe(false);
    expect(parseTeamState(null).ok).toBe(false);
    expect(parseTeamState(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseTeamState("{bad").error).toMatch(/not JSON/);
  });

  it("tolerates missing metadata / fields without throwing", () => {
    const state = parseTeamState(
      snap([{ id: "x", status: "pending" }]), // no metadata, no title
    );
    expect(state.ok).toBe(true);
    expect(state.tasks[0]).toMatchObject({
      id: "x",
      title: "x",
      dependsOn: [],
      holder: null,
      attempts: 0,
    });
  });
});

describe("summarizeTeam", () => {
  const state = parseTeamState(
    snap([
      task("a", "completed"),
      task("b", "completed"),
      task("c", "in_progress", { lease: { holder: "m1", expiresAt: 10_000 } }),
      task("d", "in_progress", { lease: { holder: "m2", expiresAt: 1_000 } }), // expired
      task("e", "blocked"),
      task("f", "pending"),
    ]),
  );

  it("counts per status, live vs stale leases, and done%", () => {
    const s = summarizeTeam(state, { now: 5_000 });
    expect(s.total).toBe(6);
    expect(s.counts).toMatchObject({
      completed: 2,
      in_progress: 2,
      blocked: 1,
      pending: 1,
    });
    expect(s.active).toBe(1); // c's lease is live at now=5000
    expect(s.stale).toBe(1); // d's lease expired at 1000
    expect(s.donePct).toBe(33); // 2/6
  });

  it("is empty-safe (no tasks → zero counts, 0%)", () => {
    const s = summarizeTeam({ tasks: [] });
    expect(s.total).toBe(0);
    expect(s.donePct).toBe(0);
    for (const st of TEAM_STATUSES) expect(s.counts[st]).toBe(0);
  });
});
