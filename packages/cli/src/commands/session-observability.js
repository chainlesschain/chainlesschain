import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { numericOption } from "../lib/cli-numeric.js";
import { loadConfig } from "../lib/config-manager.js";
import { mergePricing } from "../lib/llm-pricing.js";
import {
  buildCausalObservabilityReport,
  causalSessionIds,
  createCausalObservabilityLimitTracker,
  createVerifiedSessionObservabilityProjection,
  normalizeCausalRequest,
  projectVerifiedDelivery,
  selectCausalDeliveries,
} from "../lib/causal-observability.js";
import { restoreDeliveryFlow } from "../lib/delivery-coordinator.js";
import { readVerifiedProjection } from "../harness/jsonl-session-store.js";
import { ensurePrivateFile } from "../lib/secure-fs.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../lib/secure-file-identity.js";

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function readTrustedJson(filePath, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const trustedParent =
    deps.withTrustedFileParentSync || withTrustedFileParentSync;
  return trustedParent(
    runtimeFs,
    filePath,
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1
      ) {
        throw new Error(
          `input must be a regular, single-link file: ${filePath}`,
        );
      }
      const size = Number(before.size);
      if (size <= 0 || size > MAX_INPUT_BYTES) {
        throw new Error(
          `input exceeds the safe ${MAX_INPUT_BYTES}-byte limit: ${filePath}`,
        );
      }
      let descriptor = null;
      try {
        descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(`input identity changed while opening: ${filePath}`);
        }
        const bounded = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1);
        let bytesRead = 0;
        while (bytesRead < bounded.length) {
          const count = runtimeFs.readSync(
            descriptor,
            bounded,
            bytesRead,
            bounded.length - bytesRead,
            null,
          );
          if (count === 0) break;
          bytesRead += count;
        }
        if (bytesRead > MAX_INPUT_BYTES) {
          throw new Error(
            `input exceeds the safe ${MAX_INPUT_BYTES}-byte limit: ${filePath}`,
          );
        }
        const body = bounded.subarray(0, bytesRead);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          Number(after.size) !== body.length ||
          !sameFileStatIdentity(opened, after)
        ) {
          throw new Error(`input changed while being read: ${filePath}`);
        }
        return Object.freeze({
          canonicalPath,
          value: JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(body),
          ),
        });
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
  );
}

function atomicWritePrivate(outputPath, contents, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const absolute = path.resolve(outputPath);
  const trustedParent =
    deps.withTrustedFileParentSync || withTrustedFileParentSync;
  return trustedParent(runtimeFs, absolute, ({ canonicalPath, parentPath }) => {
    if (runtimeFs.existsSync(canonicalPath)) {
      throw new Error(
        `output already exists; refusing to overwrite: ${absolute}`,
      );
    }
    const temporary = path.join(
      parentPath,
      `.${path.basename(canonicalPath)}.${randomUUID()}.tmp`,
    );
    let published = false;
    try {
      runtimeFs.writeFileSync(temporary, contents, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      (deps.ensurePrivateFile || ensurePrivateFile)(temporary, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      // Publishing a fully-written hard link is atomic and, unlike rename,
      // fails closed if another writer created the requested output first.
      runtimeFs.linkSync(temporary, canonicalPath);
      published = true;
      runtimeFs.rmSync(temporary);
      (deps.ensurePrivateFile || ensurePrivateFile)(canonicalPath, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      return canonicalPath;
    } catch (error) {
      try {
        runtimeFs.rmSync(temporary, { force: true });
        if (published) runtimeFs.rmSync(canonicalPath, { force: true });
      } catch {
        // Preserve the authoritative write error.
      }
      throw error;
    }
  });
}

function budgetOverrides(options) {
  const parse = (value, name, extra = {}) =>
    value == null
      ? undefined
      : numericOption(value, { name, min: 0, ...extra });
  return {
    maxTokens: parse(options.maxTokens, "--max-tokens", { integer: true }),
    maxUsd: parse(options.maxUsd, "--max-usd"),
    maxRetries: parse(options.maxRetries, "--max-retries", { integer: true }),
    maxRetryRatio: parse(options.maxRetryRatio, "--max-retry-ratio", {
      max: 1,
    }),
    maxToolP95Ms: parse(options.maxToolP95Ms, "--max-tool-p95-ms"),
  };
}

function nonEmptyFilterOption(value, name) {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionFilter(options) {
  return {
    workspaceId: nonEmptyFilterOption(options.workspace, "--workspace"),
    teamId: nonEmptyFilterOption(options.team, "--team"),
    policyId: nonEmptyFilterOption(options.policy, "--policy"),
  };
}

function mergeDefined(base, overrides) {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );
  return Object.fromEntries(
    Object.entries({ ...base, ...definedOverrides }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

export function runSessionObservability(requestPath, options = {}, deps = {}) {
  try {
    const trustedRequest = readTrustedJson(requestPath, deps);
    const request = normalizeCausalRequest(trustedRequest.value);
    const requestDir = path.dirname(trustedRequest.canonicalPath);
    const deliveries = request.deliveryStates.map((statePath) => {
      const resolved = path.resolve(requestDir, statePath);
      const state = (deps.restoreDeliveryFlow || restoreDeliveryFlow)(
        readTrustedJson(resolved, deps).value,
      );
      return projectVerifiedDelivery(state);
    });
    const filter = mergeDefined(request.filter, optionFilter(options));
    const selectedDeliveries = (
      deps.selectCausalDeliveries || selectCausalDeliveries
    )(deliveries, filter);
    const selectedSessionIds = (deps.causalSessionIds || causalSessionIds)(
      selectedDeliveries,
    );
    const limitTracker = (
      deps.createCausalObservabilityLimitTracker ||
      createCausalObservabilityLimitTracker
    )();
    for (const delivery of selectedDeliveries) {
      limitTracker.acceptDelivery(delivery);
    }
    const sessionsById = new Map();
    const pricingTable = (deps.mergePricing || mergePricing)(
      (deps.loadConfig || loadConfig)().llm?.pricing,
    );
    for (const sessionId of selectedSessionIds) {
      const session = (deps.readVerifiedProjection || readVerifiedProjection)(
        sessionId,
        () =>
          (
            deps.createVerifiedSessionObservabilityProjection ||
            createVerifiedSessionObservabilityProjection
          )(sessionId, { pricingTable }),
      );
      limitTracker.acceptSession(session);
      sessionsById.set(sessionId, session);
    }
    const budgets = mergeDefined(request.budgets, budgetOverrides(options));
    const report = (
      deps.buildCausalObservabilityReport || buildCausalObservabilityReport
    )({
      deliveries: selectedDeliveries,
      sessionsById,
      filter,
      budgets,
      pricingTable,
      generatedAt: deps.now ? deps.now() : new Date().toISOString(),
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      const written = atomicWritePrivate(options.output, output, deps);
      if (!options.json) process.stdout.write(`${written}\n`);
    } else {
      process.stdout.write(output);
    }
    if (
      options.strictBudget === true &&
      ["exceeded", "unknown"].includes(report.budget.status)
    ) {
      return 2;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Causal observability failed: ${error.message}\n`);
    return 1;
  }
}

export function registerSessionObservabilitySubcommand(session) {
  session
    .command("observability <request>")
    .description(
      "Export verified token/USD, retry, tool latency, diff, gate, artifact and PR causality",
    )
    .option("--workspace <id>", "Only delivery authority for this workspace")
    .option("--team <id>", "Only delivery authority for this team")
    .option("--policy <id>", "Only delivery authority for this policy")
    .option("--max-tokens <n>", "Alert when aggregate tokens exceed n")
    .option(
      "--max-usd <amount>",
      "Alert when estimated priced USD exceeds amount",
    )
    .option("--max-retries <n>", "Alert when automatic LLM retries exceed n")
    .option(
      "--max-retry-ratio <ratio>",
      "Alert when approximate retry/call ratio exceeds 0..1",
    )
    .option(
      "--max-tool-p95-ms <ms>",
      "Alert when fully observed tool P95 exceeds ms",
    )
    .option(
      "--strict-budget",
      "Exit 2 when a budget is exceeded or cannot be evaluated",
    )
    .option(
      "--output <path>",
      "Atomically write owner-only JSON instead of stdout",
    )
    .option("--json", "Machine-readable output (default when stdout is used)")
    .action((requestPath, options) => {
      process.exitCode = runSessionObservability(requestPath, options);
    });
}
