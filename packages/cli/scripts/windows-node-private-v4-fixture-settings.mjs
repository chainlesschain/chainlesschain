/** Read-only review fixture evidence, never production settings admission.
 * An exactly attested host-terminated worker may have no exit callback. Its
 * final fixture observation is then host-only; no child exit is synthesized.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const PRIVATE_V4_SETTINGS_PROFILE = "readonly-review-settings-v1";
export const PRIVATE_V4_SETTINGS_ENV = Object.freeze({
  USERPROFILE: "X:\\workspace\\review-fixture\\home",
  HOMEDRIVE: "X:",
  HOMEPATH: "\\workspace\\review-fixture\\home",
  ProgramData: "X:\\workspace\\review-fixture\\program-data",
  CC_MANAGED_SETTINGS:
    "X:\\workspace\\review-fixture\\program-data\\ChainlessChain\\managed-settings.json",
});

const SOURCE_NAME = "windows-node-private-v4-fixture-settings.mjs";
const MAX_SOURCE_BYTES = 128 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => object(value) && Object.hasOwn(value, key);
const samePath = (value, expected) =>
  typeof value === "string" && value.toLowerCase() === expected.toLowerCase();

// Mirrors the existing native settlement exemption. A role/PID/exit code alone
// does not authorize omitting the worker's exit callback observation.
function hostTerminatedWorker(row) {
  return (
    row?.kind === "vitest-worker" &&
    row.exit === 1 &&
    row.terminationRequested === true &&
    row.terminationExitCode === 1 &&
    row.preTerminationWait === 258 &&
    row.preTerminationExit === 259 &&
    row.terminationCallSucceeded === true &&
    row.terminationCallError === 0 &&
    row.terminationWait === 0 &&
    row.actualExit === 1 &&
    row.terminationRequesterRegistrationId === row.parentRegistrationId &&
    positive(row.creationSequence) &&
    row.terminationChildSequence === row.creationSequence &&
    row.callerHandleObjectCompared === true
  );
}

export function inspectPrivateV4FixtureSettings(
  report,
  { host, readArtifact = fs.readFileSync } = {},
) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  try {
    const receipts = Array.isArray(report?.receipts) ? report.receipts : [];
    const requested =
      owns(report?.review, "fixtureSettings") ||
      owns(report, "fixtureSettings") ||
      host?.fixtureSettings === true ||
      receipts.some((row) => owns(row, "fixtureSettings"));
    if (!requested) {
      require(host?.fixtureSettings === undefined ||
        host.fixtureSettings === false, "legacy host fixture flag differs");
      return { verified: errors.length === 0, errors };
    }
    const fixture = report?.fixtureSettings;
    require(["review-baseline", "review-mutant"].includes(
      report?.mode,
    ), "fixture profile requires explicit review mode");
    require(report?.review?.fixtureSettings === PRIVATE_V4_SETTINGS_PROFILE &&
      fixture?.profile === PRIVATE_V4_SETTINGS_PROFILE &&
      host?.fixtureSettings ===
        true, "fixture profile or native host flag differs");
    require(report?.status === "NOT_ADMITTED" &&
      report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.fullFrozenReviewCompleted === false &&
      host?.status ===
        "NOT_ADMITTED", "fixture cannot confer native or formal admission");

    function environment(value, label) {
      require(object(value), label + " environment missing");
      if (!object(value)) return;
      const entries = Object.entries(value).map(([key, entry]) => [
        key.toUpperCase(),
        entry,
      ]);
      const expected = Object.entries(PRIVATE_V4_SETTINGS_ENV).map(
        ([key, entry]) => [key.toUpperCase(), entry],
      );
      require(entries.length === expected.length &&
        new Set(entries.map(([key]) => key)).size === entries.length &&
        isDeepStrictEqual(
          entries.sort(([a], [b]) => a.localeCompare(b)),
          expected.sort(([a], [b]) => a.localeCompare(b)),
        ), label + " environment differs from fixed fixture");
    }
    environment(fixture?.environment, "host");
    const source = fixture?.source;
    require(typeof source?.path === "string" &&
      source.path.replaceAll("\\", "/").split("/").at(-1) === SOURCE_NAME &&
      positive(source?.bytes) &&
      source.bytes <= MAX_SOURCE_BYTES &&
      /^sha256:[a-f0-9]{64}$/u.test(
        source?.digest ?? "",
      ), "fixture helper source capture invalid");
    try {
      const bytes = readArtifact(source?.path);
      const current = fs.readFileSync(fileURLToPath(import.meta.url));
      require(Buffer.isBuffer(bytes) &&
        bytes.length === source?.bytes &&
        hash(bytes) === source?.digest &&
        bytes.equals(
          current,
        ), "fixture helper retained bytes differ from verifier");
    } catch {
      errors.push("fixture helper source cannot be reread");
    }

    const root = report?.root;
    require(typeof root === "string" &&
      /^[a-z]:\\/iu.test(root) &&
      path.win32.normalize(root) === root &&
      !root.endsWith("\\"), "fixture physical capsule root invalid");
    if (typeof root !== "string") return { verified: false, errors };
    const physicalBase = path.win32.join(root, "workspace", "review-fixture");
    const paths = (base) => [
      {
        parent: path.win32.join(base, "home"),
        remaining: ".claude\\settings.json",
      },
      {
        parent: path.win32.join(base, "program-data"),
        remaining: "ChainlessChain\\managed-settings.json",
      },
    ];
    const sourceFields = [
      "logicalPath",
      "physicalPath",
      "nearestExistingParent",
      "remainingPath",
      "parentIdentity",
      "exists",
      "byteLength",
      "digest",
      "fileIdentity",
      "settings",
    ].sort();
    function observations(values, expectedPaths, label, expectedIdentities) {
      require(Array.isArray(values) && values.length === 2, label +
        " source population differs");
      if (!Array.isArray(values) || values.length !== 2) return null;
      const identities = [];
      values.forEach((value, index) => {
        const expected = expectedPaths[index],
          file = path.win32.join(expected.parent, expected.remaining);
        require(object(value) &&
          isDeepStrictEqual(Object.keys(value).sort(), sourceFields), label +
          " source fields differ");
        require(samePath(value?.logicalPath, file) &&
          samePath(value?.physicalPath, file) &&
          samePath(value?.nearestExistingParent, expected.parent) &&
          value?.remainingPath === expected.remaining, label +
          " source path or nearest parent differs");
        require(value?.exists === false &&
          value.byteLength === 0 &&
          value.digest === null &&
          value.fileIdentity === null &&
          value.settings === null, label + " source is not observed absent");
        const identity = value?.parentIdentity;
        require(object(identity) &&
          isDeepStrictEqual(Object.keys(identity).sort(), ["dev", "ino"]) &&
          [identity.dev, identity.ino].every(
            (field) =>
              typeof field === "string" && /^[1-9][0-9]*$/u.test(field),
          ), label + " parent identity missing or zero");
        identities.push(identity);
        if (expectedIdentities)
          require(isDeepStrictEqual(
            identity,
            expectedIdentities[index],
          ), label + " parent identity changed");
      });
      require(!isDeepStrictEqual(identities[0], identities[1]), label +
        " distinct fixture parents alias one identity");
      return identities;
    }
    const identities = observations(
      fixture?.before,
      paths(physicalBase),
      "host before",
    );
    observations(fixture?.after, paths(physicalBase), "host after", identities);
    const actors = Array.isArray(host?.creationLedger)
      ? host.creationLedger
      : [];
    require(actors.length > 0 &&
      actors.length <= 128 &&
      new Set(actors.map((row) => row?.pid)).size === actors.length &&
      new Set(actors.map((row) => row?.registrationId)).size ===
        actors.length, "fixture native actor population missing or duplicated");
    const nodeActors = actors.filter((row) => row?.kind !== "esbuild-service");
    require(nodeActors.some(
      (row) => row?.kind === "root",
    ), "fixture root actor missing");
    require(Array.isArray(report?.receipts) &&
      receipts.length <= 256, "fixture actor receipts missing or excessive");
    const consumed = new Set();
    for (const actor of nodeActors) {
      const role = {
        root: "root",
        "vitest-worker": "worker",
        "report-helper": "report-helper",
      }[actor?.kind];
      require(role &&
        positive(actor?.pid) &&
        UUID.test(actor?.registrationId ?? "") &&
        actor.registered ===
          true, "fixture actor identity or registration invalid");
      const matches = receipts
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row?.pid === actor?.pid);
      const allowedMissingExit = hostTerminatedWorker(actor);
      require(matches.length === 2 ||
        (allowedMissingExit &&
          matches.length ===
            1), "fixture actor lifecycle receipt population differs");
      require(matches.filter(({ row }) => row.phase === "installed").length ===
        1 &&
        (matches.filter(({ row }) => row.phase === "exit").length === 1 ||
          (allowedMissingExit &&
            matches.length ===
              1)), "fixture actor installed or exit observation missing or duplicated");
      for (const { row, index } of matches) {
        consumed.add(index);
        require(["installed", "exit"].includes(row.phase) &&
          row.role === role &&
          row.actor?.role === role &&
          row.actor?.pid === actor.pid &&
          row.actor?.registrationId === actor.registrationId &&
          row.actor?.parentRegistrationId === actor.parentRegistrationId &&
          row.status === "NOT_ADMITTED" &&
          row.trusted === false &&
          row.admissionEligible ===
            false, "fixture receipt actor identity or scope differs");
        const observed = row.fixtureSettings;
        require(observed?.profile === PRIVATE_V4_SETTINGS_PROFILE &&
          samePath(observed.home, PRIVATE_V4_SETTINGS_ENV.USERPROFILE) &&
          samePath(
            observed.managedSettingsFile,
            PRIVATE_V4_SETTINGS_ENV.CC_MANAGED_SETTINGS,
          ), "fixture child selected external home or managed settings");
        environment(observed?.environment, "actor " + actor.pid);
        observations(
          observed?.sources,
          paths("X:\\workspace\\review-fixture"),
          "actor " + actor.pid + " " + row.phase,
          identities,
        );
        require(object(observed?.writeDenied) &&
          isDeepStrictEqual(Object.keys(observed.writeDenied).sort(), [
            "code",
            "path",
          ]) &&
          samePath(
            observed.writeDenied.path,
            PRIVATE_V4_SETTINGS_ENV.USERPROFILE + "\\probe",
          ) &&
          ["EACCES", "EPERM"].includes(
            observed.writeDenied.code,
          ), "fixture child write denial absent or from another target");
      }
    }
    require(consumed.size ===
      receipts.length, "fixture contains unowned or extra actor receipts");
  } catch (error) {
    errors.push("fixture evidence invalid: " + error.message);
  }
  return { verified: errors.length === 0, errors };
}
