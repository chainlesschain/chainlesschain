import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  buildExecutionLocationCatalog,
  buildExecutionLocationHandoffPreview,
} from "../lib/execution-location-contract.js";
import { captureAmbientExecutionLocation } from "../lib/execution-location-runtime.js";
import { getVerifiedSessionExecutionLocationAuthority } from "../harness/jsonl-session-store.js";
import { sameFileStatIdentity } from "../lib/secure-file-identity.js";

const MAX_HANDOFF_FACTS_BYTES = 1024 * 1024;
export const SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";

function readHandoffFacts(filePath, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const absolute = path.resolve(filePath);
  const before = runtimeFs.lstatSync(absolute, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    Number(before.nlink) !== 1
  ) {
    throw new Error("handoff facts must be a regular, single-link file");
  }
  const size = Number(before.size);
  if (size <= 0 || size > MAX_HANDOFF_FACTS_BYTES) {
    throw new Error(
      `handoff facts must be 1..${MAX_HANDOFF_FACTS_BYTES} bytes`,
    );
  }
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      absolute,
      runtimeFs.constants.O_RDONLY |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
    );
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      !(deps.sameFileStatIdentity || sameFileStatIdentity)(before, opened)
    ) {
      throw new Error("handoff facts identity changed while opening");
    }
    const bounded = Buffer.allocUnsafe(MAX_HANDOFF_FACTS_BYTES + 1);
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
    if (bytesRead > MAX_HANDOFF_FACTS_BYTES) {
      throw new Error(`handoff facts exceed ${MAX_HANDOFF_FACTS_BYTES} bytes`);
    }
    const after = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      Number(after.size) !== bytesRead ||
      !(deps.sameFileStatIdentity || sameFileStatIdentity)(opened, after)
    ) {
      throw new Error("handoff facts changed while being read");
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bounded.subarray(0, bytesRead),
      ),
    );
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

export function projectCurrentExecutionLocation(options = {}, deps = {}) {
  const binding = (
    deps.captureAmbientExecutionLocation || captureAmbientExecutionLocation
  )(options, deps);
  return {
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "current-process-observation",
    binding,
  };
}

export function projectSessionExecutionLocation(sessionId, deps = {}) {
  const authority = (
    deps.getVerifiedSessionExecutionLocationAuthority ||
    getVerifiedSessionExecutionLocationAuthority
  )(sessionId);
  return {
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "verified-session-start",
    sessionId: authority.sessionId,
    headHash: authority.headHash,
    eventCount: authority.eventCount,
    binding: authority.binding,
  };
}

export function projectExecutionLocationComparison(options = {}, deps = {}) {
  return buildExecutionLocationCatalog(
    (deps.captureAmbientExecutionLocation || captureAmbientExecutionLocation)(
      options,
      deps,
    ),
  );
}

export function projectExecutionLocationHandoff(
  sessionId,
  target,
  factsPath,
  deps = {},
) {
  const source = projectSessionExecutionLocation(sessionId, deps);
  const facts = (deps.readHandoffFacts || readHandoffFacts)(factsPath, deps);
  return {
    ...buildExecutionLocationHandoffPreview({
      sourceBinding: source.binding,
      sourceAuthority: {
        sessionId: source.sessionId,
        headHash: source.headHash,
        eventCount: source.eventCount,
      },
      target,
      facts,
    }),
    session: {
      sessionId: source.sessionId,
      headHash: source.headHash,
      eventCount: source.eventCount,
    },
  };
}

function renderBinding(binding) {
  const git = binding.source.git;
  return [
    `Location: ${binding.location}`,
    `Observed: ${binding.observed ? "yes" : "no"}`,
    `Working directory: ${binding.source.cwd || "unknown"}`,
    `Git root: ${git.root || "not detected"}`,
    `Git head: ${git.head || "unknown"}`,
    `Git commit: ${git.commit || "unknown"}`,
    `Tools: ${binding.runtime.tools.join(", ") || "none observed"}`,
    `Model: ${binding.model.provider || "unknown"}/${binding.model.name || "unknown"}`,
    `Credential source: ${binding.model.credentialSource}`,
    `Network policy: ${binding.policy.network}`,
    `Sandbox strength: ${binding.policy.sandbox}`,
    `Data boundary: ${binding.policy.dataBoundary.kind} (${binding.policy.dataBoundary.root || "unknown"})`,
    "Remote Control: controls this host; it is not a remote execution location",
  ].join("\n");
}

function writeProjection(projection, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
    return;
  }
  if (projection.binding) {
    process.stdout.write(`${renderBinding(projection.binding)}\n`);
    return;
  }
  if (Array.isArray(projection.locations)) {
    process.stdout.write(
      `${projection.locations
        .map(
          (entry) =>
            `${entry.location.padEnd(10)} ${entry.availability.padEnd(24)} launch=${entry.capabilities.launch} resume=${entry.capabilities.resume} sandbox=${entry.policy.sandbox} network=${entry.policy.network}`,
        )
        .join(
          "\n",
        )}\nRemote Control is a control plane, not an execution location.\n`,
    );
    return;
  }
  process.stdout.write(
    `${projection.allowed ? "ALLOWED" : "BLOCKED"}\n${
      projection.blockers.length > 0
        ? `Blockers:\n${projection.blockers.map((item) => `- ${item}`).join("\n")}\n`
        : ""
    }`,
  );
}

function runAction(action, options = {}) {
  try {
    const projection = action();
    writeProjection(projection, options);
    return projection.allowed === false ? 2 : 0;
  } catch (error) {
    process.stderr.write(`Execution location failed: ${error.message}\n`);
    return 1;
  }
}

export function registerSessionLocationSubcommands(session) {
  const location = session
    .command("location")
    .description(
      "Inspect verified execution location, capabilities, and handoff safety",
    );

  location
    .command("current")
    .description("Observe where this CLI process is executing")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runAction(
        () => projectCurrentExecutionLocation({}, {}),
        options,
      );
    });

  location
    .command("show <id>")
    .description("Show the execution location anchored by session_start")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runAction(
        () => projectSessionExecutionLocation(id),
        options,
      );
    });

  location
    .command("compare")
    .description(
      "Compare current and declared Local/WSL/SSH/Container/Cloud capabilities",
    )
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runAction(
        () => projectExecutionLocationComparison({}, {}),
        options,
      );
    });

  location
    .command("handoff <id> <target>")
    .description("Preview a fail-closed, secret-free session handoff")
    .requiredOption(
      "--facts <path>",
      "Versioned Git/summary/artifact/permission/target evidence JSON",
    )
    .option("--json", "Machine-readable JSON output")
    .action((id, target, options) => {
      process.exitCode = runAction(
        () => projectExecutionLocationHandoff(id, target, options.facts),
        options,
      );
    });
}
