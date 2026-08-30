import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  DEFAULT_RECORDED_SKILL_POLICY,
  RecordedSkillStore,
  assertRecordedSkillBrowserBinding,
  installRecordedSkillPackage,
  launchPlaywrightRecordedSkillDriver,
  launchPlaywrightRecordedSkillRecorder,
  replayRecordedSkill,
  reviewRecordedSkillDraft,
  stageRecordedSkillPackageRevocation,
} from "../lib/record-replay/index.js";

const MAX_INPUT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;

function collect(value, previous) {
  return [...previous, value];
}

function commandError(code, message) {
  const error = new Error(message);
  error.name = "RecordReplayCommandError";
  error.code = code;
  return error;
}

function readRegularFile(filePath, maxBytes, label) {
  const target = resolve(filePath);
  const entry = lstatSync(target);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maxBytes) {
    throw commandError(
      "CC_RECORD_FILE_UNSAFE",
      `${label} must be a bounded regular file and may not be a symbolic link`,
    );
  }
  return readFileSync(target, "utf8");
}

function readJsonFile(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(readRegularFile(filePath, MAX_INPUT_FILE_BYTES, label));
  } catch (error) {
    if (error?.code) throw error;
    throw commandError("CC_RECORD_JSON_INVALID", `${label} is not valid JSON`);
  }
  return parsed;
}

function writeJsonExclusive(filePath, value) {
  const target = resolve(filePath);
  mkdirSync(dirname(target), { recursive: true });
  const handle = openSync(target, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(handle);
  }
  return target;
}

function parseAssignments(values = [], inputFile) {
  const inputs = {};
  if (inputFile) {
    const fromFile = readJsonFile(inputFile, "input file");
    if (!fromFile || typeof fromFile !== "object" || Array.isArray(fromFile)) {
      throw commandError(
        "CC_RECORD_INPUT_INVALID",
        "input file must contain a JSON object",
      );
    }
    Object.assign(inputs, fromFile);
  }
  for (const assignment of values) {
    const separator = assignment.indexOf("=");
    const name = assignment.slice(0, separator);
    if (
      separator < 1 ||
      !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name) ||
      Object.prototype.hasOwnProperty.call(inputs, name)
    ) {
      throw commandError(
        "CC_RECORD_INPUT_INVALID",
        "each --input must be a unique name=value assignment",
      );
    }
    inputs[name] = assignment.slice(separator + 1);
  }
  return inputs;
}

function reviewProjection(entry) {
  return Object.freeze({
    schema: "chainlesschain.recorded-skill-review-projection/v1",
    name: entry.name,
    revision: entry.revision,
    state: entry.state,
    description: entry.skill.description,
    actions: entry.skill.actions.map((action) => ({ ...action })),
    parameters: entry.skill.parameters.map((parameter) => ({ ...parameter })),
    capabilityManifest: [...entry.skill.capabilityManifest],
    environment: entry.skill.environment,
    failureConditions: [...entry.skill.failureConditions],
    draftDigest: entry.skill.draftDigest,
    approvalDigest: entry.skill.approvalDigest || null,
    lastReplayDigest: entry.lastReplay?.report?.replayDigest || null,
    installation: entry.installation,
    entryDigest: entry.entryDigest,
  });
}

function printReview(entry) {
  const projection = reviewProjection(entry);
  logger.log(chalk.bold(`\nRecorded Skill: ${projection.name}`));
  logger.log(`  state: ${projection.state}  revision: ${projection.revision}`);
  logger.log(`  draft: ${projection.draftDigest}`);
  logger.log(`  capabilities: ${projection.capabilityManifest.join(", ")}`);
  logger.log(`  environment: ${projection.environment.digest}`);
  logger.log(chalk.bold("\nActions:"));
  for (const action of projection.actions) {
    const value =
      "value" in action ? ` value=${JSON.stringify(action.value)}` : "";
    logger.log(
      `  ${action.id} ${action.kind} target=${JSON.stringify(action.target)}${value}`,
    );
  }
  logger.log(chalk.bold("\nParameters:"));
  if (projection.parameters.length === 0) logger.log("  (none)");
  for (const parameter of projection.parameters) {
    logger.log(
      `  ${parameter.name} required=${parameter.required} sensitive=${parameter.sensitive}`,
    );
  }
  logger.log(chalk.bold("\nFailure conditions:"));
  if (projection.failureConditions.length === 0)
    logger.log("  (none declared)");
  for (const condition of projection.failureConditions)
    logger.log(`  - ${condition}`);
  logger.log("");
}

function output(value, options, message) {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (message) logger.success(message);
}

async function guarded(action, options = {}) {
  try {
    await action();
  } catch (error) {
    const code = String(error?.code || "CC_RECORD_COMMAND_FAILED");
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          code,
          error: String(error?.message || "Record & Replay command failed"),
        }),
      );
    } else {
      logger.error(
        `[${code}] ${error?.message || "Record & Replay command failed"}`,
      );
    }
    process.exitCode = 1;
  }
}

async function waitForRecordingStop() {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw commandError(
      "CC_RECORD_INTERACTIVE_REQUIRED",
      "interactive recording requires a TTY; use --automation for headless capture",
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await prompt.question(
      "Interact with the Chromium window, then press Enter here to finish recording. ",
    );
  } finally {
    prompt.close();
  }
}

function parseAssertions(options) {
  if (!options.assertions) return [];
  const assertions = readJsonFile(options.assertions, "assertions file");
  if (!Array.isArray(assertions)) {
    throw commandError(
      "CC_RECORD_ASSERTION_INVALID",
      "assertions file must contain a JSON array",
    );
  }
  return assertions;
}

function parseEnvironment(options) {
  if (!options.environment) return {};
  const environment = readJsonFile(options.environment, "environment file");
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw commandError(
      "CC_RECORD_ENVIRONMENT_INVALID",
      "environment file must contain a JSON object",
    );
  }
  return environment;
}

function parseBrowserTarget(options, { reviewedEnvironment } = {}) {
  const hasFixture =
    typeof options.fixture === "string" && options.fixture.length > 0;
  const hasUrl = typeof options.url === "string" && options.url.length > 0;
  if (hasFixture === hasUrl) {
    throw commandError(
      "CC_RECORD_TARGET_INVALID",
      "provide exactly one --fixture or --url browser target",
    );
  }
  const expectedAdapter = reviewedEnvironment?.adapter;
  if (
    (expectedAdapter === "self-contained-html" && !hasFixture) ||
    (expectedAdapter === "url-origin" && !hasUrl)
  ) {
    throw commandError(
      "CC_RECORD_TARGET_DRIFT",
      "replay target type does not match the reviewed recording",
    );
  }
  const storageState = options.storageState
    ? readJsonFile(options.storageState, "browser storage state")
    : undefined;
  return {
    html: hasFixture
      ? readRegularFile(options.fixture, MAX_FIXTURE_BYTES, "fixture")
      : undefined,
    url: hasUrl ? options.url : undefined,
    allowedOrigins:
      reviewedEnvironment?.networkPolicy?.allowedOrigins ||
      options.allowedOrigin ||
      [],
    identity: reviewedEnvironment?.identity || options.identity || "anonymous",
    storageState,
  };
}

export function registerRecordReplayCommands(skill) {
  const recording = skill
    .command("recording")
    .alias("record-replay")
    .description(
      "Record, review, replay, enable, and govern deterministic UI skills",
    );

  recording
    .command("record <name>")
    .description(
      "Capture a real Chromium interaction into a parameterized draft",
    )
    .option("--fixture <path>", "Self-contained HTML fixture")
    .option(
      "--url <url>",
      "HTTPS target URL (loopback HTTP is allowed for testing)",
    )
    .option(
      "--allowed-origin <origin>",
      "Exact additional network origin; repeat as needed",
      collect,
      [],
    )
    .option("--identity <id>", "Non-secret browser identity label", "anonymous")
    .option(
      "--storage-state <path>",
      "Playwright storage-state JSON (never persisted)",
    )
    .option(
      "--sensitive <parameter>",
      "Mark a captured parameter as sensitive; repeat as needed",
      collect,
      [],
    )
    .option("--description <text>", "Recorded Skill description", "")
    .option("--failure <condition>", "Reviewed failure condition", collect, [])
    .option("--observe <selector>", "Append an observe action", collect, [])
    .option("--assertions <path>", "JSON array of explicit assert actions")
    .option("--environment <path>", "Additional environment requirements JSON")
    .option(
      "--automation <path>",
      "Bounded click/type/select JSON used for headless capture",
    )
    .option("--headless", "Launch Chromium headless")
    .option("--timeout-ms <ms>", "Recorder action timeout", "5000")
    .option("--max-actions <count>", "Maximum captured actions", "256")
    .option("--json", "Machine-readable result")
    .action(async (name, options) =>
      guarded(async () => {
        const target = parseBrowserTarget(options);
        const automation = options.automation
          ? readJsonFile(options.automation, "automation file")
          : null;
        const recorder = await launchPlaywrightRecordedSkillRecorder({
          ...target,
          headless: options.headless === true || Boolean(automation),
          timeoutMs: Number(options.timeoutMs),
          maxActions: Number(options.maxActions),
        });
        try {
          if (automation) await recorder.runAutomation(automation);
          else await waitForRecordingStop();
          const draft = await recorder.finish({
            name,
            description: options.description,
            environment: parseEnvironment(options),
            failureConditions: options.failure,
            observations: options.observe,
            assertions: parseAssertions(options),
            sensitiveParameters: options.sensitive,
          });
          const store = new RecordedSkillStore();
          const entry = store.create({
            draft,
            source: {
              adapter: recorder.adapter,
              targetDigest: recorder.targetDigest,
              browserVersion: recorder.browserVersion,
            },
            actor: "cli-recorder",
          });
          const projection = reviewProjection(entry);
          if (!options.json) printReview(entry);
          output(
            projection,
            options,
            `Recorded draft ${name} at revision ${entry.revision}`,
          );
        } finally {
          await recorder.close();
        }
      }, options),
    );

  recording
    .command("list", { isDefault: true })
    .description("List retained recorded Skills")
    .option("--json", "Machine-readable result")
    .action((options) =>
      guarded(async () => {
        const records = new RecordedSkillStore().list();
        if (options.json) console.log(JSON.stringify({ records }, null, 2));
        else if (records.length === 0) logger.info("No recorded Skills found.");
        else {
          logger.log(chalk.bold(`\nRecorded Skills (${records.length}):\n`));
          for (const record of records) {
            logger.log(
              `  ${chalk.cyan(record.name.padEnd(28))} ${record.state.padEnd(10)} rev ${record.revision}  ${record.actionCount} actions`,
            );
          }
          logger.log("");
        }
      }, options),
    );

  recording
    .command("show <name>")
    .description("Show the exact review projection for one recorded Skill")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        const entry = new RecordedSkillStore().get(name);
        if (options.json)
          console.log(JSON.stringify(reviewProjection(entry), null, 2));
        else printReview(entry);
      }, options),
    );

  recording
    .command("review <name>")
    .description("Review and explicitly approve the current draft revision")
    .requiredOption("--reviewer <id>", "Stable reviewer identity")
    .option(
      "--approve",
      "Approve the displayed exact revision and failure conditions",
    )
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        const store = new RecordedSkillStore();
        const current = store.get(name);
        if (!options.json) printReview(current);
        if (options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "review is read-only without --approve",
          );
        }
        const approved = reviewRecordedSkillDraft(current.skill, {
          reviewerId: options.reviewer,
          approvedCapabilities: current.skill.capabilityManifest,
          acceptedFailureConditions: true,
        });
        const entry = store.approve({
          name,
          expectedRevision: current.revision,
          skill: approved,
          actor: options.reviewer,
        });
        output(
          reviewProjection(entry),
          options,
          `Approved ${name} at revision ${entry.revision}`,
        );
      }, options),
    );

  recording
    .command("replay <name>")
    .description("Replay an approved Skill in ephemeral policy-bound Chromium")
    .option("--fixture <path>", "Original self-contained HTML fixture")
    .option("--url <url>", "Original reviewed HTTPS target URL")
    .option("--storage-state <path>", "Matching Playwright storage-state JSON")
    .option(
      "--input <name=value>",
      "Runtime parameter; repeat as needed",
      collect,
      [],
    )
    .option("--input-file <path>", "JSON object of runtime parameters")
    .option("--timeout-ms <ms>", "Per-action timeout", "5000")
    .option("--settle-ms <ms>", "Post-action settle delay", "25")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        const store = new RecordedSkillStore();
        const current = store.get(name);
        if (
          !["approved", "validated", "enabled", "revoked"].includes(
            current.state,
          )
        ) {
          throw commandError(
            "CC_RECORD_NOT_APPROVED",
            "recorded Skill must be approved before replay",
          );
        }
        const reviewedEnvironment = current.skill.environment.requirements;
        const target = parseBrowserTarget(options, { reviewedEnvironment });
        const driver = await launchPlaywrightRecordedSkillDriver({
          ...target,
          timeoutMs: Number(options.timeoutMs),
          settleMs: Number(options.settleMs),
        });
        try {
          assertRecordedSkillBrowserBinding(driver, {
            source: current.source,
            environment: reviewedEnvironment,
          });
          const startedAt = Date.now();
          const report = await replayRecordedSkill(current.skill, {
            inputs: parseAssignments(options.input, options.inputFile),
            environment: reviewedEnvironment,
            isolation: {
              sandboxed: true,
              network: driver.networkPolicy.mode,
              allowedOrigins: driver.networkPolicy.allowedOrigins,
            },
            executor: driver.executor,
          });
          const entry = store.recordReplay({
            name,
            expectedRevision: current.revision,
            report,
            targetDigest: driver.targetDigest,
            browserVersion: driver.browserVersion,
            durationMs: Date.now() - startedAt,
            actor: "cli-replay",
          });
          output(
            {
              success: true,
              name,
              state: entry.state,
              revision: entry.revision,
              replayDigest: report.replayDigest,
              actionCount: report.receipts.length,
              driver: driver.summary(),
            },
            options,
            `Replay succeeded for ${name} (${report.receipts.length} actions)`,
          );
        } finally {
          await driver.close();
        }
      }, options),
    );

  recording
    .command("enable <name>")
    .description(
      "Install a replay-validated workflow into the existing Skill loader",
    )
    .option("--global", "Install in the global managed Skill layer")
    .option("--approve", "Confirm installation of the exact validated revision")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        if (options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "enablement requires --approve",
          );
        }
        const store = new RecordedSkillStore();
        const current = store.get(name);
        const scope = options.global ? "global" : "project";
        const installed = installRecordedSkillPackage(current, { scope });
        let entry;
        try {
          entry = store.enable({
            name,
            expectedRevision: current.revision,
            scope,
            packageDigest: installed.packageDigest,
            actor: "cli-enable",
          });
        } catch (error) {
          if (installed.created) {
            const rollback = stageRecordedSkillPackageRevocation({
              name,
              scope,
              expectedPackageDigest: installed.packageDigest,
            });
            rollback.commit();
          }
          throw error;
        }
        output(
          {
            success: true,
            name,
            state: entry.state,
            revision: entry.revision,
            scope,
            packageDigest: installed.packageDigest,
          },
          options,
          `Enabled recorded Skill ${name} in the ${scope} layer`,
        );
      }, options),
    );

  recording
    .command("revoke <name>")
    .description("Atomically revoke an enabled generated Skill package")
    .option("--approve", "Confirm revocation of the exact installed package")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        if (options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "revocation requires --approve",
          );
        }
        const store = new RecordedSkillStore();
        const current = store.get(name);
        if (current.state !== "enabled" || !current.installation) {
          throw commandError(
            "CC_RECORD_NOT_ENABLED",
            "recorded Skill is not enabled",
          );
        }
        const staged = stageRecordedSkillPackageRevocation({
          name,
          scope: current.installation.scope,
          expectedPackageDigest: current.installation.packageDigest,
        });
        let entry;
        try {
          entry = store.revoke({
            name,
            expectedRevision: current.revision,
            actor: "cli-revoke",
          });
          staged.commit();
        } catch (error) {
          staged.rollback();
          throw error;
        }
        output(
          { success: true, name, state: entry.state, revision: entry.revision },
          options,
          `Revoked recorded Skill ${name}`,
        );
      }, options),
    );

  recording
    .command("export <name>")
    .description("Export a digest-bound portable record without runtime inputs")
    .requiredOption("--output <path>", "New export JSON path")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        const exported = new RecordedSkillStore().export(name, {
          actor: "cli-export",
        });
        const target = writeJsonExclusive(options.output, exported);
        output(
          {
            success: true,
            name,
            output: target,
            exportDigest: exported.exportDigest,
          },
          options,
          `Exported ${name} to ${target}`,
        );
      }, options),
    );

  recording
    .command("import <path>")
    .description("Import and fully revalidate a portable recorded Skill")
    .option("--json", "Machine-readable result")
    .action((filePath, options) =>
      guarded(async () => {
        const entry = new RecordedSkillStore().import(
          readJsonFile(filePath, "recorded Skill export"),
          { actor: "cli-import" },
        );
        output(
          reviewProjection(entry),
          options,
          `Imported recorded Skill ${entry.name} at revision ${entry.revision}`,
        );
      }, options),
    );

  recording
    .command("delete <name>")
    .description("Delete a retained, non-enabled recorded Skill")
    .option("--approve", "Confirm deletion of the exact current revision")
    .option("--json", "Machine-readable result")
    .action((name, options) =>
      guarded(async () => {
        if (options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "deletion requires --approve",
          );
        }
        const store = new RecordedSkillStore();
        const current = store.get(name);
        const removed = store.delete({
          name,
          expectedRevision: current.revision,
          actor: "cli-delete",
        });
        output(
          { success: true, removed },
          options,
          `Deleted retained recorded Skill ${name}`,
        );
      }, options),
    );

  recording
    .command("audit")
    .description(
      "Verify and display the content-free Record & Replay audit chain",
    )
    .option("--name <name>", "Filter one recorded Skill")
    .option("--json", "Machine-readable result")
    .action((options) =>
      guarded(async () => {
        const events = new RecordedSkillStore().audit({ name: options.name });
        if (options.json) console.log(JSON.stringify({ events }, null, 2));
        else {
          logger.log(
            chalk.bold(`\nRecord & Replay audit events (${events.length}):\n`),
          );
          for (const event of events) {
            logger.log(
              `  #${event.sequence} ${event.action.padEnd(18)} ${event.name.padEnd(24)} rev ${event.revision} ${event.state}`,
            );
          }
          logger.log("");
        }
      }, options),
    );

  recording
    .command("prune")
    .description(
      "Delete expired non-enabled records under the retention policy",
    )
    .option("--approve", "Confirm retention deletion")
    .option("--json", "Machine-readable result")
    .action((options) =>
      guarded(async () => {
        if (options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "retention pruning requires --approve",
          );
        }
        const removed = new RecordedSkillStore().pruneExpired({
          actor: "cli-prune",
        });
        output(
          { success: true, removed },
          options,
          `Pruned ${removed.length} expired recorded Skill record(s)`,
        );
      }, options),
    );

  recording
    .command("policy")
    .description("Show or replace owner policy for retention and capabilities")
    .option("--set <path>", "Validated policy JSON to apply")
    .option("--approve", "Confirm replacement of the current governance policy")
    .option("--json", "Machine-readable result")
    .action((options) =>
      guarded(async () => {
        const store = new RecordedSkillStore();
        if (options.set && options.approve !== true) {
          throw commandError(
            "CC_RECORD_EXPLICIT_APPROVAL_REQUIRED",
            "policy replacement requires --approve",
          );
        }
        const policy = options.set
          ? store.setPolicy(readJsonFile(options.set, "policy file"), {
              actor: "cli-policy",
            })
          : store.policy();
        if (options.json) console.log(JSON.stringify(policy, null, 2));
        else {
          logger.log(chalk.bold("\nRecord & Replay policy:\n"));
          logger.log(JSON.stringify(policy, null, 2));
          logger.log("");
        }
      }, options),
    );

  recording
    .command("policy-template")
    .description("Print the default owner policy JSON")
    .action(() =>
      console.log(JSON.stringify(DEFAULT_RECORDED_SKILL_POLICY, null, 2)),
    );
}
