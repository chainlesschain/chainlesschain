import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  diffGraphTrace,
  locateBlockedRoot,
} from "../../src/lib/graph-kernel/trace-reducer.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../tests/fixtures/graph-debug-history/blocked-root-revision-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("cross-product Graph debug history fixture", () => {
  it("keeps CLI blocked-root, revision diff, and time-travel semantics stable", () => {
    const [before, after] = fixture.snapshots.map(
      (snapshot) => snapshot.projection,
    );
    const blocked = locateBlockedRoot(after, fixture.expected.blockedNodeId);
    const diff = diffGraphTrace(before, after);

    expect(blocked).toEqual({
      root: fixture.expected.blockedRoot,
      chain: fixture.expected.blockedChain,
    });
    expect(diff.from.throughSeq).toBe(fixture.expected.fromSeq);
    expect(diff.to.throughSeq).toBe(fixture.expected.toSeq);
    expect(diff.nodes.map((node) => node.id).sort()).toEqual(
      fixture.expected.changedNodeIds,
    );
  });
});
