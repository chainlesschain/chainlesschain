/**
 * `cc privacy` — CLI surface for Phase 91 Privacy Computing.
 */

import { Command } from "commander";

import {
  FL_STATUS,
  MPC_PROTOCOL,
  DP_MECHANISM,
  HE_SCHEME,
  DEFAULT_CONFIG,
  ensurePrivacyTables,
  createModel,
  trainRound,
  failModel,
  getModel,
  listModels,
  createComputation,
  submitShare,
  getComputation,
  listComputations,
  dpPublish,
  heQuery,
  getPrivacyReport,
  // V2 surface
  FL_STATUS_V2,
  MPC_STATUS_V2,
  DP_MECHANISM_V2,
  HE_SCHEME_V2,
  MPC_PROTOCOL_V2,
  PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS,
  setMaxActiveMpcComputations,
  getMaxActiveMpcComputations,
  getActiveMpcCount,
  setPrivacyBudgetLimit,
  getPrivacyBudgetLimit,
  getPrivacyBudgetSpent,
  resetPrivacyBudget,
  createModelV2,
  trainRoundV2,
  aggregateRound,
  failModelV2,
  setFLStatusV2,
  createComputationV2,
  submitShareV2,
  failComputation,
  setMPCStatusV2,
  dpPublishV2,
  heQueryV2,
  getPrivacyStatsV2,
} from "../lib/privacy-computing.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerPrivacyCommand(program) {
  const pc = new Command("privacy")
    .description("Privacy computing (Phase 91)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensurePrivacyTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  pc.command("protocols")
    .description("List MPC protocols")
    .option("--json", "JSON output")
    .action((opts) => {
      const protocols = Object.values(MPC_PROTOCOL);
      if (opts.json) return console.log(JSON.stringify(protocols, null, 2));
      for (const p of protocols)
        console.log(
          `  ${p.id.padEnd(10)} ${p.name.padEnd(26)} ${p.description}`,
        );
    });

  pc.command("dp-mechanisms")
    .description("List differential privacy mechanisms")
    .option("--json", "JSON output")
    .action((opts) => {
      const mechs = Object.values(DP_MECHANISM);
      if (opts.json) return console.log(JSON.stringify(mechs, null, 2));
      for (const m of mechs)
        console.log(
          `  ${m.id.padEnd(14)} ${m.name.padEnd(14)} ${m.description}`,
        );
    });

  pc.command("he-schemes")
    .description("List homomorphic encryption schemes")
    .option("--json", "JSON output")
    .action((opts) => {
      const schemes = Object.values(HE_SCHEME);
      if (opts.json) return console.log(JSON.stringify(schemes, null, 2));
      for (const s of schemes)
        console.log(
          `  ${s.id.padEnd(12)} ${s.name.padEnd(12)} ${s.description}`,
        );
    });

  pc.command("fl-statuses")
    .description("List federated learning statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(FL_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  /* ── Federated Learning ──────────────────────────── */

  pc.command("create-model <name>")
    .description("Create federated learning model")
    .option("-t, --type <type>", "Model type", "neural_network")
    .option("-a, --arch <architecture>", "Architecture", "mlp")
    .option("-r, --rounds <n>", "Total training rounds", parseInt)
    .option("-l, --lr <rate>", "Learning rate", parseFloat)
    .option("-p, --participants <n>", "Participant count", parseInt)
    .option("--json", "JSON output")
    .action((name, opts) => {
      const db = _dbFromCtx(pc);
      const result = createModel(db, name, {
        modelType: opts.type,
        architecture: opts.arch,
        totalRounds: opts.rounds,
        learningRate: opts.lr,
        participants: opts.participants,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Model created: ${result.modelId}`);
    });

  pc.command("train <model-id>")
    .description("Run one training round")
    .option("--json", "JSON output")
    .action((modelId, opts) => {
      const db = _dbFromCtx(pc);
      const result = trainRound(db, modelId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.trained)
        console.log(
          `Round ${result.round}: accuracy=${result.accuracy} status=${result.status}`,
        );
      else console.log(`Failed: ${result.reason}`);
    });

  pc.command("fail-model <model-id>")
    .description("Mark model as failed")
    .option("-r, --reason <text>", "Failure reason")
    .option("--json", "JSON output")
    .action((modelId, opts) => {
      const db = _dbFromCtx(pc);
      const result = failModel(db, modelId, opts.reason);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.failed ? "Model marked as failed." : `Failed: ${result.reason}`,
      );
    });

  pc.command("show-model <model-id>")
    .description("Show model details")
    .option("--json", "JSON output")
    .action((modelId, opts) => {
      const db = _dbFromCtx(pc);
      const m = getModel(db, modelId);
      if (!m) return console.log("Model not found.");
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`ID:            ${m.id}`);
      console.log(`Name:          ${m.name}`);
      console.log(`Type:          ${m.model_type}`);
      console.log(`Architecture:  ${m.architecture}`);
      console.log(`Status:        ${m.status}`);
      console.log(`Round:         ${m.current_round}/${m.total_rounds}`);
      console.log(`Accuracy:      ${m.accuracy}`);
      if (m.loss !== null) console.log(`Loss:          ${m.loss}`);
      console.log(`Privacy spent: ${m.privacy_budget_spent}`);
    });

  pc.command("models")
    .description("List federated learning models")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(pc);
      const models = listModels(db, {
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(models, null, 2));
      if (models.length === 0) return console.log("No models.");
      for (const m of models) {
        console.log(
          `  ${m.status.padEnd(14)} ${m.name.padEnd(20)} ${m.current_round}/${m.total_rounds}  acc=${m.accuracy}  ${m.id.slice(0, 8)}`,
        );
      }
    });

  /* ── MPC Computation ─────────────────────────────── */

  pc.command("create-computation <type>")
    .description("Create MPC computation")
    .option("-p, --protocol <proto>", "Protocol (shamir/beaver/gmw)", "shamir")
    .option("-i, --participants <ids>", "Comma-separated participant IDs")
    .option("-t, --threshold <n>", "Shares required", parseInt)
    .option("--json", "JSON output")
    .action((type, opts) => {
      const db = _dbFromCtx(pc);
      const ids = opts.participants ? opts.participants.split(",") : [];
      const result = createComputation(db, type, {
        protocol: opts.protocol,
        participantIds: ids,
        sharesRequired: opts.threshold,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.computationId)
        console.log(`Computation created: ${result.computationId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  pc.command("submit-share <computation-id>")
    .description("Submit a share to MPC computation")
    .option("--json", "JSON output")
    .action((computationId, opts) => {
      const db = _dbFromCtx(pc);
      const result = submitShare(db, computationId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.submitted)
        console.log(
          `Share submitted (${result.sharesReceived} received, status=${result.status})`,
        );
      else console.log(`Failed: ${result.reason}`);
    });

  pc.command("show-computation <computation-id>")
    .description("Show computation details")
    .option("--json", "JSON output")
    .action((computationId, opts) => {
      const db = _dbFromCtx(pc);
      const c = getComputation(db, computationId);
      if (!c) return console.log("Computation not found.");
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`ID:         ${c.id}`);
      console.log(`Type:       ${c.computation_type}`);
      console.log(`Protocol:   ${c.protocol}`);
      console.log(`Status:     ${c.status}`);
      console.log(`Shares:     ${c.shares_received}/${c.shares_required}`);
      if (c.result_hash) console.log(`Result:     ${c.result_hash}`);
      if (c.computation_time_ms)
        console.log(`Time:       ${c.computation_time_ms}ms`);
    });

  pc.command("computations")
    .description("List MPC computations")
    .option("-p, --protocol <proto>", "Filter by protocol")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(pc);
      const comps = listComputations(db, {
        protocol: opts.protocol,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(comps, null, 2));
      if (comps.length === 0) return console.log("No computations.");
      for (const c of comps) {
        console.log(
          `  ${c.status.padEnd(12)} ${c.protocol.padEnd(8)} ${c.computation_type.padEnd(16)} ${c.shares_received}/${c.shares_required}  ${c.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Differential Privacy ────────────────────────── */

  pc.command("dp-publish")
    .description("Publish data with differential privacy noise")
    .option("-d, --data <json>", "Data (number or JSON array)")
    .option("-e, --epsilon <n>", "Privacy parameter epsilon", parseFloat)
    .option("--delta <n>", "Privacy parameter delta", parseFloat)
    .option(
      "-m, --mechanism <type>",
      "Noise mechanism (laplace/gaussian/exponential)",
    )
    .option("-s, --sensitivity <n>", "Sensitivity", parseFloat)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(pc);
      let data;
      try {
        data = JSON.parse(opts.data || "0");
      } catch (_e) {
        data = parseFloat(opts.data) || 0;
      }
      const result = dpPublish(db, {
        data,
        epsilon: opts.epsilon,
        delta: opts.delta,
        mechanism: opts.mechanism,
        sensitivity: opts.sensitivity,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.published) {
        console.log(`Published: ${JSON.stringify(result.data)}`);
        console.log(
          `Mechanism: ${result.mechanism}  epsilon=${result.epsilon}`,
        );
        console.log(
          `Budget:    ${result.budgetSpent}/${DEFAULT_CONFIG.maxBudget} spent`,
        );
      } else console.log(`Failed: ${result.reason}`);
    });

  /* ── Homomorphic Encryption ──────────────────────── */

  pc.command("he-query")
    .description("Query encrypted data (simulated HE)")
    .option("-d, --data <json>", "Data array (JSON)")
    .option("-o, --operation <op>", "Operation (sum/product/mean/count)")
    .option("-s, --scheme <scheme>", "HE scheme (paillier/bfv/ckks)")
    .option("--json", "JSON output")
    .action((opts) => {
      let data;
      try {
        data = JSON.parse(opts.data || "[]");
      } catch (_e) {
        return console.log("Invalid data JSON.");
      }
      const result = heQuery({
        data,
        operation: opts.operation,
        scheme: opts.scheme,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.result !== null)
        console.log(
          `Result: ${result.result}  (${result.operation} over ${result.inputCount} items, scheme=${result.scheme})`,
        );
      else console.log(`Failed: ${result.reason}`);
    });

  /* ── Report ──────────────────────────────────────── */

  pc.command("report")
    .description("Privacy computing report")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(pc);
      const report = getPrivacyReport(db);
      if (opts.json) return console.log(JSON.stringify(report, null, 2));
      const b = report.privacyBudget;
      console.log(
        `Privacy Budget: ${b.spent}/${b.limit} (${b.remaining} remaining)`,
      );
      const fl = report.federatedLearning;
      console.log(
        `FL Models:      ${fl.totalModels}  (${fl.completed} completed, ${fl.training} training, avg acc=${fl.avgAccuracy})`,
      );
      const mpc = report.mpc;
      console.log(
        `MPC:            ${mpc.totalComputations}  (${mpc.completed} completed, ${mpc.pending} pending)`,
      );
    });

  /* ──────────────────────────────────────────────────────────
   *  V2 — Phase 91
   * ────────────────────────────────────────────────────────── */

  pc.command("fl-statuses-v2")
    .description("List V2 FL statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(FL_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      v.forEach((s) => console.log(s));
    });

  pc.command("mpc-statuses-v2")
    .description("List V2 MPC statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(MPC_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      v.forEach((s) => console.log(s));
    });

  pc.command("dp-mechanisms-v2")
    .description("List V2 DP mechanisms")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(DP_MECHANISM_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      v.forEach((s) => console.log(s));
    });

  pc.command("he-schemes-v2")
    .description("List V2 HE schemes")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(HE_SCHEME_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      v.forEach((s) => console.log(s));
    });

  pc.command("mpc-protocols-v2")
    .description("List V2 MPC protocols")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(MPC_PROTOCOL_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      v.forEach((s) => console.log(s));
    });

  pc.command("default-max-active-mpc")
    .description("Show V2 default max active MPC computations")
    .action(() =>
      console.log(String(PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS)),
    );

  pc.command("max-active-mpc")
    .description("Show current max active MPC computations")
    .action(() => console.log(String(getMaxActiveMpcComputations())));

  pc.command("active-mpc-count")
    .description("Show currently-active MPC computation count")
    .action(() => console.log(String(getActiveMpcCount())));

  pc.command("set-max-active-mpc <n>")
    .description("Set max concurrent active MPC computations")
    .action((n) => {
      setMaxActiveMpcComputations(Number(n));
      console.log(`max-active-mpc = ${getMaxActiveMpcComputations()}`);
    });

  pc.command("budget-limit")
    .description("Show privacy budget limit")
    .action(() => console.log(String(getPrivacyBudgetLimit())));

  pc.command("budget-spent")
    .description("Show privacy budget spent")
    .action(() => console.log(String(getPrivacyBudgetSpent())));

  pc.command("set-budget-limit <n>")
    .description("Set privacy budget limit")
    .action((n) => {
      setPrivacyBudgetLimit(Number(n));
      console.log(`budget-limit = ${getPrivacyBudgetLimit()}`);
    });

  pc.command("reset-budget")
    .description("Reset privacy budget spent counter to 0")
    .action(() => {
      resetPrivacyBudget();
      console.log("budget reset");
    });

  pc.command("create-model-v2 <name>")
    .description("V2 create FL model (throws on invalid input)")
    .option("-t, --total-rounds <n>", "Total rounds (default 10)")
    .option("-l, --learning-rate <n>", "Learning rate (default 0.01)")
    .option("-a, --architecture <arch>", "Architecture")
    .option("-m, --model-type <type>", "Model type")
    .option("--json", "JSON output")
    .action((name, opts) => {
      const db = _dbFromCtx(pc);
      const m = createModelV2(db, {
        name,
        totalRounds: opts.totalRounds ? Number(opts.totalRounds) : undefined,
        learningRate: opts.learningRate ? Number(opts.learningRate) : undefined,
        architecture: opts.architecture,
        modelType: opts.modelType,
      });
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`Model: ${m.id} (${m.name}, rounds=${m.total_rounds})`);
    });

  pc.command("train-round-v2 <model-id>")
    .description("V2 train one FL round (auto initializing → training)")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(pc);
      const m = trainRoundV2(db, id);
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(
        `Round ${m.current_round}/${m.total_rounds}  status=${m.status}  acc=${m.accuracy}`,
      );
    });

  pc.command("aggregate-round <model-id>")
    .description("Aggregate FL round (training → training next / completed)")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(pc);
      const m = aggregateRound(db, id);
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`Model ${m.id} status=${m.status} round=${m.current_round}`);
    });

  pc.command("fail-model-v2 <model-id>")
    .description("V2 fail FL model (any non-terminal → failed)")
    .option("-e, --error <msg>", "Error message")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(pc);
      const m = failModelV2(db, id, { error: opts.error });
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`Model ${m.id} failed: ${m.error_message || ""}`);
    });

  pc.command("set-fl-status <model-id> <status>")
    .description("V2 state-machine guarded FL status setter")
    .option("-a, --accuracy <n>")
    .option("-l, --loss <n>")
    .option("-e, --error <msg>")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(pc);
      const patch = {};
      if (opts.accuracy !== undefined) patch.accuracy = Number(opts.accuracy);
      if (opts.loss !== undefined) patch.loss = Number(opts.loss);
      if (opts.error !== undefined) patch.errorMessage = opts.error;
      const m = setFLStatusV2(db, id, status, patch);
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`Model ${m.id} status=${m.status}`);
    });

  pc.command("create-computation-v2 <type>")
    .description("V2 create MPC computation (throws on invalid input)")
    .option("-p, --protocol <proto>", "Protocol (shamir|beaver|gmw)")
    .option("-i, --participants <csv>", "Comma-separated participant IDs")
    .option("-s, --shares-required <n>", "Shares required")
    .option("--json", "JSON output")
    .action((type, opts) => {
      const db = _dbFromCtx(pc);
      const ids = opts.participants
        ? opts.participants
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const c = createComputationV2(db, {
        computationType: type,
        protocol: opts.protocol,
        participantIds: ids,
        sharesRequired: opts.sharesRequired
          ? Number(opts.sharesRequired)
          : undefined,
      });
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(
        `Computation: ${c.id}  protocol=${c.protocol}  required=${c.shares_required}`,
      );
    });

  pc.command("submit-share-v2 <comp-id>")
    .description("V2 submit MPC share (state-guarded)")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(pc);
      const c = submitShareV2(db, id);
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(
        `Comp ${c.id} shares=${c.shares_received}/${c.shares_required} status=${c.status}`,
      );
    });

  pc.command("fail-computation <comp-id>")
    .description("Fail MPC computation (any non-terminal → failed)")
    .option("-e, --error <msg>")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(pc);
      const c = failComputation(db, id, { error: opts.error });
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`Comp ${c.id} failed: ${c.error_message || ""}`);
    });

  pc.command("set-mpc-status <comp-id> <status>")
    .description("V2 state-machine guarded MPC status setter")
    .option("-h, --result-hash <hash>")
    .option("-e, --error <msg>")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(pc);
      const patch = {};
      if (opts.resultHash !== undefined) patch.resultHash = opts.resultHash;
      if (opts.error !== undefined) patch.errorMessage = opts.error;
      const c = setMPCStatusV2(db, id, status, patch);
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`Comp ${c.id} status=${c.status}`);
    });

  pc.command("dp-publish-v2")
    .description("V2 DP publish (throws on invalid input / exceeded budget)")
    .requiredOption("-d, --data <n>", "Data value", Number)
    .option("-e, --epsilon <n>", "Epsilon", Number)
    .option("--delta <n>", "Delta", Number)
    .option("-m, --mechanism <mech>", "Mechanism")
    .option("-s, --sensitivity <n>", "Sensitivity", Number)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(pc);
      const r = dpPublishV2(db, {
        data: opts.data,
        epsilon: opts.epsilon,
        delta: opts.delta,
        mechanism: opts.mechanism,
        sensitivity: opts.sensitivity,
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(
        `Published: orig=${r.originalValue}  noised=${r.noisedValue}  ε=${r.epsilon}`,
      );
    });

  pc.command("he-query-v2")
    .description("V2 HE query (throws on invalid input)")
    .requiredOption("-o, --operation <op>", "sum|product|mean|count")
    .requiredOption("-d, --data <json>", "JSON array of numbers")
    .option("-s, --scheme <scheme>", "Scheme")
    .option("--json", "JSON output")
    .action((opts) => {
      let data;
      try {
        data = JSON.parse(opts.data);
      } catch (_e) {
        throw new Error("Invalid --data JSON");
      }
      const r = heQueryV2({
        data,
        operation: opts.operation,
        scheme: opts.scheme,
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(
        `Result: ${r.result}  (${r.operation} over ${r.inputCount} items, scheme=${r.scheme})`,
      );
    });

  pc.command("stats-v2")
    .description("V2 all-enum-key zero-init stats")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getPrivacyStatsV2();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Models: ${s.totalModels}  Computations: ${s.totalComputations}`,
      );
      console.log(
        `Active MPC: ${s.activeMpcCount}/${s.maxActiveMpcComputations}`,
      );
      console.log(
        `Budget: ${s.budget.spent}/${s.budget.limit} (${s.budget.remaining} remaining)`,
      );
      console.log(
        `Avg accuracy: ${s.avgAccuracy}  Avg comp time ms: ${s.avgComputationTimeMs}`,
      );
    });

  program.addCommand(pc);
}
