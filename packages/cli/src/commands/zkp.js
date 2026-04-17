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
}
