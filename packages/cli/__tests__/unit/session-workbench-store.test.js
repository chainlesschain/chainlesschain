import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SESSION_WORKBENCH_STATE_SCHEMA,
  SessionWorkbenchStore,
} from "../../src/lib/session-workbench-store.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cc-session-workbench-"));
  const filePath = join(dir, "session-workbench.json");
  let nextId = 0;
  return {
    filePath,
    store: () =>
      new SessionWorkbenchStore({
        filePath,
        uuid: () =>
          `00000000-0000-0000-0000-${String(nextId++).padStart(12, "0")}`,
      }),
  };
}

describe("CLI-owned session workbench store", () => {
  it("persists group name/order and atomically moves 128 selected sessions", () => {
    const { filePath, store } = fixture();
    const first = store();
    const empty = first.projection();
    const created = first.createGroup({
      name: "Release",
      expectedRevision: empty.revision,
    });
    const groupId = created.items[0].id;
    const sessions = Array.from(
      { length: 128 },
      (_, index) => `local:session-${index}`,
    );
    const moved = first.moveSessions({
      groupId,
      sessionIds: sessions,
      expectedRevision: created.revision,
    });

    expect(moved.assignments).toHaveLength(128);
    expect(new Set(moved.assignments.map((entry) => entry.groupId))).toEqual(
      new Set([groupId]),
    );
    const reloaded = store().projection();
    expect(reloaded).toEqual(moved);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
      schema: SESSION_WORKBENCH_STATE_SCHEMA,
      generation: 2,
      groups: [{ id: groupId, name: "Release", order: 0 }],
    });
  });

  it("rejects a stale second window instead of losing the first mutation", () => {
    const { store } = fixture();
    const left = store();
    const right = store();
    const renderedLeft = left.projection();
    const renderedRight = right.projection();
    const afterLeft = left.createGroup({
      name: "Left window",
      expectedRevision: renderedLeft.revision,
    });

    expect(() =>
      right.createGroup({
        name: "Right window",
        expectedRevision: renderedRight.revision,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SESSION_GROUP_STALE",
        currentRevision: afterLeft.revision,
      }),
    );
    expect(right.projection().items.map((group) => group.name)).toEqual([
      "Left window",
    ]);
  });

  it("supports create/rename/order/delete and ungrouping through one CAS chain", () => {
    const { store } = fixture();
    const authority = store();
    let state = authority.projection();
    state = authority.createGroup({
      name: "One",
      expectedRevision: state.revision,
    });
    const one = state.items[0].id;
    state = authority.createGroup({
      name: "Two",
      order: 0,
      expectedRevision: state.revision,
    });
    const two = state.items.find((entry) => entry.name === "Two").id;
    expect(state.items.map((entry) => entry.name)).toEqual(["Two", "One"]);
    state = authority.renameGroup({
      groupId: one,
      name: "Renamed",
      expectedRevision: state.revision,
    });
    state = authority.setGroupOrder({
      groupId: one,
      order: 0,
      expectedRevision: state.revision,
    });
    state = authority.moveSessions({
      groupId: two,
      sessionIds: ["background:bg-1", "local:s%2F1"],
      expectedRevision: state.revision,
    });
    state = authority.moveSessions({
      groupId: "ungrouped",
      sessionIds: ["local:s%2F1"],
      expectedRevision: state.revision,
    });
    state = authority.deleteGroup({
      groupId: two,
      expectedRevision: state.revision,
    });

    expect(state.items).toEqual([{ id: one, name: "Renamed", order: 0 }]);
    expect(state.assignments).toEqual([]);
  });

  it("fails closed on unreadable JSON instead of overwriting group state", () => {
    const { filePath, store } = fixture();
    writeFileSync(filePath, "{broken", "utf8");
    expect(() => store().projection()).toThrowError(
      expect.objectContaining({
        code: "DURABLE_SECURITY_STORE_CORRUPT_FAILED",
      }),
    );
    expect(readFileSync(filePath, "utf8")).toBe("{broken");
  });
});
