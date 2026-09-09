#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "../src/lib/config-manager.js";
import {
  computeEvolutionDeploymentDigest as digest,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../src/lib/evolution/evolution-deployment-loader.js";
import { firstBalancedJson } from "../src/lib/json-schema-output.js";

const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const bin = path.join(cliRoot, "bin", "chainlesschain.js");
const startedAt = Date.now();
const root = fs.mkdtempSync(
  path.join(
    fs.realpathSync.native(os.tmpdir()),
    "cc-volcengine-learning-pilot-",
  ),
);

function runCli(args, env, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `CLI ${args.join(" ")} failed (${result.status}): ${[
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }
  return result.stdout;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseCliJson(stdout) {
  const json = firstBalancedJson(stdout, "{");
  if (json) return JSON.parse(json);
  throw new Error("CLI did not return a JSON result");
}

try {
  const config = loadConfig({ failIfUnavailable: true });
  const configured = config?.llm || {};
  const provider = "volcengine";
  const model = configured.model || process.env.LLM_MODEL;
  const baseUrl =
    configured.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
  const apiKey = configured.apiKey || process.env.VOLCENGINE_API_KEY;
  if (configured.provider && configured.provider !== provider) {
    throw new Error(
      `configured provider is ${configured.provider}; this pilot requires volcengine`,
    );
  }
  if (!model) throw new Error("Volcengine model is not configured");
  if (!apiKey) throw new Error("Volcengine API key is not configured");

  const workspace = path.join(root, "workspace");
  const activeRoot = path.join(root, "active-skills");
  const candidateRoot = path.join(root, "candidate-skills");
  const artifactRoot = path.join(root, "evaluation-artifacts");
  const ledgerRoot = path.join(root, "evaluation-ledger-events");
  const ledgerAuthorityRoot = path.join(root, "evaluation-ledger-authority");
  const witnessRoot = path.join(root, "evaluation-witness");
  const witnessFile = path.join(witnessRoot, "checkpoint.json");
  fs.mkdirSync(workspace);
  fs.mkdirSync(activeRoot);
  fs.mkdirSync(witnessRoot);

  const artifactStoreUrl = pathToFileURL(
    path.join(cliRoot, "src", "lib", "artifact-store.js"),
  ).href;
  const artifactPortsUrl = pathToFileURL(
    path.join(
      cliRoot,
      "src",
      "lib",
      "evolution",
      "evolution-artifact-ports.js",
    ),
  ).href;
  const ledgerBackendUrl = pathToFileURL(
    path.join(
      cliRoot,
      "src",
      "lib",
      "evolution",
      "evolution-ledger-file-backend.js",
    ),
  ).href;
  const localSecrets = {
    artifact: randomBytes(32).toString("base64url"),
    ledger: randomBytes(32).toString("base64url"),
    witness: randomBytes(32).toString("base64url"),
    evaluator: randomBytes(32).toString("base64url"),
  };

  const moduleSource = `import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import { ArtifactStore } from ${JSON.stringify(artifactStoreUrl)};
import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA, EvolutionArtifactPorts } from ${JSON.stringify(artifactPortsUrl)};
import { createEvolutionLedgerFileBackend } from ${JSON.stringify(ledgerBackendUrl)};

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
};
const sha256 = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const mac = (secret, message) => createHmac("sha256", secret).update(message).digest("base64url");
const signingAuthority = (label, secret) => {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: "key://local-volcengine-pilot/" + label,
    trustPolicyDigest: sha256(label + "-policy")
  });
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: mac(secret, message) }) },
    verifier: { verify: ({ message, signature }) =>
      signature.algorithm === trust.algorithm &&
      signature.keyId === trust.keyId &&
      signature.trustPolicyDigest === trust.trustPolicyDigest &&
      signature.value === mac(secret, message) }
  };
};
const pilotFilesystem = (() => {
  if (process.platform !== "win32") return fs;
  const directories = new Set();
  let nextDescriptor = -50000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) && fs.fstatSync(descriptor).isDirectory()) return;
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (flags === "r" && ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) && fs.statSync(target).isDirectory()) {
          const descriptor = nextDescriptor--;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    }
  };
})();

export async function createChainlessChainCommandDependencies({ descriptor, factories }) {
    const artifactSecret = ${JSON.stringify(localSecrets.artifact)};
    const ledgerAuthority = signingAuthority("ledger", ${JSON.stringify(localSecrets.ledger)});
    const witnessAuthority = signingAuthority("witness", ${JSON.stringify(localSecrets.witness)});
    const evaluatorSecret = ${JSON.stringify(localSecrets.evaluator)};
    const artifactAlgorithm = "hmac-sha256";
    const artifactKeyId = "key://local-volcengine-pilot/artifact";
    const artifactPolicyDigest = sha256("artifact-policy");
    const artifactPorts = new EvolutionArtifactPorts({
      artifactStore: new ArtifactStore({ dir: ${JSON.stringify(artifactRoot)} }),
      tenantId: "tenant:local-volcengine-pilot",
      audience: "evolution-runtime",
      envelopeSigner: {
        sign: ({ message }) => ({
          algorithm: artifactAlgorithm,
          keyId: artifactKeyId,
          value: mac(artifactSecret, message)
        })
      },
      envelopeVerifier: {
        verify: ({ message, signature }) =>
          signature.algorithm === artifactAlgorithm &&
          signature.keyId === artifactKeyId &&
          signature.value === mac(artifactSecret, message)
      },
      currentAuthorityResolver: {
        resolve: (request) => {
          const checkedAt = new Date().toISOString();
          const core = {
            action: request.action,
            algorithm: artifactAlgorithm,
            allowed: true,
            audience: request.audience,
            checkedAt,
            decisionExpiresAt: new Date(Date.parse(checkedAt) + 30000).toISOString(),
            digest: request.digest,
            issuedAt: request.issuedAt,
            issuedPolicyDigest: request.issuedPolicyDigest,
            issuedPolicyRevision: request.issuedPolicyRevision,
            issuedPolicyTrusted: true,
            keyId: request.keyId || artifactKeyId,
            policyDigest: artifactPolicyDigest,
            policyRevision: 1,
            purpose: request.purpose,
            requestedAt: request.requestedAt,
            retention: request.retention,
            revocationRevision: 1,
            revoked: false,
            schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
            tenantId: request.tenantId,
            type: request.type
          };
          return {
            ...core,
            receiptDigest: sha256("chainlesschain.evolution-artifact-authority-decision/v1\\0" + canonical(core))
          };
        }
      }
    });
    const ledgerArtifactResolver = artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger"
    });
    const backend = createEvolutionLedgerFileBackend({
      rootDir: ${JSON.stringify(ledgerRoot)},
      authorityRootDir: ${JSON.stringify(ledgerAuthorityRoot)},
      witnessFilePath: ${JSON.stringify(witnessFile)},
      witnessId: "local-volcengine-pilot-evaluation-witness",
      ledgerAuthority,
      witnessAuthority,
      artifactResolver: ledgerArtifactResolver,
      fsImpl: pilotFilesystem,
      secure: false
    });
    const evaluationDescriptor = {
      tenantId: "tenant:local-volcengine-pilot",
      artifactTenantId: "tenant:local-volcengine-pilot",
      streamId: "learning-synthesis",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      authorityId: "authority:local-volcengine-pilot-grader",
      revision: 1,
      handlerArtifactDigest: descriptor.moduleDigest
    };
    const verifyEvaluationAttestation = async ({ receiptDigest, candidateDigest, attestation }) =>
      attestation?.algorithm === "hmac-sha256" &&
      attestation?.keyId === "key://local-volcengine-pilot/evaluator" &&
      attestation?.value === mac(evaluatorSecret, receiptDigest + "\\0" + candidateDigest);
    const evaluationLedger = factories.createGovernedSkillSynthesisEvaluationLedgerAdapter({
      descriptor: evaluationDescriptor,
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
      verifyAttestation: verifyEvaluationAttestation
    });
    const generationChat = factories.createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: ${JSON.stringify(model)},
      baseUrl: ${JSON.stringify(baseUrl)},
      apiKey: process.env.VOLCENGINE_API_KEY,
      maxTokens: 1024,
      timeoutMs: 60000
    });
    const graderChat = factories.createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: ${JSON.stringify(model)},
      baseUrl: ${JSON.stringify(baseUrl)},
      apiKey: process.env.VOLCENGINE_API_KEY,
      maxTokens: 2048,
      timeoutMs: 60000
    });
    const deterministicEvaluator = factories.createGovernedSkillSynthesisCandidateEvaluator({
      maxContentBytes: 131072
    });
    const evaluateCandidate = factories.createGovernedSkillSynthesisModelEvaluator({
      descriptor: {
        authorityId: evaluationDescriptor.authorityId,
        revision: evaluationDescriptor.revision,
        handlerArtifactDigest: evaluationDescriptor.handlerArtifactDigest
      },
      deterministicEvaluator,
      graderChat,
      minScore: 0.7,
      maxAttempts: 2,
      attestReceipt: async ({ receiptDigest, candidateDigest }) => ({
        algorithm: "hmac-sha256",
        keyId: "key://local-volcengine-pilot/evaluator",
        value: mac(evaluatorSecret, receiptDigest + "\\0" + candidateDigest)
      }),
      verifyAttestation: verifyEvaluationAttestation,
      receiptPersistence: evaluationLedger.createReceiptPersistencePort()
    });
    return {
      learningSynthesisHost: factories.createGovernedSkillSynthesisCliHost({
        descriptor: {
          tenantId: "tenant:local-volcengine-pilot",
          handlerArtifactDigest: descriptor.moduleDigest
        },
        llmChat: generationChat,
        candidateOutputDir: ${JSON.stringify(candidateRoot)},
        activeSkillsDirs: [${JSON.stringify(activeRoot)}],
        evaluateCandidate,
        synthesis: { minToolCount: 3, minScore: 0.8, minSimilar: 1 }
      })
    };
  }\n`;
  const modulePath = path.join(root, "learning-deployment.mjs");
  fs.writeFileSync(modulePath, moduleSource, { encoding: "utf8", flag: "wx" });
  const moduleDigest = digest(Buffer.from(moduleSource));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRoot = publicKey.export({ type: "spki", format: "pem" });
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest,
    trustRootDigest: digest(trustRoot),
    commands: ["learning"],
  };
  descriptor.signature = sign(
    null,
    Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
    privateKey,
  ).toString("base64");
  const descriptorPath = path.join(root, "descriptor.json");
  const trustRootPath = path.join(root, "trust-root.pem");
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), { flag: "wx" });
  fs.writeFileSync(trustRootPath, trustRoot, { flag: "wx" });

  const trajectories = [
    {
      id: "volcengine-pilot-primary",
      session_id: "volcengine-pilot-session-primary",
      user_intent:
        "Review a service security configuration and report risky settings",
      tool_chain: JSON.stringify([
        {
          tool: "read_config",
          args: { fixture: "synthetic-a" },
          status: "success",
        },
        {
          tool: "analyze_policy",
          args: { fixture: "synthetic-a" },
          status: "success",
        },
        {
          tool: "report_findings",
          args: { fixture: "synthetic-a" },
          status: "success",
        },
      ]),
      tool_count: 3,
      final_response:
        "Synthetic configuration review completed with risky settings reported.",
      outcome_score: 0.95,
      complexity_level: "complex",
      created_at: "2026-09-09 01:00:00",
      completed_at: "2026-09-09 01:01:00",
    },
    {
      id: "volcengine-pilot-similar",
      session_id: "volcengine-pilot-session-similar",
      user_intent: "Audit another service security configuration",
      tool_chain: JSON.stringify([
        {
          tool: "read_config",
          args: { fixture: "synthetic-b" },
          status: "success",
        },
        {
          tool: "analyze_policy",
          args: { fixture: "synthetic-b" },
          status: "success",
        },
        {
          tool: "report_findings",
          args: { fixture: "synthetic-b" },
          status: "success",
        },
      ]),
      tool_count: 3,
      final_response: "Synthetic configuration audit completed.",
      outcome_score: 0.9,
      complexity_level: "complex",
      created_at: "2026-09-09 00:00:00",
      completed_at: "2026-09-09 00:01:00",
    },
  ];
  const inputPath = path.join(root, "trajectories.json");
  fs.writeFileSync(inputPath, JSON.stringify(trajectories), { flag: "wx" });
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    VOLCENGINE_API_KEY: apiKey,
    CHAINLESSCHAIN_HOME: path.join(root, "cli-home"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
  };

  const imported = parseCliJson(
    runCli(
      ["learning", "import", "--input", inputPath, "--json"],
      env,
      workspace,
    ),
  );
  const synthesis = parseCliJson(
    runCli(["learning", "synthesize", "--json"], env, workspace),
  );
  if (synthesis.status !== "completed" || synthesis.created?.length !== 1) {
    throw new Error(
      `expected one accepted candidate, received ${JSON.stringify(synthesis)}`,
    );
  }
  const skillName = synthesis.created[0];
  const skillPath = path.join(candidateRoot, skillName, "1.0.0", "SKILL.md");
  const evaluationPath = path.join(
    candidateRoot,
    skillName,
    "1.0.0",
    "EVALUATION.json",
  );
  const content = fs.readFileSync(skillPath);
  const evaluation = JSON.parse(fs.readFileSync(evaluationPath, "utf8"));
  const activeEntries = fs.readdirSync(activeRoot);
  if (activeEntries.length !== 0) {
    throw new Error("pilot mutated the active Skill root");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schema: "chainlesschain.governed-learning-volcengine-pilot/v1",
        ok: true,
        provider,
        model,
        elapsedMs: Date.now() - startedAt,
        imported: imported.imported,
        synthesis: {
          status: synthesis.status,
          created: synthesis.created,
          skippedCount: synthesis.skipped?.length || 0,
        },
        candidate: {
          skillName,
          contentDigest: sha256(content),
          contentBytes: content.byteLength,
          deterministicPrecheck: "passed",
          modelEvaluation: {
            authenticated: evaluation.receipt.authenticated,
            durable: evaluation.persistence.durable,
            score: evaluation.receipt.modelScore,
            minScore: evaluation.receipt.minScore,
            attempts: evaluation.receipt.attempts,
            receiptDigest: evaluation.receipt.receiptDigest,
            persistenceDigest: evaluation.persistence.persistenceDigest,
            ledgerEventDigest: evaluation.persistence.ledgerEventDigest,
          },
        },
        activeMutationCount: activeEntries.length,
        deployment: {
          descriptorSignature: "verified-by-cli-loader",
          trustRoot: "ephemeral-local-pilot",
          candidateRegistry: "isolated-temporary-directory",
          platform: process.platform,
          nativeDirectoryDurability:
            process.platform === "win32" ? "unavailable" : "required",
        },
        limitations: [
          "no independently operated grader model or authority",
          "grader role is separate but uses the same configured model and provider",
          "evaluation receipt uses ArtifactStore plus a file Ledger and witness",
          "local HMAC authorities are ephemeral and are not production PKI/KMS",
          "Ledger and witness use separate keys but remain on the same host",
          ...(process.platform === "win32"
            ? [
                "Windows pilot uses a test-only directory-fsync compatibility shim; it proves protocol and reopen behavior, not power-loss durability",
              ]
            : []),
          "no promotion or active deployment",
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
