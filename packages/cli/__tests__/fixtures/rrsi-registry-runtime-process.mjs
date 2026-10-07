// TEST ONLY: process interruption with authentic local files and retained HMAC
// fixture authorities; no production custody or physical power-loss proof.
import fs from "node:fs";
import path from "node:path";
import { openLedgerV2Fixture } from "./evolution-ledger-v2-store.js";
import {
  scope,
  operationId,
  openRegistries,
} from "./rrsi-registry-read-only.js";
import { replicaAuthority } from "./skill-revocation-release-registry.js";
import { createEvolutionLedgerPorts } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { createRrsiRegistryStorePolicy } from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import {
  createRrsiRegistryRuntimePolicy,
  RRSI_REGISTRY_RUNTIME_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-registry-runtime-policy.js";
import { _deps as privateStorageDeps } from "../../src/lib/secure-fs.js";

const [root, mode, phase] = process.argv.slice(2);
let armed = false,
  heads = 0;
const store = openLedgerV2Fixture(path.join(root, "store"), {
  ...scope,
  fault(point) {
    if (armed && mode === "after-head" && point === "after-head") {
      heads++;
      if (heads === Number(phase)) process.exit(81);
    }
  },
});
const policy = createRrsiRegistryStorePolicy({
  backend: store.backend,
  artifactPorts: store.artifactPorts,
  ledgerArtifactResolver: store.resolver,
  descriptor: { ...scope, purpose: "evolution-ledger" },
});
const runtime = createRrsiRegistryRuntimePolicy({
  storePolicy: policy,
  backend: store.backend,
  artifactPorts: store.artifactPorts,
  ledgerArtifactResolver: store.resolver,
});
const mutations = [];
const permissionFailures = [];
const registryPath = (target) => {
  if (Buffer.isBuffer(target)) target = target.toString("utf8");
  return (
    typeof target === "string" &&
    (path.resolve(target) === path.join(root, "provisioned") ||
      path
        .resolve(target)
        .startsWith(`${path.join(root, "provisioned")}${path.sep}`))
  );
};
for (const name of [
  "mkdirSync",
  "writeFileSync",
  "appendFileSync",
  "truncateSync",
  "renameSync",
  "linkSync",
  "unlinkSync",
  "rmSync",
  "rmdirSync",
  "chmodSync",
]) {
  const original = fs[name];
  fs[name] = (...args) => {
    if (
      registryPath(args[0]) ||
      (["renameSync", "linkSync"].includes(name) && registryPath(args[1]))
    ) {
      mutations.push({ operation: name, target: String(args[0]) });
    }
    const result = Reflect.apply(original, fs, args);
    if (
      armed &&
      mode === "after-mkdir" &&
      name === "mkdirSync" &&
      registryPath(args[0]) &&
      path.basename(String(args[0])) === phase
    ) {
      process.exit(82);
    }
    return result;
  };
}
const nativeSpawn = privateStorageDeps.spawnSync;
privateStorageDeps.spawnSync = (file, args, options) => {
  const request =
    typeof options?.input === "string" ? JSON.parse(options.input) : null;
  if (request?.operation === "repair" && request.targets.some(registryPath))
    mutations.push({
      operation: "native-permission-repair",
      targets: request.targets,
    });
  if (args?.at(-1) === "repair" && registryPath(args.at(-2)))
    mutations.push({
      operation: "native-permission-repair",
      targets: [args.at(-2)],
    });
  const observed = Reflect.apply(nativeSpawn, privateStorageDeps, [
    file,
    args,
    options,
  ]);
  if (request?.targets?.some(registryPath) || registryPath(args?.at(-2))) {
    let rows;
    try {
      rows = JSON.parse(String(observed.stdout || "").trim());
    } catch {
      rows = null;
    }
    const entries = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (
      observed.error ||
      observed.status !== 0 ||
      entries.some((entry) => entry?.ok === false || entry?.ownerOnly === false)
    )
      permissionFailures.push({
        status: observed.status,
        errorCode: observed.error?.code ?? null,
        timeoutMs: options?.timeout ?? null,
        stderr: String(observed.stderr || "").slice(0, 4096),
        failures: entries
          .filter((entry) => entry?.ok === false || entry?.ownerOnly === false)
          .map((entry) => ({
            error: entry.error ?? null,
            failureStage:
              entry.failureStage ?? entry.details?.failureStage ?? null,
            hresult: entry.hresult ?? entry.details?.hresult ?? null,
          })),
      });
  }
  return observed;
};
const open = fs.openSync;
fs.openSync = (target, flags, ...args) => {
  if (
    registryPath(target) &&
    ((typeof flags === "string" && /[wa+]/u.test(flags)) ||
      (typeof flags === "number" &&
        flags &
          (fs.constants.O_WRONLY |
            fs.constants.O_RDWR |
            fs.constants.O_CREAT |
            fs.constants.O_TRUNC |
            fs.constants.O_APPEND)))
  )
    mutations.push({ operation: "write-open", target: String(target) });
  return Reflect.apply(open, fs, [target, flags, ...args]);
};
try {
  armed = true;
  const result =
    mode === "read" ? runtime.read(operationId) : runtime.recover(operationId);
  armed = false;
  // Recovery proves the registered runtime prefix. Fresh Registry construction
  // and business reads run in a separate child, with independent observations.
  let readers = {};
  if (mode === "read") {
    const bindings = Object.fromEntries(
      ["candidate", "release"].map((component) => [
        component,
        policy.bindComponent({
          operationId,
          component,
          runtimePolicy: runtime,
        }),
      ]),
    );
    const ports = createEvolutionLedgerPorts({
      artifactPorts: store.artifactPorts,
      ledger: store.journal,
      artifactTenantId: scope.artifactTenantId,
      audience: scope.audience,
      artifactDurabilityAuthority: replicaAuthority(
        path.join(root, "release-replica"),
      ),
    });
    const registry = openRegistries(bindings, ports);
    readers = {
      candidateInventory: registry.candidate.readInventory(),
      releaseInventory: registry.release.readInventory(),
      state: registry.release.readState("safe-refactor"),
    };
  }
  process.stdout.write(
    JSON.stringify({
      result,
      records: store.journal
        .read()
        .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE)
        .map((event) => ({ eventId: event.eventId, ref: event.subjectRef })),
      ...readers,
      mutations,
    }),
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      cause: error.cause
        ? { code: error.cause.code ?? null, message: error.cause.message }
        : null,
      mutations,
      permissionFailures,
    }),
  );
  process.exitCode = 2;
}
