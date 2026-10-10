#!/usr/bin/env node
/** Native diagnostic only; no provider work, formal sample, or sandbox admission. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { capture, digest } from "./windows-rollup-gnu-forwarder.mjs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  inspectPrivateV4Result,
  inspectPrivateV4Settlement,
} from "./windows-node-private-v4-result.mjs";
import { inspectNativeCapsuleSource } from "./verify01-native-capsule.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import { parseReviewTests } from "./verify01-review-runtime.mjs";
const WINDOWS_TASK_IDS = [
  "verify-01",
  "verify-02",
  "verify-03",
  "verify-10",
  "verify-11",
  "verify-12",
  "verify-19",
  "verify-20",
  "verify-21",
  "verify-28",
  "verify-29",
  "verify-30",
];

export function runPrivateV4Diagnostic(options) {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw Error("Windows x64 native diagnostic only");
  const output = path.resolve(options.output),
    compiler = path.resolve(options.compiler),
    headers = path.resolve(options.headers),
    prepared = path.resolve(options.prepared),
    sourceClosure = path.resolve(options.sourceClosure);
  if (
    ![
      "original",
      "protocol-negative",
      "unassigned-worker",
      "review-baseline",
      "review-mutant",
    ].includes(options.mode)
  )
    throw Error("unsupported diagnostic mode");
  const review = options.mode.startsWith("review-");
  if (options.reviewTask && !WINDOWS_TASK_IDS.includes(options.reviewTask))
    throw Error("Only frozen Windows task scope supported");
  const selectedSpecs = VERIFY01_REVIEW_SPECS.filter(
    (spec) =>
      WINDOWS_TASK_IDS.includes(spec.taskId) &&
      (!options.reviewTask || spec.taskId === options.reviewTask),
  );
  const selectedTests = [
    ...new Set(selectedSpecs.flatMap((spec) => spec.baselineTests)),
  ].sort();
  if (
    options.mode === "review-mutant" &&
    (!options.reviewTask || !options.mutant)
  )
    throw Error("Mutant requires exact --review-task and --mutant");
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(output, "source"));
  fs.mkdirSync(path.join(output, "inputs"));
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  function retain(file, directory = "source") {
    const target = path.join(output, directory, path.basename(file));
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    return capture(target);
  }
  const registry = JSON.parse(
    fs.readFileSync(path.join(prepared, "registry-artifacts.json"), "utf8"),
  );
  const sourceProof = inspectNativeCapsuleSource({
    root: path.join(prepared, "tree"),
    lockDigest:
      "sha256:f70a1beec6cb222e3e4fbcb13711e67681d49c8f8edb5d75f55000832b95455a",
    registry: {
      root: path.join(prepared, "tarballs"),
      artifacts: registry.artifacts,
    },
  });
  const runtime = capture(process.execPath);
  if (
    runtime.digest !==
      "sha256:ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3" ||
    runtime.bytes !== 87074816
  )
    throw Error("Exact diagnostic Node 22.22.2 binary required");

  const sources = [
    "windows-node-private-v4-broker.cpp",
    "windows-node-private-v4-adapter.cpp",
    "windows-node-private-v4-adapter.h",
    "windows-node-private-v4-paired.h",
    "windows-node-private-v4-protocol.h",
    "windows-esbuild-private-map-supervisor.cpp",
    "windows-esbuild-private-map-shim.cpp",
    "windows-node-private-v4-identity.cjs",
    "windows-node-private-v4-preload.cjs",
  ].map((file) => retain(path.join(scriptDirectory, "diagnostics", file)));
  const report = {
    schema: "chainlesschain.windows-private-v4-diagnostic/v1",
    status: "NOT_ADMITTED",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    fullFrozenReviewCompleted: false,
    sources,
    commands: [],
    driver: retain(fileURLToPath(import.meta.url)),
    validatorSource: retain(
      path.join(scriptDirectory, "windows-node-private-v4-result.mjs"),
    ),
    mode: options.mode,
    runtime,
    compiler: capture(compiler),
    preparation: retain(path.join(prepared, "preparation.json"), "inputs"),
    sourceProof: {
      binding: sourceProof.binding,
      registryContentVerified: sourceProof.report.registryContentVerified,
    },
  };
  function save() {
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  try {
    for (const [source, name, addon] of [
      [sources[0].path, "broker.exe", false],
      [sources[1].path, "windows-node-private-v4.node", true],
      [sources[6].path, "esbuild-private-shim.dll", true],
    ]) {
      const args = [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-static",
        ...(addon ? ["-shared", "-I", headers] : ["-municode"]),
        source,
        "-ladvapi32",
        "-lbcrypt",
        "-lshell32",
        ...(!addon ? ["-luserenv"] : []),
        "-Wl,--no-insert-timestamp",
        "-o",
        path.join(output, name),
      ];
      const run = spawnSync(compiler, args, {
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
      });
      report.commands.push({
        args,
        status: run.status,
        stdout: run.stdout,
        stderr: run.stderr,
      });
      if (run.status !== 0) throw Error("compile failed " + name);
    }
    report.outputs = [
      "broker.exe",
      "windows-node-private-v4.node",
      "esbuild-private-shim.dll",
    ].map((file) => capture(path.join(output, file)));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-private-v4-"));
    report.root = root;
    for (const dir of [
      "control",
      "workspace/adapter",
      "scratch/adapter-receipts",
    ])
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(root, "control/node.exe"));
    fs.cpSync(path.join(prepared, "tree"), path.join(root, "workspace/tree"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });

    const closurePath = path.join(sourceClosure, "source-closure.json"),
      closure = JSON.parse(fs.readFileSync(closurePath, "utf8"));
    if (
      closure.projectCommit !== "b2aa3aba082873570e85dce39b00754e5504ff37" ||
      capture(closurePath).digest !==
        "sha256:b8a63ab9af6e4d9be9469af2c07416d350b5a1f70301b40d8f89ffbc0f1ea658"
    )
      throw Error("Frozen source closure differs");
    report.sourceClosure = retain(closurePath, "inputs");
    report.frozenGitFiles = [];
    const testRelative =
      "packages/cli/__tests__/unit/model-capabilities.test.js";

    function stageFrozen(row, relative) {
      if (
        !relative ||
        relative.includes("..") ||
        relative.includes("\\") ||
        relative.includes(":")
      )
        throw Error("Unsafe frozen path");
      const source = path.join(sourceClosure, row.path),
        current = capture(source);
      if (current.bytes !== row.bytes || current.digest !== row.digest)
        throw Error("Frozen source differs " + row.path);
      const target = path.join(root, "workspace/tree", relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (capture(target).digest !== row.digest)
          throw Error("Existing prepared file differs " + relative);
      } else fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      report.frozenGitFiles.push({ ...row, staged: target });
    }
    for (const row of closure.files) {
      if (review) stageFrozen(row, row.path);
      else if (row.path === testRelative) stageFrozen(row, row.path);
      else if (row.path.startsWith("packages/context-memory-kernel/"))
        stageFrozen(
          row,
          "node_modules/@chainlesschain/context-memory-kernel/" +
            row.path.slice("packages/context-memory-kernel/".length),
        );
    }
    if (review) {
      for (const link of closure.workspaceLinks)
        for (const row of closure.files) {
          if (!row.path.startsWith(link.source + "/")) continue;
          const suffix = row.path.slice(link.source.length + 1);
          if (
            /^(?:__tests__|tests?|scripts|docs|examples|benchmarks|\.github)\//u.test(
              suffix,
            )
          )
            continue;
          stageFrozen(row, link.nodeModulesPath + "/" + suffix);
        }
      if (options.dependencies) {
        const dependencyRoot = path.resolve(options.dependencies),
          manifestPath = path.join(dependencyRoot, "manifest.json");
        if (
          !options.dependenciesDigest ||
          capture(manifestPath).digest !== options.dependenciesDigest
        )
          throw Error("Pinned dependency manifest digest required");
        const dependencies = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        report.dependencies = retain(manifestPath, "inputs");
        for (const row of dependencies.files) {
          if (
            !row.path.startsWith("node_modules/") ||
            row.path.includes("..") ||
            row.path.includes("\\") ||
            row.path.includes(":")
          )
            throw Error("Unsafe dependency path");
          const source = path.join(dependencyRoot, "tree", row.path);
          if (
            capture(source).digest !== row.digest ||
            fs.statSync(source).size !== row.bytes
          )
            throw Error("Dependency bytes differ");
          const target = path.join(root, "workspace/tree", row.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (fs.existsSync(target)) {
            if (capture(target).digest !== row.digest)
              throw Error("Conflicting dependency bytes");
          } else fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        }
      }
      if (options.mode === "review-mutant") {
        const spec = selectedSpecs[0],
          mutation = spec.mutants.find((row) => row.name === options.mutant);
        if (!mutation) throw Error("Unknown frozen behavioral mutant");
        const target = path.join(root, "workspace/tree", spec.sourcePath),
          before = capture(target),
          source = fs.readFileSync(target, "utf8");
        if (source.split(mutation.find).length !== 2)
          throw Error("Mutation requires one exact source match");
        fs.writeFileSync(
          target,
          source.replace(mutation.find, mutation.replace),
        );
        report.mutation = {
          taskId: spec.taskId,
          name: mutation.name,
          sourcePath: spec.sourcePath,
          before,
          after: capture(target),
          snapshot: retain(target, "inputs"),
        };
      }
      const support = [
        [
          "globalSetup",
          "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
        ],
        ["setup", "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js"],
        ["setup", "packages/cli/test/setup/agent-evolution-test-boundary.js"],
      ];
      const reviewOptions = {
        test: {
          root: "X:/workspace/tree",
          include: selectedTests,
          globals: true,
          pool: "forks",
          maxWorkers: 1,
          testTimeout: 90000,
          hookTimeout: 120000,
          teardownTimeout: 30000,
          passWithNoTests: false,
          cache: false,
          setupFiles: support
            .filter((row) => row[0] === "setup")
            .map((row) => "X:/workspace/tree/" + row[1]),
          globalSetup: support
            .filter((row) => row[0] === "globalSetup")
            .map((row) => "X:/workspace/tree/" + row[1]),
        },
      };
      const reviewConfig = path.join(root, "control/review-vitest.config.mjs");
      fs.writeFileSync(
        reviewConfig,
        "export default " + JSON.stringify(reviewOptions) + ";\n",
        { flag: "wx" },
      );
      report.review = {
        taskIds: selectedSpecs.map((row) => row.taskId),
        tests: selectedTests,
        config: retain(reviewConfig, "inputs"),
        support: support.map((row) => ({
          kind: row[0],
          source: row[1],
          capture: retain(path.join(root, "workspace/tree", row[1]), "inputs"),
        })),
        specs: retain(path.join(scriptDirectory, "verify01-review-specs.mjs")),
        runtime: retain(
          path.join(scriptDirectory, "verify01-review-runtime.mjs"),
        ),
      };
    }

    const configPath = path.join(
        root,
        "workspace/tree/packages/cli/vitest.config.js",
      ),
      testPath = path.join(root, "workspace/tree", testRelative);
    report.frozenInputs = {
      config: retain(configPath, "inputs"),
      test: retain(testPath, "inputs"),
    };
    report.stagedInputs = {
      config: { before: capture(configPath) },
      test: { before: capture(testPath) },
    };

    report.experimentKind = review
      ? options.mode === "review-mutant"
        ? "external-locked-review-mutant"
        : "external-locked-review-baseline"
      : "original-frozen-config-tests";

    for (const name of [
      "windows-node-private-v4.node",
      "esbuild-private-shim.dll",
    ])
      fs.copyFileSync(
        path.join(output, name),
        path.join(root, "workspace/adapter", name),
      );
    for (const name of [
      "windows-node-private-v4-preload.cjs",
      "windows-node-private-v4-identity.cjs",
    ])
      fs.copyFileSync(
        sources.find((row) => path.basename(row.path) === name).path,
        path.join(root, "workspace/adapter", name),
      );
    fs.writeFileSync(
      path.join(root, "workspace/entry.js"),
      "export const answer = 42;\n",
    );
    let check = String.raw`require('X:\\workspace\\adapter\\windows-node-private-v4-preload.cjs');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const workspace='X:\\workspace\\tree',scratch='X:\\scratch';process.chdir(path.join(workspace,'packages/cli'));process.env.CI='1';process.env.NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main --require X:\\workspace\\adapter\\windows-node-private-v4-preload.cjs';
const journal=fs.openSync(path.join(scratch,'journal.jsonl'),'wx');let sequence=0;const record=(phase,data={})=>{fs.writeSync(journal,JSON.stringify({sequence:++sequence,pid:process.pid,phase,...data})+'\n');fs.fsyncSync(journal)};
let service,closed;const original=cp.spawn;cp.spawn=(...args)=>{record('spawn',{application:args[0],args:args[1]});const child=original(...args);if(String(args[0]).endsWith('esbuild.exe')){service=child;closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))})}return child};
(async()=>{record('started');const api=require(path.join(workspace,'node_modules/esbuild/lib/main.js'));const transform=await api.transform('const answer: number = 42',{loader:'ts'});const build=await api.build({absWorkingDir:'X:/workspace',entryPoints:['entry.js'],bundle:true,platform:'node',outfile:'X:/scratch/bundle.js',logLevel:'silent'});const configBundle=await api.build({absWorkingDir:path.join(workspace,'packages/cli'),entryPoints:['vitest.config.js'],bundle:true,platform:'node',format:'esm',external:['vitest/config'],write:false,logLevel:'silent'});let invalidRejected=false;try{await api.transform('const =',{loader:'ts',logLevel:'silent'})}catch{invalidRejected=true}if(!invalidRejected||build.errors.length||configBundle.errors.length||!transform.code.includes('answer = 42'))throw Error('esbuild diagnostic failed');fs.writeFileSync(path.join(scratch,'service.json'),JSON.stringify({transform,build,configBundle:configBundle.outputFiles.map(file=>({path:file.path,text:file.text})),invalidRejected}));record('esbuild-completed',{invalidRejected,servicePid:service?.pid});const testFile=path.join(workspace,'packages/cli/__tests__/unit/model-capabilities.test.js');record('vitest-import-started');const {startVitest}=await import(pathToFileURL(path.join(workspace,'node_modules/vitest/dist/node.js')).href);record('vitest-import-completed');const context=await startVitest('test',[testFile],{root:path.join(workspace,'packages/cli'),config:path.join(workspace,'packages/cli/vitest.config.js'),configLoader:'native',watch:false,reporters:['json'],include:['__tests__/unit/model-capabilities.test.js'],cache:false});if(!context)throw Error('no Vitest context');try{record('config-loaded',{pool:context.config.pool,maxWorkers:context.config.maxWorkers,unhandled:context.state.getUnhandledErrors().map(error=>({name:error.name,message:error.message,stack:error.stack,cause:String(error.cause??'')}))});if(context.config.pool!=='forks'||context.config.maxWorkers!==2)throw Error('frozen configuration differs');const tests=context.state.getTestModules().flatMap(module=>Array.from(module.children.allTests()));record('test-results',{count:tests.length,states:tests.map(test=>test.result().state)});if(tests.length===0||tests.some(test=>test.result().state!=='passed')||process.exitCode)throw Error('smoke did not pass');record('completed',{tests:tests.length});}finally{await context.close();}})().catch(error=>{record('failed',{message:error.message,code:error.code??null});console.error(error.stack);process.exitCode=1}).finally(async()=>{if(service){service.stdin.end();service.ref();await closed;}fs.closeSync(journal)});
`;

    if (review) {
      check = check.replace(
        "record('vitest-import-started');",
        String.raw`const junctionRoot=path.join(scratch,'private-v4-junction-probe'),junctionTarget=path.join(junctionRoot,'target'),junctionLink=path.join(junctionRoot,'link');fs.mkdirSync(junctionTarget,{recursive:true});const junctionEvidence={};try{fs.symlinkSync(junctionTarget,junctionLink,'junction');const stat=fs.lstatSync(junctionLink);junctionEvidence.stat={mode:stat.mode,isDirectory:stat.isDirectory(),isSymbolicLink:stat.isSymbolicLink()};try{junctionEvidence.readlink=fs.readlinkSync(junctionLink)}catch(error){junctionEvidence.readlinkError={code:error.code,message:error.message}}junctionEvidence.raw=require('X:/workspace/adapter/windows-node-private-v4.node').probeReparse(junctionLink)}catch(error){junctionEvidence.error={code:error.code,message:error.message}}record('junction-probe',junctionEvidence);record('vitest-import-started');`,
      );
      check = check.replace(
        "const tests=context.state.getTestModules()",
        "const describeError=(error,depth=0)=>!error||depth>8?String(error):({name:error.name,message:error.message,stack:error.stack,code:error.code,cause:error.cause?describeError(error.cause,depth+1):null});record('module-errors',{modules:context.state.getTestModules().map(module=>({id:module.moduleId,errors:module.errors().map(error=>describeError(error))}))});const tests=context.state.getTestModules()",
      );
      check = check.replace(
        "const context=await startVitest('test',[testFile],{root:path.join(workspace,'packages/cli'),config:path.join(workspace,'packages/cli/vitest.config.js'),configLoader:'native',watch:false,reporters:['json'],include:['__tests__/unit/model-capabilities.test.js'],cache:false});",
        "const context=await startVitest('test',[],{root:workspace,config:'X:/control/review-vitest.config.mjs',configLoader:'native',watch:false,reporters:['json']});",
      );
      check = check.replace(
        "context.config.maxWorkers!==2",
        "context.config.maxWorkers!==1",
      );
      if (options.mode === "review-baseline")
        check = check.replace(
          "tests.some(test=>test.result().state!=='passed')",
          "tests.some(test=>!['passed','skipped','pending'].includes(test.result().state))",
        );
    }

    fs.writeFileSync(
      path.join(root, "control/check.cjs"),
      options.mode === "protocol-negative"
        ? `require('X:/workspace/adapter/windows-node-private-v4-preload.cjs');require('X:/workspace/adapter/windows-node-private-v4.node').protocolNegative();`
        : check,
    );
    report.checker = retain(path.join(root, "control/check.cjs"), "inputs");
    const run = spawnSync(
      path.join(output, "broker.exe"),
      [
        root,
        ...(options.mode === "unassigned-worker"
          ? ["--probe-unassigned-worker"]
          : []),
      ],
      {
        encoding: "utf8",
        timeout: 240000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    report.execution = {
      status: run.status,
      signal: run.signal,
      error: run.error?.message ?? null,
      stdout: run.stdout,
      stderr: run.stderr,
    };
    for (const file of [
      ...new Set([
        "stdout",
        "stderr",
        "service.json",
        "bundle.js",
        "journal.jsonl",
        ...fs
          .readdirSync(path.join(root, "scratch"))
          .filter((name) => /^esbuild-trace-\d+\.jsonl$/u.test(name)),
      ]),
    ]) {
      const source = path.join(root, "scratch", file);
      if (fs.existsSync(source)) {
        const bytes = fs.readFileSync(source);
        fs.writeFileSync(path.join(output, file), bytes);
        report[file] = { digest: digest(bytes), text: bytes.toString("utf8") };
      }
    }
    const receipts = path.join(root, "scratch/adapter-receipts");
    report.receipts = fs
      .readdirSync(receipts)
      .map((file) =>
        JSON.parse(fs.readFileSync(path.join(receipts, file), "utf8")),
      );
    report.manifests = fs
      .readdirSync(path.join(root, "control"))
      .filter((name) => name.endsWith(".manifest.json"))
      .map((name) => {
        const file = path.join(root, "control", name);
        return {
          path: path.win32.join("X:/", "control", name),
          raw: fs.readFileSync(file, "utf8"),
          capture: retain(file, "inputs"),
        };
      });
    report.stagedInputs.config.after = capture(configPath);
    report.stagedInputs.test.after = capture(testPath);
    report.outputsAfter = report.outputs.map((row) => capture(row.path));

    const manifest = path.join(
      root,
      "control/windows-node-private-v4.manifest.json",
    );
    if (fs.existsSync(manifest)) {
      report.manifestRaw = fs.readFileSync(manifest, "utf8");
      fs.writeFileSync(path.join(output, "manifest.json"), report.manifestRaw);
    }

    report.inspection = inspectPrivateV4Result(report);
    if (review) {
      report.settlement = inspectPrivateV4Settlement(report, {
        expectedRootExit: options.mode === "review-mutant" ? 1 : 0,
      });
      try {
        const host = JSON.parse(report.execution.stdout);
        report.reviewValidation = {
          acceptedByFrozenParser: true,
          ...parseReviewTests(
            {
              status: host.rootExit,
              stdout: report.stdout?.text ?? "",
              stderr: report.stderr?.text ?? "",
              error: report.execution.error,
              signal: report.execution.signal,
            },
            {
              baseline: options.mode === "review-baseline",
              mutant: options.mode === "review-mutant",
            },
          ),
        };
      } catch (error) {
        report.reviewValidation = {
          acceptedByFrozenParser: false,
          error: error.message,
        };
      }
      report.reviewValidation.nativeSettlementConfirmed =
        report.settlement.nativeSettlementConfirmed === true;
      report.reviewValidation.accepted =
        report.reviewValidation.acceptedByFrozenParser &&
        report.reviewValidation.nativeSettlementConfirmed;
    }
    if (["protocol-negative", "unassigned-worker"].includes(options.mode)) {
      const host = JSON.parse(report.execution.stdout);
      const rows = host.creationLedger;
      const common =
        report.execution.status === 2 &&
        report.execution.signal === null &&
        report.execution.error === null &&
        !host.completed &&
        host.cleanupConfirmed === true &&
        host.jobActiveProcesses === 0 &&
        host.profileDeleted === true &&
        host.loopbackExemptionAbsent === true &&
        host.hostMapUnchanged === true &&
        host.rootTokenAndSameJobProven === true &&
        host.rootMapInstalled === true &&
        rows.filter((row) => row.kind === "root").length === 1 &&
        rows.some(
          (row) =>
            row.kind === "root" &&
            row.registered === true &&
            row.jobAssigned === true &&
            row.tokenAndSameJobProven === true &&
            row.mapInstalled === true &&
            row.mapStatus === 0 &&
            row.wait === 0 &&
            row.exitKnown === true &&
            row.pid === host.rootPid &&
            row.parentRegistrationId === null,
        ) &&
        JSON.stringify(report.outputs) ===
          JSON.stringify(report.outputsAfter) &&
        [
          ...report.sources,
          report.driver,
          report.validatorSource,
          ...report.outputs,
        ].every((row) => {
          const current = capture(row.path);
          return current.bytes === row.bytes && current.digest === row.digest;
        }) &&
        rows.every(
          (row) =>
            row.wait === 0 &&
            row.exitKnown === true &&
            [0, 1, 125].includes(row.exit),
        );
      report.negativeVerified =
        common &&
        (options.mode === "protocol-negative"
          ? host.stage === "broker-request-policy" &&
            host.error === 13 &&
            rows.length === 1 &&
            rows[0].exit === 125 &&
            host.requests === 0
          : host.stage === "probe-unassigned-worker" &&
            host.error === 1223 &&
            rows.some(
              (row) =>
                !row.jobAssigned &&
                !row.mapInstalled &&
                row.kind === "unregistered-created-process" &&
                row.exit === 125,
            ));
    }
  } catch (error) {
    report.error = error.stack;
  }
  save();
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      compiler: { type: "string" },
      headers: { type: "string" },
      prepared: { type: "string" },
      "source-closure": { type: "string" },
      mode: { type: "string", default: "original" },
      "review-task": { type: "string" },
      mutant: { type: "string" },
      dependencies: { type: "string" },
      "dependencies-digest": { type: "string" },
    },
  });
  for (const key of [
    "output",
    "compiler",
    "headers",
    "prepared",
    "source-closure",
  ])
    if (!values[key]) throw Error("Required --" + key);
  const report = runPrivateV4Diagnostic({
    ...values,
    sourceClosure: values["source-closure"],
    reviewTask: values["review-task"],
    dependenciesDigest: values["dependencies-digest"],
  });
  console.log(
    JSON.stringify({
      output: path.resolve(values.output),
      status: report.status,
      diagnosticVerified: report.inspection?.diagnosticVerified ?? false,
      negativeVerified: report.negativeVerified ?? false,
      reviewValidation: report.reviewValidation ?? null,
      error: report.error ?? null,
      errors: report.settlement?.errors ?? report.inspection?.errors ?? [],
    }),
  );
  process.exitCode = (
    values.mode.startsWith("review-")
      ? report.reviewValidation?.accepted
      : values.mode === "original"
        ? report.inspection?.diagnosticVerified
        : report.negativeVerified
  )
    ? 0
    : 2;
}
