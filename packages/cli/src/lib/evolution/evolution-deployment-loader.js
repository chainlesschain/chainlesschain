import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { types as utilTypes } from "node:util";
import {
  assertEvolutionDeploymentActiveTrustRoot,
  assertEvolutionDeploymentDescriptorNotRevoked,
  assertEvolutionDeploymentRevisionFloor,
  readEvolutionDeploymentProfile,
} from "./evolution-deployment-profile.js";

export const EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA =
  "chainlesschain.evolution-deployment-descriptor/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SUPPORTED_COMMANDS = new Set([
  "agent",
  "ask",
  "chat",
  "compact",
  "complete",
  "cowork",
  "desktop",
  "evolution",
  "hub",
  "learning",
  "marketplace",
  "orchestrate",
  "serve",
  "stream",
  "ui",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort()))
    throw new TypeError(`${name} has unexpected or missing fields`);
}

function normalizeDescriptor(value) {
  exactKeys(
    value,
    [
      "schema",
      "revision",
      "modulePath",
      "moduleDigest",
      "trustRootDigest",
      "commands",
      "signature",
    ],
    "evolution deployment descriptor",
  );
  if (value.schema !== EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA)
    throw new TypeError("evolution deployment descriptor schema is invalid");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new TypeError("evolution deployment descriptor revision is invalid");
  if (typeof value.modulePath !== "string" || !isAbsolute(value.modulePath))
    throw new TypeError("evolution deployment modulePath must be absolute");
  if (!DIGEST.test(value.moduleDigest ?? ""))
    throw new TypeError("evolution deployment moduleDigest is invalid");
  if (!DIGEST.test(value.trustRootDigest ?? ""))
    throw new TypeError("evolution deployment trustRootDigest is invalid");
  if (
    !Array.isArray(value.commands) ||
    value.commands.length === 0 ||
    new Set(value.commands).size !== value.commands.length ||
    value.commands.some((command) => !SUPPORTED_COMMANDS.has(command))
  )
    throw new TypeError("evolution deployment commands are invalid");
  if (
    typeof value.signature !== "string" ||
    value.signature === "" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature)
  )
    throw new TypeError("evolution deployment signature is invalid");
  return Object.freeze({
    ...value,
    commands: Object.freeze([...value.commands].sort()),
  });
}

export function serializeEvolutionDeploymentDescriptorPayload(descriptor) {
  const value = normalizeDescriptor({ ...descriptor, signature: "AA==" });
  return canonical({
    schema: value.schema,
    revision: value.revision,
    modulePath: value.modulePath,
    moduleDigest: value.moduleDigest,
    trustRootDigest: value.trustRootDigest,
    commands: value.commands,
  });
}

export function computeEvolutionDeploymentDigest(bytes) {
  return sha256(bytes);
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("evolution deployment descriptor is not valid JSON");
  }
}

function dependencies(value, commandName) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  )
    throw new TypeError(
      `evolution deployment returned invalid dependencies for ${commandName}`,
    );
  return Object.freeze({ ...value });
}

function deniedAgentDependencies(commandName, code, message, source = null) {
  if (commandName !== "agent") return null;
  const evolutionCompositionFactory = Object.freeze(async () => {
    const error = new Error(message);
    error.code = code;
    throw error;
  });
  if (
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    utilTypes.isProxy(source)
  ) {
    return Object.freeze({ evolutionCompositionFactory });
  }
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const result = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (name === "evolutionCompositionFactory" || !("value" in descriptor)) {
      continue;
    }
    Object.defineProperty(result, name, {
      value: descriptor.value,
      enumerable: descriptor.enumerable,
      configurable: false,
      writable: false,
    });
  }
  Object.defineProperty(result, "evolutionCompositionFactory", {
    value: evolutionCompositionFactory,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

function authenticatedDependencies(value, commandName) {
  if (commandName !== "agent") return dependencies(value, commandName);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    return deniedAgentDependencies(
      commandName,
      "EVOLUTION_DEPLOYMENT_INVALID_DEPENDENCIES",
      "Authenticated agent deployment returned invalid dependencies",
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    value,
    "evolutionCompositionFactory",
  );
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function" ||
    descriptor.enumerable !== true
  ) {
    return deniedAgentDependencies(
      commandName,
      "EVOLUTION_DEPLOYMENT_INVALID_DEPENDENCIES",
      "Authenticated agent deployment did not provide an evolution composition factory",
      value,
    );
  }
  return dependencies(value, commandName);
}

async function loadBuiltInFactories(commandName) {
  const factories = {};
  if (commandName === "learning") {
    const [
      { createGovernedSkillSynthesisCliHost },
      { createGovernedSkillSynthesisProviderChat },
      { createGovernedSkillSynthesisCandidateEvaluator },
      { createGovernedSkillSynthesisModelEvaluator },
      { createGovernedSkillSynthesisEvaluationLedgerAdapter },
      { createGovernedSkillSynthesisProcessGrader },
      { createGovernedSkillSynthesisProcessAttestationAuthority },
      { createGovernedSkillSynthesisExternalAttestationAuthority },
      { createGovernedSkillSynthesisAttestorTrustVerifier },
    ] = await Promise.all([
      import("./governed-skill-synthesis-cli-host.js"),
      import("./governed-skill-synthesis-provider-chat.js"),
      import("./governed-skill-synthesis-candidate-evaluator.js"),
      import("./governed-skill-synthesis-model-evaluator.js"),
      import("./governed-skill-synthesis-evaluation-ledger-adapter.js"),
      import("./governed-skill-synthesis-process-grader.js"),
      import("./governed-skill-synthesis-process-attestor.js"),
      import("./governed-skill-synthesis-external-attestor.js"),
      import("./governed-skill-synthesis-attestor-trust-ledger.js"),
    ]);
    factories.createGovernedSkillSynthesisCliHost =
      createGovernedSkillSynthesisCliHost;
    factories.createGovernedSkillSynthesisProviderChat =
      createGovernedSkillSynthesisProviderChat;
    factories.createGovernedSkillSynthesisCandidateEvaluator =
      createGovernedSkillSynthesisCandidateEvaluator;
    factories.createGovernedSkillSynthesisModelEvaluator =
      createGovernedSkillSynthesisModelEvaluator;
    factories.createGovernedSkillSynthesisEvaluationLedgerAdapter =
      createGovernedSkillSynthesisEvaluationLedgerAdapter;
    factories.createGovernedSkillSynthesisProcessGrader =
      createGovernedSkillSynthesisProcessGrader;
    factories.createGovernedSkillSynthesisProcessAttestationAuthority =
      createGovernedSkillSynthesisProcessAttestationAuthority;
    factories.createGovernedSkillSynthesisExternalAttestationAuthority =
      createGovernedSkillSynthesisExternalAttestationAuthority;
    factories.createGovernedSkillSynthesisAttestorTrustVerifier =
      createGovernedSkillSynthesisAttestorTrustVerifier;
  }
  if (commandName === "marketplace" || commandName === "desktop") {
    const [
      { createGovernedSkillMarketplaceCliHost },
      { createGovernedSkillMarketplaceLedgerAdapter },
      { createGovernedSkillMarketplaceCandidateInstaller },
    ] = await Promise.all([
      import("./governed-skill-marketplace-cli-host.js"),
      import("./governed-skill-marketplace-ledger-adapter.js"),
      import("./governed-skill-marketplace-candidate.js"),
    ]);
    factories.createGovernedSkillMarketplaceCliHost =
      createGovernedSkillMarketplaceCliHost;
    factories.createGovernedSkillMarketplaceLedgerAdapter =
      createGovernedSkillMarketplaceLedgerAdapter;
    factories.createGovernedSkillMarketplaceCandidateInstaller =
      createGovernedSkillMarketplaceCandidateInstaller;
  }
  if (commandName === "evolution" || commandName === "serve") {
    const [
      { createEvolutionWorkbenchCliHost },
      { createEvolutionWorkbenchReviewRuntime },
      { createEvolutionWorkbenchRollbackRuntime },
      { createEvolutionWorkbenchRegistrySource },
      { createEvolutionWorkbenchRuntime },
      { openEvolutionWorkbenchFileResources },
      { createEvolutionWorkbenchControlPorts },
      { createGovernedKnowledgeReviewHost },
      { createWikiSkillBenchmarkCliHost },
      {
        createWikiSkillBenchmarkDatasetProvider,
        createWikiSkillBenchmarkExecutionManifest,
        createWikiSkillBenchmarkGrader,
        createWikiSkillBenchmarkReportAttestor,
        createWikiSkillBenchmarkRunner,
      },
      { createWikiSkillBenchmarkLedgerAdapter },
      { createEvolutionEvalProcessSupervisor },
      { createGovernedSkillSynthesisAttestorTrustApprovalClient },
      { createGovernedSkillSynthesisAttestorTrustOperationsClient },
      { createGovernedSkillSynthesisAttestorTrustOperationsCliHost },
    ] = await Promise.all([
      import("./evolution-workbench-cli-host.js"),
      import("./evolution-workbench-review-ledger-adapter.js"),
      import("./evolution-workbench-rollback-ledger-adapter.js"),
      import("./evolution-workbench-registry-source.js"),
      import("./evolution-workbench-runtime.js"),
      import("./evolution-workbench-file-resources.js"),
      import("./evolution-workbench-control-ports.js"),
      import("./governed-knowledge-review-host.js"),
      import("./wikiskill-benchmark-cli-host.js"),
      import("./wikiskill-benchmark-execution-host.js"),
      import("./wikiskill-benchmark-ledger-adapter.js"),
      import("./evolution-eval-process-supervisor.js"),
      import("./governed-skill-synthesis-attestor-trust-approval-client.js"),
      import("./governed-skill-synthesis-attestor-trust-operations-client.js"),
      import("./governed-skill-synthesis-attestor-trust-operations-cli-host.js"),
    ]);
    factories.createEvolutionWorkbenchCliHost = createEvolutionWorkbenchCliHost;
    factories.createEvolutionWorkbenchReviewRuntime =
      createEvolutionWorkbenchReviewRuntime;
    factories.createEvolutionWorkbenchRollbackRuntime =
      createEvolutionWorkbenchRollbackRuntime;
    factories.createEvolutionWorkbenchRegistrySource =
      createEvolutionWorkbenchRegistrySource;
    factories.createEvolutionWorkbenchRuntime = createEvolutionWorkbenchRuntime;
    factories.openEvolutionWorkbenchFileResources =
      openEvolutionWorkbenchFileResources;
    factories.createEvolutionWorkbenchControlPorts =
      createEvolutionWorkbenchControlPorts;
    factories.createGovernedKnowledgeReviewHost =
      createGovernedKnowledgeReviewHost;
    factories.createWikiSkillBenchmarkCliHost = createWikiSkillBenchmarkCliHost;
    factories.createWikiSkillBenchmarkDatasetProvider =
      createWikiSkillBenchmarkDatasetProvider;
    factories.createWikiSkillBenchmarkExecutionManifest =
      createWikiSkillBenchmarkExecutionManifest;
    factories.createWikiSkillBenchmarkGrader = createWikiSkillBenchmarkGrader;
    factories.createWikiSkillBenchmarkReportAttestor =
      createWikiSkillBenchmarkReportAttestor;
    factories.createWikiSkillBenchmarkRunner = createWikiSkillBenchmarkRunner;
    factories.createWikiSkillBenchmarkLedgerAdapter =
      createWikiSkillBenchmarkLedgerAdapter;
    factories.createEvolutionEvalProcessSupervisor =
      createEvolutionEvalProcessSupervisor;
    factories.createGovernedSkillSynthesisAttestorTrustApprovalClient =
      createGovernedSkillSynthesisAttestorTrustApprovalClient;
    factories.createGovernedSkillSynthesisAttestorTrustOperationsClient =
      createGovernedSkillSynthesisAttestorTrustOperationsClient;
    factories.createGovernedSkillSynthesisAttestorTrustOperationsCliHost =
      createGovernedSkillSynthesisAttestorTrustOperationsCliHost;
    const [
      { SkillCandidateRegistry },
      { SkillReleaseRegistry },
      { SkillPromotionController },
      { createEvolutionLedgerPorts },
      { createWikiMaintainerLedgerAdapter },
      { createGovernedKnowledgeArtifactLifecycle },
      { GovernedKnowledgeSyncLedgerAdapter },
      { GovernedKnowledgeDependencyLedgerExecutor },
      { GovernedKnowledgeDependencyInventoryPlanner },
      { GovernedKnowledgeSync },
      { createGovernedKnowledgeRevocationHost },
      {
        createGovernedKnowledgeCandidateQuarantineAuthority,
        createGovernedKnowledgeCandidateRejectionAuthority,
      },
      {
        createGovernedKnowledgeSkillQuarantineAuthority,
        createGovernedKnowledgeSkillRollbackAuthority,
      },
      {
        createGovernedKnowledgeWikiQuarantineAuthority,
        createGovernedKnowledgeWikiTombstoneAuthority,
      },
      { createGovernedKnowledgeDependencyRouter },
      {
        GovernedKnowledgeQuarantineReleaseLedger,
        createGovernedKnowledgeQuarantineReleaseDecisionAuthority,
      },
    ] = await Promise.all([
      import("./skill-candidate-registry.js"),
      import("./skill-release-registry.js"),
      import("./skill-promotion-controller.js"),
      import("./evolution-ledger-ports.js"),
      import("./wiki-maintainer-ledger-adapter.js"),
      import("./governed-knowledge-artifact-lifecycle.js"),
      import("./governed-knowledge-sync-ledger-adapter.js"),
      import("./governed-knowledge-dependency-ledger-executor.js"),
      import("./governed-knowledge-dependency-inventory.js"),
      import("./governed-knowledge-sync.js"),
      import("./governed-knowledge-revocation-host.js"),
      import("./governed-knowledge-candidate-rejection.js"),
      import("./governed-knowledge-skill-rollback.js"),
      import("./governed-knowledge-wiki-tombstone.js"),
      import("./governed-knowledge-dependency-authority.js"),
      import("./governed-knowledge-quarantine-release.js"),
    ]);
    Object.assign(factories, {
      createSkillCandidateRegistry: (options) =>
        new SkillCandidateRegistry(options),
      createSkillReleaseRegistry: (options) =>
        new SkillReleaseRegistry(options),
      createSkillPromotionController: (options) =>
        new SkillPromotionController(options),
      createEvolutionLedgerPorts,
      createWikiMaintainerLedgerAdapter,
      createGovernedKnowledgeArtifactLifecycle,
      createGovernedKnowledgeSyncLedgerAdapter: (options) =>
        new GovernedKnowledgeSyncLedgerAdapter(options),
      createGovernedKnowledgeDependencyLedgerExecutor: (options) =>
        new GovernedKnowledgeDependencyLedgerExecutor(options),
      createGovernedKnowledgeDependencyInventoryPlanner: (options) =>
        new GovernedKnowledgeDependencyInventoryPlanner(options),
      createGovernedKnowledgeSync: (options) =>
        new GovernedKnowledgeSync(options),
      createGovernedKnowledgeRevocationHost,
      createGovernedKnowledgeCandidateQuarantineAuthority,
      createGovernedKnowledgeCandidateRejectionAuthority,
      createGovernedKnowledgeSkillQuarantineAuthority,
      createGovernedKnowledgeSkillRollbackAuthority,
      createGovernedKnowledgeWikiQuarantineAuthority,
      createGovernedKnowledgeWikiTombstoneAuthority,
      createGovernedKnowledgeDependencyRouter,
      createGovernedKnowledgeQuarantineReleaseDecisionAuthority,
      createGovernedKnowledgeQuarantineReleaseLedger: (options) =>
        new GovernedKnowledgeQuarantineReleaseLedger(options),
    });
  }
  if (
    commandName === "agent" ||
    commandName === "ask" ||
    commandName === "chat" ||
    commandName === "compact" ||
    commandName === "complete" ||
    commandName === "hub" ||
    commandName === "desktop" ||
    commandName === "cowork" ||
    commandName === "orchestrate" ||
    commandName === "serve" ||
    commandName === "stream" ||
    commandName === "ui"
  ) {
    const { createAgentEvolutionRuntimeComposition } =
      await import("./agent-evolution-runtime-composition.js");
    factories.createAgentEvolutionRuntimeComposition =
      createAgentEvolutionRuntimeComposition;
  }
  return Object.freeze(factories);
}

function bindFactoriesToModule(factories, moduleDigest) {
  const result = { ...factories };
  const providerFactories = [
    "createGovernedSkillSynthesisCliHost",
    "createGovernedSkillSynthesisModelEvaluator",
    "createEvolutionWorkbenchReviewRuntime",
    "createEvolutionWorkbenchRollbackRuntime",
    "createEvolutionWorkbenchRegistrySource",
    "createEvolutionWorkbenchRuntime",
    "openEvolutionWorkbenchFileResources",
    "createEvolutionWorkbenchControlPorts",
    "createWikiSkillBenchmarkDatasetProvider",
    "createWikiSkillBenchmarkGrader",
    "createWikiSkillBenchmarkReportAttestor",
    "createWikiSkillBenchmarkRunner",
  ];
  for (const name of providerFactories) {
    if (typeof factories[name] !== "function") continue;
    result[name] = (options = {}) => {
      if (options?.descriptor?.handlerArtifactDigest !== moduleDigest)
        throw new Error(
          `${name} handlerArtifactDigest must equal the authenticated deployment module digest`,
        );
      return factories[name](options);
    };
  }
  if (
    typeof factories.createWikiSkillBenchmarkExecutionManifest === "function"
  ) {
    result.createWikiSkillBenchmarkExecutionManifest = (input = {}) => {
      for (const authority of [
        "datasetProvider",
        "runner",
        "grader",
        "reportAttestor",
      ]) {
        if (input?.[authority]?.handlerArtifactDigest !== moduleDigest)
          throw new Error(
            `benchmark ${authority} handlerArtifactDigest must equal the authenticated deployment module digest`,
          );
      }
      return factories.createWikiSkillBenchmarkExecutionManifest(input);
    };
  }
  if (typeof factories.createEvolutionEvalProcessSupervisor === "function") {
    result.createEvolutionEvalProcessSupervisor = (options = {}) => {
      if (options?.authorityDescriptor?.handlerArtifactDigest !== moduleDigest)
        throw new Error(
          "process Eval supervisor handlerArtifactDigest must equal the authenticated deployment module digest",
        );
      return factories.createEvolutionEvalProcessSupervisor(options);
    };
  }
  return Object.freeze(result);
}

export async function verifyEvolutionDeployment(
  { descriptorPath, trustRootPath },
  {
    read = readFile,
    resolveRealPath = realpath,
    includeModuleBytes = false,
  } = {},
) {
  if (!descriptorPath || !trustRootPath)
    throw new Error(
      "evolution deployment requires both descriptor and trust root",
    );
  if (!isAbsolute(descriptorPath) || !isAbsolute(trustRootPath))
    throw new Error("evolution deployment paths must be absolute");

  const [descriptorBytes, trustRootBytes] = await Promise.all([
    read(await resolveRealPath(descriptorPath)),
    read(await resolveRealPath(trustRootPath)),
  ]);
  const descriptor = normalizeDescriptor(parseJson(descriptorBytes));
  if (sha256(trustRootBytes) !== descriptor.trustRootDigest)
    throw new Error("evolution deployment trust root digest mismatch");
  let publicKey;
  try {
    publicKey = createPublicKey(trustRootBytes);
  } catch {
    throw new Error("evolution deployment trust root is invalid");
  }
  const payload = serializeEvolutionDeploymentDescriptorPayload(descriptor);
  if (
    !verify(
      null,
      Buffer.from(payload, "utf8"),
      publicKey,
      Buffer.from(descriptor.signature, "base64"),
    )
  )
    throw new Error("evolution deployment descriptor signature rejected");

  const modulePath = await resolveRealPath(descriptor.modulePath);
  const moduleBytes = await read(modulePath);
  if (moduleBytes.byteLength === 0 || moduleBytes.byteLength > 4 * 1024 * 1024)
    throw new Error("evolution deployment module size is invalid");
  if (sha256(moduleBytes) !== descriptor.moduleDigest)
    throw new Error("evolution deployment module digest mismatch");
  return Object.freeze({
    descriptor,
    descriptorPath: await resolveRealPath(descriptorPath),
    trustRootPath: await resolveRealPath(trustRootPath),
    modulePath,
    ...(includeModuleBytes ? { moduleBytes } : {}),
  });
}

export async function loadEvolutionDeploymentCommandDependencies(
  commandName,
  {
    env = process.env,
    read = readFile,
    resolveRealPath = realpath,
    importModule = (url) => import(url),
    additionalFactories = {},
  } = {},
) {
  if (!SUPPORTED_COMMANDS.has(commandName)) return null;
  let descriptorPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  let trustRootPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  let fromSavedProfile = false;
  let saved = null;
  if (!descriptorPath && !trustRootPath) {
    saved = await readEvolutionDeploymentProfile({ env });
    if (saved.error) {
      return deniedAgentDependencies(
        commandName,
        "EVOLUTION_DEPLOYMENT_PROFILE_INVALID",
        "Saved evolution deployment profile is invalid",
      );
    }
    if (saved.profile && !saved.profile.enabled) {
      return deniedAgentDependencies(
        commandName,
        "EVOLUTION_DEPLOYMENT_DISABLED",
        "Saved evolution deployment profile is disabled",
      );
    }
    if (!saved.error && saved.profile?.enabled) {
      descriptorPath = saved.profile.descriptorPath;
      trustRootPath = saved.profile.trustRootPath;
      fromSavedProfile = true;
    }
  }
  if (!descriptorPath && !trustRootPath) return null;
  if (!descriptorPath || !trustRootPath)
    throw new Error(
      "evolution deployment requires both descriptor and trust root",
    );
  let verified;
  try {
    verified = await verifyEvolutionDeployment(
      { descriptorPath, trustRootPath },
      { read, resolveRealPath, includeModuleBytes: true },
    );
    if (fromSavedProfile)
      assertEvolutionDeploymentActiveTrustRoot(
        saved.profile,
        verified.descriptor,
      );
    if (fromSavedProfile)
      assertEvolutionDeploymentDescriptorNotRevoked(
        saved.profile,
        verified.descriptor,
      );
    if (fromSavedProfile)
      assertEvolutionDeploymentRevisionFloor(
        saved.profile,
        verified.descriptor,
      );
  } catch (error) {
    // A saved profile may become stale after files are moved or rotated. Keep
    // governed capabilities fail-closed while allowing `deployment status`,
    // `configure`, and `disable` to start so the operator can recover. Explicit
    // environment overrides remain strict and surface the error immediately.
    if (fromSavedProfile) {
      return deniedAgentDependencies(
        commandName,
        error?.code || "EVOLUTION_DEPLOYMENT_NOT_VERIFIED",
        `Saved evolution deployment could not be verified: ${error?.message || String(error)}`,
      );
    }
    throw error;
  }
  const { descriptor, moduleBytes } = verified;
  if (!descriptor.commands.includes(commandName)) {
    return deniedAgentDependencies(
      commandName,
      "EVOLUTION_DEPLOYMENT_COMMAND_NOT_ALLOWED",
      `Signed evolution deployment does not admit command: ${commandName}`,
    );
  }
  // Import the exact bytes that were authenticated. Importing modulePath here
  // would reopen a pathname-replacement window between hashing and execution.
  // Deployment entrypoints are therefore single-file ESM bundles; any external
  // authority adapters they open remain the deployment's own attested boundary.
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    moduleBytes,
  ).toString("base64")}#${encodeURIComponent(descriptor.moduleDigest)}`;
  const loaded = await importModule(moduleUrl);
  if (typeof loaded?.createChainlessChainCommandDependencies !== "function")
    throw new Error(
      "evolution deployment module must export createChainlessChainCommandDependencies",
    );
  const builtInFactories = bindFactoriesToModule(
    await loadBuiltInFactories(commandName),
    descriptor.moduleDigest,
  );
  if (
    !additionalFactories ||
    typeof additionalFactories !== "object" ||
    Array.isArray(additionalFactories) ||
    utilTypes.isProxy(additionalFactories)
  ) {
    throw new TypeError(
      "additional evolution deployment factories are invalid",
    );
  }
  const additionalFactoryEntries = Object.entries(additionalFactories);
  if (additionalFactoryEntries.length > 0 && commandName !== "desktop") {
    throw new Error(
      "additional evolution deployment factories are reserved for desktop",
    );
  }
  if (
    additionalFactoryEntries.some(
      ([name, factory]) =>
        Object.hasOwn(builtInFactories, name) || typeof factory !== "function",
    )
  ) {
    throw new TypeError(
      "additional evolution deployment factories are invalid",
    );
  }
  return authenticatedDependencies(
    await loaded.createChainlessChainCommandDependencies(
      Object.freeze({
        commandName,
        descriptor: Object.freeze({ ...descriptor }),
        factories: Object.freeze({
          ...builtInFactories,
          ...additionalFactories,
        }),
      }),
    ),
    commandName,
  );
}
