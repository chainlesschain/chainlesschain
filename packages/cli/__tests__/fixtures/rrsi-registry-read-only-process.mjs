// TEST ONLY: authentic local v2 storage across Node process lifetime; no origin,
// production authority, business dispatch or promotion is asserted.
import fs from "node:fs";
import path from "node:path";
import { _deps as privateStorageDeps } from "../../src/lib/secure-fs.js";
import {
  openFixture,
  bindFixture,
  openRegistries,
  operationId,
  candidateOptions,
  releaseOptions,
} from "./rrsi-registry-read-only.js";
import { SkillCandidateRegistry } from "../../src/lib/evolution/skill-candidate-registry.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
const [root, mode, candidateBase, releaseBase] = process.argv.slice(2);
const fixture = openFixture(root);
const mutations = [];
const registryPath = (target) => {
  if (Buffer.isBuffer(target)) target = target.toString("utf8");
  return (
    typeof target === "string" &&
    (path.resolve(target) === path.join(root, "provisioned") ||
      path
        .resolve(target)
        .startsWith(`${path.join(root, "provisioned")}${path.sep}`) ||
      target.includes("rrsi-registry-store-policy-operations"))
  );
};
const restore = [];
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
    )
      mutations.push({
        operation: name,
        targets: args.slice(
          0,
          name === "renameSync" || name === "linkSync" ? 2 : 1,
        ),
      });
    return Reflect.apply(original, fs, args);
  };
  restore.push(() => {
    fs[name] = original;
  });
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
      operation: "single-path-native-permission-repair",
      targets: [args.at(-2)],
    });
  return Reflect.apply(nativeSpawn, privateStorageDeps, [file, args, options]);
};
const nativeOpen = fs.openSync;
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
    mutations.push({ operation: "write-open", targets: [target], flags });
  return Reflect.apply(nativeOpen, fs, [target, flags, ...args]);
};
restore.push(() => {
  fs.openSync = nativeOpen;
});
try {
  if (mode === "unbound") {
    const failures = [];
    for (const [component, Class, base] of [
      ["candidate", SkillCandidateRegistry, candidateBase],
      ["release", SkillReleaseRegistry, releaseBase],
    ]) {
      try {
        const bindingLike = { descriptor: { baseDir: base } };
        new Class({
          ...(component === "candidate"
            ? candidateOptions(bindingLike)
            : releaseOptions(bindingLike, fixture.ports)),
          storePolicyBinding: undefined,
        });
        failures.push({ component, admitted: true });
      } catch (error) {
        failures.push({ component, code: error.code });
      }
    }
    process.stdout.write(JSON.stringify({ failures, mutations }));
  } else {
    const bindings = bindFixture(fixture);
    const registries = openRegistries(bindings, fixture.ports);
    process.stdout.write(
      JSON.stringify({
        operationId,
        candidateDescriptor: bindings.candidate.descriptor,
        releaseDescriptor: bindings.release.descriptor,
        candidateInventory: registries.candidate.readInventory(),
        releaseInventory: registries.release.readInventory(),
        state: registries.release.readState("safe-refactor"),
        mutations,
      }),
    );
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({ code: error.code, message: error.message, mutations }),
  );
  process.exitCode = 2;
} finally {
  for (const reset of restore) reset();
  privateStorageDeps.spawnSync = nativeSpawn;
}
