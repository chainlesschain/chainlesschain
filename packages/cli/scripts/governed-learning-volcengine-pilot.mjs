#!/usr/bin/env node

import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "../src/lib/config-manager.js";
import { ArtifactStore } from "../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../src/lib/evolution/evolution-artifact-ports.js";
import {
  computeEvolutionDeploymentDigest as digest,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../src/lib/evolution/evolution-deployment-loader.js";
import { createEvolutionLedgerFileBackend } from "../src/lib/evolution/evolution-ledger-file-backend.js";
import { createGovernedSkillSynthesisAttestorTrustLedger } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-ledger.js";
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
let externalAttestorProcess = null;

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

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function pilotSigningAuthority(label, secret) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://local-volcengine-pilot/${label}`,
    trustPolicyDigest: sha256(`${label}-policy`),
  });
  const value = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: value(message) }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === value(message),
    },
  };
}

function pilotDurableFilesystem() {
  if (process.platform !== "win32") return fs;
  const directories = new Set();
  let nextDescriptor = -70_000;
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
        if (
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function openPilotControlResources({
  artifactRoot,
  ledgerRoot,
  ledgerAuthorityRoot,
  witnessFile,
  secrets,
}) {
  const artifactAlgorithm = "hmac-sha256";
  const artifactKeyId = "key://local-volcengine-pilot/artifact";
  const artifactPolicyDigest = sha256("artifact-policy");
  const mac = (message) =>
    createHmac("sha256", secrets.artifact).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({ dir: artifactRoot }),
    tenantId: "tenant:local-volcengine-pilot",
    audience: "evolution-runtime",
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm: artifactAlgorithm,
        keyId: artifactKeyId,
        value: mac(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === artifactAlgorithm &&
        signature.keyId === artifactKeyId &&
        signature.value === mac(message),
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
          decisionExpiresAt: new Date(
            Date.parse(checkedAt) + 30_000,
          ).toISOString(),
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
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: sha256(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const ledgerArtifactResolver =
    artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: ledgerRoot,
    authorityRootDir: ledgerAuthorityRoot,
    witnessFilePath: witnessFile,
    witnessId: "local-volcengine-pilot-evaluation-witness",
    ledgerAuthority: pilotSigningAuthority("ledger", secrets.ledger),
    witnessAuthority: pilotSigningAuthority("witness", secrets.witness),
    artifactResolver: ledgerArtifactResolver,
    fsImpl: pilotDurableFilesystem(),
    secure: false,
  });
  return { artifactPorts, ledgerArtifactResolver, backend };
}

function parseCliJson(stdout) {
  const json = firstBalancedJson(stdout, "{");
  if (json) return JSON.parse(json);
  throw new Error("CLI did not return a JSON result");
}

function waitForLine(stream, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let carry = "";
    const timer = setTimeout(
      () => reject(new Error("local evaluation attestor did not become ready")),
      timeoutMs,
    );
    stream.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolve(carry.slice(0, newline));
    });
    stream.once("error", reject);
  });
}

async function startLocalAttestorService(bootstrap) {
  const servicePath = path.join(
    cliRoot,
    "scripts",
    "governed-learning-local-attestor-service.mjs",
  );
  const child = spawn(process.execPath, [servicePath], {
    env:
      process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
          }
        : {},
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdin.end(`${JSON.stringify(bootstrap)}\n`);
  const ready = JSON.parse(await waitForLine(child.stdout));
  if (ready.ok !== true || ready.serviceId !== bootstrap.serviceId) {
    child.kill("SIGTERM");
    throw new Error(`local evaluation attestor failed: ${stderr}`);
  }
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
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
  const attestorTrustEvidenceFile = path.join(
    root,
    "attestor-trust-evidence.json",
  );
  const externalAttestorServiceId = "kms.local-volcengine-pilot.attestor";
  const externalAttestorCapability = randomBytes(32).toString("base64url");
  const externalAttestorEndpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\cc-evolution-attestor-${randomBytes(12).toString("hex")}`
      : path.join(
          root,
          `cc-evolution-attestor-${randomBytes(12).toString("hex")}.sock`,
        );
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
  };
  const evaluationAttestorKeys = generateKeyPairSync("ed25519");
  const evaluationAttestorPrivateKey = evaluationAttestorKeys.privateKey.export(
    {
      type: "pkcs8",
      format: "pem",
    },
  );
  const evaluationAttestorPublicKey = evaluationAttestorKeys.publicKey.export({
    type: "spki",
    format: "pem",
  });
  const controlResources = openPilotControlResources({
    artifactRoot,
    ledgerRoot,
    ledgerAuthorityRoot,
    witnessFile,
    secrets: localSecrets,
  });
  const attestorTrustControl = createGovernedSkillSynthesisAttestorTrustLedger({
    descriptor: {
      tenantId: "tenant:local-volcengine-pilot",
      artifactTenantId: "tenant:local-volcengine-pilot",
      streamId: "learning-synthesis-attestor-trust",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: controlResources.artifactPorts,
    ledger: controlResources.backend.ledger,
    ledgerArtifactResolver: controlResources.ledgerArtifactResolver,
  });
  const attestorTrustRegistration = await attestorTrustControl.registerKey({
    serviceId: externalAttestorServiceId,
    publicKey: evaluationAttestorPublicKey,
  });
  externalAttestorProcess = await startLocalAttestorService({
    endpoint: externalAttestorEndpoint,
    capabilityToken: externalAttestorCapability,
    serviceId: externalAttestorServiceId,
    privateKeyPem: evaluationAttestorPrivateKey,
  });

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
    const evaluationAttestationVerifier = factories.createGovernedSkillSynthesisAttestorTrustVerifier({
      descriptor: {
        tenantId: evaluationDescriptor.tenantId,
        artifactTenantId: evaluationDescriptor.artifactTenantId,
        streamId: "learning-synthesis-attestor-trust",
        audience: evaluationDescriptor.audience,
        purpose: evaluationDescriptor.purpose
      },
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
      serviceId: ${JSON.stringify(externalAttestorServiceId)}
    });
    fs.writeFileSync(${JSON.stringify(attestorTrustEvidenceFile)}, JSON.stringify({
      verifier: evaluationAttestationVerifier.descriptor
    }));
    const evaluationAttestationAuthority = factories.createGovernedSkillSynthesisExternalAttestationAuthority({
      endpoint: ${JSON.stringify(externalAttestorEndpoint)},
      capabilityToken: ${JSON.stringify(externalAttestorCapability)},
      publicKeyPem: ${JSON.stringify(evaluationAttestorPublicKey)},
      serviceId: ${JSON.stringify(externalAttestorServiceId)},
      timeoutMs: 10000
    });
    const evaluationLedger = factories.createGovernedSkillSynthesisEvaluationLedgerAdapter({
      descriptor: evaluationDescriptor,
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
      attestationAuthority: evaluationAttestationVerifier
    });
    const generationChat = factories.createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: ${JSON.stringify(model)},
      baseUrl: ${JSON.stringify(baseUrl)},
      apiKey: process.env.VOLCENGINE_API_KEY,
      maxTokens: 1024,
      timeoutMs: 60000
    });
    const graderChat = factories.createGovernedSkillSynthesisProcessGrader({
      provider: "volcengine",
      model: ${JSON.stringify(model)},
      baseUrl: ${JSON.stringify(baseUrl)},
      apiKey: process.env.VOLCENGINE_API_KEY,
      maxTokens: 2048,
      timeoutMs: 60000,
      memoryLimitMb: 128
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
      attestationAuthority: evaluationAttestationAuthority,
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
  if (moduleSource.includes(evaluationAttestorPrivateKey)) {
    throw new Error(
      "authenticated CLI deployment must not contain attestor private key material",
    );
  }
  if (
    moduleSource.includes("createGovernedSkillSynthesisAttestorTrustLedger")
  ) {
    throw new Error(
      "authenticated CLI deployment must not receive the attestor trust writer",
    );
  }
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
  const attestorTrustEvidence = JSON.parse(
    fs.readFileSync(attestorTrustEvidenceFile, "utf8"),
  );
  if (evaluation.receipt?.graderIsolation !== "process") {
    throw new Error("pilot grader was not process isolated");
  }
  if (
    evaluation.receipt.graderSandboxProfile !== "network-only" ||
    evaluation.receipt.graderCredentialDelivery !==
      "single-use-broker-reference" ||
    evaluation.receipt.graderCredentialTargetHost !==
      "ark.cn-beijing.volces.com" ||
    evaluation.receipt.graderCredentialMaxUses !== 1 ||
    !Number.isSafeInteger(evaluation.receipt.graderCredentialTtlMs) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      evaluation.receipt.graderCredentialResolverArtifactDigest,
    ) ||
    JSON.stringify(evaluation.receipt.graderRequiredSandboxBoundaries) !==
      JSON.stringify([
        "privilege-reduction",
        "process-tree",
        "resource-limits",
      ]) ||
    evaluation.receipt.graderPersistentProcessAuditRequired !== true
  ) {
    throw new Error("pilot grader sandbox contract was not receipt bound");
  }
  if (
    evaluation.receipt.attestation?.schema !==
      "chainlesschain.skill-synthesis-evaluation-external-attestation/v1" ||
    evaluation.receipt.attestation?.attestorSchema !==
      "chainlesschain.governed-skill-synthesis-external-attestor/v1" ||
    evaluation.receipt.attestation?.algorithm !== "Ed25519" ||
    evaluation.receipt.attestation?.isolation !== "external-service" ||
    evaluation.receipt.attestation?.serviceId !== externalAttestorServiceId ||
    evaluation.receipt.attestation?.transport !== "local-ipc-v1" ||
    evaluation.receipt.attestation?.requestTimeoutMs !== 10_000 ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      evaluation.receipt.attestation?.endpointDigest,
    ) ||
    !/^[a-f0-9]{32}$/u.test(evaluation.receipt.attestation?.requestId)
  ) {
    throw new Error("pilot evaluation attestor was not externally isolated");
  }
  if (
    attestorTrustRegistration.authenticated !== true ||
    attestorTrustRegistration.durable !== true ||
    attestorTrustRegistration.operation !== "register" ||
    attestorTrustRegistration.recovered !== false ||
    !/^sha256:[a-f0-9]{64}$/u.test(attestorTrustRegistration.recordDigest) ||
    attestorTrustEvidence.verifier?.isolation !==
      "durable-ledger-key-lifecycle" ||
    attestorTrustEvidence.verifier?.serviceId !== externalAttestorServiceId
  ) {
    throw new Error("pilot attestor key trust was not durably registered");
  }
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
            graderIsolation: evaluation.receipt.graderIsolation,
            graderWorkerArtifactDigest:
              evaluation.receipt.graderWorkerArtifactDigest,
            graderCredentialResolverArtifactDigest:
              evaluation.receipt.graderCredentialResolverArtifactDigest,
            graderInheritedEnvironment:
              evaluation.receipt.graderInheritedEnvironment,
            graderCredentialDelivery:
              evaluation.receipt.graderCredentialDelivery,
            graderCredentialTargetHost:
              evaluation.receipt.graderCredentialTargetHost,
            graderCredentialMaxUses: evaluation.receipt.graderCredentialMaxUses,
            graderCredentialTtlMs: evaluation.receipt.graderCredentialTtlMs,
            graderSandboxProfile: evaluation.receipt.graderSandboxProfile,
            graderRequiredSandboxBoundaries:
              evaluation.receipt.graderRequiredSandboxBoundaries,
            graderPersistentProcessAuditRequired:
              evaluation.receipt.graderPersistentProcessAuditRequired,
            attestorIsolation: evaluation.receipt.attestation.isolation,
            attestorAlgorithm: evaluation.receipt.attestation.algorithm,
            attestorKeyId: evaluation.receipt.attestation.keyId,
            attestorPublicKeyDigest:
              evaluation.receipt.attestation.publicKeyDigest,
            attestorServiceId: evaluation.receipt.attestation.serviceId,
            attestorTransport: evaluation.receipt.attestation.transport,
            attestorEndpointDigest:
              evaluation.receipt.attestation.endpointDigest,
            attestorRequestTimeoutMs:
              evaluation.receipt.attestation.requestTimeoutMs,
            attestorRequestId: evaluation.receipt.attestation.requestId,
            attestorTrustRecordDigest: attestorTrustRegistration.recordDigest,
            attestorTrustRegistrationRecovered:
              attestorTrustRegistration.recovered,
            attestorTrustVerifierIsolation:
              attestorTrustEvidence.verifier.isolation,
            attestorTrustLedgerId: attestorTrustEvidence.verifier.ledgerId,
            attestorTrustLedgerEpoch: attestorTrustEvidence.verifier.epoch,
          },
        },
        activeMutationCount: activeEntries.length,
        deployment: {
          descriptorSignature: "verified-by-cli-loader",
          trustRoot: "ephemeral-local-pilot",
          candidateRegistry: "isolated-temporary-directory",
          evaluationSigningKeyVisibleToCli: false,
          evaluationSignerBoundary: "separate-local-service-process",
          evaluationSignerTrust:
            "artifactstore-ledger-sequence-bound-key-lifecycle",
          attestorTrustWriterVisibleToCli: false,
          attestorTrustControlBoundary: "pre-cli-orchestrator",
          platform: process.platform,
          nativeDirectoryDurability:
            process.platform === "win32" ? "unavailable" : "required",
        },
        limitations: [
          "grader model call runs in a separate killable PID without inherited user/provider environment; the broker may add trace context",
          "grader launch requires a persistent process-audit admission record plus process-tree, resource-limit, and privilege-reduction sandbox guarantees",
          "grader still uses the same configured model, provider, credential source, and host as generation",
          "the authenticated CLI deployment has only an external signer endpoint, capability, and pinned public key; it contains no evaluation signing private key",
          "the signer public key is registered in the same durable ArtifactStore/EvolutionLedger sequence as evaluation receipts; rotation preserves only pre-rotation receipts and explicit revocation invalidates historical receipts",
          "the learning deployment receives only a branded trust verifier; the pilot orchestrator owns the lifecycle writer and registers the signer key before any CLI process starts",
          "the pilot orchestrator bootstraps the signer private key into a separate same-host service process; this validates the handle boundary but is not production KMS/HSM or workload identity",
          "evaluation receipt uses ArtifactStore plus a file Ledger and witness",
          "artifact, Ledger, and witness HMAC authorities are ephemeral and the external Ed25519 signer service is not production KMS/HSM-backed",
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
  await stopChild(externalAttestorProcess);
  fs.rmSync(root, { recursive: true, force: true });
}
