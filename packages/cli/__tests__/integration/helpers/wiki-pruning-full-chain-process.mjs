import { openPruningFullChain } from "../../fixtures/wiki-pruning-full-chain.js";

const [root, mode, crashPoint = "none"] = process.argv.slice(2);
if (!root || !["seed", "execute"].includes(mode))
  throw new Error("invalid full-chain worker arguments");
const started = Date.now();
const profile = process.env.CC_WIKI_PRUNING_PROFILE === "1";
function mark(label) {
  if (profile) process.stderr.write(`${label}=${Date.now() - started}ms\n`);
}
const h = await openPruningFullChain(root, {
  seed: mode === "seed",
  crashPoint:
    mode === "execute" && crashPoint === "release-pointer"
      ? "after-release-pointer"
      : "none",
  afterKeyUnlink() {
    if (mode === "execute" && crashPoint === "key-unlink") process.exit(96);
  },
  afterWikiAppend() {
    if (mode === "execute" && crashPoint === "dependency-commit")
      process.exit(99);
  },
  afterRawAppend(input) {
    if (
      mode === "execute" &&
      crashPoint === "raw-tombstone" &&
      input.type === "evolution.raw-deletion.tombstone-retained"
    )
      process.exit(97);
  },
  afterJournalAppend(input) {
    if (
      mode === "execute" &&
      crashPoint === "raw-checkpoint" &&
      input.reason.endsWith("checkpoint 4")
    )
      process.exit(98);
    if (
      mode === "execute" &&
      crashPoint === "projection-checkpoint" &&
      input.reason.endsWith("checkpoint 5")
    )
      process.exit(90);
  },
});
mark("open");
if (mode === "execute") {
  if (profile) {
    const resumed = await h.runtime.resume();
    mark("resume");
    if (resumed == null) {
      const plan = await h.plan();
      mark("plan");
      await h.runtime.execute({ plan });
      mark("execute");
    }
  } else {
    await h.execute();
  }
}
const snapshot = await h.inspect();
mark("inspect");
const release = h.release.inspect();
mark("release-inspect");
let decryptable = true;
try {
  h.keyAuthority.decrypt();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  decryptable = false;
}
mark("decrypt");
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    elapsedMs: Date.now() - started,
    snapshot: {
      ...snapshot,
      decryptable,
      activeRelease: release.active.release,
      activeState: release.active.state,
      baseline: release.baseline,
      releaseTransitions: release.transitions,
      kms: h.keyAuthority.inspect(),
    },
  }),
);
