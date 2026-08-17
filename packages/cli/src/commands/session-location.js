import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  buildExecutionLocationCatalog,
  buildExecutionLocationHandoffPreview,
  computeExecutionLocationTargetFactsDigest,
} from "../lib/execution-location-contract.js";
import { captureAmbientExecutionLocation } from "../lib/execution-location-runtime.js";
import {
  EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
  EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
  attestExecutionLocationTarget,
  readExecutionLocationProfile,
  resumeExecutionLocationTarget,
} from "../lib/execution-location-target.js";
import {
  MAX_SESSION_REPLICA_BYTES,
  SESSION_EXECUTION_LOCATION_HANDOFF_INSTALL_SCHEMA,
  getVerifiedSessionExecutionLocationAuthority,
  installSessionReplica,
  installSessionReplicaWithLocationHandoff,
  readVerifiedTranscriptBytes,
} from "../harness/jsonl-session-store.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../lib/secure-file-identity.js";

const MAX_HANDOFF_FACTS_BYTES = 1024 * 1024;
export const SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";

function readHandoffFacts(filePath, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const withTrustedParent =
    deps.withTrustedFileParentSync || withTrustedFileParentSync;
  return withTrustedParent(
    runtimeFs,
    path.resolve(filePath),
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
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
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        const samePathHandle =
          deps.samePathHandleFileIdentity || samePathHandleFileIdentity;
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandle(before, opened, parentDevice, deps.runtime)
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
          throw new Error(
            `handoff facts exceed ${MAX_HANDOFF_FACTS_BYTES} bytes`,
          );
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
    },
    { runtime: deps.runtime },
  );
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
    authority: authority.authority || "verified-session-start",
    sessionId: authority.sessionId,
    headHash: authority.headHash,
    eventCount: authority.eventCount,
    bindingEventHash: authority.bindingEventHash ?? null,
    bindingEventCount: authority.bindingEventCount ?? null,
    locationHandoff: authority.locationHandoff ?? null,
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

export function projectExecutionLocationTargetAttestation(
  sessionId,
  target,
  factsPath,
  profilePath,
  deps = {},
) {
  const handoff = projectExecutionLocationHandoff(
    sessionId,
    target,
    factsPath,
    deps,
  );
  const profile = (
    deps.readExecutionLocationProfile || readExecutionLocationProfile
  )(profilePath, deps);
  return (deps.attestExecutionLocationTarget || attestExecutionLocationTarget)(
    { handoff, profile },
    deps,
  );
}

export function resumeSessionAtExecutionLocation(
  sessionId,
  target,
  factsPath,
  profilePath,
  expectedTargetFactsDigest,
  deps = {},
) {
  const handoff = projectExecutionLocationHandoff(
    sessionId,
    target,
    factsPath,
    deps,
  );
  const profile = (
    deps.readExecutionLocationProfile || readExecutionLocationProfile
  )(profilePath, deps);
  const transcriptBytes =
    profile.sessionStore?.mode === "replicated"
      ? (deps.readVerifiedTranscriptBytes || readVerifiedTranscriptBytes)(
          sessionId,
        )
      : null;
  const readSourceAuthority = () => {
    const authority = (
      deps.getVerifiedSessionExecutionLocationAuthority ||
      getVerifiedSessionExecutionLocationAuthority
    )(sessionId);
    return {
      sessionId: authority.sessionId,
      headHash: authority.headHash,
      eventCount: authority.eventCount,
    };
  };
  return (deps.resumeExecutionLocationTarget || resumeExecutionLocationTarget)(
    {
      handoff,
      profile,
      expectedTargetFactsDigest,
      transcriptBytes,
      readSourceAuthority,
    },
    deps,
  );
}

function readBoundedReplicaInput(deps = {}) {
  if (process.stdin.isTTY) {
    throw new Error("session replica bytes must be provided on stdin");
  }
  const runtimeFs = deps.fs || fs;
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(
      Math.min(64 * 1024, MAX_SESSION_REPLICA_BYTES + 1 - total),
    );
    const count = runtimeFs.readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > MAX_SESSION_REPLICA_BYTES) {
      throw new Error(
        `session replica exceeds ${MAX_SESSION_REPLICA_BYTES} bytes`,
      );
    }
    chunks.push(chunk.subarray(0, count));
  }
  if (total === 0) throw new Error("session replica stdin is empty");
  return Buffer.concat(chunks, total);
}

export function receiveSessionReplica(
  sessionId,
  expectedHeadHash,
  expectedEventCount,
  expectedTranscriptDigest,
  deps = {},
) {
  const bytes = (deps.readSessionReplicaInput || readBoundedReplicaInput)(deps);
  return (deps.installSessionReplica || installSessionReplica)(
    sessionId,
    bytes,
    {
      headHash: expectedHeadHash,
      eventCount: Number(expectedEventCount),
      transcriptDigest: expectedTranscriptDigest,
    },
  );
}

export function prepareSessionReplicaHandoff(sessionId, options, deps = {}) {
  const bytes = (deps.readSessionReplicaInput || readBoundedReplicaInput)(deps);
  const binding = projectCurrentExecutionLocation({}, deps).binding;
  const targetFactsDigest = computeExecutionLocationTargetFactsDigest(binding);
  if (targetFactsDigest !== String(options.expectedTargetFactsDigest || "")) {
    throw new Error("target facts changed before location handoff append");
  }
  return (
    deps.installSessionReplicaWithLocationHandoff ||
    installSessionReplicaWithLocationHandoff
  )(
    sessionId,
    bytes,
    {
      headHash: options.expectedHeadHash,
      eventCount: Number(options.expectedEventCount),
      transcriptDigest: options.expectedTranscriptDigest,
    },
    {
      profileDigest: options.profileDigest,
      targetEvidenceId: options.targetEvidenceId,
      targetFactsDigest,
      attestationDigest: options.attestationDigest,
      binding,
    },
  );
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
  if (projection.schema === EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA) {
    process.stdout.write(
      `ATTESTED ${projection.binding.location}\nFacts: ${projection.targetFactsDigest}\nAttestation: ${projection.attestationDigest}\nGaps: ${projection.gaps.join(", ")}\n`,
    );
    return;
  }
  if (projection.schema === EXECUTION_LOCATION_TARGET_RESUME_SCHEMA) {
    process.stdout.write(
      `RESUME EXITED ${projection.target}\nReceipt: ${projection.receiptDigest}\nGaps: ${projection.gaps.join(", ")}\n`,
    );
    return;
  }
  if (projection.schema === "chainlesschain.session-replica-install/v1") {
    process.stdout.write(
      `${projection.installed ? "INSTALLED" : "ALREADY PRESENT"} ${projection.sessionId}\nReceipt: ${projection.receiptDigest}\n`,
    );
    return;
  }
  if (projection.schema === SESSION_EXECUTION_LOCATION_HANDOFF_INSTALL_SCHEMA) {
    process.stdout.write(
      `HANDOFF ANCHORED ${projection.sessionId}\nTarget head: ${projection.targetHeadHash}\nReceipt: ${projection.receiptDigest}\n`,
    );
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

export function registerSessionLocationSubcommands(session, deps = {}) {
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
        () => projectCurrentExecutionLocation({}, deps),
        options,
      );
    });

  location
    .command("show <id>")
    .description("Show the execution location anchored by session_start")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runAction(
        () => projectSessionExecutionLocation(id, deps),
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
        () => projectExecutionLocationComparison({}, deps),
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
        () => projectExecutionLocationHandoff(id, target, options.facts, deps),
        options,
      );
    });

  location
    .command("attest <id> <target>")
    .description(
      "Invoke a fixed target-side probe and bind observed host facts to a handoff",
    )
    .requiredOption(
      "--facts <path>",
      "Versioned Git/summary/artifact/permission/target evidence JSON",
    )
    .requiredOption(
      "--profile <path>",
      "Secret-free WSL/SSH/Container target profile JSON",
    )
    .option("--json", "Machine-readable JSON output")
    .action((id, target, options) => {
      process.exitCode = runAction(
        () =>
          projectExecutionLocationTargetAttestation(
            id,
            target,
            options.facts,
            options.profile,
            deps,
          ),
        options,
      );
    });

  location
    .command("receive <id>")
    .description("Install an exact verified session replica from bounded stdin")
    .requiredOption(
      "--expected-head-hash <sha256>",
      "Exact unprefixed transcript head hash",
    )
    .requiredOption(
      "--expected-event-count <count>",
      "Exact transcript event count",
    )
    .requiredOption(
      "--expected-transcript-digest <sha256>",
      "Exact SHA-256 digest of stdin bytes",
    )
    .option("--json", "Machine-readable JSON receipt")
    .action((id, options) => {
      process.exitCode = runAction(
        () =>
          receiveSessionReplica(
            id,
            options.expectedHeadHash,
            options.expectedEventCount,
            options.expectedTranscriptDigest,
            deps,
          ),
        options,
      );
    });

  location
    .command("prepare <id>")
    .description(
      "Install an exact replica and append a canonical target-location handoff",
    )
    .requiredOption(
      "--expected-head-hash <sha256>",
      "Exact unprefixed source transcript head hash",
    )
    .requiredOption(
      "--expected-event-count <count>",
      "Exact source transcript event count",
    )
    .requiredOption(
      "--expected-transcript-digest <sha256>",
      "Exact SHA-256 digest of stdin bytes",
    )
    .requiredOption(
      "--expected-target-facts-digest <sha256>",
      "Stable target facts digest from target attestation",
    )
    .requiredOption("--profile-digest <sha256>", "Exact target profile digest")
    .requiredOption(
      "--target-evidence-id <id>",
      "Exact handoff target evidence id",
    )
    .requiredOption(
      "--attestation-digest <sha256>",
      "Exact target attestation digest",
    )
    .option("--json", "Machine-readable JSON receipt")
    .action((id, options) => {
      process.exitCode = runAction(
        () => prepareSessionReplicaHandoff(id, options, deps),
        options,
      );
    });

  location
    .command("resume <id> <target>")
    .description(
      "Re-attest a target, verify its canonical session replica, and resume there",
    )
    .requiredOption(
      "--facts <path>",
      "Versioned Git/summary/artifact/permission/target evidence JSON",
    )
    .requiredOption(
      "--profile <path>",
      "Secret-free WSL/SSH/Container target profile JSON",
    )
    .requiredOption(
      "--expected-target-facts-digest <sha256>",
      "Exact stable target facts digest from session location attest",
    )
    .option("--json", "Machine-readable JSON receipt after target exit")
    .action((id, target, options) => {
      process.exitCode = runAction(
        () =>
          resumeSessionAtExecutionLocation(
            id,
            target,
            options.facts,
            options.profile,
            options.expectedTargetFactsDigest,
            deps,
          ),
        options,
      );
    });
}
