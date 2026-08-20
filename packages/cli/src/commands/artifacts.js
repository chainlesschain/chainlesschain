/**
 * `cc artifacts` — browse/manage the agent-published deliverable store
 * (gap-analysis P1 #10). The `publish_artifact` agent tool copies finished
 * deliverables (reports/patches/screenshots/logs) into
 * `~/.chainlesschain/artifacts/`; this command is the user-facing surface:
 *
 *   cc artifacts list [--session <id>] [--kind <k>] [--json]
 *   cc artifacts show <id> [--json]        public metadata + integrity
 *   cc artifacts open <id>                 audit access, then print local path
 *   cc artifacts remove <id>               settle managed-copy removal
 *   cc artifacts clean [--cleanup-id <id>] settle expired-artifact batch
 */

import chalk from "chalk";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  ArtifactStore,
  publicArtifactMetadata,
} from "../lib/artifact-store.js";
import {
  ARTIFACT_ACCESS_ACTIONS,
  ARTIFACT_ACCESS_CLIENTS,
  authorizeArtifactContentAccess,
  readArtifactAccessLedger,
} from "../lib/artifact-access-ledger.js";
import {
  ARTIFACT_DELETION_CLIENTS,
  readArtifactDeletionLedger,
  settleArtifactDeletion,
} from "../lib/artifact-deletion-ledger.js";
import {
  readArtifactCleanupLedger,
  settleArtifactCleanup,
} from "../lib/artifact-cleanup-ledger.js";
import {
  assessDeliveryEvidence,
  createDeliveryEvidenceRecord,
  DELIVERY_EVIDENCE_SCHEMA,
  verifyDeliveryEvidenceRecord,
} from "../lib/delivery-evidence.js";
import { selectImpactedGates } from "../lib/impacted-gate-selector.js";
import {
  createDeliveryFlow,
  projectDeliveryFlow,
  requestDeliveryAction,
  restoreDeliveryFlow,
  settleDeliveryAction,
  validateDeliveryActionResult,
} from "../lib/delivery-coordinator.js";
import { withFileLock } from "../lib/with-file-lock.js";

export function registerArtifactsCommand(program) {
  const cmd = program
    .command("artifacts")
    .alias("artifact")
    .description(
      "Browse agent-published deliverables (reports/patches/screenshots; see the publish_artifact tool)",
    );

  cmd
    .command("list", { isDefault: true })
    .description("List published artifacts")
    .option("--session <id>", "Only artifacts from one agent session")
    .option(
      "--kind <kind>",
      "Filter by kind (report|patch|screenshot|log|data|other)",
    )
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runArtifactsList(options);
    });

  cmd
    .command("show <id>")
    .description("Show one artifact's public metadata and integrity")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runArtifactsShow(id, options);
    });

  cmd
    .command("open <id>")
    .description("Authorize local content access and print the stored path")
    .action((id) => {
      process.exitCode = runArtifactsOpen(id);
    });

  cmd
    .command("access <id>")
    .description(
      "Authorize one official client action and record content-free access lineage",
    )
    .requiredOption(
      "--client <client>",
      `Declared client (${ARTIFACT_ACCESS_CLIENTS.join("|")})`,
    )
    .requiredOption(
      "--action <action>",
      `Requested action (${ARTIFACT_ACCESS_ACTIONS.join("|")})`,
    )
    .option("--access-id <id>", "Stable id for response-loss retry")
    .option("--json", "Machine-readable authorization and local path")
    .action((id, options) => {
      process.exitCode = runArtifactsAccess(id, options);
    });

  cmd
    .command("access-log")
    .description("Verify and display the content-free artifact access ledger")
    .option("--artifact <id>", "Only events for one artifact id")
    .option("--json", "Machine-readable verified ledger projection")
    .action((options) => {
      process.exitCode = runArtifactsAccessLog(options);
    });

  cmd
    .command("remove <id>")
    .alias("rm")
    .description("Settle and audit removal of one managed artifact copy")
    .option(
      "--client <client>",
      `Declared client (${ARTIFACT_DELETION_CLIENTS.join("|")})`,
      "cli",
    )
    .option("--deletion-id <id>", "Stable id for response-loss recovery")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runArtifactsRemove(id, options);
    });

  cmd
    .command("deletion-log")
    .description(
      "Verify and display the content-free deletion settlement ledger",
    )
    .option("--artifact <id>", "Only events for one artifact id")
    .option("--deletion <id>", "Only events for one deletion id")
    .option("--json", "Machine-readable verified ledger projection")
    .action((options) => {
      process.exitCode = runArtifactsDeletionLog(options);
    });

  cmd
    .command("clean")
    .description("Settle and audit one frozen batch of expired artifacts")
    .option(
      "--client <client>",
      `Declared client (${ARTIFACT_DELETION_CLIENTS.join("|")})`,
      "cli",
    )
    .option("--cleanup-id <id>", "Stable batch id for response-loss recovery")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runArtifactsClean(options);
    });

  cmd
    .command("cleanup-log")
    .description(
      "Verify and display the content-free cleanup settlement ledger",
    )
    .option("--cleanup <id>", "Only events for one cleanup id")
    .option("--artifact <id>", "Only batches containing one artifact id")
    .option("--json", "Machine-readable verified ledger projection")
    .action((options) => {
      process.exitCode = runArtifactsCleanupLog(options);
    });

  cmd
    .command("select-gates <input>")
    .description(
      "Select impacted required gates from an analyzer JSON file (unknowns fall back to the full suite)",
    )
    .option("--json", "Machine-readable JSON output")
    .action((input, options) => {
      process.exitCode = runArtifactsSelectGates(input, options);
    });

  cmd
    .command("delivery-evidence <input>")
    .description(
      "Validate and archive a versioned delivery-evidence JSON record (does not create or merge a PR)",
    )
    .option("--session <id>", "Bind the artifact to an agent session")
    .option("--ttl-days <days>", "Artifact retention in days")
    .option("--json", "Machine-readable JSON output")
    .action((input, options) => {
      process.exitCode = runArtifactsDeliveryEvidence(input, options);
    });

  cmd
    .command("delivery-init <input>")
    .description(
      "Create a resumable delivery-flow snapshot from JSON (no external actions)",
    )
    .option("--json", "Machine-readable JSON output")
    .action((input, options) => {
      process.exitCode = runArtifactsDeliveryInit(input, options);
    });

  cmd
    .command("delivery-step <state>")
    .description(
      "Request or settle one explicit delivery action without invoking an external adapter",
    )
    .option("--action <action>", "Action to request when no effect is pending")
    .option("--payload-file <path>", "Optional action payload JSON")
    .option(
      "--result-file <path>",
      "Versioned effect-bound external/fake result envelope to settle",
    )
    .option(
      "--expected-revision <revision>",
      "Fail closed unless the snapshot still has this revision",
    )
    .option(
      "--expected-state-digest <digest>",
      "Fail closed unless the snapshot still has this sha256 digest",
    )
    .option(
      "--expected-effect-id <effectId>",
      "Fail closed unless this exact effect is still pending",
    )
    .option(
      "--write-state",
      "Atomically persist the CLI-produced next snapshot under a strict lock",
    )
    .option("--json", "Machine-readable JSON output")
    .action((state, options) => {
      process.exitCode = runArtifactsDeliveryStep(state, options);
    });

  cmd
    .command("delivery-run <state>")
    .description(
      "Persist and execute one delivery action through the production GitHub provider",
    )
    .requiredOption("--action <action>", "Exact delivery action to execute")
    .requiredOption(
      "--provider-config <path>",
      "Production gate, preview, review, PR, CI, merge, and archive policy JSON",
    )
    .option("--payload-file <path>", "Optional action payload JSON")
    .option(
      "--expected-revision <revision>",
      "Fail closed unless the snapshot still has this revision",
    )
    .option(
      "--expected-state-digest <digest>",
      "Fail closed unless the snapshot still has this sha256 digest",
    )
    .option("--cwd <path>", "Git worktree used by the production provider")
    .option("--json", "Machine-readable JSON output")
    .action(async (state, options) => {
      process.exitCode = await runArtifactsDeliveryRun(state, options);
    });

  cmd
    .command("delivery-project <state>")
    .description("Validate and project a delivery snapshot for IDE consumption")
    .option("--json", "Machine-readable JSON output")
    .action((state, options) => {
      process.exitCode = runArtifactsDeliveryProject(state, options);
    });
}

export function runArtifactsList(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  let entries = store.list({ sessionId: options.session });
  if (options.kind) {
    entries = entries.filter((e) => e.kind === String(options.kind));
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        { artifacts: entries.map(publicArtifactMetadata) },
        null,
        2,
      ),
    );
    return 0;
  }
  if (entries.length === 0) {
    console.log(
      chalk.dim(
        "No artifacts. Agents publish deliverables with the publish_artifact tool.",
      ),
    );
    return 0;
  }
  for (const e of entries) {
    console.log(
      `${chalk.cyan(e.id)}  ${chalk.bold(e.title)}  ${chalk.dim(
        `[${e.kind}] ${e.mime} ${e.size}B ${e.createdAt}${
          e.sessionId ? ` session=${e.sessionId}` : ""
        }`,
      )}`,
    );
  }
  console.log(
    chalk.dim(`${entries.length} artifact(s). cc artifacts show <id>`),
  );
  return 0;
}

export function runArtifactsShow(id, options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const entry = store.get(id);
  if (!entry) {
    console.error(chalk.red(`No artifact with id "${id}".`));
    return 1;
  }
  const payload = {
    ...publicArtifactMetadata(entry),
    integrity: store.verifyIntegrity(entry),
  };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  for (const [k, v] of Object.entries(payload)) {
    console.log(`${chalk.dim(k.padEnd(11))} ${v == null ? "" : v}`);
  }
  return 0;
}

export function runArtifactsOpen(id, deps = {}) {
  return runArtifactsAccess(id, { client: "cli", action: "open" }, deps);
}

export function runArtifactsAccess(id, options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  try {
    const authorization = (
      deps.authorizeArtifactContentAccess || authorizeArtifactContentAccess
    )(
      store,
      {
        artifactId: id,
        client: options.client,
        action: options.action,
        accessId: options.accessId,
      },
      deps.accessOptions || {},
    );
    const payload = {
      schema: "cc-artifact-content-access-authorization/v1",
      access: authorization.access,
      recorded: authorization.recorded,
      storedPath: authorization.storedPath,
      integrity: authorization.integrity,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(authorization.storedPath);
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-content-access-authorization-error/v1",
          authorized: false,
          error: error.message,
        }),
      );
    } else {
      console.error(chalk.red(`Artifact access failed: ${error.message}`));
    }
    return 1;
  }
}

export function runArtifactsAccessLog(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  try {
    const ledger = (deps.readArtifactAccessLedger || readArtifactAccessLedger)(
      store,
      deps.accessOptions || {},
    );
    const events = options.artifact
      ? ledger.events.filter(
          (event) => event.artifactId === String(options.artifact),
        )
      : ledger.events;
    const projection = {
      ...ledger,
      filtered: Boolean(options.artifact),
      matchedEventCount: events.length,
      events,
    };
    if (options.json) {
      console.log(JSON.stringify(projection, null, 2));
    } else if (events.length === 0) {
      console.log(chalk.dim("No artifact content access events."));
    } else {
      for (const event of events) {
        console.log(
          `${chalk.cyan(event.sequence)}  ${event.artifactId}  ${event.client}/${event.action}  ${event.authorizedAt}  ${event.eventDigest}`,
        );
      }
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-content-access-ledger-error/v1",
          verified: false,
          error: error.message,
        }),
      );
    } else {
      console.error(chalk.red(`Artifact access log failed: ${error.message}`));
    }
    return 1;
  }
}

export function runArtifactsRemove(id, options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const deletionId = String(
    options.deletionId || `delete_${randomUUID().replaceAll("-", "")}`,
  );
  try {
    const result = (deps.settleArtifactDeletion || settleArtifactDeletion)(
      store,
      {
        deletionId,
        artifactId: id,
        reason: "explicit",
        client: options.client || "cli",
      },
      deps.deletionOptions || {},
    );
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return result.found ? 0 : 1;
    }
    if (!result.found) {
      console.error(chalk.red(`No artifact with id "${id}".`));
      return 1;
    }
    console.log(
      chalk.green(`Removed managed copy ${id} (deletion ${deletionId}).`),
    );
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-deletion-error/v1",
          deletionId: error.deletionId || deletionId,
          artifactId: String(id),
          settled: false,
          error: error.message,
        }),
      );
    } else {
      console.error(
        chalk.red(
          `Artifact removal ${error.deletionId || deletionId} is not settled: ${error.message}`,
        ),
      );
    }
    return 1;
  }
}

export function runArtifactsDeletionLog(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  try {
    const ledger = (
      deps.readArtifactDeletionLedger || readArtifactDeletionLedger
    )(store, deps.deletionOptions || {});
    const events = ledger.events.filter(
      (event) =>
        (!options.artifact || event.artifactId === String(options.artifact)) &&
        (!options.deletion || event.deletionId === String(options.deletion)),
    );
    const projection = {
      ...ledger,
      filtered: Boolean(options.artifact || options.deletion),
      matchedEventCount: events.length,
      events,
    };
    if (options.json) {
      console.log(JSON.stringify(projection, null, 2));
    } else if (events.length === 0) {
      console.log(chalk.dim("No artifact deletion settlement events."));
    } else {
      for (const event of events) {
        console.log(
          `${event.sequence}\t${event.phase}\t${event.artifactId}\t${event.deletionId}\t${event.eventDigest}`,
        );
      }
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-deletion-ledger-error/v1",
          verified: false,
          error: error.message,
        }),
      );
    } else {
      console.error(
        chalk.red(`Artifact deletion log failed: ${error.message}`),
      );
    }
    return 1;
  }
}

export function runArtifactsClean(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const cleanupId = String(
    options.cleanupId || `cleanup_${randomUUID().replaceAll("-", "")}`,
  );
  try {
    const result = (deps.settleArtifactCleanup || settleArtifactCleanup)(
      store,
      {
        cleanupId,
        client: options.client || "cli",
      },
      deps.cleanupOptions || {},
    );
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(
      result.removed > 0
        ? chalk.green(
            `Settled cleanup ${cleanupId}: removed ${result.removed} expired artifact(s).`,
          )
        : chalk.dim(`Settled cleanup ${cleanupId}: nothing expired.`),
    );
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-cleanup-error/v1",
          cleanupId: error.cleanupId || cleanupId,
          settled: false,
          ...(error.cleanup ? { cleanup: error.cleanup } : {}),
          error: error.message,
        }),
      );
    } else {
      console.error(
        chalk.red(
          `Artifact cleanup ${error.cleanupId || cleanupId} is not settled: ${error.message}`,
        ),
      );
    }
    return 1;
  }
}

export function runArtifactsCleanupLog(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  try {
    const ledger = (
      deps.readArtifactCleanupLedger || readArtifactCleanupLedger
    )(store, deps.cleanupOptions || {});
    const events = ledger.events.filter(
      (event) =>
        (!options.cleanup || event.cleanupId === String(options.cleanup)) &&
        (!options.artifact ||
          event.items.some(
            (item) => item.artifactId === String(options.artifact),
          )),
    );
    const projection = {
      ...ledger,
      filtered: Boolean(options.cleanup || options.artifact),
      matchedEventCount: events.length,
      events,
    };
    if (options.json) {
      console.log(JSON.stringify(projection, null, 2));
    } else if (events.length === 0) {
      console.log(chalk.dim("No artifact cleanup settlement events."));
    } else {
      for (const event of events) {
        console.log(
          `${event.sequence}\t${event.phase}\t${event.itemCount}\t${event.cleanupId}\t${event.eventDigest}`,
        );
      }
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          schema: "cc-artifact-cleanup-ledger-error/v1",
          verified: false,
          error: error.message,
        }),
      );
    } else {
      console.error(chalk.red(`Artifact cleanup log failed: ${error.message}`));
    }
    return 1;
  }
}

function readJsonFile(inputPath, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  return JSON.parse(readFileSync(inputPath, "utf-8"));
}

export function runArtifactsSelectGates(inputPath, options = {}, deps = {}) {
  try {
    const selection = selectImpactedGates(readJsonFile(inputPath, deps));
    if (options.json) {
      console.log(JSON.stringify(selection, null, 2));
    } else {
      console.log(
        selection.mode === "blocked"
          ? chalk.red(`Gate selection blocked: ${selection.reason}`)
          : chalk.green(
              `Gate selection: ${selection.mode} (${selection.selectedGateIds.join(", ")})`,
            ),
      );
      if (selection.fallback) {
        console.log(
          chalk.yellow(`Full required-suite fallback: ${selection.reason}`),
        );
      }
    }
    return selection.decision === "blocked" ? 1 : 0;
  } catch (error) {
    const payload = {
      schema: "chainlesschain.impacted-gate-selection-error",
      version: 1,
      error: error.message,
    };
    if (options.json) console.error(JSON.stringify(payload));
    else console.error(chalk.red(`Gate selection failed: ${error.message}`));
    return 1;
  }
}

export function runArtifactsDeliveryEvidence(
  inputPath,
  options = {},
  deps = {},
) {
  const store = deps.store || new ArtifactStore();
  try {
    const input = readJsonFile(inputPath, deps);
    const record =
      input?.schema === DELIVERY_EVIDENCE_SCHEMA
        ? input
        : createDeliveryEvidenceRecord(input, { now: deps.now });
    const verification = verifyDeliveryEvidenceRecord(record);
    const readiness = assessDeliveryEvidence(record);
    const recordJson = `${JSON.stringify(record, null, 2)}\n`;
    const digestSuffix = String(record.recordDigest || "unverified")
      .replace(/^sha256:/, "")
      .slice(0, 16);
    const entry = store.publishData({
      data: recordJson,
      fileName: `delivery-evidence-v1-${digestSuffix}.json`,
      title: `Delivery evidence ${digestSuffix}`,
      kind: "data",
      mime: "application/json",
      sessionId: options.session || null,
      ttlDays: options.ttlDays,
      immutable: true,
      recordDigest: record.recordDigest || null,
    });
    const payload = {
      schema: "chainlesschain.delivery-evidence-command-result",
      version: 1,
      archived: true,
      artifact: publicArtifactMetadata(entry),
      artifactIntegrity: store.verifyIntegrity(entry),
      verification,
      readiness,
      record,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        readiness.ready
          ? chalk.green(`Delivery evidence ready: ${entry.id}`)
          : chalk.yellow(
              `Delivery evidence archived but blocked: ${readiness.reason}`,
            ),
      );
      console.log(chalk.dim(store.storedPath(entry)));
    }
    return readiness.ready ? 0 : 1;
  } catch (error) {
    const payload = {
      schema: "chainlesschain.delivery-evidence-command-error",
      version: 1,
      archived: false,
      error: error.message,
    };
    if (options.json) console.error(JSON.stringify(payload));
    else console.error(chalk.red(`Delivery evidence failed: ${error.message}`));
    return 1;
  }
}

function deliveryCommandPayload(state) {
  return {
    schema: "chainlesschain.delivery-flow-command-result",
    version: 1,
    state,
    projection: projectDeliveryFlow(state),
  };
}

function printDeliveryCommandPayload(payload, options) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const projection = payload.projection;
  console.log(
    `${chalk.cyan(projection.flowId || "invalid")}  ${projection.status || "invalid"}/${projection.phase || "unknown"}  revision=${projection.revision ?? "?"}`,
  );
  if (projection.pendingEffect) {
    console.log(
      chalk.yellow(
        `Pending explicit effect: ${projection.pendingEffect.action} (${projection.pendingEffect.id})`,
      ),
    );
  }
  if (projection.stopReason) {
    console.log(chalk.yellow(`Stop reason: ${projection.stopReason}`));
  }
}

export function runArtifactsDeliveryInit(inputPath, options = {}, deps = {}) {
  try {
    const config = readJsonFile(inputPath, deps);
    const state = createDeliveryFlow(config, { now: deps.now });
    const payload = deliveryCommandPayload(state);
    printDeliveryCommandPayload(payload, options);
    return state.status === "blocked" ? 1 : 0;
  } catch (error) {
    const payload = {
      schema: "chainlesschain.delivery-flow-command-error",
      version: 1,
      error: error.message,
    };
    if (options.json) console.error(JSON.stringify(payload));
    else
      console.error(chalk.red(`Delivery flow init failed: ${error.message}`));
    return 1;
  }
}

export function runArtifactsDeliveryStep(statePath, options = {}, deps = {}) {
  try {
    const step = () => {
      let state = restoreDeliveryFlow(readJsonFile(statePath, deps));
      assertDeliveryStepExpectation(state, options);
      if (state.pendingEffect) {
        if (options.action && options.action !== state.pendingEffect.action) {
          throw new Error(
            `snapshot already has pending ${state.pendingEffect.action}; it cannot request ${options.action}`,
          );
        }
        if (!options.resultFile) {
          throw new Error(
            "snapshot has a pending effect; provide --result-file to settle it explicitly",
          );
        }
      } else {
        if (!options.action) {
          throw new Error("--action is required when no effect is pending");
        }
        if (options.expectedEffectId) {
          throw new Error(
            "expected effectId but snapshot has no pending effect",
          );
        }
        const actionPayload = options.payloadFile
          ? readJsonFile(options.payloadFile, deps)
          : {};
        state = requestDeliveryAction(state, options.action, actionPayload, {
          now: deps.now,
        });
      }
      if (options.resultFile) {
        const envelope = readJsonFile(options.resultFile, deps);
        const validation = validateDeliveryActionResult(envelope);
        if (!validation.valid) {
          throw new Error(`invalid action result: ${validation.reason}`);
        }
        if (envelope.effectId !== state.pendingEffect.id) {
          throw new Error(
            "action result effectId does not match pending effect",
          );
        }
        state = settleDeliveryAction(
          state,
          state.pendingEffect.id,
          envelope.result,
          { now: deps.now },
        );
      }
      if (options.writeState) writeDeliveryState(statePath, state, deps);
      return state;
    };
    const state = options.writeState
      ? (deps.withFileLock || withFileLock)(statePath, step, {
          failIfUnavailable: true,
        })
      : step();
    const payload = deliveryCommandPayload(state);
    printDeliveryCommandPayload(payload, options);
    return 0;
  } catch (error) {
    const payload = {
      schema: "chainlesschain.delivery-flow-command-error",
      version: 1,
      error: error.message,
    };
    if (options.json) console.error(JSON.stringify(payload));
    else
      console.error(chalk.red(`Delivery flow step failed: ${error.message}`));
    return 1;
  }
}

/**
 * Execute exactly one production delivery effect. The runner durably records
 * the pending effect before this handler invokes any provider operation and
 * refuses to replay an effect left pending by a crash or ambiguous response.
 */
export async function runArtifactsDeliveryRun(
  statePath,
  options = {},
  deps = {},
) {
  try {
    const providerConfig = readJsonFile(options.providerConfig, deps);
    const payload = options.payloadFile
      ? readJsonFile(options.payloadFile, deps)
      : {};
    const createAdapter =
      deps.createAdapter ||
      (await import("../lib/delivery-production-adapter.js"))
        .createGitHubDeliveryProductionAdapter;
    const adapter = createAdapter(
      {
        cwd: options.cwd || process.cwd(),
        config: providerConfig,
      },
      deps.adapterDeps || {},
    );
    const runAction =
      deps.runAction ||
      (await import("../lib/delivery-production-runner.js"))
        .runDeliveryProductionAction;
    const state = await runAction(
      {
        statePath,
        action: options.action,
        payload,
        expectedRevision: options.expectedRevision,
        expectedStateDigest: options.expectedStateDigest,
        adapter,
      },
      deps.runnerDeps || {},
    );
    printDeliveryCommandPayload(deliveryCommandPayload(state), options);
    return state.status === "stopped" || state.status === "blocked" ? 1 : 0;
  } catch (error) {
    const pending = error.pendingEffect
      ? {
          id: error.pendingEffect.id,
          action: error.pendingEffect.action,
        }
      : null;
    const payload = {
      schema: "chainlesschain.delivery-flow-command-error",
      version: 1,
      error: error.message,
      ...(pending ? { pendingEffect: pending } : {}),
    };
    if (options.json) console.error(JSON.stringify(payload));
    else {
      console.error(
        chalk.red(`Production delivery action failed: ${error.message}`),
      );
      if (pending) {
        console.error(
          chalk.yellow(
            `Effect ${pending.action} (${pending.id}) remains pending; reconcile it before any retry.`,
          ),
        );
      }
    }
    return 1;
  }
}

function assertDeliveryStepExpectation(state, options) {
  if (options.expectedRevision != null) {
    const expected = Number(options.expectedRevision);
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error("expected revision must be a non-negative integer");
    }
    if (state.revision !== expected) {
      throw new Error(
        `stale delivery revision: expected ${expected}, found ${state.revision}`,
      );
    }
  }
  if (
    options.expectedStateDigest &&
    state.stateDigest !== String(options.expectedStateDigest)
  ) {
    throw new Error("stale delivery state digest");
  }
  if (options.expectedEffectId) {
    if (!state.pendingEffect) {
      throw new Error("expected effectId but snapshot has no pending effect");
    }
    if (state.pendingEffect.id !== String(options.expectedEffectId)) {
      throw new Error("stale delivery effectId");
    }
  }
}

function writeDeliveryState(statePath, state, deps = {}) {
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  const renameSync = deps.renameSync || fs.renameSync;
  const rmSync = deps.rmSync || fs.rmSync;
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, statePath);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve the authoritative write error.
    }
    throw error;
  }
}

export function runArtifactsDeliveryProject(
  statePath,
  options = {},
  deps = {},
) {
  try {
    const state = restoreDeliveryFlow(readJsonFile(statePath, deps));
    const payload = deliveryCommandPayload(state);
    printDeliveryCommandPayload(payload, options);
    return 0;
  } catch (error) {
    const payload = {
      schema: "chainlesschain.delivery-flow-command-error",
      version: 1,
      error: error.message,
    };
    if (options.json) console.error(JSON.stringify(payload));
    else
      console.error(
        chalk.red(`Delivery flow projection failed: ${error.message}`),
      );
    return 1;
  }
}
