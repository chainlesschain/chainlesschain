#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CERTIFICATE_SHA256 = /^[a-f0-9]{64}$/u;
const TEAM_IDENTIFIER = /^[A-Z0-9]{10}$/u;

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, label) {
  const normalized = String(value || "").trim();
  assertion(
    normalized.length > 0 && normalized.length <= 2048,
    `${label} is required`,
  );
  return normalized;
}

function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function createSignatureEvidence(options) {
  const artifact = path.resolve(options.artifact || "");
  assertion(fs.statSync(artifact).isFile(), "signed artifact is not a file");
  const common = {
    artifactSha256: sha256File(artifact),
    verified: true,
    policyVerified: true,
  };
  if (options.platform === "linux") {
    return Object.freeze({
      kind: "sigstore-keyless",
      ...common,
      transparencyLogVerified: options.transparencyLogVerified === true,
      certificateIdentity: text(
        options.certificateIdentity,
        "certificate identity",
      ),
      certificateOidcIssuer: text(
        options.certificateOidcIssuer,
        "certificate OIDC issuer",
      ),
    });
  }
  if (options.platform === "windows") {
    const certificateSha256 = String(
      options.certificateSha256 || "",
    ).toLowerCase();
    assertion(
      CERTIFICATE_SHA256.test(certificateSha256),
      "Windows signer certificate SHA-256 is invalid",
    );
    return Object.freeze({
      kind: "authenticode",
      ...common,
      timestamped: options.timestamped === true,
      certificateSha256,
      subject: text(options.subject, "Authenticode subject"),
      timestampSubject: text(
        options.timestampSubject,
        "Authenticode timestamp subject",
      ),
    });
  }
  assertion(options.platform === "macos", "unsupported signature platform");
  const teamIdentifier = String(options.teamIdentifier || "").trim();
  assertion(
    TEAM_IDENTIFIER.test(teamIdentifier),
    "macOS TeamIdentifier is invalid",
  );
  return Object.freeze({
    kind: "codesign+notarized",
    ...common,
    notarizationAssessed: options.notarizationAssessed === true,
    teamIdentifier,
    authority: text(options.authority, "code-signing authority"),
    designatedRequirement: text(
      options.designatedRequirement,
      "designated requirement",
    ),
  });
}

async function main(argv = process.argv.slice(2)) {
  const output = argument(argv, "--output");
  assertion(output, "--output is required");
  const evidence = createSignatureEvidence({
    platform: argument(argv, "--platform"),
    artifact: argument(argv, "--artifact"),
    transparencyLogVerified: argv.includes("--transparency-log-verified"),
    certificateIdentity: argument(argv, "--certificate-identity"),
    certificateOidcIssuer: argument(argv, "--certificate-oidc-issuer"),
    timestamped: argv.includes("--timestamped"),
    certificateSha256: argument(argv, "--certificate-sha256"),
    subject: argument(argv, "--subject"),
    timestampSubject: argument(argv, "--timestamp-subject"),
    notarizationAssessed: argv.includes("--notarization-assessed"),
    teamIdentifier: argument(argv, "--team-identifier"),
    authority: argument(argv, "--authority"),
    designatedRequirement: argument(argv, "--designated-requirement"),
  });
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${evidence.kind} signature evidence recorded\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
