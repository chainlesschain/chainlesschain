/** Supported desktop host composition entry. Keep this separate from index.js:
 * importing the CLI program would preload commands and ambient user settings.
 * The native host owns this dedicated database and its protection/lifecycle. */
import { SqliteRolloutStore } from "../lib/app-server/sqlite-rollout-store.js";
import { GraphEventStore } from "../lib/graph-kernel/event-store.js";
import { GraphCutoverLedger } from "../lib/graph-kernel/cutover-ledger.js";
import { GraphCutoverAuthorityResolver } from "../lib/graph-kernel/cutover-authority-resolver.js";
import { SchedulerOccurrenceGraphAuthority } from "../lib/scheduler-kernel/graph-authority-adapter.js";

export const PROJECT_GOAL_GRAPH_HOST_VERSION = 1;
export function projectGoalGraphMode(env = process.env) {
  const mode = String(env.CHAINLESSCHAIN_GRAPH_PROJECT_GOALS ?? "legacy")
    .trim()
    .toLowerCase();
  if (!["legacy", "shadow", "canonical"].includes(mode))
    throw Object.assign(
      new Error(
        "CHAINLESSCHAIN_GRAPH_PROJECT_GOALS must be legacy, shadow, or canonical",
      ),
      { code: "GOAL_MONITOR_GRAPH_MODE_INVALID" },
    );
  return mode;
}
export function createProjectGoalGraphAuthority({
  database,
  mode = "legacy",
  clock = Date.now,
  readCommittedResult,
}) {
  mode = projectGoalGraphMode({ CHAINLESSCHAIN_GRAPH_PROJECT_GOALS: mode });
  if (
    !database ||
    typeof database.prepare !== "function" ||
    typeof readCommittedResult !== "function"
  )
    throw Object.assign(
      new Error("Native database and synchronous result reader are required"),
      { code: "GOAL_MONITOR_GRAPH_HOST_INVALID" },
    );
  const rolloutStore = new SqliteRolloutStore({ database, now: clock });
  const eventStore = new GraphEventStore({ rolloutStore });
  const resolver = new GraphCutoverAuthorityResolver({
    surface: "scheduler",
    entryId: "desktop-project-goals",
    ledger: new GraphCutoverLedger({ store: rolloutStore }),
    fallbackMode: mode,
  });
  const authority = new SchedulerOccurrenceGraphAuthority({
    mode,
    eventStore,
    authorityResolver: resolver,
    readCommittedResult,
    now: clock,
  });
  authority.close = () => rolloutStore.close();
  return authority;
}
