import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DesktopGraphRunRegistry,
  MemoryDesktopGraphRunStore,
} = require("../desktop-graph-run-registry.js");

describe("DesktopGraphRunRegistry", () => {
  it("hydrates exact run authority through a shared durable store", () => {
    const store = new MemoryDesktopGraphRunStore();
    const first = new DesktopGraphRunRegistry({ store, now: () => 10 });
    first.record({
      surface: "desktop_workflow_manager",
      entityId: "workflow-1",
      graphRunId: "desktop-workflow:workflow-1",
      authorityMode: "canonical",
      lifecycleStatus: "running",
      metadata: { title: "Durable workflow" },
    });
    first.updateProjection("desktop_workflow_manager", "workflow-1", {
      id: "desktop-workflow:workflow-1",
      status: "reconciliation_required",
      authorityGeneration: 2,
      writerId: "writer-2",
    });

    const recovered = new DesktopGraphRunRegistry({ store });
    expect(
      recovered.get("desktop_workflow_manager", "workflow-1"),
    ).toMatchObject({
      graphRunId: "desktop-workflow:workflow-1",
      authorityMode: "canonical",
      lifecycleStatus: "reconciliation_required",
      metadata: { title: "Durable workflow" },
      lastProjection: {
        status: "reconciliation_required",
        authorityGeneration: 2,
        writerId: "writer-2",
      },
    });
  });

  it("rejects invalid authority modes and corrupt identifiers", () => {
    const registry = new DesktopGraphRunRegistry();
    expect(() =>
      registry.record({
        surface: "desktop workflow",
        entityId: "workflow-1",
        graphRunId: "run-1",
        authorityMode: "legacy",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_DESKTOP_GRAPH_BINDING_INVALID" }),
    );
  });
});
