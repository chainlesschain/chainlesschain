#!/usr/bin/env node
// Offline preparation/recomputation only. Never loads a deployment or model.
import fs from "node:fs";
import { parseArgs } from "node:util";
import {
  PM_EXPLORATION_EFFECT_PLAN_SCHEMA,
  buildPmExplorationEffectPlan,
  buildPmExplorationEffectReport,
  buildPmExplorationEffectSlotManifest,
  inspectPmExplorationEffectPlan,
  verifyPmExplorationEffectPlan,
  verifyPmExplorationEffectReport,
  verifyPmExplorationEffectSlotManifest,
} from "../src/lib/evolution/pm-exploration-benchmark.js";

const MAX_BYTES = 16 * 1024 * 1024;
const FLAGS = {
  plan: ["input"],
  inspect: ["plan"],
  report: ["plan", "plan-digest", "runs"],
  verify: ["plan", "plan-digest", "report"],
  slots: ["plan", "plan-digest", "slots"],
  "verify-slots": ["plan", "plan-digest", "manifest"],
};
const HELP = `Offline PM effect workflow (no model calls or production approval).
node scripts/pm-exploration-effect.mjs plan --input plan-input.json
node scripts/pm-exploration-effect.mjs inspect --plan plan.json
node scripts/pm-exploration-effect.mjs report --plan plan.json --plan-digest sha256:... --runs runs.json
node scripts/pm-exploration-effect.mjs verify --plan plan.json --plan-digest sha256:... --report report.json
node scripts/pm-exploration-effect.mjs slots --plan plan.json --plan-digest sha256:... --slots slot-input.json
node scripts/pm-exploration-effect.mjs verify-slots --plan plan.json --plan-digest sha256:... --manifest slot-manifest.json

JSON is written to stdout; inputs are never modified. UTF-8 JSON files only, at most 16 MiB each.
plan: input is buildPmExplorationEffectPlan input, including verified suite/policy objects.
inspect: lists transitive task groups and planned counts before spending a model budget.
report: v2 only; runs must cover every frozen seed/task, including evidenced failures.
verify: recomputes a report, including historical v1 without promoting its score semantics.
slots: freezes 1-32 cohort slot IDs against a v2 plan; save its digest independently before collection.
verify-slots: recomputes the frozen slot manifest without proving its signing or creation time.
Save planDigest independently BEFORE collection and supply that value to report/verify.
Digest consistency does not authenticate receipts or prove preregistration timing.
Exit 0: help/plan, sufficient planned groups, or v2 statistical threshold met.
Exit 1: invalid input. Exit 2: insufficient groups/evidence or historical v1.
Exit 3: statistical threshold not met. No exit code authorizes promotion or Pilot.`;

function readJson(file) {
  // Bound the actual read, not just a prior stat; growing inputs cannot cause an
  // unbounded allocation. Nonblocking open avoids waiting on a named pipe.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) {
      throw new Error("invalid input file");
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== stat.size) throw new Error("input size changed");
    // Fatal decoding rejects damaged UTF-8; TextDecoder accepts a UTF-8 BOM
    // emitted by Windows PowerShell's Set-Content -Encoding utf8.
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
    );
  } finally {
    fs.closeSync(fd);
  }
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  const { values, positionals, tokens } = parseArgs({
    allowPositionals: true,
    tokens: true,
    options: {
      help: { type: "boolean" },
      input: { type: "string" },
      plan: { type: "string" },
      "plan-digest": { type: "string" },
      runs: { type: "string" },
      report: { type: "string" },
      slots: { type: "string" },
      manifest: { type: "string" },
    },
  });
  const optionNames = tokens
    .filter((token) => token.kind === "option")
    .map((token) => token.name);
  if (new Set(optionNames).size !== optionNames.length) {
    throw new Error("duplicate option");
  }
  if (values.help && optionNames.length === 1 && positionals.length === 0) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const mode = positionals[0];
    const required = Object.hasOwn(FLAGS, mode) ? FLAGS[mode] : null;
    if (
      positionals.length !== 1 ||
      !required ||
      Object.keys(values).length !== required.length ||
      required.some(
        (key) => typeof values[key] !== "string" || !values[key].trim(),
      )
    ) {
      throw new Error("invalid mode or options");
    }
    console.error(
      "Offline PM statistics only: external receipts are not authenticated; independent Eval Gate and Pilot approval remain required.",
    );
    if (mode === "plan") {
      emit(buildPmExplorationEffectPlan(readJson(values.input)));
    } else {
      const plan = verifyPmExplorationEffectPlan(readJson(values.plan));
      if (mode === "inspect") {
        const inspection = inspectPmExplorationEffectPlan(plan);
        emit(inspection);
        if (inspection.status !== "group-count-satisfied") process.exitCode = 2;
      } else {
        if (values["plan-digest"] !== plan.planDigest) {
          throw new Error("frozen plan digest mismatch");
        }
        const legacy = plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA;
        if (mode === "slots" || mode === "verify-slots") {
          if (legacy) throw new Error("slot manifests require v2");
          if (mode === "slots") {
            const slotInput = readJson(values.slots);
            if (Object.hasOwn(slotInput, "plan"))
              throw new Error("slot input must not replace the frozen plan");
            emit(
              buildPmExplorationEffectSlotManifest({
                plan,
                ...slotInput,
              }),
            );
          } else {
            emit(
              verifyPmExplorationEffectSlotManifest({
                plan,
                manifest: readJson(values.manifest),
              }),
            );
          }
        } else {
          if (mode === "report" && legacy) {
            throw new Error("new reports require v2");
          }
          const report =
            mode === "report"
              ? buildPmExplorationEffectReport({
                  plan,
                  runs: readJson(values.runs),
                })
              : verifyPmExplorationEffectReport({
                  plan,
                  report: readJson(values.report),
                });
          emit(report);
          if (legacy) {
            console.error(
              "Historical v1 verified with its original score semantics; it is not v2 completion-rate evidence.",
            );
            process.exitCode = 2;
          } else {
            process.exitCode =
              report.evidenceDecision === "threshold-met"
                ? 0
                : report.evidenceDecision === "insufficient-evidence"
                  ? 2
                  : 3;
          }
        }
      }
    }
  }
} catch {
  console.error(
    "Invalid PM effect input or binding; use --help. No report was emitted for this request.",
  );
  process.exitCode = 1;
}
