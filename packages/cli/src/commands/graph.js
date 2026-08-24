import path from "node:path";
import { JsonlRolloutStore } from "../lib/app-server/rollout-store.js";
import {
  GraphEventStore,
  defaultGraphEventStoreDirectory,
} from "../lib/graph-kernel/event-store.js";
import {
  diffGraphTrace,
  locateBlockedRoot,
  reduceGraphTrace,
  timeTravelGraphTrace,
} from "../lib/graph-kernel/trace-reducer.js";
import {
  enforceGraphEvalThresholds,
  evaluateGraphProjection,
} from "../lib/graph-kernel/eval.js";

function store(directory) {
  return new GraphEventStore({
    rolloutStore: new JsonlRolloutStore({
      directory: path.resolve(directory || defaultGraphEventStoreDirectory()),
    }),
  });
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function registerGraphCommand(program) {
  const graph = program
    .command("graph")
    .description(
      "Inspect, time-travel, diff, and evaluate canonical GraphRuns",
    );

  graph
    .command("inspect <runId>")
    .description(
      "Project a durable GraphRun into Agent/Task/Artifact/Trace views",
    )
    .option("--state-dir <path>", "Graph rollout directory")
    .option("--at-seq <n>", "Time-travel through a durable event sequence")
    .option("--blocked-root <nodeId>", "Locate a deterministic blocked root")
    .option("--include-content", "Include message and HumanTask content")
    .action((runId, options) => {
      const events = store(options.stateDir).read(runId);
      const projection = options.atSeq
        ? timeTravelGraphTrace(events, Number(options.atSeq), {
            includeContent: options.includeContent === true,
          })
        : reduceGraphTrace(events, {
            includeContent: options.includeContent === true,
          });
      print(
        options.blockedRoot
          ? {
              projection,
              blockedRoot: locateBlockedRoot(projection, options.blockedRoot),
            }
          : projection,
      );
    });

  graph
    .command("diff <runId>")
    .description("Diff two time-travel projections of one GraphRun")
    .requiredOption("--from-seq <n>", "First durable event sequence")
    .requiredOption("--to-seq <n>", "Second durable event sequence")
    .option("--state-dir <path>", "Graph rollout directory")
    .action((runId, options) => {
      const events = store(options.stateDir).read(runId);
      print(
        diffGraphTrace(
          timeTravelGraphTrace(events, Number(options.fromSeq)),
          timeTravelGraphTrace(events, Number(options.toSeq)),
        ),
      );
    });

  graph
    .command("eval <runId>")
    .description(
      "Evaluate a durable GraphRun and optionally enforce thresholds",
    )
    .option("--state-dir <path>", "Graph rollout directory")
    .option(
      "--thresholds <json>",
      'Metric threshold object, e.g. \'{"deadlocked":{"max":0}}\'',
    )
    .action((runId, options) => {
      const projection = reduceGraphTrace(store(options.stateDir).read(runId));
      const report = evaluateGraphProjection(projection);
      const gate = options.thresholds
        ? enforceGraphEvalThresholds(report, JSON.parse(options.thresholds))
        : null;
      print({ report, gate });
      if (gate && !gate.passed) process.exitCode = 2;
    });
}
