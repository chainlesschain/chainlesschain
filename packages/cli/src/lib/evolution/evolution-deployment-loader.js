import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { types as utilTypes } from "node:util";

export const EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA =
  "chainlesschain.evolution-deployment-descriptor/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SUPPORTED_COMMANDS = new Set(["agent", "desktop", "evolution", "serve"]);

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

async function loadBuiltInFactories(commandName) {
  const factories = {};
  if (commandName === "evolution" || commandName === "serve") {
    const [
      { createEvolutionWorkbenchCliHost },
      { createGovernedKnowledgeReviewHost },
    ] = await Promise.all([
      import("./evolution-workbench-cli-host.js"),
      import("./governed-knowledge-review-host.js"),
    ]);
    factories.createEvolutionWorkbenchCliHost = createEvolutionWorkbenchCliHost;
    factories.createGovernedKnowledgeReviewHost =
      createGovernedKnowledgeReviewHost;
  }
  if (commandName === "agent" || commandName === "serve") {
    const { createAgentEvolutionRuntimeComposition } =
      await import("./agent-evolution-runtime-composition.js");
    factories.createAgentEvolutionRuntimeComposition =
      createAgentEvolutionRuntimeComposition;
  }
  return Object.freeze(factories);
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
  const descriptorPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  const trustRootPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  if (!descriptorPath && !trustRootPath) return null;
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
  if (!descriptor.commands.includes(commandName)) return null;

  const modulePath = await resolveRealPath(descriptor.modulePath);
  const moduleBytes = await read(modulePath);
  if (moduleBytes.byteLength === 0 || moduleBytes.byteLength > 4 * 1024 * 1024)
    throw new Error("evolution deployment module size is invalid");
  if (sha256(moduleBytes) !== descriptor.moduleDigest)
    throw new Error("evolution deployment module digest mismatch");
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
  const builtInFactories = await loadBuiltInFactories(commandName);
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
  return dependencies(
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
