#!/usr/bin/env node
/** Explicit native toolchain diagnostics. No formal review/model execution. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectNativeToolchain } from "./verify01-native-toolchain.mjs";
import { readFrozenPreparationFiles } from "./verify01-native-toolchain-prepare.mjs";
import { readNativeReviewBundle } from "./verify01-native-review-admission.mjs";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { createWindowsNativeCapsuleEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const MODES = ["package-import", "global-setup", "addon-load", "vitest-smoke"];
const METADATA = [
  "package.json",
  "packages/cli/package.json",
  "packages/cli/vitest.config.js",
];
const requireCondition = (condition, detail) => {
  if (!condition) throw new Error(`Native capsule: ${detail}`);
};
const SOURCE_IDENTITIES = [
  "./verify01-native-capsule.mjs",
  "./verify01-native-toolchain.mjs",
  "./verify01-native-toolchain-prepare.mjs",
  "./verify01-registry-content.mjs",
  "../src/lib/process-execution-broker/windows-native-evaluator.js",
  "../src/lib/process-execution-broker/windows-sandbox.cs",
  "../src/lib/process-execution-broker/windows-sandbox-helper.exe",
  "../src/lib/process-execution-broker/windows-sandbox-helper.dll",
].map((file) => ({
  file,
  digest: evalDigest(fs.readFileSync(new URL(file, import.meta.url))),
}));

/** Reinspect source bytes, including every registry artifact. An inventory JSON
 * supplied by a caller is never an execution ticket. The factory independently
 * rechecks all captured bytes and the actual runtime before copying them.
 */
export function inspectNativeCapsuleSource(options = {}) {
  const bundle = options.bundle ?? readNativeReviewBundle();
  const frozenFiles = options.readFrozenBlob
    ? null
    : new Map(
        readFrozenPreparationFiles(bundle.catalog.projectCommit).map((item) => [
          item.path,
          item.content,
        ]),
      );
  const readFrozenBlob =
    options.readFrozenBlob ??
    ((commit, file) => {
      requireCondition(
        commit === bundle.catalog.projectCommit,
        "frozen commit changed",
      );
      return frozenFiles.get(file);
    });
  const report = inspectNativeToolchain({ ...options, bundle, readFrozenBlob });
  requireCondition(
    report.registryContentVerified === true,
    "all registry content must be verified before staging",
  );
  const { inventory } = report;
  const snapshots = [
    {
      path: "package-lock.json",
      bytes: fs.statSync(path.join(options.root, "package-lock.json")).size,
      digest: inventory.lockDigest,
    },
    ...inventory.files,
    ...inventory.support,
  ];
  for (const relative of METADATA) {
    let current = path.resolve(options.root);
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      requireCondition(
        !stat.isSymbolicLink() &&
          (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()),
        "frozen metadata traverses a link",
      );
    }
    const before = fs.lstatSync(current, { bigint: true });
    requireCondition(
      before.isFile() &&
        before.nlink === 1n &&
        before.size <= 1024n * 1024n &&
        fs.realpathSync.native(current).toLowerCase() ===
          path.resolve(current).toLowerCase(),
      "frozen metadata must be a bounded plain file",
    );
    const bytes = fs.readFileSync(current);
    const after = fs.lstatSync(current, { bigint: true });
    const frozen = readFrozenBlob(bundle.catalog.projectCommit, relative);
    requireCondition(
      ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => before[key] === after[key],
      ) &&
        Buffer.isBuffer(frozen) &&
        frozen.equals(bytes),
      "metadata/config differs from frozen Git blob",
    );
    snapshots.push({
      path: relative,
      bytes: bytes.length,
      digest: evalDigest(bytes),
    });
  }
  // Frozen setup uses relative imports into production sources; include the
  // frozen closure, rather than loading code from the mutable checkout.
  const closure = frozenFiles
    ? [...frozenFiles.keys()].filter(
        (file) =>
          file.startsWith("packages/cli/src/") ||
          file.startsWith("packages/cli/test/helpers/"),
      )
    : execFileSync(
        "git",
        [
          "-C",
          repository,
          "ls-tree",
          "-r",
          "--name-only",
          bundle.catalog.projectCommit,
          "packages/cli/src",
          "packages/cli/test/helpers",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
        },
      )
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean);
  const already = new Set(snapshots.map((item) => item.path));
  for (const relative of closure) {
    if (already.has(relative)) continue;
    requireCondition(
      relative.startsWith("packages/cli/src/") ||
        relative.startsWith("packages/cli/test/helpers/"),
      "unexpected frozen closure path",
    );
    const frozen = readFrozenBlob(bundle.catalog.projectCommit, relative);
    requireCondition(
      Buffer.isBuffer(frozen) && frozen.length <= 32 * 1024 * 1024,
      "frozen closure bytes unavailable",
    );
    // Capturing all closure paths through the native factory performs the
    // plain path/identity check and compares these independently pinned bytes.
    snapshots.push({
      path: relative,
      bytes: frozen.length,
      digest: evalDigest(frozen),
    });
  }
  requireCondition(
    new Set(snapshots.map((item) => item.path.toLowerCase())).size ===
      snapshots.length,
    "duplicate capsule snapshot path",
  );
  return {
    report,
    snapshots,
    binding: {
      inventoryDigest: report.inventoryDigest,
      lockDigest: inventory.lockDigest,
      planDigest: inventory.planDigest,
      projectCommit: inventory.projectCommit,
      runtime: inventory.runtime,
    },
  };
}

export function nativeCapsuleCheckSource(mode, inventory) {
  requireCondition(MODES.includes(mode), "unknown diagnostic mode");
  const addons = inventory.addons.map((item) => item.path);
  return String.raw`
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const workspace=process.argv[2],scratch=process.argv[3],mode=${JSON.stringify(mode)};
for(const [key,relative]of Object.entries({TMP:'tmp',TEMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'home/AppData/Roaming',LOCALAPPDATA:'home/AppData/Local'})){
 const value=path.join(scratch,relative);fs.mkdirSync(value,{recursive:true});process.env[key]=value;
}

process.env.CI='1';
const journal=fs.openSync(path.join(scratch,'capsule-journal.jsonl'),'wx');
let sequence=0;
function record(stage,detail={}){const row={sequence:sequence++,stage,mode,pid:process.pid,...detail};fs.writeSync(journal,JSON.stringify(row)+'\n');fs.fsyncSync(journal);}
record('started',{nodeVersion:process.version,modulesAbi:process.versions.modules});
const fromWorkspace=createRequire(path.join(workspace,'package.json'));
(async()=>{
 let detail;
 if(mode==='package-import'){
  record('builtin-import-started');await import('node:fs');record('builtin-imported');
  record('vitest-import-started');
  const vitest=await import(pathToFileURL(fromWorkspace.resolve('vitest/node')).href);
  record('vitest-imported');record('vite-import-started');
  const vite=await import(pathToFileURL(fromWorkspace.resolve('vite')).href);
  record('vite-imported');record('happy-dom-import-started');
  const dom=await import(pathToFileURL(fromWorkspace.resolve('happy-dom')).href);
  record('happy-dom-imported');
  if(typeof vitest.startVitest!=='function'||typeof vite.createServer!=='function'||typeof dom.Window!=='function')throw Error('Toolchain exports unavailable');
  detail={packages:['vitest/node','vite','happy-dom'],exportsVerified:true};
 }else if(mode==='global-setup'){
  record('builtin-import-started');await import('node:fs');record('builtin-imported');
  record('support-import-started');
  const setup=await import(pathToFileURL(path.join(workspace,'packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js')).href);
  record('support-imported');record('setup-started');
  const teardown=await setup.default();
  record('setup-completed');
  if(typeof teardown!=='function')throw Error('Frozen global setup did not install on Windows');
  record('teardown-started');
  await teardown();detail={globalSetupExecuted:true,teardownCompleted:true};
 }else if(mode==='addon-load'){
  const results=[];
  for(const relative of ${JSON.stringify(addons)}){
   record('addon-started',{path:relative});
   try{fromWorkspace(path.join(workspace,relative));results.push({path:relative,status:'loaded',code:null});record('addon-loaded',{path:relative,code:null});}
   catch(error){results.push({path:relative,status:'blocked',code:error.code??'UNKNOWN'});record('addon-blocked',{path:relative,code:error.code??'UNKNOWN',error:error.message});}
  }
  detail={results,loaded:results.filter(row=>row.status==='loaded').map(row=>row.path),addonAbiVerified:results.length?results.every(row=>row.status==='loaded'):null};
 }else{
  const testFile=path.join(scratch,'capsule-smoke.test.mjs');
  const vitestEntry=pathToFileURL(fromWorkspace.resolve('vitest')).href;
  fs.writeFileSync(testFile,'import {it,expect} from '+JSON.stringify(vitestEntry)+'; it("native capsule smoke",()=>expect(2+3).toBe(5));\n',{flag:'wx'});
  record('vitest-import-started');
  const {startVitest}=await import(pathToFileURL(fromWorkspace.resolve('vitest/node')).href);
  record('vitest-imported');
  record('vitest-started',{pool:'threads',config:'packages/cli/vitest.config.js'});
  const context=await startVitest('test',[testFile],{root:path.join(workspace,'packages/cli'),config:path.join(workspace,'packages/cli/vitest.config.js'),pool:'threads',maxWorkers:1,watch:false,reporters:['json'],include:[testFile],cache:false});
  if(!context)throw Error('Vitest did not create a context');
  try{const modules=context.state.getTestModules();const tests=modules.flatMap(module=>Array.from(module.children.allTests()));
   if(tests.length!==1||tests[0].result().state!=='passed'||process.exitCode)throw Error('Vitest smoke did not pass exactly one test');
   detail={executedTests:1,pool:'threads',frozenConfigLoaded:true};
  }finally{await context.close();}
 }
 record('completed',detail);process.stdout.write('CC_NATIVE_CAPSULE:'+JSON.stringify({mode,pid:process.pid,nodeVersion:process.version,modulesAbi:process.versions.modules,detail})+'\n');
})().catch(error=>{record('failed',{error:error.message,code:error.code??null});process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>fs.closeSync(journal));
`;
}

export function inspectNativeCapsuleCompletion(report, journalBytes) {
  requireCondition(
    MODES.includes(report?.mode) &&
      report.formalSample === false &&
      report.providerAssessed === false &&
      report.fullReviewPackReady === false &&
      report.manifest?.version === 2 &&
      report.manifest.capsuleBinding.inventoryDigest ===
        outcomeDigest(report.inventory) &&
      report.inventoryDigest === outcomeDigest(report.inventory) &&
      evalDigest(Buffer.from(JSON.stringify(report.manifest))) ===
        report.manifestDigest,
    "capsule evidence scope/inventory/manifest differs",
  );
  const result = report.execution,
    receipt = report.settlement;
  requireCondition(
    Buffer.isBuffer(journalBytes) &&
      journalBytes.length > 0 &&
      journalBytes.length <= 65536,
    "bounded native journal required",
  );
  requireCondition(
    report.journalDigest === evalDigest(journalBytes),
    "native journal digest differs",
  );
  const rows = journalBytes
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  requireCondition(
    rows.length >= 2 &&
      rows.length <= 1000 &&
      rows.every(
        (row, index) =>
          row.sequence === index &&
          row.mode === report.mode &&
          row.pid === receipt?.targetPid,
      ) &&
      rows[0].stage === "started" &&
      rows.at(-1).stage === "completed" &&
      rows[0].nodeVersion === report.nodeVersion &&
      rows[0].modulesAbi === report.inventory.runtime.modulesAbi,
    "native journal identity/order/completion differs",
  );
  requireCondition(
    result?.status === 0 &&
      result.signal === null &&
      result.error === null &&
      receipt?.cleanupConfirmed === true &&
      receipt.executionFailed === false &&
      receipt.targetExitCode === 0 &&
      receipt.capabilityCount === 0 &&
      receipt.loopbackExemptionAbsent === true &&
      report.manifestDigest === `sha256:${receipt.manifestDigest}` &&
      Number.isSafeInteger(receipt.targetPid) &&
      receipt.targetPid > 0,
    "native execution or cleanup not confirmed",
  );
  const frames = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("CC_NATIVE_CAPSULE:"));
  requireCondition(frames.length === 1, "unique completion frame required");
  const frame = JSON.parse(frames[0].slice("CC_NATIVE_CAPSULE:".length));
  requireCondition(
    frame.mode === report.mode &&
      frame.pid === receipt.targetPid &&
      frame.nodeVersion === report.nodeVersion &&
      frame.modulesAbi === report.inventory.runtime.modulesAbi,
    "completion runtime identity differs",
  );
  const detail = Object.fromEntries(
    Object.entries(rows.at(-1)).filter(
      ([key]) => !["stage", "sequence", "pid", "mode"].includes(key),
    ),
  );
  requireCondition(
    JSON.stringify(detail) === JSON.stringify(frame.detail),
    "journal/frame completion differs",
  );
  if (report.mode === "package-import")
    requireCondition(
      frame.detail.exportsVerified === true &&
        JSON.stringify(frame.detail.packages) ===
          JSON.stringify(["vitest/node", "vite", "happy-dom"]),
      "toolchain imports incomplete",
    );
  if (["package-import", "global-setup"].includes(report.mode))
    requireCondition(
      JSON.stringify(rows.map((row) => row.stage)) ===
        JSON.stringify(
          report.mode === "package-import"
            ? [
                "started",
                "builtin-import-started",
                "builtin-imported",
                "vitest-import-started",
                "vitest-imported",
                "vite-import-started",
                "vite-imported",
                "happy-dom-import-started",
                "happy-dom-imported",
                "completed",
              ]
            : [
                "started",
                "builtin-import-started",
                "builtin-imported",
                "support-import-started",
                "support-imported",
                "setup-started",
                "setup-completed",
                "teardown-started",
                "completed",
              ],
        ),
      "native diagnostic stages differ",
    );
  if (report.mode === "global-setup")
    requireCondition(
      frame.detail.globalSetupExecuted === true &&
        frame.detail.teardownCompleted === true,
      "global setup lifecycle incomplete",
    );
  if (report.mode === "vitest-smoke")
    requireCondition(
      JSON.stringify(rows.map((row) => row.stage)) ===
        JSON.stringify([
          "started",
          "vitest-import-started",
          "vitest-imported",
          "vitest-started",
          "completed",
        ]) &&
        rows[3].pool === "threads" &&
        rows[3].config === "packages/cli/vitest.config.js" &&
        frame.detail.executedTests === 1 &&
        frame.detail.pool === "threads" &&
        frame.detail.frozenConfigLoaded === true,
      "Vitest smoke execution incomplete",
    );
  if (report.mode === "addon-load") {
    const expected = report.inventory.addons.map((item) => item.path);
    requireCondition(
      Array.isArray(frame.detail.results) &&
        frame.detail.results.length === expected.length &&
        frame.detail.results.every(
          (item, index) =>
            item.path === expected[index] &&
            ((item.status === "loaded" && item.code === null) ||
              (item.status === "blocked" &&
                typeof item.code === "string" &&
                item.code.length > 0)),
        ) &&
        JSON.stringify(frame.detail.loaded) ===
          JSON.stringify(
            frame.detail.results
              .filter((item) => item.status === "loaded")
              .map((item) => item.path),
          ) &&
        frame.detail.addonAbiVerified ===
          (expected.length
            ? frame.detail.results.every((item) => item.status === "loaded")
            : null),
      "addon population/ABI differs",
    );
    requireCondition(
      JSON.stringify(
        rows.slice(1, -1).map((row) => [row.stage, row.path, row.code ?? null]),
      ) ===
        JSON.stringify(
          frame.detail.results.flatMap((item) => [
            ["addon-started", item.path, null],
            [
              item.status === "loaded" ? "addon-loaded" : "addon-blocked",
              item.path,
              item.code,
            ],
          ]),
        ),
      "addon execution sequence differs",
    );
  }
  return frame.detail;
}

function readJournal(evaluator) {
  const scratch = fs.lstatSync(evaluator.manifest.scratch, { bigint: true });
  const expected = evaluator.manifest.directories.find(
    (item) => item.path === evaluator.manifest.scratch,
  );
  requireCondition(
    scratch.isDirectory() &&
      !scratch.isSymbolicLink() &&
      String(scratch.dev) === expected.dev &&
      String(scratch.ino) === expected.ino,
    "scratch identity changed",
  );
  const file = path.join(evaluator.manifest.scratch, "capsule-journal.jsonl");
  const before = fs.lstatSync(file, { bigint: true });
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0 &&
      before.size <= 65536n,
    "journal is linked or exceeds bound",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(file, { bigint: true });
    const reopened = fs.openSync(file, fs.constants.O_RDONLY);
    let current;
    try {
      current = fs.fstatSync(reopened, { bigint: true });
    } finally {
      fs.closeSync(reopened);
    }
    requireCondition(
      size === Number(before.size) &&
        opened.nlink === 1n &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
          (key) =>
            before[key] === named[key] &&
            opened[key] === after[key] &&
            after[key] === current[key],
        ),
      "journal changed during bounded read",
    );
    return buffer.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}

/** Each attempt has a fresh private root/Job. Even success is diagnostic only;
 * threads deliberately differs from the frozen forks review contract.
 */
export async function runNativeCapsuleDiagnostic({
  mode = "package-import",
  output,
  ...options
}) {
  requireCondition(
    process.platform === "win32" && path.isAbsolute(output),
    "Windows and absolute new output required",
  );
  requireCondition(MODES.includes(mode), "unknown diagnostic mode");
  const source = inspectNativeCapsuleSource(options);
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.native-toolchain-capsule-diagnostic/v1",
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    osRelease: os.release(),
    mode,
    pool: mode === "vitest-smoke" ? "threads" : null,
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    durableAuthorityAssessed: false,
    capabilities: {},
    inventoryDigest: source.report.inventoryDigest,
    registryContentVerified: true,
    inventory: source.report.inventory,
    diagnosticCompleted: false,
    stage: null,
    execution: null,
    settlement: null,
    sourceIdentities: SOURCE_IDENTITIES,
  };
  try {
    const evaluator = createWindowsNativeCapsuleEvaluator({
      sourceRoot: options.root,
      snapshots: source.snapshots,
      binding: source.binding,
      checkSource: nativeCapsuleCheckSource(mode, source.report.inventory),
      wallTimeMs: 15000,
    });
    report.stage = evaluator.root;
    report.manifest = evaluator.manifest;
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    const { result, receipt } = await evaluator.execute();
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    report.settlement = receipt;
    fs.writeFileSync(path.join(output, "stdout.txt"), result.stdout ?? "", {
      flag: "wx",
    });
    fs.writeFileSync(path.join(output, "stderr.txt"), result.stderr ?? "", {
      flag: "wx",
    });
    // Stage remains available for independent review, including failures.
    const journalBytes = readJournal(evaluator);
    report.journalDigest = evalDigest(journalBytes);
    fs.writeFileSync(path.join(output, "capsule-journal.jsonl"), journalBytes, {
      flag: "wx",
    });
    requireCondition(
      result.status === 0 && receipt.executionFailed === false,
      result.status === 125
        ? "native check timed out or was rejected; inspect raw journal/settlement"
        : "native check failed; inspect raw journal/stdio",
    );
    report.completion = inspectNativeCapsuleCompletion(report, journalBytes);
    report.diagnosticCompleted = true;
  } catch (error) {
    report.error = error.message;
    if (error.nativeEvaluator) report.failure = error.nativeEvaluator;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "confirm-native": { type: "boolean" },
        root: { type: "string" },
        "lock-digest": { type: "string" },
        "tarball-dir": { type: "string" },
        "tarball-manifest": { type: "string" },
        "tarball-manifest-digest": { type: "string" },
        output: { type: "string" },
        mode: { type: "string" },
      },
    });
    requireCondition(
      values["confirm-native"] === true,
      "explicit --confirm-native required",
    );
    const manifestStat = fs.lstatSync(values["tarball-manifest"]);
    requireCondition(
      manifestStat.isFile() &&
        !manifestStat.isSymbolicLink() &&
        manifestStat.nlink === 1 &&
        manifestStat.size <= 1024 * 1024,
      "registry manifest must be a bounded plain file",
    );
    const manifestBytes = fs.readFileSync(values["tarball-manifest"]);
    requireCondition(
      manifestBytes.length <= 1024 * 1024 &&
        evalDigest(manifestBytes) === values["tarball-manifest-digest"],
      "registry manifest digest differs",
    );
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    requireCondition(
      manifest.schema === "chainlesschain.native-review-registry-artifacts/v1",
      "registry artifact schema differs",
    );
    const report = await runNativeCapsuleDiagnostic({
      root: values.root,
      lockDigest: values["lock-digest"],
      registry: { root: values["tarball-dir"], artifacts: manifest.artifacts },
      output: values.output,
      mode: values.mode,
    });
    console.log(
      JSON.stringify(
        {
          diagnosticCompleted: report.diagnosticCompleted,
          fullReviewPackReady: false,
          mode: report.mode,
          error: report.error ?? null,
          output: values.output,
        },
        null,
        2,
      ),
    );
    process.exitCode = report.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
