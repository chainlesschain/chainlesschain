const test = require("node:test");
const assert = require("node:assert/strict");

function freshCliBinary() {
  const modulePath = require.resolve("../src/cli-binary.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("uses the unambiguous CLI name before asynchronous resolution completes", () => {
  const { getResolvedCli } = freshCliBinary();
  assert.equal(getResolvedCli(), "chainlesschain");
});

test("prefers the long npm bin over a shadowing cc executable", async () => {
  const { resolveCliBinary } = freshCliBinary();
  const probes = [];
  const resolved = await resolveCliBinary({
    getVersionOf: async (candidate) => {
      probes.push(candidate);
      if (candidate === "chainlesschain") return "0.166.21\n";
      if (candidate === "cc") return "1.2.3\n";
      return null;
    },
  });
  assert.equal(resolved, "chainlesschain");
  assert.deepEqual(probes, ["chainlesschain"]);
});

test("still falls back to a valid cc alias when the long name is unavailable", async () => {
  const { resolveCliBinary } = freshCliBinary();
  const resolved = await resolveCliBinary({
    getVersionOf: async (candidate) =>
      candidate === "cc" ? "0.166.21\n" : null,
  });
  assert.equal(resolved, "cc");
});
