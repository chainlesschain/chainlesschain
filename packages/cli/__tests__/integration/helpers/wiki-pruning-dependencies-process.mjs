import { openPruningMaintenanceStore } from "../../fixtures/governed-wiki-pruning-maintenance.js";

const [root, mode, crashPoint = "none"] = process.argv.slice(2);
if (!root || !["seed", "execute"].includes(mode))
  throw new Error("invalid dependency worker arguments");
const h = openPruningMaintenanceStore(root, {
  realDependencies: true,
  dependencyDeletion: true,
  afterWikiAppend() {
    if (mode === "execute" && crashPoint === "dependency-commit")
      process.exit(93);
  },
  afterJournalAppend(input) {
    if (
      mode === "execute" &&
      crashPoint === "dependency-checkpoint" &&
      input.reason.endsWith("checkpoint 2")
    )
      process.exit(94);
  },
});
if (mode === "seed") await h.seed();
else {
  // This process test establishes the real Wiki dependency/maintenance
  // boundary, not a fake successful KMS operation or a finalized deletion.
  try {
    await h.execute();
    throw new Error("unexpected completion without a KMS provider");
  } catch (error) {
    if (!/separately verified KMS/u.test(error.message)) throw error;
  }
}
process.stdout.write(JSON.stringify(await h.inspect()));
