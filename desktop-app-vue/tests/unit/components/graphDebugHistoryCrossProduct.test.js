import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createGraphDebuggerProjection,
  diffGraphs,
  graphDebugHistoryView,
} from "../../../src/renderer/components/graph/graphRunDebuggerUtils.js";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../tests/fixtures/graph-debug-history/blocked-root-revision-v1.json",
    ),
    "utf8",
  ),
);

describe("cross-product Graph debug history fixture", () => {
  it("keeps Desktop blocked-root, revision diff, and time-travel semantics stable", () => {
    const view = graphDebugHistoryView(fixture);
    const projection = createGraphDebuggerProjection(view.graph, view.events);
    const [before, after] = fixture.snapshots.map(
      (snapshot) => snapshot.projection,
    );

    expect(view.events).toHaveLength(2);
    expect(projection.topology.blockedRootIds.sort()).toEqual([
      "build",
      "deploy",
      "prepare",
    ]);
    expect(
      projection.topology.nodes.find(
        (node) => node.id === fixture.expected.blockedNodeId,
      )?.blockedRoot,
    ).toBe("build");
    expect(
      diffGraphs(before, after)
        .statusChanged.map((entry) => entry.nodeId)
        .sort(),
    ).toEqual(fixture.expected.changedNodeIds);
  });
});
