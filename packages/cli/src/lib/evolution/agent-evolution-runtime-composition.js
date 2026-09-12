import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { ArtifactStore } from "../artifact-store.js";
import {
  ArtifactStoreEncryptedRawStore,
  EvolutionEvidenceArtifactAdapter,
} from "./evolution-evidence-artifact-adapter.js";
import {
  EvolutionEvidenceBundleVerifier,
  EvolutionEvidenceProjector,
  EvolutionEvidenceReader,
} from "./evolution-evidence-projector.js";
import { EvolutionArtifactPorts } from "./evolution-artifact-ports.js";
import {
  captureEvolutionLedgerFileBackend,
  createEvolutionLedgerFileBackend,
} from "./evolution-ledger-file-backend.js";
import { EvolutionRunLedgerAdapter } from "./evolution-run-ledger-adapter.js";
import { createEvolutionRunWikiEvidenceResolver } from "./evolution-run-wiki-evidence-resolver.js";
import { WikiMaintainerLedgerAdapter } from "./wiki-maintainer-ledger-adapter.js";
import { EvidenceBackedWikiMaintainer } from "./evidence-backed-wiki-maintainer.js";
import { createWikiEvidenceCommitGuard } from "./wiki-evidence-commit-guard.js";
import { EvolutionWorkbenchMetricsLedgerAdapter } from "./evolution-workbench-metrics-ledger-adapter.js";
import { EvolutionReleaseTrainLedgerAdapter } from "./evolution-release-train-ledger-adapter.js";
import { WikiSkillProposalLedgerAdapter } from "./wiki-skill-proposal-ledger-adapter.js";
import { EvolutionReleaseTrainStageOutputLedgerAdapter } from "./evolution-release-train-stage-output-ledger-adapter.js";
import { createEvolutionReleaseTrainDomainStages } from "./evolution-release-train-domain-stages.js";
import { createEvolutionReleaseTrain } from "./evolution-release-train.js";
import { captureSkillOutcomeSourceCatalogAuthority } from "./skill-outcome-source-catalog-authority.js";
import {
  captureAgentEvolutionIngress,
  createAgentEvolutionIngress,
} from "./agent-evolution-ingress.js";
import {
  captureAgentEvolutionRuntimeComposition,
  sealAgentSkillOutcomeIndex,
  sealAgentEvolutionRuntimeComposition,
} from "./agent-evolution-runtime-composition-brand.js";

export {
  AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA,
  captureAgentEvolutionRuntimeComposition,
} from "./agent-evolution-runtime-composition-brand.js";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const AUTHORITY_KEYS = new Set([
  "artifact",
  "attestationSigner",
  "attestationVerifier",
  "keyedCommitter",
  "ledger",
  "rawEncryptor",
  "sourceEnvelope",
  "sourceVerifier",
  "storagePolicy",
  "witness",
]);
const ARTIFACT_AUTHORITY_KEYS = new Set([
  "currentAuthorityResolver",
  "envelopeSigner",
  "envelopeVerifier",
]);
const SKILL_OUTCOME_SOURCE_KEYS = new Set(["composition", "skillName"]);
const SKILL_OUTCOME_CATALOG_ENTRY_KEYS = new Set(["runId", "skillNames"]);
const MAX_SKILL_OUTCOME_SOURCES = 128;
const RELEASE_TRAIN_STAGE_KEYS = new Set(["plan", "stages"]);
const RELEASE_TRAIN_DOMAIN_KEYS = new Set(["plan", "domain"]);
const WIKI_MAINTENANCE_KEYS = new Set([
  "principalEnvelope",
  "schemaPolicies",
  "readAuthorities",
  "commitCoordinator",
  "maintainer",
]);
const WIKI_READ_AUTHORITY_KEYS = new Set([
  "evidenceState",
  "principalResolver",
  "accessPolicy",
]);
const WIKI_COMMIT_COORDINATOR_KEYS = new Set(["acquireCurrentEvidence"]);
const WIKI_MAINTAINER_KEYS = new Set([
  "maintainerModel",
  "rulesDigest",
  "minCorroboratingSources",
  "derive",
]);
const WIKI_STAGE_KEYS = new Set(["request", "usage"]);
const DOMAIN_STAGE_KEYS = new Set([
  "wiki-maintain",
  "propose",
  "candidate",
  "eval",
  "review",
  "pilot",
  "promotion",
  "wiki-impact",
]);

function exactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.has(key),
    )
  ) {
    throw new TypeError(`${label} must contain exactly the required ports`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} must be a data property`);
    }
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method} port is required`);
  }
  const operation = owner[method];
  return Object.freeze((...args) => Reflect.apply(operation, owner, args));
}

function captureAuthority(authority, method, label) {
  return Object.freeze({ [method]: capture(authority, method, label) });
}

function normalizeClock(clock) {
  if (typeof clock !== "function" || utilTypes.isProxy(clock)) {
    throw new TypeError("clock must be a non-proxy function");
  }
  return Object.freeze(() => {
    const milliseconds = Number(clock());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("clock must return epoch milliseconds");
    }
    return milliseconds;
  });
}

function layout(stateRootDir, tenantId, runId, initialize = true) {
  if (typeof stateRootDir !== "string" || stateRootDir.trim() === "") {
    throw new TypeError("stateRootDir is required");
  }
  const rootDir = path.resolve(stateRootDir);
  const scope = path.join(
    rootDir,
    encodeURIComponent(tenantId),
    encodeURIComponent(runId),
  );
  const result = Object.freeze({
    rootDir,
    artifactDir: path.join(scope, "artifacts"),
    rawDir: path.join(scope, "raw"),
    ledgerRootDir: path.join(scope, "ledger-events"),
    ledgerAuthorityRootDir: path.join(scope, "ledger-authority"),
    witnessFilePath: path.join(scope, "witness", "checkpoint.json"),
  });
  if (initialize)
    fs.mkdirSync(path.dirname(result.witnessFilePath), {
      recursive: true,
      mode: 0o700,
    });
  return result;
}

function defaultWitnessId(tenantId, runId) {
  return `agent-evolution-${crypto
    .createHash("sha256")
    .update(`${tenantId}\0${runId}`, "utf8")
    .digest("hex")}`;
}

function assertIndependentSigningAuthorities(ledger, witness) {
  if (
    !ledger?.trust ||
    !witness?.trust ||
    ledger === witness ||
    ledger.signer === witness.signer ||
    ledger.verifier === witness.verifier ||
    ledger.trust === witness.trust ||
    ledger.trust.keyId === witness.trust.keyId ||
    ledger.trust.trustPolicyDigest === witness.trust.trustPolicyDigest
  ) {
    throw new TypeError(
      "ledger and witness production authorities must be independent",
    );
  }
}

/**
 * Production composition root for the CLI Agent evolution ingress.
 *
 * Every cryptographic, identity, policy, commitment and encryption operation
 * is supplied by the host. This module deliberately contains no local key,
 * permissive policy, environment fallback, or auto-enable path.
 */
export function createAgentEvolutionRuntimeComposition({
  tenantId: tenantIdInput,
  runId: runIdInput,
  audience: audienceInput = "evolution-runtime",
  stateRootDir,
  authorities: authorityInput,
  evidenceTtlMs,
  witnessId: witnessIdInput,
  clock: clockInput = Date.now,
  evidenceIdGenerator,
  ingressIdGenerator,
  wikiMaintenanceProducer = null,
  wikiMaintenance: wikiMaintenanceInput = null,
  releaseTrain: releaseTrainInput = null,
  completionTriggerKind,
  secure = true,
  fsImpl,
  lock,
  random,
  lockTimeoutMs,
  witnessMaximumBytes,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const runId = identifier(runIdInput, "runId");
  const audience = identifier(audienceInput, "audience");
  const witnessId = identifier(
    witnessIdInput ?? defaultWitnessId(tenantId, runId),
    "witnessId",
  );
  const authorities = exactRecord(
    authorityInput,
    AUTHORITY_KEYS,
    "authorities",
  );
  const artifactAuthority = exactRecord(
    authorities.artifact,
    ARTIFACT_AUTHORITY_KEYS,
    "authorities.artifact",
  );
  const clock = normalizeClock(clockInput);
  let wikiConfiguration = null;
  if (wikiMaintenanceInput !== null) {
    const input = exactRecord(
      wikiMaintenanceInput,
      WIKI_MAINTENANCE_KEYS,
      "wikiMaintenance",
    );
    const readers = exactRecord(
      input.readAuthorities,
      WIKI_READ_AUTHORITY_KEYS,
      "wikiMaintenance.readAuthorities",
    );
    const maintainer = exactRecord(
      input.maintainer,
      WIKI_MAINTAINER_KEYS,
      "wikiMaintenance.maintainer",
    );
    const coordinator = exactRecord(
      input.commitCoordinator,
      WIKI_COMMIT_COORDINATOR_KEYS,
      "wikiMaintenance.commitCoordinator",
    );
    if (
      utilTypes.isAsyncFunction(coordinator.acquireCurrentEvidence) ||
      utilTypes.isGeneratorFunction(coordinator.acquireCurrentEvidence)
    ) {
      throw new TypeError("Wiki commit coordinator must be synchronous");
    }
    const commitCoordinator = Object.freeze({
      acquireCurrentEvidence: capture(
        coordinator,
        "acquireCurrentEvidence",
        "Wiki commit coordinator",
      ),
    });
    if (
      !Number.isSafeInteger(maintainer.minCorroboratingSources) ||
      maintainer.minCorroboratingSources < 2 ||
      maintainer.minCorroboratingSources > 128
    ) {
      throw new TypeError(
        "Wiki corroboration threshold must be between 2 and 128",
      );
    }
    wikiConfiguration = Object.freeze({
      principalEnvelope: input.principalEnvelope,
      schemaPolicies: input.schemaPolicies,
      commitCoordinator,
      descriptor: Object.freeze({
        tenantId,
        evolutionRunId: runId,
        maintainerModel: maintainer.maintainerModel,
        rulesDigest: maintainer.rulesDigest,
        minCorroboratingSources: maintainer.minCorroboratingSources,
      }),
      derive: capture(maintainer, "derive", "Wiki maintainer"),
      evidenceState: captureAuthority(
        readers.evidenceState,
        "resolve",
        "Wiki evidence state",
      ),
      principalResolver: captureAuthority(
        readers.principalResolver,
        "resolve",
        "Wiki principal resolver",
      ),
      accessPolicy: captureAuthority(
        readers.accessPolicy,
        "authorize",
        "Wiki access policy",
      ),
    });
  }
  if (
    typeof evidenceIdGenerator !== "function" ||
    utilTypes.isProxy(evidenceIdGenerator)
  ) {
    throw new TypeError("evidenceIdGenerator port is required");
  }
  if (
    typeof ingressIdGenerator !== "function" ||
    utilTypes.isProxy(ingressIdGenerator)
  ) {
    throw new TypeError("ingressIdGenerator port is required");
  }
  const ports = Object.freeze({
    artifactEnvelopeSigner: captureAuthority(
      artifactAuthority.envelopeSigner,
      "sign",
      "artifact envelope signer",
    ),
    artifactEnvelopeVerifier: captureAuthority(
      artifactAuthority.envelopeVerifier,
      "verify",
      "artifact envelope verifier",
    ),
    artifactCurrentAuthorityResolver: captureAuthority(
      artifactAuthority.currentAuthorityResolver,
      "resolve",
      "artifact current authority resolver",
    ),
    rawEncryptor: captureAuthority(
      authorities.rawEncryptor,
      "encrypt",
      "Raw encryptor",
    ),
    sourceEnvelope: captureAuthority(
      authorities.sourceEnvelope,
      "issue",
      "source envelope authority",
    ),
    sourceVerifier: captureAuthority(
      authorities.sourceVerifier,
      "verify",
      "source verifier",
    ),
    keyedCommitter: captureAuthority(
      authorities.keyedCommitter,
      "commit",
      "keyed committer",
    ),
    storagePolicy: captureAuthority(
      authorities.storagePolicy,
      "resolve",
      "storage policy",
    ),
    attestationSigner: captureAuthority(
      authorities.attestationSigner,
      "sign",
      "attestation signer",
    ),
    attestationVerifier: captureAuthority(
      authorities.attestationVerifier,
      "verify",
      "attestation verifier",
    ),
  });
  capture(authorities.ledger?.signer, "sign", "ledger signer");
  capture(authorities.ledger?.verifier, "verify", "ledger verifier");
  capture(authorities.witness?.signer, "sign", "witness signer");
  capture(authorities.witness?.verifier, "verify", "witness verifier");
  assertIndependentSigningAuthorities(authorities.ledger, authorities.witness);
  const storage = layout(stateRootDir, tenantId, runId);
  const artifactPorts = new EvolutionArtifactPorts({
    tenantId,
    audience,
    artifactStore: new ArtifactStore({
      dir: storage.artifactDir,
      now: clock,
    }),
    envelopeSigner: ports.artifactEnvelopeSigner,
    envelopeVerifier: ports.artifactEnvelopeVerifier,
    currentAuthorityResolver: ports.artifactCurrentAuthorityResolver,
    now: clock,
  });
  const rawStore = new ArtifactStoreEncryptedRawStore({
    tenantId,
    artifactStore: new ArtifactStore({
      dir: storage.rawDir,
      now: clock,
    }),
    encryptor: ports.rawEncryptor,
  });
  const projector = new EvolutionEvidenceProjector({
    sourceVerifier: ports.sourceVerifier,
    keyedCommitter: ports.keyedCommitter,
    storagePolicy: ports.storagePolicy,
    rawStore,
    attestationSigner: ports.attestationSigner,
    attestationVerifier: ports.attestationVerifier,
    idGenerator: evidenceIdGenerator,
    now: () => new Date(clock()),
  });
  const bundleVerifier = new EvolutionEvidenceBundleVerifier({
    attestationVerifier: ports.attestationVerifier,
    now: () => new Date(clock()),
  });
  const evidenceAdapter = new EvolutionEvidenceArtifactAdapter({
    tenantId,
    audience,
    projector,
    bundleVerifier,
    artifactPorts,
    ...(evidenceTtlMs === undefined ? {} : { ttlMs: evidenceTtlMs }),
  });
  const ledgerArtifactResolver =
    artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: storage.ledgerRootDir,
    authorityRootDir: storage.ledgerAuthorityRootDir,
    witnessFilePath: storage.witnessFilePath,
    witnessId,
    ledgerAuthority: authorities.ledger,
    witnessAuthority: authorities.witness,
    artifactResolver: ledgerArtifactResolver,
    secure,
    clock,
    ...(fsImpl === undefined ? {} : { fsImpl }),
    ...(lock === undefined ? {} : { lock }),
    ...(random === undefined ? {} : { random }),
    ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
    ...(witnessMaximumBytes === undefined ? {} : { witnessMaximumBytes }),
  });
  captureEvolutionLedgerFileBackend(backend);
  const cacheSourceAuthorities = Object.freeze(
    Object.fromEntries(
      ["ledger", "witness"].map((kind) => [
        kind,
        Object.freeze({
          trust: Object.freeze({ ...backend.descriptor[`${kind}Trust`] }),
          signer: captureAuthority(
            authorities[kind].signer,
            "sign",
            `cache ${kind} signer`,
          ),
          verifier: captureAuthority(
            authorities[kind].verifier,
            "verify",
            `cache ${kind} verifier`,
          ),
        }),
      ]),
    ),
  );
  const runAdapter = new EvolutionRunLedgerAdapter({
    descriptor: {
      tenantId,
      artifactTenantId: tenantId,
      runId,
      audience,
      purpose: "evolution-ledger",
    },
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver,
    now: clock,
  });
  let wikiMaintenance = null;
  let wikiMaintainer = null;
  if (wikiConfiguration !== null) {
    const evidenceReader = new EvolutionEvidenceReader({
      attestationVerifier: ports.attestationVerifier,
      evidenceState: wikiConfiguration.evidenceState,
      principalResolver: wikiConfiguration.principalResolver,
      accessPolicy: wikiConfiguration.accessPolicy,
      now: () => new Date(clock()),
    });
    const wikiEvidence = createEvolutionRunWikiEvidenceResolver({
      runAdapter,
      evidenceAdapter,
      evidenceReader,
      principalEnvelope: wikiConfiguration.principalEnvelope,
      schemaPolicies: wikiConfiguration.schemaPolicies,
    });
    const wikiAdapter = new WikiMaintainerLedgerAdapter({
      descriptor: {
        tenantId,
        artifactTenantId: tenantId,
        evolutionRunId: runId,
        audience,
        purpose: "evolution-ledger",
      },
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
    });
    const wikiCommit = createWikiEvidenceCommitGuard({
      wikiAdapter,
      commitCoordinator: wikiConfiguration.commitCoordinator,
      principalEnvelope: wikiConfiguration.principalEnvelope,
      clock,
    });
    wikiMaintainer = new EvidenceBackedWikiMaintainer({
      descriptor: wikiConfiguration.descriptor,
      policy: {
        trustedProjectionRead: true,
        rawEvidenceRead: false,
        activeSkillWrite: false,
        shell: false,
        network: false,
        secretRead: false,
      },
      ports: {
        ...wikiAdapter.maintainerPorts({
          resolveEvidence: wikiEvidence.resolveEvidence,
          derive: wikiConfiguration.derive,
        }),
        commitRevision: wikiCommit.commitRevision,
      },
    });
    // The host receives only scoped maintenance and authenticated Wiki reads,
    // never a Raw store, caller-supplied bundle, or write/approval capability.
    wikiMaintenance = Object.freeze({
      maintain: Object.freeze(wikiMaintainer.maintain.bind(wikiMaintainer)),
      loadWiki: Object.freeze(() => wikiAdapter.loadWiki()),
    });
  }
  const skillOutcomeReaders = new Map();
  const createSkillOutcomeReader = Object.freeze((skillNameInput) => {
    const skillName = identifier(skillNameInput, "skillName");
    const cached = skillOutcomeReaders.get(skillName);
    if (cached) return cached;
    const reader = new EvolutionWorkbenchMetricsLedgerAdapter({
      descriptor: {
        tenantId,
        artifactTenantId: tenantId,
        evolutionRunId: runId,
        skillName,
        audience,
        purpose: "evolution-ledger",
      },
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
    }).createOutcomeReader();
    skillOutcomeReaders.set(skillName, reader);
    return reader;
  });
  let releaseTrain = null;
  if (releaseTrainInput !== null) {
    const releaseTrainKeys = Object.hasOwn(releaseTrainInput, "domain")
      ? RELEASE_TRAIN_DOMAIN_KEYS
      : RELEASE_TRAIN_STAGE_KEYS;
    const releaseTrainConfig = exactRecord(
      releaseTrainInput,
      releaseTrainKeys,
      "releaseTrain",
    );
    if (
      wikiMaintainer !== null &&
      !Object.hasOwn(releaseTrainConfig, "domain")
    ) {
      throw new TypeError(
        "authorized Wiki maintenance requires production release train domain stages",
      );
    }
    if (
      releaseTrainConfig.plan?.tenantId !== tenantId ||
      typeof releaseTrainConfig.plan?.skillId !== "string"
    ) {
      throw new TypeError(
        "releaseTrain plan must belong to the composition tenant",
      );
    }
    const releaseTrainAdapter = new EvolutionReleaseTrainLedgerAdapter({
      descriptor: {
        tenantId,
        artifactTenantId: tenantId,
        skillName: releaseTrainConfig.plan.skillId,
        audience,
        purpose: "evolution-ledger",
      },
      artifactPorts,
      ledger: backend.ledger,
      ledgerArtifactResolver,
      clock: () => new Date(clock()).toISOString(),
    });
    let stages = releaseTrainConfig.stages;
    if (Object.hasOwn(releaseTrainConfig, "domain")) {
      const proposalLedger = new WikiSkillProposalLedgerAdapter({
        descriptor: {
          tenantId,
          artifactTenantId: tenantId,
          evolutionRunId: runId,
          skillName: releaseTrainConfig.plan.skillId,
          audience,
          purpose: "evolution-ledger",
        },
        artifactPorts,
        ledger: backend.ledger,
        ledgerArtifactResolver,
      });
      const outputLedger = new EvolutionReleaseTrainStageOutputLedgerAdapter({
        descriptor: {
          tenantId,
          artifactTenantId: tenantId,
          skillName: releaseTrainConfig.plan.skillId,
          audience,
          purpose: "evolution-ledger",
        },
        artifactPorts,
        ledger: backend.ledger,
        ledgerArtifactResolver,
      });
      let domain = releaseTrainConfig.domain;
      if (wikiMaintainer !== null) {
        exactRecord(domain, DOMAIN_STAGE_KEYS, "releaseTrain.domain");
        const wikiStage = exactRecord(
          domain["wiki-maintain"],
          WIKI_STAGE_KEYS,
          "authorized wiki-maintain stage",
        );
        domain = {
          ...domain,
          "wiki-maintain": { ...wikiStage, maintainer: wikiMaintainer },
        };
      }
      stages = createEvolutionReleaseTrainDomainStages({
        domain,
        proposalLedger,
        outputLedger,
      });
    }
    releaseTrain = createEvolutionReleaseTrain({
      plan: releaseTrainConfig.plan,
      stateStore: releaseTrainAdapter.createStateStore(),
      stages,
      clock,
    });
  }

  const evolutionIngress = createAgentEvolutionIngress({
    evidenceAdapter,
    runAdapter,
    openCacheSourceRun: (input) => {
      const sourceRunId = identifier(input, "cache source runId");
      const sourceStorage = layout(
        storage.rootDir,
        tenantId,
        sourceRunId,
        false,
      );
      if (!fs.existsSync(sourceStorage.witnessFilePath))
        throw new Error("Cache source Run witness does not exist");
      const sourcePorts = new EvolutionArtifactPorts({
        tenantId,
        audience,
        artifactStore: new ArtifactStore({
          dir: sourceStorage.artifactDir,
          now: clock,
        }),
        envelopeSigner: ports.artifactEnvelopeSigner,
        envelopeVerifier: ports.artifactEnvelopeVerifier,
        currentAuthorityResolver: ports.artifactCurrentAuthorityResolver,
        now: clock,
      });
      const sourceResolver = sourcePorts.createEvolutionLedgerArtifactResolver({
        purpose: "evolution-ledger",
      });
      const sourceBackend = createEvolutionLedgerFileBackend({
        rootDir: sourceStorage.ledgerRootDir,
        authorityRootDir: sourceStorage.ledgerAuthorityRootDir,
        witnessFilePath: sourceStorage.witnessFilePath,
        witnessId: witnessIdInput ?? defaultWitnessId(tenantId, sourceRunId),
        ledgerAuthority: cacheSourceAuthorities.ledger,
        witnessAuthority: cacheSourceAuthorities.witness,
        artifactResolver: sourceResolver,
        secure,
        clock,
        ...(fsImpl === undefined ? {} : { fsImpl }),
        ...(lock === undefined ? {} : { lock }),
        ...(random === undefined ? {} : { random }),
        ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
        ...(witnessMaximumBytes === undefined ? {} : { witnessMaximumBytes }),
      });
      return {
        runAdapter: new EvolutionRunLedgerAdapter({
          descriptor: { ...runAdapter.descriptor, runId: sourceRunId },
          artifactPorts: sourcePorts,
          ledger: sourceBackend.ledger,
          ledgerArtifactResolver: sourceResolver,
          now: clock,
        }),
        evidenceAdapter: new EvolutionEvidenceArtifactAdapter({
          tenantId,
          audience,
          projector,
          bundleVerifier,
          artifactPorts: sourcePorts,
          ...(evidenceTtlMs === undefined ? {} : { ttlMs: evidenceTtlMs }),
        }),
      };
    },
    sourceEnvelopeAuthority: ports.sourceEnvelope,
    wikiMaintenanceProducer,
    releaseTrain,
    ...(completionTriggerKind === undefined ? {} : { completionTriggerKind }),
    now: () => new Date(clock()),
    idGenerator: ingressIdGenerator,
  });
  captureAgentEvolutionIngress(evolutionIngress, { tenantId });

  const composition = sealAgentEvolutionRuntimeComposition({
    tenantId,
    runId,
    evolutionIngress,
    createSkillOutcomeReader,
    wikiMaintenance,
    loadRun: Object.freeze(() => runAdapter.load()),
    ledgerDescriptor: backend.descriptor,
    storage,
    releaseTrain,
  });
  return composition;
}

export function assembleAgentSkillOutcomeIndex({ sources } = {}) {
  if (
    !Array.isArray(sources) ||
    utilTypes.isProxy(sources) ||
    sources.length < 1 ||
    sources.length > MAX_SKILL_OUTCOME_SOURCES
  ) {
    throw new TypeError("Skill outcome index sources are invalid or unbounded");
  }
  let tenantId = null;
  const sourceIds = new Set();
  const readers = sources.map((input, index) => {
    const source = exactRecord(
      input,
      SKILL_OUTCOME_SOURCE_KEYS,
      `sources[${index}]`,
    );
    const composition = captureAgentEvolutionRuntimeComposition(
      source.composition,
    );
    const skillName = identifier(
      source.skillName,
      `sources[${index}].skillName`,
    );
    if (tenantId === null) tenantId = composition.tenantId;
    if (composition.tenantId !== tenantId) {
      throw new Error("Skill outcome index sources crossed a tenant boundary");
    }
    const sourceId = `${composition.runId}\0${skillName}`;
    if (sourceIds.has(sourceId)) {
      throw new Error("Skill outcome index sources contain a duplicate");
    }
    sourceIds.add(sourceId);
    if (typeof composition.createSkillOutcomeReader !== "function") {
      throw new TypeError(
        "Agent evolution composition lacks an outcome reader",
      );
    }
    return composition.createSkillOutcomeReader(skillName);
  });
  return sealAgentSkillOutcomeIndex({
    tenantId,
    readers: Object.freeze(readers),
  });
}

export async function assembleAgentSkillOutcomeIndexFromCatalog({
  tenantId: tenantIdInput,
  catalogAuthority: catalogAuthorityInput,
  openComposition,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const catalogAuthority = captureSkillOutcomeSourceCatalogAuthority(
    catalogAuthorityInput,
  );
  if (
    typeof openComposition !== "function" ||
    utilTypes.isProxy(openComposition)
  ) {
    throw new TypeError("Skill outcome composition opener is invalid");
  }
  const loaded = await catalogAuthority.loadCatalog();
  if (
    loaded?.authenticated !== true ||
    loaded.durable !== true ||
    loaded.tenantId !== tenantId ||
    !Array.isArray(loaded.entries)
  ) {
    throw new Error("Skill outcome source catalog authority is invalid");
  }
  const catalog = loaded.entries;
  const runIds = new Set();
  let sourceCount = 0;
  const normalizedCatalog = catalog.map((input, index) => {
    const entry = exactRecord(
      input,
      SKILL_OUTCOME_CATALOG_ENTRY_KEYS,
      `catalog[${index}]`,
    );
    const runId = identifier(entry.runId, `catalog[${index}].runId`);
    if (runIds.has(runId)) {
      throw new TypeError(
        "Skill outcome source catalog contains a duplicate run",
      );
    }
    runIds.add(runId);
    if (
      !Array.isArray(entry.skillNames) ||
      utilTypes.isProxy(entry.skillNames) ||
      entry.skillNames.length < 1 ||
      entry.skillNames.length > MAX_SKILL_OUTCOME_SOURCES
    ) {
      throw new TypeError(
        `catalog[${index}].skillNames is invalid or unbounded`,
      );
    }
    const skillNames = entry.skillNames.map((skillName, skillIndex) =>
      identifier(skillName, `catalog[${index}].skillNames[${skillIndex}]`),
    );
    if (new Set(skillNames).size !== skillNames.length) {
      throw new TypeError(
        "Skill outcome source catalog contains a duplicate Skill",
      );
    }
    sourceCount += skillNames.length;
    if (sourceCount > MAX_SKILL_OUTCOME_SOURCES) {
      throw new TypeError(
        "Skill outcome source catalog is invalid or unbounded",
      );
    }
    return Object.freeze({ runId, skillNames: Object.freeze(skillNames) });
  });
  const sources = [];
  for (const entry of normalizedCatalog) {
    const context = Object.freeze({ tenantId, runId: entry.runId });
    const composition = captureAgentEvolutionRuntimeComposition(
      await openComposition(context),
    );
    if (
      composition.tenantId !== tenantId ||
      composition.runId !== entry.runId
    ) {
      throw new TypeError(
        "Skill outcome catalog opener returned an unbound composition",
      );
    }
    for (const skillName of entry.skillNames) {
      sources.push(Object.freeze({ composition, skillName }));
    }
  }
  return assembleAgentSkillOutcomeIndex({ sources });
}
