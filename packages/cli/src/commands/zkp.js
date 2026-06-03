/**
 * ZKP commands
 * chainlesschain zkp compile|prove|verify|identity|stats|circuits|proofs
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureZKPTables,
  compileCircuit,
  generateProof,
  verifyProof,
  createIdentityProof,
  getZKPStats,
  listCircuits,
  listProofs,
  PROOF_SCHEME,
  CIRCUIT_STATUS,
  SUPPORTED_SCHEMES,
  setCircuitStatus,
  registerCredential,
  selectiveDisclose,
  listCredentials,
  // V2 — Phase 88
  PROOF_SCHEME_V2,
  CIRCUIT_STATUS_V2,
  PROOF_STATUS_V2,
  ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR,
  ZKP_DEFAULT_PROOF_EXPIRY_MS,
  setMaxCircuitsPerCreator,
  getMaxCircuitsPerCreator,
  getCircuitCountByCreator,
  setProofExpiryMs,
  getProofExpiryMs,
  compileCircuitV2,
  setCircuitStatusV2,
  generateProofV2,
  verifyProofV2,
  failProof,
  setProofStatus,
  autoExpireProofs,
  selectiveDiscloseV2,
  getZKPStatsV2,
} from "../lib/zkp-engine.js";

export function registerZkpCommand(program) {
  const zkp = program
    .command("zkp")
    .description("Zero-knowledge proof engine — circuits, proofs, identity");

  // zkp compile
  zkp
    .command("compile <name>")
    .description("Compile a ZKP circuit")
    .option("--definition <json>", "Circuit definition as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const def = options.definition || "{}";
        const circuit = compileCircuit(db, name, def);
        logger.success(`Circuit compiled: ${chalk.cyan(name)}`);
        logger.log(
          `  ${chalk.bold("ID:")}           ${chalk.cyan(circuit.id)}`,
        );
        logger.log(`  ${chalk.bold("Constraints:")}  ${circuit.constraints}`);
        logger.log(
          `  ${chalk.bold("VK:")}           ${circuit.verificationKey.slice(0, 16)}...`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp prove
  zkp
    .command("prove <circuit-id>")
    .description("Generate a zero-knowledge proof")
    .option("--private <json>", "Private inputs as JSON")
    .option("--public <json>", "Public inputs as JSON")
    .option("--scheme <scheme>", "Proof scheme (groth16|plonk|bulletproofs)")
    .option("--json", "Output as JSON")
    .action(async (circuitId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const privateInputs = options.private
          ? JSON.parse(options.private)
          : {};
        const publicInputs = options.public ? JSON.parse(options.public) : [];
        const proveOpts = options.scheme ? { scheme: options.scheme } : {};
        const proof = generateProof(
          db,
          circuitId,
          privateInputs,
          publicInputs,
          proveOpts,
        );

        if (options.json) {
          console.log(JSON.stringify(proof, null, 2));
        } else {
          logger.success("Proof generated");
          logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(proof.id)}`);
          logger.log(`  ${chalk.bold("Scheme:")}  ${proof.scheme}`);
          logger.log(`  ${chalk.bold("Circuit:")} ${proof.circuitId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp verify
  zkp
    .command("verify <proof-id>")
    .description("Verify a zero-knowledge proof")
    .option("--json", "Output as JSON")
    .action(async (proofId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const result = verifyProof(db, proofId);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const status = result.valid
            ? chalk.green("VALID")
            : chalk.red("INVALID");
          logger.log(
            `  ${chalk.bold("Proof:")}   ${chalk.cyan(result.proofId)}`,
          );
          logger.log(`  ${chalk.bold("Result:")}  ${status}`);
          logger.log(`  ${chalk.bold("Scheme:")}  ${result.scheme}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp identity
  zkp
    .command("identity")
    .description("Create a selective-disclosure identity proof")
    .option("--claims <json>", "Identity claims as JSON")
    .option("--disclose <fields>", "Comma-separated fields to disclose")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const claims = options.claims ? JSON.parse(options.claims) : {};
        const disclose = options.disclose
          ? options.disclose.split(",").map((s) => s.trim())
          : [];
        const result = createIdentityProof(claims, disclose);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Identity proof created");
          logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(result.id)}`);
          logger.log(`  ${chalk.bold("Type:")}    ${result.type}`);
          logger.log(
            `  ${chalk.bold("Disclosed:")} ${JSON.stringify(result.disclosed)}`,
          );
          logger.log(
            `  ${chalk.bold("Hidden:")}  ${result.hiddenCount} field(s)`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp stats
  zkp
    .command("stats")
    .description("Show ZKP engine statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const stats = getZKPStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Circuits:")}       ${stats.circuits}`);
          logger.log(`  ${chalk.bold("Proofs:")}         ${stats.proofs}`);
          logger.log(
            `  ${chalk.bold("Verified:")}       ${stats.verifiedProofs}`,
          );
          if (stats.credentials !== undefined) {
            logger.log(
              `  ${chalk.bold("Credentials:")}    ${stats.credentials}`,
            );
          }
          if (stats.proofsByScheme) {
            logger.log(`  ${chalk.bold("By scheme:")}`);
            for (const [scheme, count] of Object.entries(
              stats.proofsByScheme,
            )) {
              logger.log(`    ${scheme}: ${count}`);
            }
          }
          if (stats.circuitsByStatus) {
            logger.log(`  ${chalk.bold("Circuit status:")}`);
            for (const [status, count] of Object.entries(
              stats.circuitsByStatus,
            )) {
              logger.log(`    ${status}: ${count}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp circuits
  zkp
    .command("circuits")
    .description("List all compiled circuits")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const circuits = listCircuits(db);
        if (options.json) {
          console.log(JSON.stringify(circuits, null, 2));
        } else {
          if (circuits.length === 0) {
            logger.log("No circuits compiled");
          } else {
            for (const c of circuits) {
              logger.log(
                `  ${chalk.cyan(c.id.slice(0, 8))} ${chalk.bold(c.name)} — ${c.constraints} constraint(s)`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp proofs
  zkp
    .command("proofs")
    .description("List proofs")
    .option("--circuit <id>", "Filter by circuit ID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const proofs = listProofs(db, { circuitId: options.circuit });
        if (options.json) {
          console.log(JSON.stringify(proofs, null, 2));
        } else {
          if (proofs.length === 0) {
            logger.log("No proofs generated");
          } else {
            for (const p of proofs) {
              const status = p.verified
                ? chalk.green("verified")
                : chalk.yellow("unverified");
              logger.log(
                `  ${chalk.cyan(p.id.slice(0, 8))} ${p.scheme} [${status}]`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp schemes
  zkp
    .command("schemes")
    .description("List supported proof schemes and circuit statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const payload = {
          schemes: Array.from(SUPPORTED_SCHEMES),
          proofSchemes: { ...PROOF_SCHEME },
          circuitStatuses: { ...CIRCUIT_STATUS },
        };
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          logger.log(chalk.bold("Proof schemes:"));
          for (const [key, val] of Object.entries(PROOF_SCHEME)) {
            logger.log(`  ${chalk.cyan(key)} → ${val}`);
          }
          logger.log(chalk.bold("Circuit statuses:"));
          for (const [key, val] of Object.entries(CIRCUIT_STATUS)) {
            logger.log(`  ${chalk.cyan(key)} → ${val}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp set-status
  zkp
    .command("set-status <circuit-id> <status>")
    .description("Update circuit status (draft|compiled|verified|failed)")
    .action(async (circuitId, status) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const result = setCircuitStatus(db, circuitId, status);
        logger.success(
          `Circuit ${chalk.cyan(circuitId.slice(0, 8))} → ${chalk.bold(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp register-credential
  zkp
    .command("register-credential")
    .description("Register a credential with selective-disclosure merkle root")
    .option("--did <did>", "Subject DID")
    .option("--claims <json>", "Credential claims as JSON")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const claims = options.claims ? JSON.parse(options.claims) : {};
        const cred = registerCredential(db, {
          did: options.did,
          claims,
        });

        if (options.json) {
          console.log(JSON.stringify(cred, null, 2));
        } else {
          logger.success("Credential registered");
          logger.log(`  ${chalk.bold("ID:")}          ${chalk.cyan(cred.id)}`);
          logger.log(`  ${chalk.bold("DID:")}         ${cred.did || "-"}`);
          logger.log(
            `  ${chalk.bold("MerkleRoot:")}  ${cred.merkleRoot.slice(0, 16)}...`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp disclose
  zkp
    .command("disclose <credential-id> <fields>")
    .description(
      "Selectively disclose credential fields (comma-separated field list)",
    )
    .option("--to <did>", "Recipient DID")
    .option("--json", "Output as JSON")
    .action(async (credentialId, fields, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const disclosed = fields
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const result = selectiveDisclose(
          db,
          credentialId,
          disclosed,
          options.to,
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Selective disclosure created");
          logger.log(
            `  ${chalk.bold("ID:")}          ${chalk.cyan(result.id)}`,
          );
          logger.log(`  ${chalk.bold("Credential:")}  ${result.credentialId}`);
          logger.log(
            `  ${chalk.bold("Disclosed:")}   ${JSON.stringify(result.disclosed)}`,
          );
          logger.log(
            `  ${chalk.bold("Hidden:")}      ${result.hiddenCount} field(s)`,
          );
          logger.log(
            `  ${chalk.bold("MerkleRoot:")}  ${result.merkleRoot.slice(0, 16)}...`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // zkp credentials
  zkp
    .command("credentials")
    .description("List registered credentials")
    .option("--did <did>", "Filter by subject DID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);

        const creds = listCredentials(db, { did: options.did });
        if (options.json) {
          console.log(JSON.stringify(creds, null, 2));
        } else {
          if (creds.length === 0) {
            logger.log("No credentials registered");
          } else {
            for (const c of creds) {
              logger.log(
                `  ${chalk.cyan(c.id.slice(0, 8))} ${c.did || "(no-did)"} — root ${c.merkleRoot.slice(0, 12)}...`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ── V2 — Phase 88 ──────────────────────────────────────── */

  // Enum dumps
  zkp
    .command("proof-schemes-v2")
    .description("List V2 proof schemes")
    .action(() => {
      console.log(JSON.stringify(PROOF_SCHEME_V2, null, 2));
    });

  zkp
    .command("circuit-statuses-v2")
    .description("List V2 circuit statuses")
    .action(() => {
      console.log(JSON.stringify(CIRCUIT_STATUS_V2, null, 2));
    });

  zkp
    .command("proof-statuses-v2")
    .description("List V2 proof statuses (pending/verified/invalid/expired)")
    .action(() => {
      console.log(JSON.stringify(PROOF_STATUS_V2, null, 2));
    });

  zkp
    .command("default-max-circuits-per-creator")
    .description("Show default max circuits per creator")
    .action(() => {
      console.log(ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR);
    });

  zkp
    .command("max-circuits-per-creator")
    .description("Show current max circuits per creator")
    .action(() => {
      console.log(getMaxCircuitsPerCreator());
    });

  zkp
    .command("set-max-circuits-per-creator <n>")
    .description("Set max circuits per creator (positive integer)")
    .action((n) => {
      try {
        setMaxCircuitsPerCreator(Number(n));
        logger.success(
          `Max circuits per creator = ${getMaxCircuitsPerCreator()}`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("circuit-count-by-creator <creator>")
    .description("Count circuits owned by a creator")
    .action((creator) => {
      console.log(getCircuitCountByCreator(creator));
    });

  zkp
    .command("default-proof-expiry-ms")
    .description("Show default proof expiry (ms)")
    .action(() => {
      console.log(ZKP_DEFAULT_PROOF_EXPIRY_MS);
    });

  zkp
    .command("proof-expiry-ms")
    .description("Show current proof expiry (ms)")
    .action(() => {
      console.log(getProofExpiryMs());
    });

  zkp
    .command("set-proof-expiry-ms <ms>")
    .description("Set proof expiry in ms")
    .action((ms) => {
      try {
        setProofExpiryMs(Number(ms));
        logger.success(`Proof expiry = ${getProofExpiryMs()}ms`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("compile-v2 <name>")
    .description("Compile circuit (V2 — creator cap enforced)")
    .option("-d, --definition <json>", "Circuit definition as JSON")
    .option("-c, --creator <did>", "Creator DID")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const def = options.definition ? JSON.parse(options.definition) : {};
        const circuit = compileCircuitV2(db, {
          name,
          definition: def,
          creator: options.creator,
        });
        logger.success(`Circuit compiled (V2): ${chalk.cyan(name)}`);
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(circuit.id)}`);
        if (circuit.creator) {
          logger.log(`  ${chalk.bold("Creator:")} ${circuit.creator}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("set-circuit-status-v2 <circuit-id> <status>")
    .description("Set circuit status (state-machine guarded)")
    .option("-e, --error-message <msg>", "Error message (for failed status)")
    .action(async (circuitId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const patch = {};
        if (options.errorMessage !== undefined) {
          patch.errorMessage = options.errorMessage;
        }
        const updated = setCircuitStatusV2(db, circuitId, status, patch);
        logger.success(`Circuit ${circuitId} → ${updated.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("prove-v2 <circuit-id>")
    .description("Generate proof (V2 — stamps pending + expiresAt)")
    .option("--private <json>", "Private inputs JSON", "{}")
    .option("--public <json>", "Public inputs JSON", "[]")
    .option("-s, --scheme <scheme>", "Proof scheme")
    .action(async (circuitId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const proof = generateProofV2(db, {
          circuitId,
          privateInputs: JSON.parse(options.private),
          publicInputs: JSON.parse(options.public),
          scheme: options.scheme,
        });
        logger.success("Proof generated (V2)");
        logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(proof.id)}`);
        logger.log(`  ${chalk.bold("Status:")}    ${proof.status}`);
        logger.log(
          `  ${chalk.bold("ExpiresAt:")} ${new Date(proof.expiresAt).toISOString()}`,
        );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("verify-v2 <proof-id>")
    .description("Verify proof (V2 — auto-expire past deadline)")
    .action(async (proofId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const result = verifyProofV2(db, proofId);
        if (result.valid) {
          logger.success(`Proof ${proofId} VERIFIED`);
        } else {
          logger.error(
            `Proof ${proofId} INVALID (reason: ${result.reason || result.status})`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("fail-proof <proof-id>")
    .description("Mark proof as invalid")
    .option("-r, --reason <reason>", "Failure reason")
    .action(async (proofId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        failProof(db, proofId, { reason: options.reason });
        logger.success(`Proof ${proofId} → invalid`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("set-proof-status <proof-id> <status>")
    .description("Set proof status (state-machine guarded)")
    .option("-e, --error-message <msg>", "Error message")
    .action(async (proofId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const patch = {};
        if (options.errorMessage !== undefined) {
          patch.errorMessage = options.errorMessage;
        }
        const updated = setProofStatus(db, proofId, status, patch);
        logger.success(`Proof ${proofId} → ${updated.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("auto-expire-proofs")
    .description("Bulk-expire proofs past their deadline")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const expired = autoExpireProofs(db);
        logger.success(`Expired ${expired.length} proofs`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("selective-disclose-v2 <credential-id>")
    .description(
      "Selectively disclose credential fields (requiredFields enforced)",
    )
    .option(
      "-d, --disclosed <fields>",
      "Comma-separated fields to disclose",
      "",
    )
    .option(
      "-r, --required <fields>",
      "Comma-separated fields REQUIRED in disclosure",
      "",
    )
    .option("--recipient <did>", "Recipient DID")
    .action(async (credentialId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const disclosedFields = options.disclosed
          ? options.disclosed
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const requiredFields = options.required
          ? options.required
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        const result = selectiveDiscloseV2(db, {
          credentialId,
          disclosedFields,
          requiredFields,
          recipientDid: options.recipient,
        });
        console.log(JSON.stringify(result, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  zkp
    .command("stats-v2")
    .description("V2 stats (all-enum-key zero init)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        ensureZKPTables(db);
        const stats = getZKPStatsV2();
        console.log(JSON.stringify(stats, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
  registerZkpV2Command(zkp);
}

import {
  ZKP_CIRCUIT_MATURITY_V2,
  ZKP_PROOF_LIFECYCLE_V2,
  registerZkpCircuitV2,
  activateZkpCircuitV2,
  deprecateZkpCircuitV2,
  archiveZkpCircuitV2,
  touchZkpCircuitV2,
  getZkpCircuitV2,
  listZkpCircuitsV2,
  createZkpProofV2,
  startZkpProofV2,
  verifyZkpProofV2,
  failZkpProofV2,
  cancelZkpProofV2,
  getZkpProofV2,
  listZkpProofsV2,
  setMaxActiveZkpCircuitsPerOwnerV2,
  getMaxActiveZkpCircuitsPerOwnerV2,
  setMaxPendingZkpProofsPerCircuitV2,
  getMaxPendingZkpProofsPerCircuitV2,
  setZkpCircuitIdleMsV2,
  getZkpCircuitIdleMsV2,
  setZkpProofStuckMsV2,
  getZkpProofStuckMsV2,
  autoDeprecateIdleZkpCircuitsV2,
  autoFailStuckZkpProofsV2,
  getZkpEngineGovStatsV2,
} from "../lib/zkp-engine.js";

export function registerZkpV2Command(zkp) {
  zkp
    .command("enums-v2")
    .description("Show V2 governance enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { ZKP_CIRCUIT_MATURITY_V2, ZKP_PROOF_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });
  zkp
    .command("register-circuit-v2")
    .description("Register a zkp circuit profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--scheme <scheme>")
    .action((o) => {
      console.log(
        JSON.stringify(
          registerZkpCircuitV2({ id: o.id, owner: o.owner, scheme: o.scheme }),
          null,
          2,
        ),
      );
    });
  zkp
    .command("activate-circuit-v2 <id>")
    .description("Activate circuit")
    .action((id) => {
      console.log(JSON.stringify(activateZkpCircuitV2(id), null, 2));
    });
  zkp
    .command("deprecate-circuit-v2 <id>")
    .description("Deprecate circuit")
    .action((id) => {
      console.log(JSON.stringify(deprecateZkpCircuitV2(id), null, 2));
    });
  zkp
    .command("archive-circuit-v2 <id>")
    .description("Archive circuit (terminal)")
    .action((id) => {
      console.log(JSON.stringify(archiveZkpCircuitV2(id), null, 2));
    });
  zkp
    .command("touch-circuit-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchZkpCircuitV2(id), null, 2));
    });
  zkp
    .command("get-circuit-v2 <id>")
    .description("Get circuit")
    .action((id) => {
      console.log(JSON.stringify(getZkpCircuitV2(id), null, 2));
    });
  zkp
    .command("list-circuits-v2")
    .description("List circuits")
    .action(() => {
      console.log(JSON.stringify(listZkpCircuitsV2(), null, 2));
    });
  zkp
    .command("create-proof-v2")
    .description("Create a zkp proof (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--circuit-id <circuitId>")
    .option("--inputs <inputs>")
    .action((o) => {
      console.log(
        JSON.stringify(
          createZkpProofV2({
            id: o.id,
            circuitId: o.circuitId,
            inputs: o.inputs,
          }),
          null,
          2,
        ),
      );
    });
  zkp
    .command("start-proof-v2 <id>")
    .description("Transition proof to proving")
    .action((id) => {
      console.log(JSON.stringify(startZkpProofV2(id), null, 2));
    });
  zkp
    .command("verify-proof-v2 <id>")
    .description("Transition proof to verified")
    .action((id) => {
      console.log(JSON.stringify(verifyZkpProofV2(id), null, 2));
    });
  zkp
    .command("fail-proof-v2 <id>")
    .description("Fail proof")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(failZkpProofV2(id, o.reason), null, 2));
    });
  zkp
    .command("cancel-proof-v2 <id>")
    .description("Cancel proof")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(cancelZkpProofV2(id, o.reason), null, 2));
    });
  zkp
    .command("get-proof-v2 <id>")
    .description("Get proof")
    .action((id) => {
      console.log(JSON.stringify(getZkpProofV2(id), null, 2));
    });
  zkp
    .command("list-proofs-v2")
    .description("List proofs")
    .action(() => {
      console.log(JSON.stringify(listZkpProofsV2(), null, 2));
    });
  zkp
    .command("set-max-active-circuits-v2 <n>")
    .description("Set per-owner active cap")
    .action((n) => {
      setMaxActiveZkpCircuitsPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          { maxActiveZkpCircuitsPerOwner: getMaxActiveZkpCircuitsPerOwnerV2() },
          null,
          2,
        ),
      );
    });
  zkp
    .command("set-max-pending-proofs-v2 <n>")
    .description("Set per-circuit pending cap")
    .action((n) => {
      setMaxPendingZkpProofsPerCircuitV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingZkpProofsPerCircuit: getMaxPendingZkpProofsPerCircuitV2(),
          },
          null,
          2,
        ),
      );
    });
  zkp
    .command("set-circuit-idle-ms-v2 <n>")
    .description("Set idle threshold")
    .action((n) => {
      setZkpCircuitIdleMsV2(Number(n));
      console.log(
        JSON.stringify({ zkpCircuitIdleMs: getZkpCircuitIdleMsV2() }, null, 2),
      );
    });
  zkp
    .command("set-proof-stuck-ms-v2 <n>")
    .description("Set stuck threshold")
    .action((n) => {
      setZkpProofStuckMsV2(Number(n));
      console.log(
        JSON.stringify({ zkpProofStuckMs: getZkpProofStuckMsV2() }, null, 2),
      );
    });
  zkp
    .command("auto-deprecate-idle-circuits-v2")
    .description("Auto-deprecate idle circuits")
    .action(() => {
      console.log(JSON.stringify(autoDeprecateIdleZkpCircuitsV2(), null, 2));
    });
  zkp
    .command("auto-fail-stuck-proofs-v2")
    .description("Auto-fail stuck proving proofs")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckZkpProofsV2(), null, 2));
    });
  zkp
    .command("gov-stats-v2")
    .description("V2 governance aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getZkpEngineGovStatsV2(), null, 2));
    });
}
