import fs from "node:fs";
import path from "node:path";
import {
  defaultRolloutStoreDirectory,
  JsonlRolloutStore,
} from "../lib/app-server/rollout-store.js";
import { GraphCutoverAuthorityResolver } from "../lib/graph-kernel/cutover-authority-resolver.js";
import { GraphCutoverLedger } from "../lib/graph-kernel/cutover-ledger.js";
import {
  GraphEventStore,
  defaultGraphEventStoreDirectory,
} from "../lib/graph-kernel/event-store.js";
import { loadGraphRuntimeSurfaceManifest } from "../lib/graph-kernel/runtime-surface-manifest.js";
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

function graphEventStore(directory) {
  return new GraphEventStore({
    rolloutStore: new JsonlRolloutStore({
      directory: path.resolve(directory || defaultGraphEventStoreDirectory()),
    }),
  });
}

function cutoverStore(directory) {
  return new JsonlRolloutStore({
    directory: path.resolve(directory || defaultRolloutStoreDirectory()),
  });
}

function selectedCutoverEntries(manifest, { surface, entry } = {}) {
  if ((surface && !entry) || (!surface && entry)) {
    throw new Error("--surface and --entry must be supplied together");
  }
  const entries = manifest.surfaces.flatMap((candidate) =>
    candidate.entries.map((declaredEntry) => ({
      surface: candidate,
      entry: declaredEntry,
    })),
  );
  if (!surface) return entries;
  const selected = entries.filter(
    (candidate) =>
      candidate.surface.originSurface === surface &&
      candidate.entry.id === entry,
  );
  if (selected.length !== 1) {
    throw new Error(`Graph runtime entry is not declared: ${surface}/${entry}`);
  }
  return selected;
}

function evidenceFile(file) {
  const target = path.resolve(file);
  const stats = fs.statSync(target);
  if (!stats.isFile() || stats.size > 4 * 1024 * 1024) {
    throw new Error(
      "cutover evidence must be a JSON file no larger than 4 MiB",
    );
  }
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cutover evidence must contain one JSON object");
  }
  return value;
}

function cutoverResolver({ manifest, ledger, surface, entryId }) {
  return new GraphCutoverAuthorityResolver({
    manifest,
    ledger,
    surface,
    entryId,
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
      const events = graphEventStore(options.stateDir).read(runId);
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
      const events = graphEventStore(options.stateDir).read(runId);
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
      const projection = reduceGraphTrace(
        graphEventStore(options.stateDir).read(runId),
      );
      const report = evaluateGraphProjection(projection);
      const gate = options.thresholds
        ? enforceGraphEvalThresholds(report, JSON.parse(options.thresholds))
        : null;
      print({ report, gate });
      if (gate && !gate.passed) process.exitCode = 2;
    });

  const cutover = graph
    .command("cutover")
    .description("Operate entry-scoped Graph Kernel cutover authority");

  cutover
    .command("init")
    .description("Bind declared runtime entries to the durable cutover ledger")
    .option("--state-dir <path>", "Cutover ledger directory")
    .option("--surface <name>", "Initialize one origin surface")
    .option("--entry <id>", "Initialize one entry id")
    .option(
      "--include-non-durable",
      "Also initialize disabled non-durable entries",
    )
    .action((options) => {
      const manifest = loadGraphRuntimeSurfaceManifest();
      const ledger = new GraphCutoverLedger({
        store: cutoverStore(options.stateDir),
      });
      const selected = selectedCutoverEntries(manifest, options).filter(
        ({ surface }) =>
          options.includeNonDurable === true ||
          surface.durability === "durable",
      );
      const entries = selected.map(({ surface, entry }) =>
        cutoverResolver({
          manifest,
          ledger,
          surface: surface.originSurface,
          entryId: entry.id,
        }).begin(),
      );
      print({
        schema: "chainlesschain.graph-cutover-operation/v1",
        operation: "init",
        stateDirectory: path.resolve(
          options.stateDir || defaultRolloutStoreDirectory(),
        ),
        entries,
      });
    });

  cutover
    .command("status")
    .description("List manifest bindings and durable cutover stages")
    .option("--state-dir <path>", "Cutover ledger directory")
    .option("--surface <name>", "Inspect one origin surface")
    .option("--entry <id>", "Inspect one entry id")
    .action((options) => {
      const manifest = loadGraphRuntimeSurfaceManifest();
      const ledger = new GraphCutoverLedger({
        store: cutoverStore(options.stateDir),
      });
      const entries = selectedCutoverEntries(manifest, options).map(
        ({ surface, entry }) => {
          const resolver = cutoverResolver({
            manifest,
            ledger,
            surface: surface.originSurface,
            entryId: entry.id,
          });
          const state = resolver.status();
          return state
            ? { initialized: true, ...state }
            : {
                initialized: false,
                surface: surface.originSurface,
                entryId: entry.id,
                durability: surface.durability,
                runtimeDurability: entry.runtimeDurability,
                cutoverStrategy: resolver.cutoverStrategy,
                manifestDigest: resolver.manifestDigest,
                stores: resolver.stores,
                writerStores: resolver.writerStores,
                retirementStores: resolver.retirementStores,
                rebuildStores: resolver.rebuildStores,
                disabledStores: resolver.disabledStores,
                fallbackMode: resolver.fallbackMode,
              };
        },
      );
      print({
        schema: "chainlesschain.graph-cutover-operation/v1",
        operation: "status",
        entries,
      });
    });

  cutover
    .command("authority <surface> <entryId>")
    .description("Resolve one new run through the durable entry ledger")
    .option("--state-dir <path>", "Cutover ledger directory")
    .option("--run-key <key>", "Stable logical run identity")
    .option("--opt-in", "Explicitly enroll an opt-in-only canary run")
    .option("--fallback <mode>", "Pre-ledger feature-flag fallback")
    .action((surface, entryId, options) => {
      const manifest = loadGraphRuntimeSurfaceManifest();
      const resolver = cutoverResolver({
        manifest,
        ledger: new GraphCutoverLedger({
          store: cutoverStore(options.stateDir),
        }),
        surface,
        entryId,
      });
      print(
        resolver.resolve({
          runKey: options.runKey,
          optIn: options.optIn === true,
          fallbackMode: options.fallback,
        }),
      );
    });

  cutover
    .command("transition <surface> <entryId> <stage>")
    .description("Advance or roll back one entry using durable JSON evidence")
    .requiredOption("--evidence <path>", "Evidence JSON file")
    .option("--state-dir <path>", "Cutover ledger directory")
    .option("--expected-head <digest>", "Expected ledger event head CAS")
    .action((surface, entryId, stage, options) => {
      const manifest = loadGraphRuntimeSurfaceManifest();
      const ledger = new GraphCutoverLedger({
        store: cutoverStore(options.stateDir),
      });
      const resolver = cutoverResolver({
        manifest,
        ledger,
        surface,
        entryId,
      });
      if (!resolver.status()) {
        throw new Error(
          `cutover entry is not initialized: ${surface}/${entryId}`,
        );
      }
      print(
        ledger.transition(
          surface,
          entryId,
          stage,
          evidenceFile(options.evidence),
          options.expectedHead
            ? { expectedEventHead: options.expectedHead }
            : {},
        ),
      );
    });
}
