const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { parseGraphDebugHistory } = require("../src/team-monitor");

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../../tests/fixtures/graph-debug-history/blocked-root-revision-v1.json",
    ),
    "utf8",
  ),
);

test("keeps VS Code blocked-root, revision diff, and time-travel semantics stable", () => {
  const parsed = parseGraphDebugHistory(fixture);
  const blocked = parsed.blockedRoots.find(
    (entry) => entry.nodeId === fixture.expected.blockedNodeId,
  );

  assert.deepEqual(blocked, {
    nodeId: fixture.expected.blockedNodeId,
    root: fixture.expected.blockedRoot,
    chain: fixture.expected.blockedChain,
  });
  assert.equal(parsed.current.seq, fixture.expected.toSeq);
  assert.deepEqual(parsed.revisions[0], {
    fromSeq: fixture.expected.fromSeq,
    toSeq: fixture.expected.toSeq,
    changedNodeIds: fixture.expected.changedNodeIds,
  });
  assert.throws(
    () => parseGraphDebugHistory({ ...fixture, snapshots: [] }),
    /invalid Graph debug history/,
  );
});
