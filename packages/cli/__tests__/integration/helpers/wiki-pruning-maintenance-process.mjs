import { openPruningMaintenanceStore } from "../../fixtures/governed-wiki-pruning-maintenance.js";

const [root, mode, crashPoint = "none"] = process.argv.slice(2);
if (!root || !["seed", "execute"].includes(mode))
  throw new Error("invalid maintenance worker arguments");
const h = openPruningMaintenanceStore(
  root,
  mode === "execute"
    ? {
        afterWikiAppend() {
          if (crashPoint === "wiki-commit") process.exit(91);
        },
        afterJournalAppend(input) {
          if (
            crashPoint === "wiki-checkpoint" &&
            input.reason.endsWith("checkpoint 3")
          )
            process.exit(92);
        },
      }
    : {},
);
if (mode === "seed") await h.seed();
else await h.execute();
process.stdout.write(JSON.stringify(await h.inspect()));
