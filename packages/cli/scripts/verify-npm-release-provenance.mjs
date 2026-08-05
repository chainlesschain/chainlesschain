#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NPM_RELEASE_AUTHORITY = Object.freeze({
  packageName: "chainlesschain",
  repository: "https://github.com/chainlesschain/chainlesschain",
  workflow: ".github/workflows/npm-publish.yml",
  registry: "https://registry.npmjs.org/",
  builder: "https://github.com/actions/runner/github-hosted",
});

const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
const GITHUB_WORKFLOW_BUILD_TYPE =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const IN_TOTO_STATEMENT = "https://in-toto.io/Statement/v1";
const IN_TOTO_PAYLOAD = "application/vnd.in-toto+json";
const SIGSTORE_BUNDLE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const MAX_AUDIT_BYTES = 64 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

function requiredString(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function assertExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual ?? "missing"}`,
    );
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function decodeDssePayload(bundle) {
  const envelope = assertPlainObject(
    bundle?.bundle?.dsseEnvelope,
    "SLSA DSSE envelope",
  );
  assertExact(envelope.payloadType, IN_TOTO_PAYLOAD, "DSSE payload type");
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) {
    throw new Error("SLSA DSSE envelope has no verified signatures");
  }
  const encoded = requiredString(envelope.payload, "DSSE payload");
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("DSSE payload is not canonical base64");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error("DSSE payload size is outside the accepted range");
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("DSSE payload is not valid JSON");
  }
  return assertPlainObject(payload, "SLSA statement");
}

function targetMatches(entry, packageName, version) {
  return entry?.name === packageName && entry?.version === version;
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Consume only entries that npm itself placed in `verified` after
 * `npm audit signatures --include-attestations`. The Sigstore verification is
 * npm's responsibility; this function binds that verified bundle to the exact
 * ChainlessChain release authority.
 */
export function verifyNpmReleaseProvenance(audit, expected) {
  assertPlainObject(audit, "npm signature audit");
  const packageName = requiredString(
    expected?.packageName || NPM_RELEASE_AUTHORITY.packageName,
    "package name",
  );
  const version = requiredString(expected?.version, "version");
  const commit = requiredString(expected?.commit, "commit").toLowerCase();
  const ref = requiredString(expected?.ref, "ref");
  const sha512 = requiredString(expected?.sha512, "sha512").toLowerCase();
  const repository = expected?.repository || NPM_RELEASE_AUTHORITY.repository;
  const workflow = expected?.workflow || NPM_RELEASE_AUTHORITY.workflow;

  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error("commit must be a full 40-character Git SHA");
  }
  if (!/^[0-9a-f]{128}$/u.test(sha512)) {
    throw new Error("sha512 must be a 128-character hexadecimal digest");
  }
  if (!ref.startsWith("refs/tags/v-npm-")) {
    throw new Error("ref must be an immutable v-npm tag ref");
  }
  if (!Array.isArray(audit.invalid)) {
    throw new Error("npm signature audit is missing the invalid list");
  }
  if (audit.invalid.length > 0) {
    throw new Error("npm signature audit contains invalid package signatures");
  }
  if (!Array.isArray(audit.verified)) {
    throw new Error("npm signature audit is missing the verified list");
  }
  const matches = audit.verified.filter((entry) =>
    targetMatches(entry, packageName, version),
  );
  if (matches.length !== 1) {
    const targetMissing = Array.isArray(audit.missing)
      ? audit.missing.some((entry) =>
          targetMatches(entry, packageName, version),
        )
      : false;
    throw new Error(
      targetMissing
        ? `${packageName}@${version} has no verified npm attestation`
        : `expected exactly one verified ${packageName}@${version} entry, found ${matches.length}`,
    );
  }

  const entry = matches[0];
  assertExact(entry.registry, NPM_RELEASE_AUTHORITY.registry, "npm registry");
  const bundles = Array.isArray(entry.attestationBundles)
    ? entry.attestationBundles.filter(
        (candidate) => candidate?.predicateType === SLSA_PREDICATE,
      )
    : [];
  if (bundles.length !== 1) {
    throw new Error(
      `expected exactly one verified SLSA provenance bundle, found ${bundles.length}`,
    );
  }
  const bundle = bundles[0];
  assertExact(
    bundle.bundle?.mediaType,
    SIGSTORE_BUNDLE,
    "Sigstore bundle type",
  );
  const statement = decodeDssePayload(bundle);
  assertExact(statement._type, IN_TOTO_STATEMENT, "in-toto statement type");
  assertExact(statement.predicateType, SLSA_PREDICATE, "SLSA predicate type");

  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) {
    throw new Error("SLSA statement must contain exactly one package subject");
  }
  const subject = statement.subject[0];
  assertExact(
    subject?.name,
    `pkg:npm/${packageName}@${version}`,
    "SLSA package subject",
  );
  assertExact(
    subject?.digest?.sha512?.toLowerCase(),
    sha512,
    "SLSA package sha512",
  );

  const predicate = assertPlainObject(statement.predicate, "SLSA predicate");
  const definition = assertPlainObject(
    predicate.buildDefinition,
    "SLSA build definition",
  );
  assertExact(
    definition.buildType,
    GITHUB_WORKFLOW_BUILD_TYPE,
    "SLSA build type",
  );
  const workflowAuthority = assertPlainObject(
    definition.externalParameters?.workflow,
    "SLSA workflow authority",
  );
  assertExact(workflowAuthority.repository, repository, "workflow repository");
  assertExact(workflowAuthority.path, workflow, "workflow path");
  assertExact(workflowAuthority.ref, ref, "workflow ref");
  assertExact(
    definition.internalParameters?.github?.event_name,
    "push",
    "workflow event",
  );

  if (
    !Array.isArray(definition.resolvedDependencies) ||
    definition.resolvedDependencies.length !== 1
  ) {
    throw new Error(
      "SLSA statement must contain exactly one source dependency",
    );
  }
  const source = definition.resolvedDependencies[0];
  assertExact(source?.uri, `git+${repository}@${ref}`, "source repository ref");
  assertExact(
    source?.digest?.gitCommit?.toLowerCase(),
    commit,
    "source Git commit",
  );

  const runDetails = assertPlainObject(
    predicate.runDetails,
    "SLSA run details",
  );
  assertExact(
    runDetails.builder?.id,
    NPM_RELEASE_AUTHORITY.builder,
    "SLSA builder",
  );
  const invocationId = requiredString(
    runDetails.metadata?.invocationId,
    "SLSA invocation id",
  );
  const invocationPattern = new RegExp(
    `^${escapedRegExp(repository)}/actions/runs/(\\d+)/attempts/(\\d+)$`,
    "u",
  );
  const invocation = invocationId.match(invocationPattern);
  if (!invocation) {
    throw new Error(`SLSA invocation id is outside ${repository}`);
  }

  return {
    schema: 1,
    verifiedAt: new Date().toISOString(),
    verifier: "npm audit signatures --include-attestations",
    package: packageName,
    version,
    sha512,
    repository,
    workflow,
    ref,
    commit,
    builder: NPM_RELEASE_AUTHORITY.builder,
    invocationId,
    runId: Number(invocation[1]),
    attempt: Number(invocation[2]),
    audit: {
      invalid: audit.invalid.length,
      missing: Array.isArray(audit.missing) ? audit.missing.length : null,
    },
  };
}

function readAudit(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIT_BYTES) {
    throw new Error("npm signature audit size is outside the accepted range");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

async function main() {
  const [auditPath, version, commit, ref, sha512, ...extra] =
    process.argv.slice(2);
  if (
    !auditPath ||
    !version ||
    !commit ||
    !ref ||
    !sha512 ||
    extra.length > 0
  ) {
    throw new Error(
      "usage: verify-npm-release-provenance.mjs <npm-audit.json> <version> <commit> <ref> <sha512>",
    );
  }
  const result = verifyNpmReleaseProvenance(readAudit(auditPath), {
    version,
    commit,
    ref,
    sha512,
  });
  const output = path.resolve(
    process.env.CC_NPM_PROVENANCE_OUTPUT || "npm-release-provenance.json",
  );
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Verified npm provenance for ${result.package}@${result.version} from ${result.commit} (run ${result.runId}, attempt ${result.attempt})\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(`npm release provenance error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
