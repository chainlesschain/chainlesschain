import { openPruningMaintenanceStore } from "../../fixtures/governed-wiki-pruning-maintenance.js";

const [root, mode, crashPoint = "none"] = process.argv.slice(2);
if (!root || !["seed", "execute"].includes(mode))
  throw new Error("invalid retrieval worker arguments");
const h = openPruningMaintenanceStore(root, {
  realRetrieval: true,
  afterRetrievalAppend() {
    if (mode === "execute" && crashPoint === "projection-commit")
      process.exit(93);
  },
  afterJournalAppend(input) {
    if (
      mode === "execute" &&
      crashPoint === "projection-checkpoint" &&
      input.reason.endsWith("checkpoint 4")
    )
      process.exit(94);
  },
});
if (mode === "seed") await h.seed();
else await h.execute();
process.stdout.write(JSON.stringify(await h.inspect()));
