#!/usr/bin/env node
/** Frozen JS client -> real private-map esbuild service. Host client is NOT sandboxed. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  capture,
  digest,
  GNU_IDENTITY,
} from "./windows-rollup-gnu-forwarder.mjs";
import { ESBUILD_DIGEST } from "./windows-esbuild-api-trace.mjs";
import {
  runPrivateMap,
  ENTRY_SOURCE,
  BUNDLE_DIGEST,
  NATIVE_SOURCES,
} from "./windows-esbuild-private-map.mjs";

export const CLIENT_DIGEST =
  "sha256:8331fe1d8b3a07381f33cc425fcfaa94776e263113653f80ec3ba433e9657e73";
export const CONFIG_DIGEST =
  "sha256:2a75931a59f4f30eaf665273b669ae8753ec6081a2327af2ed37975dad65ef08";
export const SERVICE_SCHEMA =
  "chainlesschain.windows-esbuild-private-map-service/v1";
const insist = (condition, message) => {
  if (!condition) throw new Error("private-map service: " + message);
};

export function inspectService(report) {
  insist(
    report.schema === SERVICE_SCHEMA &&
      report.completed === true &&
      report.error === undefined &&
      report.settlementError === undefined &&
      report.status === "NOT_ADMITTED" &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.clientLocation === "host-outside-appcontainer" &&
      report.fullFrozenReviewCompleted === false &&
      report.resultTranslation === false,
    "scope differs",
  );
  insist(report.client.digest === CLIENT_DIGEST, "frozen client bytes differ");
  insist(report.clientAfter.digest === report.client.digest, "client changed");
  const directory = path.dirname(fileURLToPath(import.meta.url));
  insist(
    report.driver?.digest === capture(fileURLToPath(import.meta.url)).digest &&
      report.runtime?.digest === GNU_IDENTITY.runtimeDigest &&
      report.esbuild?.digest === ESBUILD_DIGEST &&
      report.sources?.length === 2 &&
      report.sources.every(
        (row, index) =>
          row.digest ===
          capture(path.join(directory, "diagnostics", NATIVE_SOURCES[index]))
            .digest,
      ),
    "source/runtime bytes differ",
  );
  insist(
    report.outputs?.length === 2 &&
      report.outputs.every(
        (row, index) =>
          path.win32.basename(row.path) ===
            ["supervisor.exe", "shim.dll"][index] &&
          /^sha256:[a-f0-9]{64}$/u.test(row.digest),
      ),
    "native outputs differ",
  );
  for (const observations of [report.outputsBefore, report.outputsAfter])
    insist(
      observations?.length === 2 &&
        observations.every(
          (row, index) =>
            row.path === report.outputs[index].path &&
            row.digest === report.outputs[index].digest,
        ),
      "compiled native bytes changed before or after service execution",
    );
  insist(
    report.stagedInputs?.length === 4 &&
      [
        ["esbuild.exe", ESBUILD_DIGEST],
        ["shim.dll", report.outputs[1].digest],
        ["entry.js", digest(ENTRY_SOURCE)],
        ["vitest.config.js", CONFIG_DIGEST],
      ].every(
        ([name, expected]) =>
          report.stagedInputs.filter(
            (row) =>
              row.path === path.win32.join(report.root, "workspace", name) &&
              row.digest === expected,
          ).length === 1,
      ),
    "guarded staged inputs differ",
  );
  insist(
    report.serviceExit.code === 0 && report.serviceExit.signal === null,
    "service exit differs",
  );
  const native = report.native;
  insist(
    native?.completed === true &&
      native.stage === "completed" &&
      native.error === 0 &&
      native.childExit === 0 &&
      native.setterStatus === 0 &&
      native.status === "NOT_ADMITTED",
    "native settlement differs",
  );
  for (const key of [
    "hostNonElevatedUnrestricted",
    "childTokenProven",
    "imagePinned",
    "leafRestricted",
    "mapPrepared",
    "mapInstalled",
    "parentMapUnchanged",
    "cleanupConfirmed",
    "profileDeleted",
    "loopbackExemptionAbsent",
    "childCreated",
    "jobAssigned",
    "childExitRead",
    "childExited",
    "jobQuerySucceeded",
  ])
    insist(native[key] === true, "missing native proof: " + key);
  insist(
    native.runWaitStatus === 0 &&
      native.runDeadlineExceeded === false &&
      native.childWaitStatus === 0 &&
      native.jobActiveProcesses === 0 &&
      native.capabilityCount === 0 &&
      native.exactHandleCount === 5 &&
      native.rootPid === report.servicePid &&
      native.childPid > 0 &&
      native.childPid !== native.rootPid,
    "native process/handle proof differs",
  );
  insist(
    /^S-1-15-2-(?:\d+-){6}\d+$/u.test(native.appContainerSid) &&
      /^\\Device\\HarddiskVolume\d+\\/u.test(native.guardedRootNt) &&
      native.guardedRootNt.slice(
        native.guardedRootNt.indexOf("\\", "\\Device\\".length),
      ) === report.root.slice(2) &&
      /^[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/u.test(native.guardedRootFileId),
    "canonical authority binding differs",
  );
  for (const row of [
    native.beforeMap,
    native.afterSetterMap,
    native.afterChildMap,
  ])
    insist(
      row?.status === "absent" &&
        row.characters === 0 &&
        row.error === 2 &&
        row.valueHex === "",
      "host mapping not conclusively absent",
    );
  insist(
    report.trace.digest === digest(report.trace.text),
    "trace bytes differ",
  );
  const rows = report.trace.text.trim().split(/\r?\n/u).map(JSON.parse);
  insist(
    rows.length >= 20 &&
      rows.length <= 512 &&
      rows.every(
        (row, index) =>
          row.sequence === index + 1 &&
          row.pid === native.childPid &&
          row.overflow === 0,
      ),
    "trace population differs",
  );
  const one = (api, check) => {
    const matches = rows.filter((row) => row.api === api);
    insist(
      matches.length === 1 && matches[0].success === true && check(matches[0]),
      "trace proof missing: " + api,
    );
  };
  one("identity-accepted", () => true);
  one("installed", (row) => row.patches === 2);
  const installedIndex = rows.findIndex((row) => row.api === "installed");
  insist(
    installedIndex > 0 &&
      rows[0].api === "identity-accepted" &&
      rows.every(
        (row, index) => row.patches === (index < installedIndex ? 0 : 2),
      ),
    "shim lifecycle differs",
  );
  one("exit", () => rows.at(-1).api === "exit");
  one(
    "device-map-root-proven",
    (row) => row.requestedPath === native.guardedRootNt,
  );
  one(
    "device-map-file-id-proven",
    (row) => row.requestedPath === native.guardedRootFileId,
  );
  one("device-map-handle-access", (row) => row.kind === 3 && row.error === 0);
  one("device-map-supervisor-handle", (row) => row.kind === 3);
  one(
    "namespace-host-root-denied",
    (row) => row.error === 5 && row.requestedPath === "C:\\",
  );
  one(
    "namespace-workspace-write-denied",
    (row) =>
      row.error === 5 && row.requestedPath === "X:\\workspace\\forbidden.txt",
  );
  one(
    "namespace-traversal-confined",
    (row) => row.requestedPath === native.guardedRootNt,
  );
  insist(
    rows.some(
      (row) =>
        row.api === "CreateFileW" &&
        row.requestedPath === "X:\\workspace\\entry.js" &&
        row.success,
    ) &&
      rows.some(
        (row) =>
          row.api === "GetFileInformationByHandleEx" &&
          row.requestedPath === native.guardedRootNt &&
          row.kind === 11 &&
          row.success,
      ),
    "real service filesystem operations absent",
  );
  insist(
    report.bundle.digest === BUNDLE_DIGEST &&
      digest(report.bundle.text) === report.bundle.digest,
    "bundle differs",
  );
  insist(
    report.transform.code === "const answer = 42;\n" &&
      report.transform.warnings.length === 0 &&
      report.build.errors.length === 0 &&
      report.build.warnings.length === 0,
    "service replies differ",
  );
  insist(
    report.invalidTransform.rejected === true &&
      report.invalidTransform.errors.length === 1 &&
      report.invalidTransform.errors[0].text ===
        'Expected identifier but found "="' &&
      report.invalidTransform.errors[0].location.lineText === "const =",
    "negative protocol request not rejected",
  );
  insist(
    report.frozenConfig.digest === CONFIG_DIGEST &&
      report.frozenConfigAfter.digest === CONFIG_DIGEST &&
      report.configBundle.errors.length === 0 &&
      report.configBundle.warnings.length === 0 &&
      report.configBundle.outputFiles.length === 1 &&
      digest(report.configBundle.outputFiles[0].text) ===
        report.configBundle.outputFiles[0].digest &&
      /pool: "forks"/u.test(report.configBundle.outputFiles[0].text) &&
      /maxWorkers: 2/u.test(report.configBundle.outputFiles[0].text) &&
      rows.some(
        (row) =>
          row.api === "CreateFileW" &&
          row.requestedPath === "X:\\workspace\\vitest.config.js" &&
          row.kind === 0x80000000 &&
          row.success,
      ),
    "frozen configuration bundle differs",
  );
  insist(
    report.serviceStderr === "" && report.nativeStderr === "",
    "unexpected service stderr",
  );
  insist(
    report.protocol.inputBytes > 0 &&
      report.protocol.outputBytes > 0 &&
      report.protocol.spawnCount === 1,
    "duplex service not observed",
  );
  return {
    rows: rows.length,
    childPid: native.childPid,
    bundleDigest: report.bundle.digest,
  };
}

export async function runPrivateMapService({
  compiler,
  esbuild,
  client,
  frozenConfig,
  output,
}) {
  insist(
    path.isAbsolute(client) && capture(client).digest === CLIENT_DIGEST,
    "exact frozen JS client required",
  );
  insist(
    path.isAbsolute(frozenConfig) &&
      capture(frozenConfig).digest === CONFIG_DIGEST,
    "exact frozen configuration required",
  );
  fs.mkdirSync(output);
  const report = {
    schema: SERVICE_SCHEMA,
    status: "NOT_ADMITTED",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    resultTranslation: false,
    clientLocation: "host-outside-appcontainer",
    fullFrozenReviewCompleted: false,
    completed: false,
    client: capture(client),
    frozenConfig: capture(frozenConfig),
    driver: capture(fileURLToPath(import.meta.url)),
    startedAt: new Date().toISOString(),
  };
  const originalSpawn = childProcess.spawn;
  let service, closePromise, api;
  try {
    const leaf = await runPrivateMap({
      compiler,
      esbuild,
      output: path.join(output, "leaf"),
    });
    report.leafReport = capture(path.join(output, "leaf/report.json"));
    insist(
      leaf.completed,
      "prerequisite private-map leaf failed: " + leaf.error,
    );
    report.sources = leaf.sources;
    report.outputs = leaf.outputs;
    report.runtime = leaf.runtime;
    report.esbuild = leaf.esbuild;
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-esbuild-service-"),
    );
    report.root = root;
    const workspace = path.join(root, "workspace"),
      scratch = path.join(root, "scratch");
    fs.mkdirSync(workspace);
    fs.mkdirSync(scratch);
    fs.copyFileSync(esbuild, path.join(workspace, "esbuild.exe"));
    fs.copyFileSync(leaf.outputs[1].path, path.join(workspace, "shim.dll"));
    fs.writeFileSync(path.join(workspace, "entry.js"), ENTRY_SOURCE, {
      flag: "wx",
    });
    fs.copyFileSync(frozenConfig, path.join(workspace, "vitest.config.js"));
    report.stagedInputs = [
      "esbuild.exe",
      "shim.dll",
      "entry.js",
      "vitest.config.js",
    ].map((name) => capture(path.join(workspace, name)));
    report.protocol = { inputBytes: 0, outputBytes: 0, spawnCount: 0 };
    report.serviceStderr = "";
    childProcess.spawn = (command, args, options) => {
      insist(
        path.resolve(command) === path.resolve(esbuild) &&
          args.length === 2 &&
          args[0] === "--service=0.28.1" &&
          args[1] === "--ping" &&
          report.protocol.spawnCount === 0,
        "unexpected frozen client spawn",
      );
      report.protocol.spawnCount++;
      report.outputsBefore = leaf.outputs.map((row) => capture(row.path));
      insist(
        report.outputsBefore.every(
          (row, index) => row.digest === leaf.outputs[index].digest,
        ),
        "compiled native bytes changed before service spawn",
      );
      service = originalSpawn(
        leaf.outputs[0].path,
        [root, leaf.outputs[1].digest.slice(7), ...args],
        { ...options, stdio: ["pipe", "pipe", "pipe"] },
      );
      report.servicePid = service.pid;
      closePromise = new Promise((resolve, reject) => {
        service.once("error", reject);
        service.once("close", (code, signal) => resolve({ code, signal }));
      });
      // Observe bytes without decoding, replacing, or rewriting the protocol.
      const originalWrite = service.stdin.write;
      service.stdin.write = function (bytes, ...rest) {
        report.protocol.inputBytes += Buffer.byteLength(bytes);
        return originalWrite.call(this, bytes, ...rest);
      };
      service.stdout.on("data", (bytes) => {
        report.protocol.outputBytes += bytes.length;
      });
      service.stderr.on("data", (bytes) => {
        report.serviceStderr += bytes.toString("utf8");
      });
      return service;
    };
    api = createRequire(import.meta.url)(client);
    report.build = await api.build({
      absWorkingDir: "X:\\workspace",
      entryPoints: ["entry.js"],
      bundle: true,
      platform: "node",
      outfile: "X:\\scratch\\bundle.js",
      logLevel: "silent",
    });
    report.transform = await api.transform("const answer: number = 42", {
      loader: "ts",
    });
    const configBundle = await api.build({
      absWorkingDir: "X:\\workspace",
      entryPoints: ["vitest.config.js"],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["vitest/config"],
      write: false,
      logLevel: "silent",
    });
    report.configBundle = {
      errors: configBundle.errors,
      warnings: configBundle.warnings,
      outputFiles: configBundle.outputFiles.map((file) => ({
        path: file.path,
        text: file.text,
        digest: digest(file.contents),
      })),
    };
    try {
      await api.transform("const =", { loader: "ts", logLevel: "silent" });
      report.invalidTransform = { rejected: false };
    } catch (error) {
      report.invalidTransform = { rejected: true, errors: error.errors };
    }
    // A graceful EOF lets the real service finish and the supervisor settle its
    // original process handle. esbuild.stop() would kill the supervisor early.
    service.stdin.end();
    service.ref();
    report.serviceExit = await closePromise;
    report.outputsAfter = leaf.outputs.map((row) => capture(row.path));
    report.native = JSON.parse(
      fs.readFileSync(path.join(root, "supervisor.json"), "utf8"),
    );
    report.nativeStderr = fs.readFileSync(path.join(scratch, "stderr"), "utf8");
    for (const [file, key] of [
      ["trace.jsonl", "trace"],
      ["bundle.js", "bundle"],
    ]) {
      const bytes = fs.readFileSync(path.join(scratch, file));
      fs.writeFileSync(path.join(output, file), bytes, { flag: "wx" });
      report[key] = { digest: digest(bytes), text: bytes.toString("utf8") };
    }
    report.clientAfter = capture(client);
    report.frozenConfigAfter = capture(frozenConfig);
    report.completed = true;
    report.observations = inspectService(report);
  } catch (error) {
    report.completed = false;
    report.error = error.stack;
    if (service && service.exitCode === null) {
      service.stdin.end();
      service.ref();
      try {
        report.serviceExit = await closePromise;
      } catch (settlementError) {
        report.settlementError = settlementError.message;
      }
    }
    if (report.root)
      for (const [name, key] of [
        ["supervisor.json", "nativeRaw"],
        ["stderr", "nativeStderr"],
        ["trace.jsonl", "traceRaw"],
      ]) {
        const file =
          name === "supervisor.json"
            ? path.join(report.root, name)
            : path.join(report.root, "scratch", name);
        if (fs.existsSync(file)) report[key] = fs.readFileSync(file, "utf8");
      }
  } finally {
    childProcess.spawn = originalSpawn;
    api?.stop();
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      compiler: { type: "string" },
      esbuild: { type: "string" },
      client: { type: "string" },
      frozenConfig: { type: "string" },
      output: { type: "string" },
      "confirm-native": { type: "boolean" },
    },
  });
  insist(values["confirm-native"], "explicit native confirmation required");
  const report = await runPrivateMapService(values);
  console.log(
    JSON.stringify({
      completed: report.completed,
      output: values.output,
      error: report.error ?? null,
    }),
  );
  process.exitCode = report.completed ? 0 : 2;
}
