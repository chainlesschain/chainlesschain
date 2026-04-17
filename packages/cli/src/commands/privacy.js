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

  program.addCommand(pc);
}
